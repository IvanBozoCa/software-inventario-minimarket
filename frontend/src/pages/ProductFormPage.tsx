import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { navigate } from "../router";
import { api } from "../api";
import type { Category, ContentUnit, StockUnit } from "../api";
import {
  CONTENT_UNIT_LABEL,
  STOCK_UNIT_LABEL,
  parseDecimalInput,
  percentInputToRatio,
  ratioToPercentInput,
} from "../format";

type FormState = {
  name: string;
  category_id: string;
  brand: string;
  variant: string;
  content_amount: string;
  content_unit: ContentUnit | "";
  stock_unit: StockUnit;
  track_stock: boolean;
  initial_quantity: string;
  sale_price_clp: string;
  last_unit_cost_clp: string;
  extra_supply_cost_clp: string;
  cost_source: string;
  min_margin: string;
  upper_margin: string;
  barcode: string;
};

const EMPTY: FormState = {
  name: "",
  category_id: "",
  brand: "",
  variant: "",
  content_amount: "",
  content_unit: "",
  stock_unit: "UNIT",
  track_stock: true,
  initial_quantity: "",
  sale_price_clp: "",
  last_unit_cost_clp: "",
  extra_supply_cost_clp: "",
  cost_source: "",
  min_margin: "",
  upper_margin: "",
  barcode: "",
};

