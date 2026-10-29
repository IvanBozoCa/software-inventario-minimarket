import { useEffect, useState } from "react";
import "./admin.css";
import { api, OFFLINE_EVENT, ONLINE_EVENT, setAccessToken, UNAUTHORIZED_EVENT } from "./api";
import type { AccessStatus } from "./api";
import { applySession, supabaseClient } from "./auth/supabase";
import CategoriesPage from "./pages/CategoriesPage";
import InventoryPage from "./pages/InventoryPage";
import LoginPage from "./pages/LoginPage";
import MarketPage from "./pages/MarketPage";
import ProductDetailPage from "./pages/ProductDetailPage";
import ProductFormPage from "./pages/ProductFormPage";
import { parseRoute } from "./router";
import type { Route } from "./router";

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

// "checking": consultando el backend · "ok": listo · "login": el backend exige
// acceso y no hay sesión · "offline": el backend no responde.
type Access = "checking" | "ok" | "login" | "offline";

const OPEN_STATUS: AccessStatus = { required: false, authenticated: true, expires_at: null, mode: "none" };

function hasSupabase(status: AccessStatus): status is AccessStatus & {
  supabase_url: string;
  supabase_anon_key: string;
} {
  return status.mode === "supabase" && !!status.supabase_url && !!status.supabase_anon_key;
}

const PAGE_TITLE: Record<Route["page"], string> = {
  inventory: "Inventario",
  "product-new": "Nuevo producto",
  "product-edit": "Editar producto",
  product: "Ficha del producto",
  categories: "Categorías y márgenes",
  market: "Precios de mercado",
};

