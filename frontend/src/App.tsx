import { useEffect, useState } from "react";
import "./admin.css";
import { api } from "./api";
import CategoriesPage from "./pages/CategoriesPage";
import InventoryPage from "./pages/InventoryPage";
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

function App() {
  const route = useRoute();
  const [backend, setBackend] = useState<"checking" | "ok" | "offline">("checking");

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then(() => !cancelled && setBackend("ok"))
      .catch(() => !cancelled && setBackend("offline"));
    return () => {
      cancelled = true;
    };
  }, []);

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
        <nav aria-label="Secciones">
          {navItems.map((item) => (
            <a key={item.path} href={item.path} className={item.active ? "active" : ""}>
              {item.label}
            </a>
          ))}
        </nav>
        <span className={`backend-status backend-${backend}`} role="status">
          {backend === "checking" && "Conectando…"}
          {backend === "ok" && "Sistema local conectado"}
          {backend === "offline" && "Sin conexión con el sistema local"}
        </span>
      </header>

      <main className="admin-main">
        {backend === "offline" ? (
          <section className="card">
            <h2>No se pudo conectar con el sistema local</h2>
            <p>
              Inicia el backend (ver README) y vuelve a cargar esta página. Los datos quedan en
              la base local; no se necesita Internet para administrar el inventario.
            </p>
          </section>
        ) : (
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
