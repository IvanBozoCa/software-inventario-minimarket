// Instalación de SIM como app en el celular (PWA).

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const INSTALL_READY_EVENT = "sim:install-ready";

let deferredPrompt: InstallPromptEvent | null = null;

/** Se llama una vez al cargar: guarda el aviso de instalación de Chrome (Android). */
export function listenForInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_READY_EVENT));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
  });
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

/** Abre el diálogo "Instalar app" de Chrome. Devuelve true si se instaló. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = null;
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === "accepted";
}

export function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone);
}

export function isIos(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS se presenta como Mac con pantalla táctil.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
}

/** Registra el service worker (solo en producción, para no interferir con Vite). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // sin service worker SIM funciona igual, solo no se instala offline
    });
  });
}
