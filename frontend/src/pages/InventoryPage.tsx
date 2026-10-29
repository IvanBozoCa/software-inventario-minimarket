import { useEffect, useState } from "react";
import { api } from "../api";
import type { Category, OverviewRow } from "../api";
import { Alert } from "../components/Alert";
import { formatClp, formatContent, formatPercent, formatQuantity } from "../format";
import BarcodeScanner from "../components/BarcodeScanner";
import { hashQuery, navigate, replaceHashQuery } from "../router";
import { findProductByCode } from "../scanner";

type Filter = "all" | "review" | "cost" | "market";
type SortKey = "name" | "price" | "margin" | "status";

const FILTER_PARAM: Record<Filter, string> = { all: "", review: "revisar", cost: "costo", market: "mercado" };

function readFilter(value: string | null): Filter {
  const found = (Object.keys(FILTER_PARAM) as Filter[]).find((key) => FILTER_PARAM[key] === value);
  return found ?? "all";
}

function statusRank(row: OverviewRow): number {
  if (row.needs_review) return 0;
  if (row.cost_pending) return 1;
  if (row.margins_pending) return 2;
  return 3;
}

function compareRows(a: OverviewRow, b: OverviewRow, key: SortKey): number {
  const nullsLast = (x: number | null, y: number | null) =>
    x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : x - y;
  switch (key) {
    case "price":
      return nullsLast(a.sale_price_clp, b.sale_price_clp);
    case "margin":
      return nullsLast(
        a.current_gross_margin === null ? null : Number(a.current_gross_margin),
        b.current_gross_margin === null ? null : Number(b.current_gross_margin),
      );
    case "status":
      return statusRank(a) - statusRank(b);
    default:
      return a.name.localeCompare(b.name, "es");
  }
}

