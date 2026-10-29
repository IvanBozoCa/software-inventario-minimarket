import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { navigate, setFlash } from "../router";
import { api } from "../api";
import type { Category, ContentUnit, OverviewRow, Product, StockUnit } from "../api";
import { Alert } from "../components/Alert";
import BarcodeScanner from "../components/BarcodeScanner";
import { findProductByCode } from "../scanner";
import {
  CONTENT_UNIT_LABEL,
  MAX_PRICE_CLP,
  STOCK_UNIT_LABEL,
  foldText,
  formatClp,
  formatContent,
  priceWarning,
  ratioToPercentInput,
  readMarginField,
  readNumberField,
  toNumberInput,
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

type Field = keyof FormState;

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

const NAME_MAX = 200;

export default function ProductFormPage({
  productId,
  initialBarcode,
}: {
  productId?: string;
  initialBarcode?: string;
}) {
  const editing = Boolean(productId);
  // Con un código escaneado desde el inventario el formulario parte con él.
  const [start] = useState<FormState>(() => ({ ...EMPTY, barcode: initialBarcode ?? "" }));
  const [form, setForm] = useState<FormState>(start);
  const [initial, setInitial] = useState<FormState>(start);
  const [scanning, setScanning] = useState(false);
  const [barcodeOwner, setBarcodeOwner] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!editing);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Avisos que piden un segundo clic: precio inusual o producto parecido ya existente.
  const [pendingWarning, setPendingWarning] = useState<{ key: string; message: string; duplicate?: OverviewRow } | null>(
    null,
  );
  // Avisos ya mostrados: un segundo clic en «Crear producto» los da por aceptados.
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Incluye las inactivas para mostrar la categoría real de un producto que
    // pertenece a una categoría desactivada.
    api.categories(true).then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!productId) return;
    api
      .product(productId)
      .then((product) => {
        const values: FormState = {
          ...EMPTY,
          name: product.name,
          category_id: product.category_id ?? "",
          brand: product.brand ?? "",
          variant: product.variant ?? "",
          // "1.500" de la API es 1,5: se muestra con coma para no leerlo como 1.500.
          content_amount: toNumberInput(product.content_amount),
          content_unit: product.content_unit ?? "",
          stock_unit: product.stock_unit,
          track_stock: product.track_stock,
          sale_price_clp: toNumberInput(product.sale_price_clp),
          min_margin: ratioToPercentInput(product.min_margin),
          upper_margin: ratioToPercentInput(product.upper_margin),
          barcode: product.barcode ?? "",
        };
        setForm(values);
        setInitial(values);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [productId]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function update<K extends Field>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setPendingWarning(null);
    setAcknowledged([]);
  }

  async function applyScanned(code: string) {
    setScanning(false);
    update("barcode", code);
    setBarcodeOwner(null);
    try {
      const existing = await findProductByCode(code);
      if (existing && existing.id !== productId) setBarcodeOwner(existing);
    } catch {
      // si la búsqueda falla, el backend igual rechaza códigos repetidos al guardar
    }
  }

  function failField(field: Field, message: string) {
    setFieldErrors({ [field]: message });
    setError(message);
    // Lleva el foco (y la pantalla, en el celular) al campo con el problema.
    requestAnimationFrame(() => {
      const input = formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`);
      input?.focus();
      input?.scrollIntoView?.({ block: "center" });
    });
  }

  function read<T>(field: Field, reader: () => T): T {
    try {
      return reader();
    } catch (err) {
      failField(field, (err as Error).message);
      throw err;
    }
  }

  async function findDuplicate(): Promise<OverviewRow | undefined> {
    try {
      const rows = await api.overview({ search: form.name.trim(), includeInactive: true });
      const same = (a: string | null, b: string) => foldText(a ?? "") === foldText(b);
      return rows.find(
        (row) =>
          same(row.name, form.name) &&
          same(row.brand, form.brand) &&
          same(row.variant, form.variant),
      );
    } catch {
      return undefined;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    let price: string | null;
    let contentAmount: string | null;
    let minMargin: string | null;
    let upperMargin: string | null;
    let cost: string | null = null;
    let extra: string | null = null;
    let quantity: string | null = null;
    try {
      if (!form.name.trim()) {
        failField("name", "El nombre del producto es obligatorio.");
        return;
      }
      if (form.name.trim().length > NAME_MAX) {
        failField("name", `El nombre puede tener como máximo ${NAME_MAX} caracteres (tiene ${form.name.trim().length}).`);
        return;
      }
      price = read("sale_price_clp", () =>
        readNumberField(form.sale_price_clp, "el precio de venta", {
          required: !editing,
          integer: true,
          max: MAX_PRICE_CLP,
          example: "1.990",
        }),
      );
      contentAmount = read("content_amount", () =>
        readNumberField(form.content_amount, "el contenido", { positive: true, example: "1,5" }),
      );
      if ((contentAmount === null) !== (form.content_unit === "")) {
        failField("content_amount", "Para el contenido indica cantidad y unidad, o deja ambos vacíos.");
        return;
      }
      if (!editing) {
        cost = read("last_unit_cost_clp", () =>
          readNumberField(form.last_unit_cost_clp, "el costo unitario", { max: MAX_PRICE_CLP, example: "1.100" }),
        );
        extra = read("extra_supply_cost_clp", () =>
          readNumberField(form.extra_supply_cost_clp, "el costo adicional", { max: MAX_PRICE_CLP, example: "80" }),
        );
        if (form.track_stock) {
          quantity = read("initial_quantity", () =>
            readNumberField(form.initial_quantity, "la cantidad inicial", {
              example: form.stock_unit === "UNIT" ? "24" : "1,5",
            }),
          );
          if (quantity !== null && form.stock_unit === "UNIT" && !Number.isInteger(Number(quantity))) {
            failField("initial_quantity", "Este producto se cuenta por unidades: la cantidad va sin decimales.");
            return;
          }
        }
      }
      minMargin = read("min_margin", () => readMarginField(form.min_margin, "el margen mínimo"));
      upperMargin = read("upper_margin", () => readMarginField(form.upper_margin, "el margen superior"));
      if (minMargin !== null && upperMargin !== null && Number(upperMargin) < Number(minMargin)) {
        failField("upper_margin", "El margen superior no puede ser menor que el mínimo.");
        return;
      }
    } catch {
      return;
    }

    if (!editing) {
      const warning = priceWarning(Number(price), null, cost === null ? null : Number(cost) + Number(extra ?? 0));
      if (warning && !acknowledged.includes("price")) {
        setPendingWarning({ key: "price", message: `${warning} Si es correcto, pulsa «Crear producto» otra vez.` });
        setAcknowledged((current) => [...current, "price"]);
        return;
      }
      if (!acknowledged.includes("duplicate")) {
        const duplicate = await findDuplicate();
        if (duplicate) {
          setPendingWarning({
            key: "duplicate",
            message: "Ya existe un producto con el mismo nombre, marca y variante.",
            duplicate,
          });
          setAcknowledged((current) => [...current, "duplicate"]);
          return;
        }
      }
    }
    setPendingWarning(null);

    const base: Record<string, unknown> = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      brand: form.brand.trim() || null,
      variant: form.variant.trim() || null,
      content_amount: contentAmount,
      content_unit: form.content_unit || null,
      stock_unit: form.stock_unit,
      track_stock: form.track_stock,
      min_margin: minMargin,
      upper_margin: upperMargin,
      barcode: form.barcode.trim() || null,
    };

    setBusy(true);
    try {
      if (editing && productId) {
        // El precio se cambia desde la ficha con una acción explícita.
        await api.updateProduct(productId, base);
        setFlash("Cambios guardados.");
        navigate(`/productos/${productId}`, { replace: true });
      } else {
        const created = await api.createProduct({
          ...base,
          sale_price_clp: Number(price),
          last_unit_cost_clp: cost,
          extra_supply_cost_clp: extra,
          cost_source: form.cost_source.trim() || null,
          initial_quantity: quantity,
        });
        setFlash("Producto creado.");
        // Reemplaza el formulario en el historial: "atrás" no vuelve a un formulario en blanco.
        navigate(`/productos/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    navigate(editing && productId ? `/productos/${productId}` : "/");
  }

  if (!loaded && !error) {
    return <p className="loading-screen">Cargando…</p>;
  }

  const currentCategory = categories.find((category) => category.id === form.category_id);
  const categoryOptions = categories.filter((category) => category.active || category.id === form.category_id);

  const fieldProps = (field: Field) => ({
    name: field,
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `${field}-error` : undefined,
  });
  const fieldError = (field: Field) =>
    fieldErrors[field] ? (
      <span id={`${field}-error`} className="field-error">
        {fieldErrors[field]}
      </span>
    ) : null;

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

      {scanning && (
        <BarcodeScanner
          title="Escanear código del producto"
          onDetected={applyScanned}
          onClose={() => setScanning(false)}
        />
      )}

      <form onSubmit={submit} className="card" noValidate ref={formRef}>
        {error && <Alert kind="danger">{error}</Alert>}
        {pendingWarning && (
          <Alert kind="warn">
            {pendingWarning.message}
            {pendingWarning.duplicate && (
              <>
                {" "}
                <a href={`#/productos/${pendingWarning.duplicate.id}`}>
                  Abrir «
                  {[
                    pendingWarning.duplicate.name,
                    pendingWarning.duplicate.brand,
                    pendingWarning.duplicate.variant,
                    formatContent(pendingWarning.duplicate.content_amount, pendingWarning.duplicate.content_unit),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  » ({formatClp(pendingWarning.duplicate.sale_price_clp)})
                </a>{" "}
                o pulsa «Crear producto» otra vez si de verdad es otro producto.
              </>
            )}
          </Alert>
        )}

        <div className="form-grid">
          <label className="field wide">
            <span>
              Nombre del producto <span className="required">(obligatorio)</span>
            </span>
            <input
              {...fieldProps("name")}
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Ej.: Bebida cola"
              maxLength={NAME_MAX + 50}
              required
            />
            {fieldError("name")}
          </label>
          <label className="field">
            Categoría
            <select value={form.category_id} onChange={(event) => update("category_id", event.target.value)}>
              <option value="">Sin categoría</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {category.active ? "" : " (inactiva)"}
                </option>
              ))}
            </select>
            <span className="hint">
              {currentCategory && !currentCategory.active
                ? "Esta categoría está inactiva; el producto la conserva."
                : "Las categorías definen los márgenes por defecto."}
            </span>
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
            Contenido <span className="hint">opcional</span>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <input
                {...fieldProps("content_amount")}
                inputMode="decimal"
                value={form.content_amount}
                onChange={(event) => update("content_amount", event.target.value)}
                placeholder="Ej.: 1,5"
                aria-label="Cantidad del contenido"
              />
              <select
                value={form.content_unit}
                onChange={(event) => update("content_unit", event.target.value as ContentUnit | "")}
                aria-label="Unidad del contenido"
              >
                <option value="">—</option>
                {(Object.keys(CONTENT_UNIT_LABEL) as ContentUnit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {CONTENT_UNIT_LABEL[unit]}
                  </option>
                ))}
              </select>
            </div>
            {fieldError("content_amount")}
            <span className="hint">Ayuda a comparar con el mercado.</span>
          </label>
          <label className="field">
            Código de barras <span className="hint">opcional</span>
            <div className="input-with-action">
              <input
                name="barcode"
                inputMode="numeric"
                aria-label="Código de barras"
                value={form.barcode}
                onChange={(event) => {
                  update("barcode", event.target.value);
                  setBarcodeOwner(null);
                }}
              />
              <button type="button" onClick={() => setScanning(true)}>
                Escanear
              </button>
            </div>
            <span className="hint">Con la cámara o una foto; también sirve un código QR.</span>
            {barcodeOwner && (
              <Alert kind="warn">
                Ese código ya pertenece a <strong>{barcodeOwner.name}</strong>
                {barcodeOwner.active ? "" : " (inactivo)"}.{" "}
                <a href={`#/productos/${barcodeOwner.id}`}>Abrir su ficha</a>
              </Alert>
            )}
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
                Cantidad inicial disponible <span className="hint">opcional</span>
                <input
                  {...fieldProps("initial_quantity")}
                  inputMode={form.stock_unit === "UNIT" ? "numeric" : "decimal"}
                  value={form.initial_quantity}
                  onChange={(event) => update("initial_quantity", event.target.value)}
                  placeholder="Ej.: 24"
                />
                {fieldError("initial_quantity")}
              </label>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Precio y costo</legend>
          <div className="form-grid">
            <label className="field">
              <span>
                Precio de venta actual (CLP) {!editing && <span className="required">(obligatorio)</span>}
              </span>
              <input
                {...fieldProps("sale_price_clp")}
                inputMode="numeric"
                value={form.sale_price_clp}
                onChange={(event) => update("sale_price_clp", event.target.value)}
                placeholder="Ej.: 2.200"
                disabled={editing}
                required
              />
              {fieldError("sale_price_clp")}
              {editing && <span className="hint">Se cambia desde la ficha del producto.</span>}
            </label>
            {!editing && (
              <>
                <label className="field">
                  Último costo unitario de compra (CLP) <span className="hint">opcional</span>
                  <input
                    {...fieldProps("last_unit_cost_clp")}
                    inputMode="decimal"
                    value={form.last_unit_cost_clp}
                    onChange={(event) => update("last_unit_cost_clp", event.target.value)}
                    placeholder="Ej.: 1.100"
                  />
                  {fieldError("last_unit_cost_clp")}
                  <span className="hint">Normalmente con IVA incluido. Sin costo, la recomendación queda pendiente.</span>
                </label>
                <label className="field">
                  Costo adicional de abastecimiento por unidad <span className="hint">opcional</span>
                  <input
                    {...fieldProps("extra_supply_cost_clp")}
                    inputMode="decimal"
                    value={form.extra_supply_cost_clp}
                    onChange={(event) => update("extra_supply_cost_clp", event.target.value)}
                    placeholder="Ej.: 80 (transporte)"
                  />
                  {fieldError("extra_supply_cost_clp")}
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
            Déjalos vacíos para usar los márgenes de la categoría. Son porcentajes sobre el precio de venta, entre 0
            y 99,99 %.
          </p>
          <div className="form-grid">
            <label className="field">
              Margen mínimo objetivo (%)
              <input
                {...fieldProps("min_margin")}
                inputMode="decimal"
                value={form.min_margin}
                onChange={(event) => update("min_margin", event.target.value)}
                placeholder="Ej.: 25"
              />
              {fieldError("min_margin")}
            </label>
            <label className="field">
              Margen superior de referencia (%)
              <input
                {...fieldProps("upper_margin")}
                inputMode="decimal"
                value={form.upper_margin}
                onChange={(event) => update("upper_margin", event.target.value)}
                placeholder="Ej.: 40"
              />
              {fieldError("upper_margin")}
            </label>
          </div>
        </fieldset>

        {confirmDiscard && (
          <Alert kind="warn">
            Hay cambios sin guardar. ¿Descartarlos?{" "}
            <button type="button" className="danger" onClick={cancel}>
              Descartar cambios
            </button>{" "}
            <button type="button" onClick={() => setConfirmDiscard(false)}>
              Seguir editando
            </button>
          </Alert>
        )}

        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {editing ? "Guardar cambios" : "Crear producto"}
          </button>
          <button type="button" onClick={cancel}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
