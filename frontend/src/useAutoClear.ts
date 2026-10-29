import { useEffect } from "react";

/** Mensaje de éxito que se oculta solo tras unos segundos. */
export function useAutoClear(value: string, clear: () => void, ms = 6000) {
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(clear, ms);
    return () => clearTimeout(timer);
  }, [value, clear, ms]);
}
