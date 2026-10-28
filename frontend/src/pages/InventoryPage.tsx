import { useEffect, useState } from "react";
import { api } from "../api";
import type { Category, OverviewRow } from "../api";
import { formatClp, formatContent, formatPercent, formatQuantity } from "../format";

type Filter = "all" | "review" | "cost" | "market";

export default function InventoryPage() {
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.categories(true).then(setCategories).catch(() => setCategories([]));
  }, []);

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
  }, [search, categoryId, includeInactive]);

  const visible = rows.filter((row) => {
    if (filter === "review") return row.needs_review;
    if (filter === "cost") return row.cost_pending;
    if (filter === "market") return row.market_reference_count === 0;
    return true;
  });

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
          <p>Productos del minimarket con su cantidad, precio actual y estado de la información.</p>
        </div>
        <a href="#/productos/nuevo">
          <button type="button" className="primary">
            Nuevo producto
          </button>
        </a>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre o marca"
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

      <div className="chips" style={{ marginBottom: "1rem" }}>
        <FilterChip label={`Todos (${rows.length})`} value="all" current={filter} onSelect={setFilter} />
        <FilterChip
          label={`Precio por revisar (${counts.review})`}
          value="review"
          current={filter}
          onSelect={setFilter}
        />
        <FilterChip label={`Costo pendiente (${counts.cost})`} value="cost" current={filter} onSelect={setFilter} />
        <FilterChip
          label={`Sin referencias de mercado (${counts.market})`}
          value="market"
          current={filter}
          onSelect={setFilter}
        />
      </div>

      {error && <div className="alert danger">{error}</div>}

      <div className="card table-wrap">
        {loading && rows.length === 0 ? (
          <p className="empty">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="empty">
            {rows.length === 0
              ? "Todavía no hay productos. Crea el primero con “Nuevo producto”."
              : "Ningún producto coincide con el filtro."}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio venta</th>
                <th className="num">Costo unit.</th>
                <th className="num">Margen bruto</th>
                <th>Estado</th>
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
                  <td>{row.category_name ?? <span className="muted">Sin categoría</span>}</td>
                  <td className="num">
                    {row.track_stock ? formatQuantity(row.quantity, row.stock_unit) : "—"}
                  </td>
                  <td className="num">{formatClp(row.sale_price_clp)}</td>
                  <td className="num">{formatClp(row.total_unit_cost_clp)}</td>
                  <td className="num">{formatPercent(row.current_gross_margin)}</td>
                  <td>
                    <div className="chips">
                      {!row.active && <span className="chip">Inactivo</span>}
                      {row.needs_review && <span className="chip danger">Revisar precio</span>}
                      {row.cost_pending && <span className="chip warn">Costo pendiente</span>}
                      {row.margins_pending && !row.cost_pending && (
                        <span className="chip warn">Márgenes sin definir</span>
                      )}
                      {row.market_reference_count === 0 ? (
                        <span className="chip">Sin referencias</span>
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
  value,
  current,
  onSelect,
}: {
  label: string;
  value: Filter;
  current: Filter;
  onSelect: (value: Filter) => void;
}) {
  return (
    <button
      type="button"
      className={`chip ${current === value ? "info" : ""}`}
      aria-pressed={current === value}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}
