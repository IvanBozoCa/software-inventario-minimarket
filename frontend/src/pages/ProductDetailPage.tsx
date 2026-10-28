import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { MarketReference, MatchType, ProductDetail } from "../api";
import { ReferenceCard } from "../components/ReferenceCard";
import {
  SCOPE_LABEL,
  STOCK_UNIT_LABEL,
  formatClp,
  formatDate,
  formatDateTime,
  formatPercent,
  formatQuantity,
  parseDecimalInput,
  productTitle,
} from "../format";

type Panel = "none" | "price" | "cost" | "stock" | "link";

export default function ProductDetailPage({ productId }: { productId: string }) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    try {
      setDetail(await api.productDetail(productId));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [productId]);

  useEffect(() => {
    let cancelled = false;
    api
      .productDetail(productId)
      .then((data) => !cancelled && setDetail(data))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await reload();
      setPanel("none");
      setNotice(successMessage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) return <div className="alert danger">{error}</div>;
  if (!detail) return <p className="empty">Cargando…</p>;

  const { product, pricing, market } = detail;
  const title = productTitle(product);

  return (
    <section>
      <div className="page-header">
        <div>
          <a href="#/" className="muted">
            ← Inventario
          </a>
          <h2>
            {product.name}
            {!product.active && <span className="chip" style={{ marginLeft: "0.5rem" }}>Inactivo</span>}
          </h2>
          <p>
            {title !== product.name ? title : ""}
            {detail.category_name ? ` · ${detail.category_name}` : " · Sin categoría"}
          </p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <a href={`#/productos/${product.id}/editar`}>
            <button type="button">Editar ficha</button>
          </a>
          <button
            type="button"
            className={product.active ? "danger" : "primary"}
            disabled={busy}
            onClick={() =>
              void run(
                () => api.updateProduct(product.id, { active: !product.active }),
                product.active ? "Producto desactivado. Su historial se conserva." : "Producto reactivado.",
              )
            }
          >
            {product.active ? "Desactivar" : "Reactivar"}
          </button>
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="stats" style={{ marginBottom: "1rem" }}>
        <div className="stat">
          <span className="label">Cantidad disponible</span>
          <span className="value">
            {product.track_stock ? formatQuantity(detail.quantity, product.stock_unit) : "No se controla"}
          </span>
          {product.track_stock && (
            <button type="button" className="link" onClick={() => setPanel(panel === "stock" ? "none" : "stock")}>
              Actualizar cantidad
            </button>
          )}
        </div>
        <div className="stat">
          <span className="label">Precio de venta actual</span>
          <span className="value">{formatClp(product.sale_price_clp)}</span>
          <button type="button" className="link" onClick={() => setPanel(panel === "price" ? "none" : "price")}>
            Cambiar precio
          </button>
        </div>
        <div className="stat">
          <span className="label">Último costo unitario</span>
          <span className="value">{formatClp(pricing.unit_cost_clp)}</span>
          <span className="detail">
            {pricing.extra_supply_cost_clp
              ? `+ ${formatClp(pricing.extra_supply_cost_clp)} abastecimiento = ${formatClp(pricing.total_unit_cost_clp)}`
              : pricing.unit_cost_clp
                ? "sin costo adicional de abastecimiento"
                : "costo pendiente"}
          </span>
          <button type="button" className="link" onClick={() => setPanel(panel === "cost" ? "none" : "cost")}>
            {pricing.unit_cost_clp ? "Actualizar costo" : "Registrar costo"}
          </button>
        </div>
        <div className="stat">
          <span className="label">Margen bruto actual</span>
          <span className="value">{formatPercent(pricing.current_gross_margin)}</span>
          <span className="detail">
            {pricing.current_markup !== null
              ? `recargo sobre el costo: ${formatPercent(pricing.current_markup)}`
              : "requiere precio y costo"}
          </span>
        </div>
      </div>

      {panel === "price" && (
        <PricePanel
          current={product.sale_price_clp}
          busy={busy}
          onCancel={() => setPanel("none")}
          onSave={(price, note) =>
            run(() => api.updatePrice(product.id, price, note), "Precio de venta actualizado y registrado en el historial.")
          }
        />
      )}
      {panel === "cost" && (
        <CostPanel
          unitCost={pricing.unit_cost_clp}
          extraCost={pricing.extra_supply_cost_clp}
          busy={busy}
          onCancel={() => setPanel("none")}
          onSave={(body) => run(() => api.updateCost(product.id, body), "Costo registrado en el historial.")}
        />
      )}
      {panel === "stock" && (
        <StockPanel
          current={detail.quantity}
          unitLabel={STOCK_UNIT_LABEL[product.stock_unit]}
          busy={busy}
          onCancel={() => setPanel("none")}
          onSave={(quantity, note) =>
            run(() => api.updateStock(product.id, quantity, note), "Cantidad actualizada.")
          }
        />
      )}

      <div className="card-grid">
        <section className="card">
          <h3>Rango de precios según márgenes</h3>
          {pricing.warnings.map((warning) => (
            <div
              key={warning.code}
              className={`alert ${
                warning.code === "PRICE_BELOW_COST" || warning.code === "MARGIN_BELOW_MIN" || warning.code === "COST_INCREASED"
                  ? "danger"
                  : "warn"
              }`}
            >
              {warning.message}
              {warning.code === "MARGINS_MISSING" && (
                <>
                  {" "}
                  <a href="#/categorias">Configurar márgenes</a>
                </>
              )}
            </div>
          ))}
          {pricing.range_available ? (
            <table>
              <tbody>
                <tr>
                  <td>Costo unitario total</td>
                  <td className="num">{formatClp(pricing.total_unit_cost_clp)}</td>
                </tr>
                <tr>
                  <td>
                    Precio con margen mínimo ({formatPercent(pricing.min_margin)})
                    <span className="sub">{pricing.min_margin_source === "PRODUCT" ? "margen del producto" : "margen de la categoría"}</span>
                  </td>
                  <td className="num">
                    <strong>{formatClp(pricing.price_at_min_margin, true)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    Precio con margen superior ({formatPercent(pricing.upper_margin)})
                    <span className="sub">{pricing.upper_margin_source === "PRODUCT" ? "margen del producto" : "margen de la categoría"}</span>
                  </td>
                  <td className="num">
                    <strong>{formatClp(pricing.price_at_upper_margin, true)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Precio actual</td>
                  <td className="num">
                    {formatClp(pricing.sale_price_clp)} ({formatPercent(pricing.current_gross_margin)})
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">
              El rango se mostrará cuando el producto tenga costo unitario y márgenes definidos.
            </p>
          )}
          <p className="muted">
            Los precios calculados no se redondean ni se aplican automáticamente: tú decides el precio
            definitivo. Es margen bruto sobre los costos registrados, no utilidad neta.
          </p>
        </section>

        <section className="card">
          <h3>Referencias de mercado</h3>
          {!market.has_references ? (
            <p className="muted">Pendiente de referencias: aún no hay precios de mercado asociados a este producto.</p>
          ) : (
            <>
              {market.exact_regular_low && market.exact_regular_high ? (
                <p>
                  Entre las referencias del <strong>mismo producto</strong>, con precio habitual vigente (menos de{" "}
                  {market.stale_days} días), el valor más bajo es{" "}
                  <strong>{formatClp(market.exact_regular_low.price_clp)}</strong> ({market.exact_regular_low.source_name},{" "}
                  {SCOPE_LABEL[market.exact_regular_low.scope]}, {formatDate(market.exact_regular_low.observed_on)})
                  {market.exact_regular_high.reference_id !== market.exact_regular_low.reference_id && (
                    <>
                      {" "}
                      y el más alto <strong>{formatClp(market.exact_regular_high.price_clp)}</strong> (
                      {market.exact_regular_high.source_name}, {SCOPE_LABEL[market.exact_regular_high.scope]},{" "}
                      {formatDate(market.exact_regular_high.observed_on)})
                    </>
                  )}
                  . Son datos observados, no una recomendación.
                </p>
              ) : (
                <p className="muted">
                  No hay referencias del mismo producto con precio habitual vigente; las equivalentes son solo
                  información complementaria.
                </p>
              )}
              {market.has_stale && (
                <div className="alert warn">
                  Hay referencias con más de {market.stale_days} días: precio por verificar.
                </div>
              )}
            </>
          )}
          <div className="actions" style={{ marginTop: "0.4rem" }}>
            <button type="button" onClick={() => setPanel(panel === "link" ? "none" : "link")}>
              Asociar referencia existente
            </button>
            <a href="#/mercado">
              <button type="button">Registrar nueva referencia</button>
            </a>
          </div>
          {panel === "link" && (
            <LinkPanel
              productId={product.id}
              onLinked={() => void run(async () => undefined, "Referencia asociada al producto.")}
              onCancel={() => setPanel("none")}
            />
          )}
        </section>
      </div>

      {market.references.map((reference) => (
        <ReferenceCard
          key={reference.id}
          reference={reference}
          onChanged={() => void reload()}
          actions={
            <button
              type="button"
              className="link"
              onClick={() =>
                void run(() => api.linkReference(reference.id, null, null), "Referencia desasociada del producto.")
              }
            >
              Quitar asociación
            </button>
          }
        />
      ))}

      <div className="card-grid">
        <section className="card">
          <h3>Historial de precios de venta</h3>
          <HistoryTable
            rows={detail.price_history.map((change) => ({
              id: change.id,
              when: change.changed_at,
              from: formatClp(change.previous_price_clp),
              to: formatClp(change.new_price_clp),
              note: change.note,
            }))}
            emptyText="Sin cambios registrados."
          />
          {detail.price_history.length < 2 && (
            <p className="muted">Todavía no hay suficientes cambios para analizar una tendencia.</p>
          )}
        </section>
        <section className="card">
          <h3>Historial de costos de compra</h3>
          <HistoryTable
            rows={detail.cost_history.map((change) => ({
              id: change.id,
              when: change.changed_at,
              from: describeCost(change.previous_unit_cost_clp, change.previous_extra_cost_clp),
              to: describeCost(change.new_unit_cost_clp, change.new_extra_cost_clp),
              note: [change.source, change.note].filter(Boolean).join(" · ") || null,
            }))}
            emptyText="Sin costo registrado todavía."
          />
          {detail.cost_history.length < 2 && detail.cost_history.length > 0 && (
            <p className="muted">Solo hay una observación de costo; aún no se puede ver una tendencia.</p>
          )}
        </section>
      </div>

      {product.track_stock && (
        <details className="card">
          <summary>Movimientos de inventario ({detail.stock_movements.length})</summary>
          <HistoryTable
            rows={detail.stock_movements.map((movement) => ({
              id: movement.id,
              when: movement.created_at,
              from: MOVEMENT_LABEL[movement.movement_type] ?? movement.movement_type,
              to: `${Number(movement.quantity_delta) > 0 ? "+" : ""}${Number(movement.quantity_delta).toLocaleString("es-CL", { maximumFractionDigits: 3 })}`,
              note: movement.note,
            }))}
            emptyText="Sin movimientos."
            labels={["Fecha", "Tipo", "Cambio", "Nota"]}
          />
        </details>
      )}
    </section>
  );
}

const MOVEMENT_LABEL: Record<string, string> = {
  INITIAL_STOCK: "Cantidad inicial",
  ADJUSTMENT: "Ajuste",
  PURCHASE: "Compra",
  SALE: "Venta",
  SALE_REVERSAL: "Anulación de venta",
  WASTE: "Merma",
  RETURN: "Devolución",
};

function describeCost(unit: string | null, extra: string | null): string {
  if (unit === null && extra === null) return "—";
  const parts = [formatClp(unit)];
  if (extra !== null) parts.push(`+ ${formatClp(extra)} abast.`);
  return parts.join(" ");
}

function HistoryTable({
  rows,
  emptyText,
  labels = ["Fecha", "Anterior", "Nuevo", "Nota"],
}: {
  rows: { id: string; when: string; from: string; to: string; note: string | null }[];
  emptyText: string;
  labels?: string[];
}) {
  if (rows.length === 0) return <p className="muted">{emptyText}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {labels.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatDateTime(row.when)}</td>
              <td>{row.from}</td>
              <td>
                <strong>{row.to}</strong>
              </td>
              <td>{row.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PricePanel({
  current,
  busy,
  onSave,
  onCancel,
}: {
  current: number | null;
  busy: boolean;
  onSave: (price: number, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(current === null ? "" : String(current));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(price.replace(/\./g, ""));
    if (!price.trim() || Number.isNaN(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
      setError("Ingresa el nuevo precio en pesos, sin decimales.");
      return;
    }
    setError("");
    void onSave(numeric, note);
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Cambiar precio de venta</h3>
      {error && <div className="alert danger">{error}</div>}
      <div className="inline-form">
        <label className="field">
          Nuevo precio (CLP)
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Motivo <span className="hint">opcional</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: alza de costo" />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          Confirmar nuevo precio
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function CostPanel({
  unitCost,
  extraCost,
  busy,
  onSave,
  onCancel,
}: {
  unitCost: string | null;
  extraCost: string | null;
  busy: boolean;
  onSave: (body: { last_unit_cost_clp: string | null; extra_supply_cost_clp: string | null; source?: string; note?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [unit, setUnit] = useState(unitCost ?? "");
  const [extra, setExtra] = useState(extraCost ?? "");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const unitValue = parseDecimalInput(unit);
    const extraValue = parseDecimalInput(extra);
    if (unit.trim() && unitValue === null) {
      setError("El costo unitario debe ser un número.");
      return;
    }
    if (extra.trim() && extraValue === null) {
      setError("El costo adicional debe ser un número.");
      return;
    }
    setError("");
    void onSave({
      last_unit_cost_clp: unitValue,
      extra_supply_cost_clp: extraValue,
      source: source.trim() || undefined,
      note: note.trim() || undefined,
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Registrar costo unitario</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        El costo de compra se conserva separado del costo adicional de abastecimiento (por ejemplo, el
        transporte hasta Pichilemu). Ninguno se inventa: registra solo lo que conoces.
      </p>
      {error && <div className="alert danger">{error}</div>}
      <div className="inline-form">
        <label className="field">
          Costo unitario de compra (CLP)
          <input inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Costo adicional de abastecimiento por unidad
          <input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </label>
        <label className="field">
          Fuente <span className="hint">factura, proveedor…</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label className="field">
          Observaciones
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          Guardar costo
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function StockPanel({
  current,
  unitLabel,
  busy,
  onSave,
  onCancel,
}: {
  current: string | null;
  unitLabel: string;
  busy: boolean;
  onSave: (quantity: string, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState(current ? String(Number(current)) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseDecimalInput(quantity);
    if (value === null || Number(value) < 0) {
      setError("Ingresa la cantidad contada.");
      return;
    }
    setError("");
    void onSave(value, note);
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Actualizar cantidad disponible</h3>
      {error && <div className="alert danger">{error}</div>}
      <div className="inline-form">
        <label className="field">
          Cantidad actual ({unitLabel})
          <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Nota <span className="hint">opcional</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: conteo semanal" />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          Guardar cantidad
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function LinkPanel({
  productId,
  onLinked,
  onCancel,
}: {
  productId: string;
  onLinked: () => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketReference[]>([]);
  const [matchType, setMatchType] = useState<MatchType>("EXACT");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .references({ search, unlinked: true })
        .then(setResults)
        .catch((err: Error) => setError(err.message));
    }, 150);
    return () => clearTimeout(timer);
  }, [search]);

  async function link(reference: MarketReference) {
    try {
      await api.linkReference(reference.id, productId, matchType);
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div style={{ marginTop: "0.8rem" }}>
      {error && <div className="alert danger">{error}</div>}
      <div className="inline-form">
        <label className="field">
          Buscar referencia sin asociar
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="nombre o marca" />
        </label>
        <label className="field">
          Tipo de coincidencia
          <select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
            <option value="EXACT">Mismo producto (marca, variante y presentación)</option>
            <option value="EQUIVALENT">Producto equivalente (similar, no idéntico)</option>
          </select>
        </label>
        <button type="button" onClick={onCancel}>
          Cerrar
        </button>
      </div>
      {results.length === 0 ? (
        <p className="muted">No hay referencias sin asociar que coincidan.</p>
      ) : (
        <ul>
          {results.slice(0, 15).map((reference) => (
            <li key={reference.id}>
              {reference.product_name}
              {reference.brand ? ` · ${reference.brand}` : ""}
              {reference.variant ? ` · ${reference.variant}` : ""}
              {reference.content_amount ? ` · ${Number(reference.content_amount).toLocaleString("es-CL")} ${reference.content_unit}` : ""}
              {" — "}
              <span className="muted">{reference.source.name}</span>{" "}
              <button type="button" className="link" onClick={() => void link(reference)}>
                Asociar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
