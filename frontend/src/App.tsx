import { useEffect, useState } from "react";
import "./admin.css";
import { api, setAccessToken, UNAUTHORIZED_EVENT } from "./api";
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

function App() {
  const route = useRoute();
  const [access, setAccess] = useState<Access>("checking");
  const [status, setStatus] = useState<AccessStatus>(OPEN_STATUS);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

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
      setAccess("login");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const logout = () => {
    setAccessToken(null);
    setLoginNotice(null);
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
        <span className={`backend-status backend-${access}`} role="status">
          {access === "checking" && "Conectando…"}
          {access === "ok" && "Conectado"}
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
        {access === "offline" && (
          <section className="card">
            <h2>No se pudo conectar con el servidor de SIM</h2>
            <p>
              Si usas SIM en tu propio equipo, inicia el backend (ver README) y vuelve a cargar
              esta página. Si usas la versión publicada, revisa tu conexión a Internet e inténtalo
              de nuevo.
            </p>
          </section>
        )}
        {access === "login" && (
          <LoginPage status={status} notice={loginNotice} onLoggedIn={() => setAccess("ok")} />
        )}
        {access === "ok" && (
          <>
            {route.page === "inventory" && <InventoryPage />}
            {route.page === "product-new" && <ProductFormPage />}
            {route.page === "product-edit" && <ProductFormPage productId={route.id} />}
            {route.page === "product" && <ProductDetailPage productId={route.id} />}
            {route.page === "categories" && <CategoriesPage />}
            {route.page === "market" && <MarketPage />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
