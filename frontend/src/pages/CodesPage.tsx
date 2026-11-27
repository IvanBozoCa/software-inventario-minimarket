import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { CatalogItem } from "../api";
import { Alert } from "../components/Alert";
import ContinuousScanner from "../components/ContinuousScanner";
import { foldText } from "../format";
import { hashQuery } from "../router";
import { cleanCode, codeVariants, MAX_CODE_LENGTH } from "../scanner";

type Notice = { kind: "ok" | "info" | "danger"; text: string; ownerId?: string };

/**
 * Asignar códigos de barra a productos que ya existen: se escanea el envase y
 * se elige de qué producto es (o al revés). Pensado para recorrer la estantería
 * con el celular y dejar todo el catálogo listo para la caja.
 */
export default function CodesPage() {
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [camera, setCamera] = useState(true);
  const [tab, setTab] = useState<"missing" | "done">("missing");
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  // Código leído que espera saber de qué producto es…
  const [pending, setPending] = useState<string | null>(() => hashQuery().get("codigo")?.trim() || null);
  // …o producto elegido que espera su código.
  const [targetId, setTargetId] = useState<string | null>(() => hashQuery().get("producto"));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .posCatalog()
      .then(setCatalog)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const items = useMemo(() => catalog ?? [], [catalog]);
  const target = items.find((item) => item.id === targetId) ?? null;
  const missing = items.filter((item) => !item.barcode);
  const withCode = items.filter((item) => item.barcode);

  const shown = useMemo(() => {
    const words = foldText(search).split(/\s+/).filter(Boolean);
    const base = words.length > 0 ? items : tab === "missing" ? missing : withCode;
    return base.filter((item) => {
      const haystack = foldText(`${item.label} ${item.category_name ?? ""} ${item.barcode ?? ""}`);
      return words.every((word) => haystack.includes(word));
    });
  }, [items, missing, withCode, search, tab]);

  function ownerOf(code: string): CatalogItem | undefined {
    const variants = new Set(codeVariants(code));
    return items.find((item) => item.barcode && codeVariants(item.barcode).some((v) => variants.has(v)));
  }

  async function save(item: CatalogItem, code: string | null) {
    setBusy(true);
    try {
      await api.updateProduct(item.id, { barcode: code });
      setCatalog((current) => (current ?? []).map((row) => (row.id === item.id ? { ...row, barcode: code } : row)));
      setNotice({
        kind: "ok",
        text: code ? `✓ Código ${code} guardado en ${item.label}.` : `Se quitó el código de ${item.label}.`,
      });
      setPending(null);
      setTargetId(null);
      setSearch("");
    } catch (err) {
      setNotice({ kind: "danger", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function onCode(raw: string) {
    const code = cleanCode(raw);
    if (!code || busy) return;
    if (code.length > MAX_CODE_LENGTH) {
      setNotice({ kind: "danger", text: "Ese código es demasiado largo." });
      return;
    }
    const owner = ownerOf(code);
    if (target) {
      if (owner && owner.id === target.id) {
        setNotice({ kind: "info", text: `${target.label} ya tenía el código ${code}.` });
        setTargetId(null);
      } else if (owner) {
        setNotice({ kind: "danger", text: `El código ${code} ya es de ${owner.label}.`, ownerId: owner.id });
      } else {
        void save(target, code);
      }
      return;
    }
    if (owner) {
      setPending(null);
      setNotice({ kind: "info", text: `El código ${code} es de ${owner.label}.`, ownerId: owner.id });
      return;
    }
    setPending(code);
    setNotice(null);
  }

  function choose(item: CatalogItem) {
    if (pending) {
      void save(item, pending);
      return;
    }
    setTargetId(item.id);
    setNotice(null);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    const code = typed.trim();
    if (!code) return;
    setTyped("");
    onCode(code);
  }

  return (
    <section className="codes">
      <div className="page-header">
        <div>
          <a href="#/ajustes" className="muted">
            ← Ajustes
          </a>
          <h2>Códigos de barra</h2>
          <p className="page-intro">
            Escanea un envase y toca el producto al que pertenece. También puedes tocar primero el producto y
            después escanear.
          </p>
        </div>
        <button type="button" onClick={() => setCamera((value) => !value)} aria-pressed={camera}>
          {camera ? "Apagar cámara" : "Encender cámara"}
        </button>
      </div>

      {loadError && <Alert kind="danger">No se pudo cargar la lista de productos. {loadError}</Alert>}

      {catalog && (
        <p className="codes-progress">
          <strong>
            {withCode.length} de {items.length}
          </strong>{" "}
          productos tienen código.
          {missing.length > 0 ? ` Faltan ${missing.length}.` : " ¡Están todos!"}
        </p>
      )}

      {camera && <ContinuousScanner onCode={onCode} />}

      <form className="pos-search" onSubmit={submitTyped}>
        <input
          inputMode="numeric"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="O escribe el código"
          aria-label="Escribir código de barras"
          maxLength={MAX_CODE_LENGTH}
        />
        <button type="submit" disabled={!typed.trim() || busy}>
          Usar código
        </button>
      </form>

      {target && (
        <div className="card codes-step" role="status">
          <p>
            Escanea el código de <strong>{target.label}</strong>
            {target.barcode ? ` (hoy tiene ${target.barcode}; el nuevo lo reemplaza)` : ""}.
          </p>
          <div className="actions" style={{ marginTop: 0 }}>
            {target.barcode && (
              <button type="button" className="danger" disabled={busy} onClick={() => void save(target, null)}>
                Quitar código
              </button>
            )}
            <button type="button" onClick={() => setTargetId(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="card codes-step" role="status">
          <p>
            Código <strong>{pending}</strong>: toca abajo el producto al que pertenece.
          </p>
          <div className="actions" style={{ marginTop: 0 }}>
            <a className="button" href={`#/productos/nuevo?codigo=${encodeURIComponent(pending)}`}>
              Es un producto nuevo
            </a>
            <button type="button" onClick={() => setPending(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {notice && (
        <Alert kind={notice.kind}>
          {notice.text}
          {notice.ownerId && (
            <>
              {" "}
              <a href={`#/productos/${notice.ownerId}`}>Abrir su ficha</a>
            </>
          )}
        </Alert>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar producto por nombre o marca"
          aria-label="Buscar producto"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {!search.trim() && (
        <div className="filter-tabs" role="group" aria-label="Filtrar productos">
          <button type="button" aria-pressed={tab === "missing"} onClick={() => setTab("missing")}>
            Sin código <span className="count">{missing.length}</span>
          </button>
          <button type="button" aria-pressed={tab === "done"} onClick={() => setTab("done")}>
            Con código <span className="count">{withCode.length}</span>
          </button>
        </div>
      )}

      {!catalog && !loadError && <p className="muted">Cargando productos…</p>}
      {catalog && shown.length === 0 && (
        <p className="muted">
          {search.trim() ? "Ningún producto coincide con la búsqueda." : tab === "missing" ? "Todos tienen código." : "Aún no hay productos con código."}
        </p>
      )}

      <ul className="codes-list">
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={item.id === targetId ? "selected" : undefined}
              disabled={busy}
              onClick={() => choose(item)}
            >
              <span>
                <strong>{item.label}</strong>
                <span className="muted"> · {item.category_name ?? "Sin categoría"}</span>
              </span>
              <span className={item.barcode ? "codes-code" : "chip warn"}>{item.barcode ?? "Sin código"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
