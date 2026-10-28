import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type {
  ContentUnit,
  ImportResult,
  MarketReference,
  MarketScope,
  MarketSource,
  MarketSourceType,
  MatchType,
  OverviewRow,
  PriceType,
} from "../api";
import { ReferenceCard } from "../components/ReferenceCard";
import { CONTENT_UNIT_LABEL, SCOPE_LABEL, parseDecimalInput, todayIso } from "../format";

const SOURCE_TYPE_LABEL: Record<MarketSourceType, string> = {
  LOCAL_STORE: "Negocio local",
  SUPERMARKET_WEB: "Supermercado (sitio web)",
  PUBLIC_AGENCY: "Organismo público",
  OTHER: "Otra",
};

export default function MarketPage() {
  const [references, setReferences] = useState<MarketReference[]>([]);
  const [sources, setSources] = useState<MarketSource[]>([]);
  const [products, setProducts] = useState<OverviewRow[]>([]);
  const [search, setSearch] = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [staleDays, setStaleDays] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [refs, srcs, prods, settings] = await Promise.all([
        api.references({ search, unlinked: onlyUnlinked }),
        api.sources(),
        api.overview({ includeInactive: false }),
        api.settings(),
      ]);
      setReferences(refs);
      setSources(srcs);
      setProducts(prods);
      setStaleDays(settings.market_stale_days);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [search, onlyUnlinked]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), 150);
    return () => clearTimeout(timer);
  }, [reload]);

  function replaceReference(updated: MarketReference) {
    setReferences((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Precios de mercado</h2>
          <p>
            Precios observados en otros negocios y sitios, con su fuente y fecha. Se mantienen separados
            de tus precios y no se promedian: son información para decidir.
          </p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="primary" onClick={() => setShowNew((v) => !v)}>
            Registrar precio observado
          </button>
          <button type="button" onClick={() => setShowSource((v) => !v)}>
            Nueva fuente
          </button>
          <button type="button" onClick={() => setShowImport((v) => !v)}>
            Importar CSV
          </button>
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {showSource && (
        <SourceForm
          onSaved={() => {
            setShowSource(false);
            void reload();
          }}
          onCancel={() => setShowSource(false)}
        />
      )}
      {showNew && (
        <NewReferenceForm
          sources={sources}
          products={products}
          onSaved={() => {
            setShowNew(false);
            void reload();
          }}
          onCancel={() => setShowNew(false)}
          onNeedSource={() => setShowSource(true)}
        />
      )}
      {showImport && <ImportPanel onDone={() => void reload()} onClose={() => setShowImport(false)} />}

      <StaleSettings
        value={staleDays}
        onSaved={(days) => {
          setStaleDays(days);
          void reload();
        }}
      />

      <div className="toolbar">
        <input
          type="search"
          aria-label="Buscar referencia"
          placeholder="Buscar producto o marca"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="inline">
          <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} />
          Solo sin asociar a un producto
        </label>
        <span className="muted">{references.length} referencias</span>
      </div>

      {references.length === 0 ? (
        <p className="empty">No hay referencias registradas. Registra un precio observado o importa un CSV.</p>
      ) : (
        references.map((reference) => (
          <ReferenceCard
            key={reference.id}
            reference={reference}
            onChanged={replaceReference}
            actions={
              <LinkControl reference={reference} products={products} onChanged={replaceReference} onError={setError} />
            }
          />
        ))
      )}
    </section>
  );
}

