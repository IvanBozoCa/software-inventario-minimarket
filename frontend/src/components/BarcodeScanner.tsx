import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { CameraUnavailableError, MAX_CODE_LENGTH, decodeImageFile, startCameraScan } from "../scanner";

type CameraState = "starting" | "scanning" | "unavailable";

// Ventana para leer el código de un producto con la cámara en vivo o con una
// foto. Llama a `onDetected` con el texto leído (código de barras o QR).
export default function BarcodeScanner({
  title = "Escanear código",
  onDetected,
  onClose,
}: {
  title?: string;
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [cameraMessage, setCameraMessage] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Se guarda la última versión de los callbacks para no reiniciar la cámara
  // cuando el componente padre vuelve a renderizar.
  const handlers = useRef({ onDetected, onClose });
  useEffect(() => {
    handlers.current = { onDetected, onClose };
  });

  function accept(code: string): boolean {
    if (code.length > MAX_CODE_LENGTH) {
      setMessage(
        `El código leído tiene ${code.length} caracteres y el máximo es ${MAX_CODE_LENGTH}. Prueba con el código de barras del envase.`,
      );
      return false;
    }
    handlers.current.onDetected(code);
    return true;
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let controls: { stop: () => void } | null = null;

    // Se espera un ciclo antes de abrir la cámara: si el componente se monta y
    // desmonta de inmediato (React en modo estricto), no quedan dos lecturas
    // peleando por el mismo <video>.
    const timer = setTimeout(() => {
      startCameraScan(video, (code) => {
        if (!cancelled && !accept(code)) setCamera("unavailable");
      })
        .then((started) => {
          if (cancelled) {
            started.stop();
            return;
          }
          controls = started;
          setCamera("scanning");
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setCamera("unavailable");
          setCameraMessage(
            error instanceof CameraUnavailableError ? error.message : "No se pudo abrir la cámara. Usa una foto.",
          );
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controls?.stop();
    };
    // accept usa handlers.current: la cámara se abre una sola vez.
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handlers.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function readPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const code = await decodeImageFile(file);
      if (code) {
        accept(code);
      } else {
        setMessage(
          "No se encontró un código en la foto. Acércate para que las barras se vean nítidas, con buena luz y sin reflejos.",
        );
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="card scanner-card">
        <div className="scanner-head">
          <h3>{title}</h3>
          <button type="button" onClick={() => handlers.current.onClose()} aria-label="Cerrar escáner">
            Cerrar
          </button>
        </div>

        <div className={`scanner-view ${camera === "unavailable" ? "hidden" : ""}`}>
          <video ref={videoRef} playsInline muted aria-label="Vista de la cámara" />
          <div className="scanner-frame" aria-hidden="true" />
        </div>
        {camera === "starting" && <p className="muted">Abriendo la cámara…</p>}
        {camera === "scanning" && (
          <p className="muted">Apunta al código de barras o QR del producto. Se lee solo.</p>
        )}

        {cameraMessage && <p className="muted">{cameraMessage}</p>}
        {message && (
          <div className="alert warn" role="alert">
            {message}
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className={camera === "unavailable" ? "primary" : ""}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Leyendo foto…" : "Tomar o elegir foto"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={readPhoto}
            hidden
            aria-label="Foto del código"
          />
        </div>
      </div>
    </div>
  );
}