export default function ProductFormPage({ productId }: { productId?: string }) {
  const editing = Boolean(productId);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    api.categories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!productId) return;
    api
      .product(productId)
      .then((product) => {
        setForm({
          ...EMPTY,
          name: product.name,
          category_id: product.category_id ?? "",
          brand: product.brand ?? "",
          variant: product.variant ?? "",
          content_amount: product.content_amount ?? "",
          content_unit: product.content_unit ?? "",
          stock_unit: product.stock_unit,
          track_stock: product.track_stock,
          sale_price_clp: product.sale_price_clp === null ? "" : String(product.sale_price_clp),
          min_margin: ratioToPercentInput(product.min_margin),
          upper_margin: ratioToPercentInput(product.upper_margin),
          barcode: product.barcode ?? "",
        });
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [productId]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const price = form.sale_price_clp.trim().replace(/\./g, "");
    if (!form.name.trim()) {
      setError("El nombre del producto es obligatorio.");
      return;
    }
    if (price === "" || Number.isNaN(Number(price)) || Number(price) < 0) {
      setError("Ingresa el precio de venta actual en pesos.");
      return;
    }
    if ((form.content_amount.trim() === "") !== (form.content_unit === "")) {
      setError("Para el contenido indica cantidad y unidad, o deja ambos vacíos.");
      return;
    }

    const base: Record<string, unknown> = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      brand: form.brand.trim() || null,
      variant: form.variant.trim() || null,
      content_amount: parseDecimalInput(form.content_amount),
      content_unit: form.content_unit || null,
      stock_unit: form.stock_unit,
      track_stock: form.track_stock,
      min_margin: percentInputToRatio(form.min_margin),
      upper_margin: percentInputToRatio(form.upper_margin),
      barcode: form.barcode.trim() || null,
    };

    setBusy(true);
    try {
      if (editing && productId) {
        // El precio se cambia desde la ficha con una acción explícita.
        await api.updateProduct(productId, base);
        navigate(`/productos/${productId}`);
      } else {
        const created = await api.createProduct({
          ...base,
          sale_price_clp: Number(price),
          last_unit_cost_clp: parseDecimalInput(form.last_unit_cost_clp),
          extra_supply_cost_clp: parseDecimalInput(form.extra_supply_cost_clp),
          cost_source: form.cost_source.trim() || null,
          initial_quantity: form.track_stock ? parseDecimalInput(form.initial_quantity) : null,
        });
        navigate(`/productos/${created.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded && !error) {
    return <p className="empty">Cargando…</p>;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>{editing ? "Editar producto" : "Nuevo producto"}</h2>
          <p>
            {editing
              ? "Modifica los datos de identificación. El precio, el costo y la cantidad se cambian desde la ficha."
              : "Solo el nombre y el precio actual son obligatorios. El resto se puede completar después."}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="card" noValidate>
        {error && <div className="alert danger">{error}</div>}

        <div className="form-grid">
          <label className="field wide">
            Nombre del producto
            <input
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Ej.: Bebida cola"
              required
            />
          </label>
          <label className="field">
            Categoría
            <select value={form.category_id} onChange={(event) => update("category_id", event.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <span className="hint">Las categorías definen los márgenes por defecto.</span>
          </label>
          <label className="field">
            Marca <span className="hint">opcional</span>
            <input value={form.brand} onChange={(event) => update("brand", event.target.value)} placeholder="Ej.: Coca-Cola" />
          </label>
          <label className="field">
            Variante o descripción <span className="hint">opcional</span>
            <input value={form.variant} onChange={(event) => update("variant", event.target.value)} placeholder="Ej.: Sin azúcar" />
          </label>
          <label className="field">
            Contenido <span className="hint">opcional, ayuda a comparar con el mercado</span>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <input
                inputMode="decimal"
                value={form.content_amount}
                onChange={(event) => update("content_amount", event.target.value)}
                placeholder="1,5"
                aria-label="Cantidad del contenido"
              />
              <select
                value={form.content_unit}
                onChange={(event) => update("content_unit", event.target.value as ContentUnit | "")}
                aria-label="Unidad del contenido"
              >
                <option value="">unidad</option>
                {(Object.keys(CONTENT_UNIT_LABEL) as ContentUnit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {CONTENT_UNIT_LABEL[unit]}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="field">
            Código de barras <span className="hint">opcional</span>
            <input value={form.barcode} onChange={(event) => update("barcode", event.target.value)} />
          </label>
        </div>

        <fieldset style={{ marginTop: "1rem" }}>
          <legend>Inventario</legend>
          <div className="form-grid">
            <label className="field">
              Unidad de control
              <select
                value={form.stock_unit}
                onChange={(event) => update("stock_unit", event.target.value as StockUnit)}
              >
                {(Object.keys(STOCK_UNIT_LABEL) as StockUnit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {STOCK_UNIT_LABEL[unit]}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline" style={{ alignSelf: "end" }}>
              <input
                type="checkbox"
                checked={form.track_stock}
                onChange={(event) => update("track_stock", event.target.checked)}
              />
              Controlar cantidad disponible
            </label>
            {!editing && form.track_stock && (
              <label className="field">
                Cantidad inicial disponible
                <input
                  inputMode="decimal"
                  value={form.initial_quantity}
                  onChange={(event) => update("initial_quantity", event.target.value)}
                  placeholder="0"
                />
              </label>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Precio y costo</legend>
          <div className="form-grid">
            <label className="field">
              Precio de venta actual (CLP)
              <input
                inputMode="numeric"
                value={form.sale_price_clp}
                onChange={(event) => update("sale_price_clp", event.target.value)}
                placeholder="Ej.: 2200"
                disabled={editing}
                required
              />
              {editing && <span className="hint">Se cambia desde la ficha del producto.</span>}
            </label>
            {!editing && (
              <>
                <label className="field">
                  Último costo unitario de compra (CLP) <span className="hint">opcional</span>
                  <input
                    inputMode="decimal"
                    value={form.last_unit_cost_clp}
                    onChange={(event) => update("last_unit_cost_clp", event.target.value)}
                    placeholder="Si se conoce"
                  />
                  <span className="hint">Normalmente con IVA incluido. Sin costo, la recomendación queda pendiente.</span>
                </label>
                <label className="field">
                  Costo adicional de abastecimiento por unidad <span className="hint">opcional</span>
                  <input
                    inputMode="decimal"
                    value={form.extra_supply_cost_clp}
                    onChange={(event) => update("extra_supply_cost_clp", event.target.value)}
                    placeholder="Ej.: transporte"
                  />
                </label>
                <label className="field">
                  Fuente del costo <span className="hint">opcional</span>
                  <input
                    value={form.cost_source}
                    onChange={(event) => update("cost_source", event.target.value)}
                    placeholder="Ej.: Factura 123, distribuidor"
                  />
                </label>
              </>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Márgenes particulares de este producto</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            Déjalos vacíos para usar los márgenes de la categoría. Son porcentajes sobre el precio de venta.
          </p>
          <div className="form-grid">
            <label className="field">
              Margen mínimo objetivo (%)
              <input inputMode="decimal" value={form.min_margin} onChange={(event) => update("min_margin", event.target.value)} />
            </label>
            <label className="field">
              Margen superior de referencia (%)
              <input inputMode="decimal" value={form.upper_margin} onChange={(event) => update("upper_margin", event.target.value)} />
            </label>
          </div>
        </fieldset>

        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {editing ? "Guardar cambios" : "Crear producto"}
          </button>
          <a href={editing && productId ? `#/productos/${productId}` : "#/"}>
            <button type="button">Cancelar</button>
          </a>
        </div>
      </form>
    </section>
  );
}