function LinkControl({
  reference,
  products,
  onChanged,
  onError,
}: {
  reference: MarketReference;
  products: OverviewRow[];
  onChanged: (reference: MarketReference) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(reference.product_id ?? "");
  const [matchType, setMatchType] = useState<MatchType>(reference.match_type ?? "EXACT");
  const linked = products.find((p) => p.id === reference.product_id);

  async function save(unlink = false) {
    try {
      const updated = unlink
        ? await api.linkReference(reference.id, null, null)
        : await api.linkReference(reference.id, productId || null, productId ? matchType : null);
      onChanged(updated);
      setOpen(false);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  if (!open) {
    return (
      <span className="muted" style={{ alignSelf: "center" }}>
        {linked ? (
          <>
            Asociada a <a href={`#/productos/${linked.id}`}>{linked.name}</a>{" "}
          </>
        ) : reference.product_id ? (
          "Asociada a un producto inactivo "
        ) : (
          "Sin asociar "
        )}
        <button type="button" className="link" onClick={() => setOpen(true)}>
          {reference.product_id ? "Cambiar" : "Asociar a un producto"}
        </button>
      </span>
    );
  }

  return (
    <div className="inline-form" style={{ width: "100%" }}>
      <label className="field">
        Producto propio
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Sin asociar</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
              {product.brand ? ` · ${product.brand}` : ""}
              {product.variant ? ` · ${product.variant}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Coincidencia
        <select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
          <option value="EXACT">Mismo producto</option>
          <option value="EQUIVALENT">Producto equivalente</option>
        </select>
      </label>
      <button type="button" className="primary" onClick={() => void save()}>
        Guardar
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancelar
      </button>
    </div>
  );
}

function SourceForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<MarketSourceType>("LOCAL_STORE");
  const [scope, setScope] = useState<MarketScope>("PICHILEMU");
  const [locality, setLocality] = useState("Pichilemu");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("El nombre de la fuente es obligatorio.");
      return;
    }
    try {
      await api.createSource({
        name: name.trim(),
        source_type: sourceType,
        scope,
        locality: locality.trim() || null,
        url: url.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Nueva fuente (negocio, sitio o institución)</h3>
      {error && <div className="alert danger">{error}</div>}
      <div className="inline-form">
        <label className="field">
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Almacén Don Pedro" autoFocus />
        </label>
        <label className="field">
          Tipo
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as MarketSourceType)}>
            {(Object.keys(SOURCE_TYPE_LABEL) as MarketSourceType[]).map((key) => (
              <option key={key} value={key}>
                {SOURCE_TYPE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Cobertura
          <select value={scope} onChange={(e) => setScope(e.target.value as MarketScope)}>
            {(Object.keys(SCOPE_LABEL) as MarketScope[]).map((key) => (
              <option key={key} value={key}>
                {SCOPE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Localidad <span className="hint">opcional</span>
          <input value={locality} onChange={(e) => setLocality(e.target.value)} />
        </label>
        <label className="field">
          Sitio web <span className="hint">opcional</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </label>
        <button type="submit" className="primary">
          Guardar fuente
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function NewReferenceForm({
  sources,
  products,
  onSaved,
  onCancel,
  onNeedSource,
}: {
  sources: MarketSource[];
  products: OverviewRow[];
  onSaved: () => void;
  onCancel: () => void;
  onNeedSource: () => void;
}) {
  const [sourceId, setSourceId] = useState("");
  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [variant, setVariant] = useState("");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<ContentUnit | "">("");
  const [productId, setProductId] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("EXACT");
  const [price, setPrice] = useState("");
  const [priceType, setPriceType] = useState<PriceType>("REGULAR");
  const [observedOn, setObservedOn] = useState(todayIso());
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const effectiveSourceId = sourceId || sources[0]?.id || "";

  function prefillFromProduct(id: string) {
    setProductId(id);
    const product = products.find((p) => p.id === id);
    if (product && !productName.trim()) {
      setProductName(product.name);
      setBrand(product.brand ?? "");
      setVariant(product.variant ?? "");
      setContentAmount(product.content_amount ? String(Number(product.content_amount)) : "");
      setContentUnit(product.content_unit ?? "");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(price.replace(/\./g, ""));
    if (!effectiveSourceId) {
      setError("Selecciona la fuente. Si no existe, créala con “Nueva fuente”.");
      return;
    }
    if (!productName.trim()) {
      setError("Indica el producto observado.");
      return;
    }
    if (!price.trim() || Number.isNaN(numeric) || numeric <= 0) {
      setError("Ingresa el precio observado en pesos.");
      return;
    }
    if ((contentAmount.trim() === "") !== (contentUnit === "")) {
      setError("Para la presentación indica cantidad y unidad, o deja ambos vacíos.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.createReference({
        source_id: effectiveSourceId,
        product_name: productName.trim(),
        brand: brand.trim() || null,
        variant: variant.trim() || null,
        content_amount: parseDecimalInput(contentAmount),
        content_unit: contentUnit || null,
        product_id: productId || null,
        match_type: productId ? matchType : null,
        first_observation: {
          price_clp: Math.round(numeric),
          price_type: priceType,
          observed_on: observedOn,
          promo_valid_until: priceType === "PROMO" && validUntil ? validUntil : null,
          notes: notes.trim() || null,
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Registrar precio observado</h3>
      {error && <div className="alert danger">{error}</div>}
      <div className="form-grid">
        <label className="field">
          Negocio o fuente
          <select value={effectiveSourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.length === 0 && <option value="">No hay fuentes</option>}
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} · {SCOPE_LABEL[source.scope]}
              </option>
            ))}
          </select>
          <span className="hint">
            <button type="button" className="link" style={{ padding: 0 }} onClick={onNeedSource}>
              Crear una fuente nueva
            </button>
          </span>
        </label>
        <label className="field">
          Producto propio relacionado <span className="hint">opcional</span>
          <select value={productId} onChange={(e) => prefillFromProduct(e.target.value)}>
            <option value="">Sin asociar</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
                {product.brand ? ` · ${product.brand}` : ""}
              </option>
            ))}
          </select>
        </label>
        {productId && (
          <label className="field">
            Coincidencia
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
              <option value="EXACT">Mismo producto (marca, variante y presentación)</option>
              <option value="EQUIVALENT">Producto equivalente (similar, no idéntico)</option>
            </select>
          </label>
        )}
        <label className="field">
          Producto observado
          <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Ej.: Bebida cola" />
        </label>
        <label className="field">
          Marca <span className="hint">opcional</span>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} />
        </label>
        <label className="field">
          Variante o formato <span className="hint">opcional</span>
          <input value={variant} onChange={(e) => setVariant(e.target.value)} />
        </label>
        <label className="field">
          Presentación <span className="hint">opcional</span>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input inputMode="decimal" value={contentAmount} onChange={(e) => setContentAmount(e.target.value)} placeholder="1,5" aria-label="Cantidad de la presentación" />
            <select value={contentUnit} onChange={(e) => setContentUnit(e.target.value as ContentUnit | "")} aria-label="Unidad de la presentación">
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
          Precio observado (CLP)
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">
          Tipo de precio
          <select value={priceType} onChange={(e) => setPriceType(e.target.value as PriceType)}>
            <option value="REGULAR">Habitual</option>
            <option value="PROMO">Promoción</option>
          </select>
        </label>
        <label className="field">
          Fecha de observación
          <input type="date" value={observedOn} max={todayIso()} onChange={(e) => setObservedOn(e.target.value)} />
        </label>
        {priceType === "PROMO" && (
          <label className="field">
            Promoción válida hasta <span className="hint">si se conoce</span>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
        )}
        <label className="field wide">
          Notas <span className="hint">opcional</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          Guardar referencia
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ImportPanel({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setCsv(await file.text());
  }

  async function submit() {
    if (!csv.trim()) {
      setError("Pega el contenido del CSV o selecciona un archivo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setResult(await api.importCsv(csv));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Importar referencias desde CSV</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Columnas obligatorias: fuente, tipo_fuente, cobertura, producto, precio_clp, tipo_precio,
        fecha_observacion (AAAA-MM-DD). Opcionales: localidad, url_fuente, marca, variante, contenido,
        unidad_contenido, promo_desde, promo_hasta, url, notas. Las observaciones repetidas se omiten.
      </p>
      {error && <div className="alert danger">{error}</div>}
      <input type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} />
      <textarea
        aria-label="Contenido CSV"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder="fuente,tipo_fuente,cobertura,producto,precio_clp,tipo_precio,fecha_observacion"
        style={{ marginTop: "0.6rem" }}
      />
      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
          Importar
        </button>
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {result && (
        <div className={`alert ${result.errors.length ? "warn" : "ok"}`}>
          Fuentes nuevas: {result.sources_created} · Referencias nuevas: {result.references_created} ·
          Precios registrados: {result.observations_created} · Repetidos omitidos: {result.duplicates_skipped}
          {result.errors.length > 0 && (
            <ul>
              {result.errors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StaleSettings({ value, onSaved }: { value: number | null; onSaved: (days: number) => void }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  if (value === null) return null;

  async function save() {
    const days = Number(draft);
    if (!Number.isInteger(days) || days < 1) {
      setError("Indica un número de días mayor que cero.");
      return;
    }
    try {
      const saved = await api.updateSettings(days);
      onSaved(saved.market_stale_days);
      setEditing(false);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <p className="muted">
      Una referencia se marca como “Precio por verificar” cuando su última observación tiene más de{" "}
      {editing ? (
        <>
          <input
            inputMode="numeric"
            aria-label="Días para marcar una referencia por verificar"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: "5rem", display: "inline-block" }}
          />{" "}
          días{" "}
          <button type="button" className="link" onClick={() => void save()}>
            Guardar
          </button>
          <button type="button" className="link" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          {error && <span className="chip danger">{error}</span>}
        </>
      ) : (
        <>
          <strong>{value} días</strong>.{" "}
          <button
            type="button"
            className="link"
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
          >
            Cambiar plazo
          </button>
        </>
      )}
    </p>
  );
}