function App() {
  const route = useRoute();
  const [access, setAccess] = useState<Access>("checking");
  const [status, setStatus] = useState<AccessStatus>(OPEN_STATUS);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  // Cambia para volver a consultar el servidor (botón Reintentar o reintento automático).
  const [attempt, setAttempt] = useState(0);
  // La conexión se perdió después de entrar: la pantalla sigue, pero la cabecera lo dice.
  const [connectionLost, setConnectionLost] = useState(false);
  // Se entró al menos una vez: las pantallas se mantienen montadas (ocultas)
  // si la sesión vence, para no perder lo que se estaba escribiendo.
  const [hasEntered, setHasEntered] = useState(false);

  if (access === "ok" && !hasEntered) setHasEntered(true);

  useEffect(() => {
    document.title = `${PAGE_TITLE[route.page]} · SIM`;
  }, [route.page]);

  useEffect(() => {
    const onOffline = () => setConnectionLost(true);
    const onOnline = () => setConnectionLost(false);
    window.addEventListener(OFFLINE_EVENT, onOffline);
    window.addEventListener(ONLINE_EVENT, onOnline);
    return () => {
      window.removeEventListener(OFFLINE_EVENT, onOffline);
      window.removeEventListener(ONLINE_EVENT, onOnline);
    };
  }, []);

  // Sin conexión al abrir: se reintenta solo cada 10 segundos.
  useEffect(() => {
    if (access !== "offline") return;
    const timer = setTimeout(() => setAttempt((value) => value + 1), 10000);
    return () => clearTimeout(timer);
  }, [access, attempt]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    // En modo Supabase el JWT de la sesión es el token de la API; tras obtenerlo
    // se vuelve a consultar /auth/status para confirmar que el correo está autorizado.
    const verifySupabaseSession = async (initial: AccessStatus) => {
      const supabase = supabaseClient(initial.supabase_url!, initial.supabase_anon_key!);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        applySession(session);
        const confirmed = await api.accessStatus();
        if (cancelled) return;
        if (confirmed.authenticated) {
          setStatus(confirmed);
          setAccess("ok");
        } else {
          setLoginNotice(
            `El correo ${session.user?.email ?? "usado"} no está autorizado para entrar a SIM.`,
          );
          await supabase.auth.signOut();
          setAccessToken(null);
          setAccess("login");
        }
      } else {
        setAccess("login");
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === "SIGNED_OUT") {
          setAccessToken(null);
          setAccess("login");
          return;
        }
        if (newSession && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
          applySession(newSession);
          if (event === "SIGNED_IN") {
            void verifySupabaseSession(initial);
          }
        }
      });
      unsubscribe();
      unsubscribe = () => subscription.unsubscribe();
    };

    api
      .accessStatus()
      .then((initial) => {
        if (cancelled) return;
        setStatus(initial);
        if (initial.authenticated) {
          setAccess("ok");
          return;
        }
        if (hasSupabase(initial)) {
          return verifySupabaseSession(initial).catch(() => !cancelled && setAccess("login"));
        }
        setAccess("login");
      })
      .catch(() => !cancelled && setAccess("offline"));

    const onUnauthorized = () => {
      setAccessToken(null);
      setStatus((current) => ({ ...current, required: true, authenticated: false }));
      setLoginNotice(
        "Tu sesión venció y el último cambio no se guardó. Vuelve a entrar: lo que estabas escribiendo se conserva para que lo guardes de nuevo.",
      );
      setAccess("login");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [attempt]);

  const logout = () => {
    setAccessToken(null);
    setLoginNotice(null);
    setHasEntered(false);
    setAccess("login");
    if (hasSupabase(status)) {
      void supabaseClient(status.supabase_url, status.supabase_anon_key).auth.signOut();
    }
  };

  const navItems: { path: string; label: string; active: boolean }[] = [
    {
      path: "#/",
      label: "Inventario",
      active: ["inventory", "product", "product-new", "product-edit"].includes(route.page),
    },
    { path: "#/categorias", label: "Categorías y márgenes", active: route.page === "categories" },
    { path: "#/mercado", label: "Precios de mercado", active: route.page === "market" },
  ];

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-brand-kicker">SIM</span>
          <h1>Inventario y precios</h1>
        </div>
        {access === "ok" && (
          <nav aria-label="Secciones">
            {navItems.map((item) => (
              <a key={item.path} href={item.path} className={item.active ? "active" : ""}>
                {item.label}
              </a>
            ))}
          </nav>
        )}
        <span
          className={`backend-status backend-${access === "ok" && connectionLost ? "warn" : access}`}
          role="status"
        >
          {access === "checking" && "Conectando…"}
          {access === "ok" && (connectionLost ? "Sin conexión" : "Conectado")}
          {access === "login" && "Sesión requerida"}
          {access === "offline" && "Sin conexión con el servidor"}
        </span>
        {access === "ok" && status.required && (
          <button type="button" className="link" onClick={logout}>
            {status.email ? `Cerrar sesión (${status.email})` : "Cerrar sesión"}
          </button>
        )}
      </header>

      <main className="admin-main">
        {access === "checking" && <p className="loading-screen">Cargando SIM…</p>}
        {access === "offline" && (
          <section className="card">
            <h2>No se pudo conectar con el servidor de SIM</h2>
            <p>
              Revisa tu conexión a Internet. SIM vuelve a intentarlo solo cada 10 segundos, o
              puedes intentarlo ahora.
            </p>
            <button type="button" className="primary" onClick={() => setAttempt((value) => value + 1)}>
              Reintentar
            </button>
          </section>
        )}
        {access === "login" && (
          <LoginPage
            status={status}
            notice={loginNotice}
            onLoggedIn={() => {
              setLoginNotice(null);
              setAccess("ok");
            }}
          />
        )}
        {(access === "ok" || hasEntered) && (
          <div hidden={access !== "ok"}>
            {route.page === "inventory" && <InventoryPage />}
            {route.page === "product-new" && (
              <ProductFormPage key={route.barcode ?? ""} initialBarcode={route.barcode} />
            )}
            {route.page === "product-edit" && <ProductFormPage key={route.id} productId={route.id} />}
            {route.page === "product" && <ProductDetailPage key={route.id} productId={route.id} />}
            {route.page === "categories" && <CategoriesPage />}
            {route.page === "market" && <MarketPage />}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
