import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { MarketReference, MatchType, Product, ProductDetail, StockUnit } from "../api";
import { Alert } from "../components/Alert";
import { useAutoClear } from "../useAutoClear";
import { ReferenceCard } from "../components/ReferenceCard";
import {
  MAX_PRICE_CLP,
  SCOPE_LABEL,
  STOCK_UNIT_LABEL,
  foldText,
  formatClp,
  formatContent,
  formatDate,
  formatDateTime,
  formatPercent,
  formatQuantity,
  priceWarning,
  readNumberField,
  toNumberInput,
} from "../format";
import { isUuid, takeFlash } from "../router";

type Panel = "none" | "price" | "cost" | "stock" | "link";

const DANGER_WARNINGS = new Set(["PRICE_BELOW_COST", "MARGIN_BELOW_MIN", "COST_INCREASED"]);

export default function ProductDetailPage({ productId }: { productId: string }) {
  const validId = isUuid(productId);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loadError, setLoadError] = useState(validId ? "" : "Producto no encontrado");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(() => takeFlash());
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const clearNotice = useCallback(() => setNotice(""), []);
  useAutoClear(notice, clearNotice);

  const reload = useCallback(async () => {
    try {
      setDetail(await api.productDetail(productId));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [productId]);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    api
      .productDetail(productId)
      .then((data) => !cancelled && setDetail(data))
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [productId, validId]);

  function openPanel(next: Panel) {
    setPanel(panel === next ? "none" : next);
    setNotice("");
    setError("");
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setNotice("");
    setError("");
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

  if (loadError && !detail) {
    const notFound = loadError === "Producto no encontrado";
    return (
      <section className="card">
        <h2>{notFound ? "Producto no encontrado" : "No se pudo cargar el producto"}</h2>
        <p>
          {notFound
            ? "La dirección no corresponde a ningún producto. Puede que el enlace esté incompleto."
            : loadError}
        </p>
        <a className="button primary" href="#/">
          Volver al inventario
        </a>
      </section>
    );
  }
  if (!detail) return <p className="loading-screen">Cargando producto…</p>;

  const { product, pricing, market } = detail;
  const subtitle = [
    product.brand,
    product.variant,
    formatContent(product.content_amount, product.content_unit),
    detail.category_name ?? "Sin categoría",
  ]
    .filter(Boolean)
    .join(" · ");
  const dangerWarnings = pricing.warnings.filter((warning) => DANGER_WARNINGS.has(warning.code));
  const otherWarnings = pricing.warnings.filter((warning) => !DANGER_WARNINGS.has(warning.code));
  const marginAlert = pricing.warnings.some(
    (warning) => warning.code === "MARGIN_BELOW_MIN" || warning.code === "PRICE_BELOW_COST",
  );

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
          <p>{subtitle}</p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <a className="button" href={`#/productos/${product.id}/editar`}>
            Editar ficha
          </a>
          {product.active ? (
            <button type="button" className="danger" disabled={busy} onClick={() => setConfirmDeactivate(true)}>
              Desactivar
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void run(() => api.updateProduct(product.id, { active: true }), "Producto reactivado.")}
            >
              Reactivar
            </button>
          )}
        </div>
      </div>

      {confirmDeactivate && product.active && (
        <Alert kind="warn">
          ¿Desactivar «{product.name}»? Se ocultará del inventario, pero su historial se conserva y podrás
          reactivarlo cuando quieras.{" "}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              setConfirmDeactivate(false);
              void run(
                () => api.updateProduct(product.id, { active: false }),
                "Producto desactivado. Su historial se conserva.",
              );
            }}
          >
            Sí, desactivar
          </button>{" "}
          <button type="button" onClick={() => setConfirmDeactivate(false)}>
            No
          </button>
        </Alert>
      )}
      {error && <Alert kind="danger">{error}</Alert>}
      {notice && <Alert kind="ok">{notice}</Alert>}
      {dangerWarnings.map((warning) => (
        <Alert key={warning.code} kind="danger">
          {warning.message}
        </Alert>
      ))}

      <div className="stats" style={{ marginBottom: "1rem" }}>
        <div className="stat">
          <span className="label">Cantidad disponible</span>
          <span className="value">
            {product.track_stock ? formatQuantity(detail.quantity, product.stock_unit) : "No se controla"}
          </span>
          {product.track_stock && (
            <button type="button" className="link" onClick={() => openPanel("stock")}>
              Actualizar cantidad
            </button>
          )}
        </div>
        <div className="stat">
          <span className="label">Precio de venta actual</span>
          <span className="value">{formatClp(product.sale_price_clp)}</span>
          <button type="button" className="link" onClick={() => openPanel("price")}>
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
          <button type="button" className="link" onClick={() => openPanel("cost")}>
            {pricing.unit_cost_clp ? "Actualizar costo" : "Registrar costo"}
          </button>
        </div>
        <div className={`stat ${marginAlert ? "danger" : ""}`}>
          <span className="label">Margen bruto actual</span>
          <span className="value">{formatPercent(pricing.current_gross_margin)}</span>
          <span className="detail">
            {marginAlert && pricing.min_margin !== null
              ? `bajo tu mínimo de ${formatPercent(pricing.min_margin)}`
              : pricing.current_markup !== null
                ? `recargo sobre el costo: ${formatPercent(pricing.current_markup)}`
                : "requiere precio y costo"}
          </span>
        </div>
      </div>

      {panel === "price" && (
        <PricePanel
          current={product.sale_price_clp}
          cost={pricing.total_unit_cost_clp === null ? null : Number(pricing.total_unit_cost_clp)}
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
          unit={product.stock_unit}
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
          {otherWarnings.map((warning) => (
            <Alert key={warning.code} kind="warn">
              {warning.message}
              {warning.code === "MARGINS_MISSING" && (
                <>
                  {" "}
                  <a href="#/categorias">Configurar márgenes</a>
                </>
              )}
            </Alert>
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
                    <strong>{formatClp(roundUpPeso(pricing.price_at_min_margin))}</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    Precio con margen superior ({formatPercent(pricing.upper_margin)})
                    <span className="sub">{pricing.upper_margin_source === "PRODUCT" ? "margen del producto" : "margen de la categoría"}</span>
                  </td>
                  <td className="num">
                    <strong>{formatClp(roundUpPeso(pricing.price_at_upper_margin))}</strong>
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
            Los precios calculados se redondean hacia arriba al peso para no quedar bajo el margen, y
            no se aplican automáticamente: tú decides el precio definitivo. Es margen bruto sobre los costos registrados, no utilidad neta.
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
                <Alert kind="warn">
                  Hay referencias con más de {market.stale_days} días: precio por verificar.
                </Alert>
              )}
            </>
          )}
          <div className="actions" style={{ marginTop: "0.4rem" }}>
            <button type="button" onClick={() => openPanel("link")}>
              Asociar referencia existente
            </button>
            <a className="button" href={`#/mercado?producto=${product.id}`}>
              Registrar nueva referencia
            </a>
          </div>
          {panel === "link" && (
            <LinkPanel
              product={product}
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

function roundUpPeso(value: string | null): number | null {
  return value === null ? null : Math.ceil(Number(value));
}

function PricePanel({
  current,
  cost,
  busy,
  onSave,
  onCancel,
}: {
  current: number | null;
  cost: number | null;
  busy: boolean;
  onSave: (price: number, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(toNumberInput(current));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  // Precio inusual pendiente de confirmar: 0, bajo el costo o un cambio de más de 50 %.
  const [pending, setPending] = useState<{ price: number; warning: string } | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    let value: number;
    try {
      value = Number(
        readNumberField(price, "el nuevo precio", { required: true, integer: true, max: MAX_PRICE_CLP, example: "1.990" }),
      );
    } catch (err) {
      setError((err as Error).message);
      setPending(null);
      return;
    }
    setError("");
    const warning = priceWarning(value, current, cost);
    if (warning && pending?.price !== value) {
      setPending({ price: value, warning });
      return;
    }
    setPending(null);
    void onSave(value, note);
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>Cambiar precio de venta</h3>
      {error && <Alert kind="danger">{error}</Alert>}
      {pending && (
        <Alert kind="warn">
          {pending.warning} ¿Seguro? Pulsa «Sí, guardar {formatClp(pending.price)}» para confirmar o corrige el
          precio.
        </Alert>
      )}
      <div className="inline-form">
        <label className="field">
          Nuevo precio (CLP)
          <input
            inputMode="numeric"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setPending(null);
            }}
            placeholder="Ej.: 1.990"
            aria-invalid={error ? true : undefined}
            autoFocus
          />
        </label>
        <label className="field">
          Motivo <span className="hint">opcional</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: alza de costo" />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {pending ? `Sí, guardar ${formatClp(pending.price)}` : "Confirmar nuevo precio"}
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
  // Los valores de la API ("1450.00") se muestran en formato chileno ("1.450")
  // para que guardar sin cambios no altere el costo.
  const [unit, setUnit] = useState(toNumberInput(unitCost));
  const [extra, setExtra] = useState(toNumberInput(extraCost));
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    let unitValue: string | null;
    let extraValue: string | null;
    try {
      unitValue = readNumberField(unit, "el costo unitario", { max: MAX_PRICE_CLP, example: "1.450" });
      extraValue = readNumberField(extra, "el costo adicional", { max: MAX_PRICE_CLP, example: "80" });
    } catch (err) {
      setError((err as Error).message);
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
    <form className="card" onSubmit={submit} noValidate>
      <h3>Registrar costo unitario</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        El costo de compra se conserva separado del costo adicional de abastecimiento (por ejemplo, el
        transporte hasta Pichilemu). Ninguno se inventa: registra solo lo que conoces.
      </p>
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="inline-form">
        <label className="field">
          Costo unitario de compra (CLP)
          <input inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Ej.: 1.450" autoFocus />
        </label>
        <label className="field">
          Costo adicional de abastecimiento por unidad
          <input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ej.: 80" />
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
  unit,
  busy,
  onSave,
  onCancel,
}: {
  current: string | null;
  unit: StockUnit;
  busy: boolean;
  onSave: (quantity: string, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState(toNumberInput(current));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    let value: string | null;
    try {
      value = readNumberField(quantity, "la cantidad", { required: true, example: unit === "UNIT" ? "24" : "1,5" });
      if (unit === "UNIT" && !Number.isInteger(Number(value))) {
        throw new Error("Este producto se cuenta por unidades: la cantidad va sin decimales.");
      }
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setError("");
    void onSave(value as string, note);
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h3>Actualizar cantidad disponible</h3>
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="inline-form">
        <label className="field">
          Cantidad actual ({STOCK_UNIT_LABEL[unit]})
          <input
            inputMode={unit === "UNIT" ? "numeric" : "decimal"}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            autoFocus
          />
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

/** Qué tanto se parece una referencia al producto (marca, variante y contenido). */
function similarity(product: Product, reference: MarketReference): number {
  const same = (a: string | null, b: string | null) => !!a && !!b && foldText(a) === foldText(b);
  let score = 0;
  if (same(product.brand, reference.brand)) score += 2;
  if (same(product.variant, reference.variant)) score += 1;
  if (
    product.content_amount &&
    reference.content_amount &&
    Number(product.content_amount) === Number(reference.content_amount) &&
    product.content_unit === reference.content_unit
  ) {
    score += 2;
  }
  if (foldText(reference.product_name).includes(foldText(product.name))) score += 1;
  return score;
}

function LinkPanel({
  product,
  onLinked,
  onCancel,
}: {
  product: Product;
  onLinked: () => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketReference[]>([]);
  // "Mismo producto" no se da por hecho: cambia el valor más bajo del mercado
  // que muestra la ficha, así que debe elegirse a propósito.
  const [matchType, setMatchType] = useState<MatchType>("EQUIVALENT");
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
      await api.linkReference(reference.id, product.id, matchType);
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const sorted = [...results].sort((a, b) => similarity(product, b) - similarity(product, a));

  return (
    <div style={{ marginTop: "0.8rem" }}>
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="inline-form">
        <label className="field">
          Buscar referencia sin asociar
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="nombre o marca" />
        </label>
        <label className="field">
          Tipo de coincidencia
          <select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
            <option value="EQUIVALENT">Producto equivalente (similar, no idéntico)</option>
            <option value="EXACT">Mismo producto (marca, variante y presentación)</option>
          </select>
        </label>
        <button type="button" onClick={onCancel}>
          Cerrar
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="muted">No hay referencias sin asociar que coincidan.</p>
      ) : (
        <ul>
          {sorted.slice(0, 15).map((reference) => (
            <li key={reference.id}>
              {reference.product_name}
              {reference.brand ? ` · ${reference.brand}` : ""}
              {reference.variant ? ` · ${reference.variant}` : ""}
              {reference.content_amount ? ` · ${formatContent(reference.content_amount, reference.content_unit)}` : ""}
              {" — "}
              <span className="muted">{reference.source.name}</span>{" "}
              <button type="button" className="link" onClick={() => void link(reference)}>
                Asociar como {matchType === "EXACT" ? "mismo producto" : "equivalente"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
