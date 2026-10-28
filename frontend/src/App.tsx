import { useEffect, useState } from "react";
import "./admin.css";
import { api, setAccessToken, UNAUTHORIZED_EVENT } from "./api";
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
// contraseña y no hay sesión · "offline": el backend no responde.
type Access = "checking" | "ok" | "login" | "offline";

function App() {
  const route = useRoute();
  const [access, setAccess] = useState<Access>("checking");
  const [passwordRequired, setPasswordRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .accessStatus()
      .then((status) => {
        if (cancelled) return;
        setPasswordRequired(status.required);
        setAccess(status.authenticated ? "ok" : "login");
      })
      .catch(() => !cancelled && setAccess("offline"));

    const onUnauthorized = () => {
      setAccessToken(null);
      setPasswordRequired(true);
      setAccess("login");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const logout = () => {
    setAccessToken(null);
    setAccess("login");
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
        {access === "ok" && passwordRequired && (
          <button type="button" className="link" onClick={logout}>
            Cerrar sesión
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
        {access === "login" && <LoginPage onLoggedIn={() => setAccess("ok")} />}
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
