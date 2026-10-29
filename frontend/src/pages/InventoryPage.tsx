import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Category, OverviewRow } from "../api";
import { Alert } from "../components/Alert";
import {
  MAX_PRICE_CLP,
  STOCK_UNIT_LABEL,
  formatClp,
  formatContent,
  formatPercent,
  formatQuantity,
  priceWarning,
  readNumberField,
  toNumberInput,
} from "../format";
import BarcodeScanner from "../components/BarcodeScanner";
import QuickEdit from "../components/QuickEdit";
import { hashQuery, navigate, replaceHashQuery } from "../router";
import { findProductByCode } from "../scanner";
import { useAutoClear } from "../useAutoClear";

type Filter = "all" | "noprice" | "review" | "cost" | "market";
type SortKey = "name" | "price" | "margin" | "status";

const FILTER_PARAM: Record<Filter, string> = {
  all: "",
  noprice: "sin-precio",
  review: "revisar",
  cost: "costo",
  market: "mercado",
};

function readFilter(value: string | null): Filter {
  const found = (Object.keys(FILTER_PARAM) as Filter[]).find((key) => FILTER_PARAM[key] === value);
  return found ?? "all";
}

function statusRank(row: OverviewRow): number {
  if (row.sale_price_clp === null) return -1;
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
  // Solo una celda se edita a la vez: el precio o la cantidad de un producto.
  const [editing, setEditing] = useState<{ id: string; field: "price" | "stock" } | null>(null);
  const [saved, setSaved] = useState("");
  const clearSaved = useCallback(() => setSaved(""), []);
  useAutoClear(saved, clearSaved, 4000);

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
      if (filter === "noprice") return row.sale_price_clp === null;
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

  function updateRow(id: string, changes: Partial<OverviewRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }

  // El precio pasa por la misma API que la ficha, así queda en el historial.
  // Al ponerle precio a un producto que no tenía, se abre el siguiente sin
  // precio de la lista para seguir de corrido.
  async function savePrice(row: OverviewRow, price: number) {
    const next =
      row.sale_price_clp === null
        ? visible.find((other, index) => index > visible.indexOf(row) && other.sale_price_clp === null)
        : undefined;
    await api.updatePrice(row.id, price, "Desde el inventario");
    const cost = row.total_unit_cost_clp === null ? null : Number(row.total_unit_cost_clp);
    updateRow(row.id, {
      sale_price_clp: price,
      current_gross_margin: cost === null || price === 0 ? null : String((price - cost) / price),
    });
    setSaved(`Precio de ${row.name}: ${formatClp(price)}.`);
    setEditing(next ? { id: next.id, field: "price" } : null);
    setAttempt((value) => value + 1);
  }

  async function saveStock(row: OverviewRow, quantity: string) {
    await api.updateStock(row.id, quantity, "Conteo desde el inventario");
    updateRow(row.id, { quantity });
    setSaved(`Cantidad de ${row.name}: ${formatQuantity(quantity, row.stock_unit)}.`);
    setEditing(null);
    setAttempt((value) => value + 1);
  }

  const counts = {
    noprice: rows.filter((r) => r.sale_price_clp === null).length,
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
      {saved && (
        <div className="toast" role="status">
          ✓ {saved}
        </div>
      )}
      {counts.noprice > 0 && filter === "all" && (
        <div className="noprice-banner">
          <span>
            {counts.noprice === 1 ? "1 producto no tiene" : `${counts.noprice} productos no tienen`} precio de venta.
          </span>
          <button type="button" className="primary" onClick={() => setFilter("noprice")}>
            Ponerles precio
          </button>
        </div>
      )}

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
          label="Sin precio"
          count={counts.noprice}
          tone="danger"
          value="noprice"
          current={filter}
          onSelect={setFilter}
        />
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
          <table className="cards compact-cards inventory-table">
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
                    {!row.track_stock ? (
                      "—"
                    ) : editing?.id === row.id && editing.field === "stock" ? (
                      <QuickEdit
                        label={`Cantidad de ${row.name} (${STOCK_UNIT_LABEL[row.stock_unit]})`}
                        initial={toNumberInput(row.quantity)}
                        inputMode={row.stock_unit === "UNIT" ? "numeric" : "decimal"}
                        placeholder={row.stock_unit === "UNIT" ? "Ej.: 24" : "Ej.: 1,5"}
                        validate={(raw) => readQuantity(raw, row)}
                        onSave={(quantity) => saveStock(row, quantity)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="quick-edit"
                        title="Cambiar cantidad"
                        aria-label={`Cambiar cantidad de ${row.name}`}
                        onClick={() => {
                          setSaved("");
                          setEditing({ id: row.id, field: "stock" });
                        }}
                      >
                        {formatQuantity(row.quantity, row.stock_unit)}
                        <PencilIcon />
                      </button>
                    )}
                  </td>
                  <td className="num price">
                    {editing?.id === row.id && editing.field === "price" ? (
                      <QuickEdit
                        key={row.id}
                        label={`Precio de venta de ${row.name}`}
                        initial={toNumberInput(row.sale_price_clp)}
                        inputMode="numeric"
                        placeholder="Ej.: 1.990"
                        validate={readPrice}
                        confirm={(price) =>
                          priceWarning(
                            price,
                            row.sale_price_clp,
                            row.total_unit_cost_clp === null ? null : Number(row.total_unit_cost_clp),
                          )
                        }
                        onSave={(price) => savePrice(row, price)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : row.sale_price_clp === null ? (
                      <button
                        type="button"
                        className="quick-edit missing"
                        aria-label={`Poner precio a ${row.name}`}
                        onClick={() => {
                          setSaved("");
                          setEditing({ id: row.id, field: "price" });
                        }}
                      >
                        + Poner precio
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="quick-edit"
                        title="Cambiar precio"
                        aria-label={`Cambiar precio de ${row.name}: ${formatClp(row.sale_price_clp)}`}
                        onClick={() => {
                          setSaved("");
                          setEditing({ id: row.id, field: "price" });
                        }}
                      >
                        {formatClp(row.sale_price_clp)}
                        <PencilIcon />
                      </button>
                    )}
                  </td>
                  <td className="num" data-label="Costo">{formatClp(row.total_unit_cost_clp)}</td>
                  <td className="num" data-label="Margen">{formatPercent(row.current_gross_margin)}</td>
                  <td>
                    <div className="chips">
                      {!row.active && <span className="chip">Inactivo</span>}
                      {row.sale_price_clp === null && <span className="chip danger">Sin precio</span>}
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

function readPrice(raw: string): number {
  return Number(
    readNumberField(raw, "el precio", { required: true, integer: true, max: MAX_PRICE_CLP, example: "1.990" }),
  );
}

function readQuantity(raw: string, row: OverviewRow): string {
  const value = readNumberField(raw, "la cantidad", {
    required: true,
    example: row.stock_unit === "UNIT" ? "24" : "1,5",
  }) as string;
  if (row.stock_unit === "UNIT" && !Number.isInteger(Number(value))) {
    throw new Error("Este producto se cuenta por unidades: la cantidad va sin decimales.");
  }
  return value;
}

function PencilIcon() {
  return (
    <svg className="pencil" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M11.3 2.3a1.4 1.4 0 0 1 2 2L5.6 12l-2.8.8.8-2.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
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