export default function InventoryPage() {
  // Los filtros viven en la dirección (#/?q=…&filtro=revisar) para que se
  // conserven al volver desde la ficha de un producto.
  const [initialQuery] = useState(() => hashQuery());
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState(initialQuery.get("q") ?? "");
  const [categoryId, setCategoryId] = useState(initialQuery.get("categoria") ?? "");
  const [includeInactive, setIncludeInactive] = useState(initialQuery.get("inactivos") === "1");
  const [filter, setFilter] = useState<Filter>(readFilter(initialQuery.get("filtro")));
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: (initialQuery.get("orden")?.replace(/^-/, "") as SortKey) || "name",
    desc: initialQuery.get("orden")?.startsWith("-") ?? false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [hasCategories, setHasCategories] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState("");
  const [scanError, setScanError] = useState("");

  useEffect(() => {
    api
      .categories(true)
      .then((data) => {
        setCategories(data);
        setHasCategories(data.length > 0);
      })
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    replaceHashQuery({
      q: search.trim(),
      categoria: categoryId,
      inactivos: includeInactive ? "1" : "",
      filtro: FILTER_PARAM[filter],
      orden: sort.key === "name" && !sort.desc ? "" : `${sort.desc ? "-" : ""}${sort.key}`,
    });
  }, [search, categoryId, includeInactive, filter, sort]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .overview({ search, categoryId, includeInactive })
        .then((data) => {
          if (cancelled) return;
          setRows(data);
          setError("");
        })
        .catch((err: Error) => !cancelled && setError(err.message))
        .finally(() => !cancelled && setLoading(false));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, categoryId, includeInactive, attempt]);

  const visible = rows
    .filter((row) => {
      if (filter === "review") return row.needs_review;
      if (filter === "cost") return row.cost_pending;
      if (filter === "market") return row.market_reference_count === 0;
      return true;
    })
    .sort((a, b) => compareRows(a, b, sort.key) * (sort.desc ? -1 : 1));

  const searching = search.trim() !== "" || categoryId !== "";

  function sortBy(key: SortKey) {
    setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }));
  }

  function sortHeader(label: string, sortKey: SortKey, className?: string) {
    const active = sort.key === sortKey;
    return (
      <th key={sortKey} className={className} aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}>
        <button type="button" className="sort" onClick={() => sortBy(sortKey)}>
          {label}
          {active ? (sort.desc ? " ▼" : " ▲") : ""}
        </button>
      </th>
    );
  }

  // Al escanear: si el producto ya existe se abre su ficha; si no, se crea con
  // el código ya completado.
  async function openScanned(code: string) {
    setScanning(false);
    setLookup(`Buscando el código ${code}…`);
    setScanError("");
    try {
      const product = await findProductByCode(code);
      navigate(
        product ? `/productos/${product.id}` : `/productos/nuevo?codigo=${encodeURIComponent(code)}`,
      );
    } catch (err) {
      setScanError((err as Error).message);
    } finally {
      setLookup("");
    }
  }

  const counts = {
    review: rows.filter((r) => r.needs_review).length,
    cost: rows.filter((r) => r.cost_pending).length,
    market: rows.filter((r) => r.market_reference_count === 0).length,
  };

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Inventario</h2>
          <p className="page-intro">Productos del minimarket con su cantidad, precio actual y estado de la información.</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" onClick={() => setScanning(true)} disabled={Boolean(lookup)}>
            Escanear código
          </button>
          <a className="button primary" href="#/productos/nuevo">
            Nuevo producto
          </a>
        </div>
      </div>

      {scanning && (
        <BarcodeScanner
          title="Escanear producto"
          onDetected={openScanned}
          onClose={() => setScanning(false)}
        />
      )}
      {lookup && <Alert kind="info">{lookup}</Alert>}
      {scanError && <Alert kind="danger">No se pudo buscar el código. {scanError}</Alert>}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, marca o código"
          aria-label="Buscar producto"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Filtrar por categoría"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Todas las categorías</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.active ? "" : " (inactiva)"}
            </option>
          ))}
        </select>
        <label className="inline">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          Mostrar inactivos
        </label>
      </div>

      <div className="filter-tabs" role="group" aria-label="Filtrar por estado">
        <FilterChip label="Todos" count={rows.length} value="all" current={filter} onSelect={setFilter} />
        <FilterChip
          label="Precio por revisar"
          count={counts.review}
          tone="danger"
          value="review"
          current={filter}
          onSelect={setFilter}
        />
        <FilterChip
          label="Costo pendiente"
          count={counts.cost}
          tone="warn"
          value="cost"
          current={filter}
          onSelect={setFilter}
        />
        <FilterChip
          label="Sin referencias de mercado"
          count={counts.market}
          value="market"
          current={filter}
          onSelect={setFilter}
        />
      </div>

      <div className="card table-wrap">
        {loading && rows.length === 0 && !error ? (
          <p className="empty">Cargando…</p>
        ) : error ? (
          <div className="empty">
            <Alert kind="danger">No se pudo cargar el inventario. {error}</Alert>
            <button type="button" className="primary" onClick={() => setAttempt((value) => value + 1)}>
              Reintentar
            </button>
          </div>
        ) : rows.length === 0 && searching ? (
          <div className="empty">
            <p>
              {search.trim()
                ? `Ningún producto coincide con «${search.trim()}».`
                : "No hay productos en esta categoría."}
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setCategoryId("");
              }}
            >
              Borrar búsqueda
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p>Todavía no hay productos. Para que SIM te muestre el rango de precios, conviene seguir este orden:</p>
            <ol className="steps">
              <li>
                <a href="#/categorias">Crea las categorías y sus márgenes</a>
                {hasCategories ? " (ya tienes algunas)." : "."}
              </li>
              <li>
                <a href="#/productos/nuevo">Agrega tus productos</a> con su precio y su último costo.
              </li>
              <li>
                <a href="#/mercado">Registra precios de mercado</a> para comparar.
              </li>
            </ol>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <p>Ningún producto coincide con el filtro.</p>
            <button type="button" onClick={() => setFilter("all")}>
              Ver todos
            </button>
          </div>
        ) : (
          <table className="cards inventory-table">
            <thead>
              <tr>
                {sortHeader("Producto", "name")}
                <th>Categoría</th>
                <th className="num">Cantidad</th>
                {sortHeader("Precio venta", "price", "num")}
                <th className="num">Costo unit.</th>
                {sortHeader("Margen bruto", "margin", "num")}
                {sortHeader("Estado", "status")}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className={row.active ? "" : "inactive"}>
                  <td>
                    <a className="row-link" href={`#/productos/${row.id}`}>
                      {row.name}
                    </a>
                    <span className="sub">
                      {[row.brand, row.variant, formatContent(row.content_amount, row.content_unit)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </td>
                  <td data-label="Categoría">{row.category_name ?? <span className="muted">Sin categoría</span>}</td>
                  <td className="num" data-label="Cantidad">
                    {row.track_stock ? formatQuantity(row.quantity, row.stock_unit) : "—"}
                  </td>
                  <td className="num price">{formatClp(row.sale_price_clp)}</td>
                  <td className="num" data-label="Costo">{formatClp(row.total_unit_cost_clp)}</td>
                  <td className="num" data-label="Margen">{formatPercent(row.current_gross_margin)}</td>
                  <td>
                    <div className="chips">
                      {!row.active && <span className="chip">Inactivo</span>}
                      {row.needs_review && <span className="chip danger">Revisar precio</span>}
                      {row.cost_pending && <span className="chip warn">Costo pendiente</span>}
                      {row.margins_pending && !row.cost_pending && (
                        <span className="chip warn">Márgenes sin definir</span>
                      )}
                      {row.market_reference_count === 0 ? (
                        <span className="chip subtle">Sin referencias</span>
                      ) : row.market_references_stale ? (
                        <span className="chip warn">Referencia por verificar</span>
                      ) : (
                        <span className="chip ok">{row.market_reference_count} ref.</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function FilterChip({
  label,
  count,
  tone,
  value,
  current,
  onSelect,
}: {
  label: string;
  count: number;
  tone?: "danger" | "warn";
  value: Filter;
  current: Filter;
  onSelect: (value: Filter) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={current === value}
      aria-label={`${label} (${count})`}
      onClick={() => onSelect(value)}
    >
      {label}
      <span className={`count ${count > 0 && tone ? tone : ""}`} aria-hidden="true">
        {count}
      </span>
    </button>
  );
}
