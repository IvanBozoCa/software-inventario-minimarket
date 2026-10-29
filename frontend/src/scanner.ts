// Lectura de códigos de barras (EAN/UPC y otros lineales) y QR desde la cámara
// o desde una foto. Usa el BarcodeDetector del navegador cuando existe
// (Chrome/Android) y, si no, la librería ZXing (Safari/iPhone, Firefox), que
// se carga solo al abrir el escáner para no agrandar la carga inicial.

import { ApiError, api } from "./api";
import type { Product } from "./api";
import type { DecodeHintType as HintType } from "@zxing/library";

const NATIVE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
  "qr_code",
];

// Largo máximo que acepta el backend para el código de un producto.
export const MAX_CODE_LENGTH = 64;

// Las fotos de celular son enormes; reducirlas acelera la lectura sin perder
// las barras.
const MAX_IMAGE_SIDE = 1600;

type DetectedBarcode = { rawValue: string };
type NativeDetector = { detect(source: ImageBitmapSource): Promise<DetectedBarcode[]> };
type NativeDetectorClass = {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
};

export type ScanControls = { stop: () => void };

export class CameraUnavailableError extends Error {}

function nativeDetectorClass(): NativeDetectorClass | null {
  const candidate = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  return candidate ?? null;
}

let nativeDetector: Promise<NativeDetector | null> | null = null;

function getNativeDetector(): Promise<NativeDetector | null> {
  nativeDetector ??= (async () => {
    const Detector = nativeDetectorClass();
    if (!Detector) return null;
    try {
      const supported = await Detector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
      // Sin EAN-13 no sirve para productos de supermercado: mejor usar ZXing.
      if (!formats.includes("ean_13")) return null;
      return new Detector({ formats });
    } catch {
      return null;
    }
  })();
  return nativeDetector;
}

async function zxingReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map<HintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
}

export function cleanCode(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

// Un mismo envase puede leerse como UPC-A (12 dígitos) o como EAN-13 con un
// cero adelante según el lector; al buscar se prueban ambas formas.
export function codeVariants(code: string): string[] {
  const variants = [code];
  if (/^\d{12}$/.test(code)) variants.push(`0${code}`);
  if (/^0\d{12}$/.test(code)) variants.push(code.slice(1));
  return variants;
}

/** Busca el producto con ese código (o su forma UPC/EAN equivalente). */
export async function findProductByCode(code: string): Promise<Product | null> {
  for (const variant of codeVariants(code)) {
    try {
      return await api.productByBarcode(variant);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  return null;
}

async function loadImage(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Lee el primer código de una foto. Devuelve null si no encuentra ninguno. */
export async function decodeImageFile(file: Blob): Promise<string | null> {
  let canvas: HTMLCanvasElement;
  try {
    canvas = await loadImage(file);
  } catch {
    throw new Error("No se pudo abrir la imagen. Prueba con una foto JPG o PNG.");
  }

  const detector = await getNativeDetector();
  if (detector) {
    try {
      const found = await detector.detect(canvas);
      const value = found.map((item) => cleanCode(item.rawValue)).find(Boolean);
      if (value) return value;
    } catch {
      // se intenta con ZXing
    }
  }

  const reader = await zxingReader();
  try {
    return cleanCode(reader.decodeFromCanvas(canvas).getText()) || null;
  } catch {
    return null;
  }
}

function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function cameraError(error: unknown): CameraUnavailableError {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new CameraUnavailableError(
      "No hay permiso para usar la cámara. Actívalo en el navegador o usa una foto.",
    );
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new CameraUnavailableError("No se encontró una cámara en este equipo. Usa una foto.");
  }
  if (name === "NotReadableError") {
    return new CameraUnavailableError("La cámara está ocupada por otra aplicación. Ciérrala o usa una foto.");
  }
  return new CameraUnavailableError("No se pudo abrir la cámara. Usa una foto.");
}

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

/**
 * Muestra la cámara trasera en `video` y llama a `onCode` con el primer código
 * leído. La lectura se detiene sola al encontrar un código o con `stop()`.
 */
export async function startCameraScan(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<ScanControls> {
  if (!cameraSupported()) {
    throw new CameraUnavailableError(
      "Este navegador no permite usar la cámara aquí (requiere HTTPS). Usa una foto.",
    );
  }

  const [detector, stream] = await Promise.all([
    getNativeDetector(),
    navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS).catch((error: unknown) => {
      throw cameraError(error);
    }),
  ]);
  // Sin lector nativo se usa ZXing sobre una copia reducida de cada cuadro.
  const reader = detector ? null : await zxingReader().catch(() => null);
  const canvas = document.createElement("canvas");

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };

  video.srcObject = stream;
  video.muted = true;
  video.setAttribute("playsinline", "true");
  await video.play().catch(() => undefined);

  const readFrame = async (): Promise<string | null> => {
    if (detector) {
      const found = await detector.detect(video);
      return found.map((item) => cleanCode(item.rawValue)).find(Boolean) ?? null;
    }
    if (!reader) return null;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return cleanCode(reader.decodeFromCanvas(canvas).getText()) || null;
  };

  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const value = await readFrame();
        if (value && !stopped) {
          stop();
          onCode(value);
          return;
        }
      } catch {
        // cuadro sin código o ilegible: se reintenta
      }
    }
    timer = setTimeout(tick, 200);
  };
  void tick();
  return { stop };
}
