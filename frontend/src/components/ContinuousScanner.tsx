import { useEffect, useRef, useState } from "react";
import { CameraUnavailableError, MAX_CODE_LENGTH, startCameraScan } from "../scanner";

// Mismo código leído otra vez antes de este tiempo = el mismo producto aún
// frente a la cámara, no una segunda unidad.
export const REPEAT_WINDOW_MS = 1500;

/**
 * Cámara siempre encendida para la caja, como una pistola lectora: cada código
 * nuevo llama a `onCode`. Para sumar otra unidad del mismo producto basta con
 * retirarlo y volver a mostrarlo, o usar el botón + del carro.
 */
export default function ContinuousScanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "scanning" | "unavailable">("starting");
  const [message, setMessage] = useState("");
  const handler = useRef(onCode);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    handler.current = onCode;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    const timer = setTimeout(() => {
      startCameraScan(
        video,
        (code) => {
          if (cancelled || code.length > MAX_CODE_LENGTH) return;
          const now = Date.now();
          const previous = last.current;
          last.current = { code, at: now };
          if (previous.code === code && now - previous.at < REPEAT_WINDOW_MS) return;
          handler.current(code);
        },
        { continuous: true },
      )
        .then((started) => {
          if (cancelled) return started.stop();
          controls = started;
          setState("scanning");
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setState("unavailable");
          setMessage(
            error instanceof CameraUnavailableError
              ? error.message
              : "No se pudo abrir la cámara. Busca los productos por nombre.",
          );
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controls?.stop();
    };
  }, []);

  return (
    <div className={`pos-camera ${state}`}>
      <video ref={videoRef} muted playsInline aria-label="Cámara para escanear productos" />
      {state === "scanning" && <span className="pos-camera-line" aria-hidden="true" />}
      {state === "starting" && <p className="pos-camera-msg">Abriendo la cámara…</p>}
      {state === "unavailable" && <p className="pos-camera-msg">{message}</p>}
    </div>
  );
}
