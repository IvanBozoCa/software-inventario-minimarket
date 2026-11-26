import { useEffect, useState } from "react";
import { canPromptInstall, INSTALL_READY_EVENT, isIos, isStandalone, promptInstall } from "../pwa";

const DISMISSED_KEY = "sim-install-dismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Invita a instalar SIM en la pantalla de inicio del celular. En Android usa
 * el diálogo de Chrome; en iPhone explica el paso por el menú Compartir, que
 * Safari no permite abrir desde la página.
 */
export default function InstallBanner() {
  const [ready, setReady] = useState(canPromptInstall);
  const [hidden, setHidden] = useState(() => isStandalone() || wasDismissed());

  useEffect(() => {
    const onReady = () => setReady(true);
    window.addEventListener(INSTALL_READY_EVENT, onReady);
    return () => window.removeEventListener(INSTALL_READY_EVENT, onReady);
  }, []);

  if (hidden) return null;
  const ios = isIos();
  if (!ready && !ios) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // sin almacenamiento: se oculta solo por ahora
    }
    setHidden(true);
  };

  return (
    <div className="alert info install-banner" role="status">
      {ready ? (
        <p>
          <strong>Instala SIM en tu celular</strong> para abrirlo como una app, a pantalla completa y con su
          ícono en el inicio.
        </p>
      ) : (
        <p>
          <strong>Instala SIM en tu iPhone:</strong> toca el botón Compartir de Safari (el cuadrado con la
          flecha hacia arriba) y luego «Agregar a inicio».
        </p>
      )}
      <div className="actions">
        {ready && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              void promptInstall().then((installed) => {
                setReady(false);
                if (installed) setHidden(true);
              });
            }}
          >
            Instalar
          </button>
        )}
        <button type="button" className="link" onClick={dismiss}>
          Ahora no
        </button>
      </div>
    </div>
  );
}
