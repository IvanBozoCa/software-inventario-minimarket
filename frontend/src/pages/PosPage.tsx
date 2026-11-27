import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, NetworkError } from "../api";
import type { CatalogItem, PaymentMethod, PosSale } from "../api";
import { Alert } from "../components/Alert";
import ContinuousScanner from "../components/ContinuousScanner";
import { foldText, formatClp, parseLocaleNumber } from "../format";
import { cleanCode, codeVariants } from "../scanner";
import { lineQuantity, lineTotal, METHOD_LABEL } from "../pos";
import type { CartLine } from "../pos";
import { useSession } from "../session";

const CART_KEY = "sim-cart-v1";
const CATALOG_KEY = "sim-catalog-v1";
const CAMERA_KEY = "sim-pos-camera";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sin almacenamiento: el carro dura mientras la pantalla esté abierta
  }
}

function newRef(): string {
  const random = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return random.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
}

function lineProblem(line: CartLine): string | null {
  if (line.unitPrice === null || line.unitPrice <= 0) {
    return line.productId ? "Escribe el precio (no tiene precio en SIM)" : "Escribe el monto";
  }
  if (lineQuantity(line) === null) return line.weight ? "Escribe los kilos (ej.: 0,25)" : "Cantidad no válida";
  return null;
}

// Pitido corto al leer un código (agudo: agregado; grave: no encontrado).
let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    audio = audio ?? new AudioCtor();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = ok ? 1500 : 300;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + (ok ? 0.08 : 0.25));
  } catch {
    // sin sonido
  }
  window.navigator.vibrate?.(ok ? 40 : [60, 40, 60]);
}

function cashSuggestions(total: number): number[] {
  const options = new Set<number>([total]);
  for (const step of [1000, 2000, 5000, 10000, 20000]) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) options.add(rounded);
  }
  return [...options].sort((a, b) => a - b).slice(0, 5);
}

export default function PosPage() {
  const session = useSession();
  const [catalog, setCatalog] = useState<CatalogItem[]>(() => readJson(CATALOG_KEY, []));
  const [catalogError, setCatalogError] = useState("");
  const [cart, setCart] = useState<CartLine[]>(() => readJson(CART_KEY, []));
  const [camera, setCamera] = useState(() => readJson(CAMERA_KEY, true));
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "warn" | "danger"; text: string; code?: string } | null>(null);
  const [checkout, setCheckout] = useState<{ ref: string; method: PaymentMethod; received: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<PosSale | null>(null);
  const focusKey = useRef<string | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const checkoutId = checkout?.ref;

  // En el celular el cobro queda bajo el carro: se lleva a la vista al abrirlo.
  useEffect(() => {
    if (checkoutId) checkoutRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [checkoutId]);

  const loadCatalog = useCallback(async () => {
    try {
      const items = await api.posCatalog();
      setCatalog(items);
      writeJson(CATALOG_KEY, items);
      setCatalogError("");
      return items;
    } catch (err) {
      setCatalogError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    api
      .posCatalog()
      .then((items) => {
        setCatalog(items);
        writeJson(CATALOG_KEY, items);
      })
      .catch((err: Error) => setCatalogError(err.message));
  }, []);

  useEffect(() => writeJson(CART_KEY, cart), [cart]);
  useEffect(() => writeJson(CAMERA_KEY, camera), [camera]);

  const byCode = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const item of catalog) {
      if (!item.barcode) continue;
      for (const variant of codeVariants(item.barcode)) map.set(variant, item);
    }
    return map;
  }, [catalog]);

  const results = useMemo(() => {
    const text = foldText(search);
    if (text.length < 2) return [];
    const words = text.split(/\s+/);
    return catalog
      .filter((item) => {
        const haystack = foldText(`${item.label} ${item.category_name ?? ""} ${item.barcode ?? ""}`);
        return words.every((word) => haystack.includes(word));
      })
      .slice(0, 8);
  }, [catalog, search]);

  const total = cart.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0);
  const units = cart.reduce((sum, line) => sum + (line.weight ? 1 : lineQuantity(line) ?? 0), 0);
  const problems = cart.map(lineProblem);
  const ready = cart.length > 0 && problems.every((problem) => problem === null) && total > 0;

  function addProduct(item: CatalogItem) {
    const weight = item.sale_mode === "WEIGHT" || item.stock_unit !== "UNIT";
    setDone(null);
    setCheckout(null);
    setCart((current) => {
      const existing = current.find((line) => line.productId === item.id && !line.weight);
      if (existing && !weight) {
        const quantity = (lineQuantity(existing) ?? 0) + 1;
        return current.map((line) => (line === existing ? { ...line, quantity: String(quantity) } : line));
      }
      const key = newRef();
      if (weight || item.sale_price_clp === null) focusKey.current = key;
      return [
        {
          key,
          productId: item.id,
          label: item.label,
          unitPrice: item.sale_price_clp,
          typedPrice: item.sale_price_clp === null,
          quantity: weight ? "" : "1",
          weight,
        },
        ...current,
      ];
    });
  }

  function onCode(raw: string) {
    const code = cleanCode(raw);
    const item = codeVariants(code)
      .map((variant) => byCode.get(variant))
      .find(Boolean);
    if (item) {
      beep(true);
      addProduct(item);
      setNotice({ kind: "ok", text: `+ ${item.label}` });
    } else {
      beep(false);
      setNotice({ kind: "danger", text: `El código ${code} no está en SIM.`, code });
    }
  }

  function updateLine(key: string, changes: Partial<CartLine>) {
    setCheckout(null);
    setCart((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  }

  function step(line: CartLine, delta: number) {
    const next = (lineQuantity(line) ?? 0) + delta;
    if (next <= 0) return removeLine(line.key);
    updateLine(line.key, { quantity: String(next) });
  }

  function removeLine(key: string) {
    setCheckout(null);
    setCart((current) => current.filter((line) => line.key !== key));
  }

  function addFreeAmount() {
    const key = newRef();
    focusKey.current = key;
    setDone(null);
    setCart((current) => [
      { key, productId: null, label: "Varios", unitPrice: null, typedPrice: true, quantity: "1", weight: false },
      ...current,
    ]);
  }

  function startCheckout() {
    setError("");
    setCheckout({ ref: newRef(), method: "CASH", received: "" });
  }

  const received = checkout?.received ? Number(parseLocaleNumber(checkout.received) ?? NaN) : null;
  const change = received !== null && Number.isFinite(received) ? received - total : null;

  async function confirm() {
    if (!checkout || !ready) return;
    if (checkout.method === "CASH" && change !== null && change < 0) {
      setError("El efectivo recibido no alcanza para el total.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const sale = await api.createSale({
        client_ref: checkout.ref,
        payment_method: checkout.method,
        cash_received_clp: checkout.method === "CASH" && received !== null && Number.isFinite(received) ? received : null,
        expected_total_clp: total,
        lines: cart.map((line) => ({
          product_id: line.productId,
          quantity: String(lineQuantity(line)),
          unit_price_clp: line.unitPrice,
          description: line.productId ? null : line.label,
        })),
      });
      beep(true);
      setDone(sale);
      setCart([]);
      setCheckout(null);
      setNotice(null);
      void loadCatalog();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Cambió un precio: se actualizan los precios del carro y se pide revisar.
        const items = await loadCatalog();
        if (items) {
          const prices = new Map(items.map((item) => [item.id, item.sale_price_clp]));
          setCart((current) =>
            current.map((line) =>
              line.productId && !line.typedPrice && prices.has(line.productId)
                ? { ...line, unitPrice: prices.get(line.productId) ?? line.unitPrice }
                : line,
            ),
          );
        }
        setCheckout(null);
        setError(`${err.message} El total ya está actualizado.`);
      } else if (err instanceof NetworkError) {
        setError("Sin conexión: la venta NO quedó registrada todavía. Revisa la señal y toca «Confirmar venta» otra vez (no se duplicará).");
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pos">
      <div className="page-header pos-header">
        <div>
          <h2>Caja</h2>
          <p className="page-intro">
            Vendes como {session.name}. Muestra cada producto a la cámara o búscalo por nombre.
          </p>
        </div>
        <button type="button" onClick={() => setCamera((value: boolean) => !value)} aria-pressed={camera}>
          {camera ? "Apagar cámara" : "Encender cámara"}
        </button>
      </div>

      {catalogError && catalog.length === 0 && (
        <Alert kind="danger">No se pudo cargar la lista de productos. {catalogError}</Alert>
      )}

      {done && (
        <div className="card pos-done" role="status">
          <h3>Venta registrada · {formatClp(done.total_clp)}</h3>
          <p>
            {done.payment_method ? METHOD_LABEL[done.payment_method] : ""}
            {done.change_clp !== null && done.change_clp > 0 && (
              <>
                {" "}· <strong className="pos-change">Vuelto {formatClp(done.change_clp)}</strong>
              </>
            )}
          </p>
          {done.warnings.map((warning) => (
            <p key={warning} className="hint">
              {warning}
            </p>
          ))}
          <p className="hint">
            {done.payment_method === "CARD"
              ? "Entrega el voucher de la máquina de tarjetas: vale como boleta."
              : "Recuerda entregar la boleta (todavía se emite aparte, en la máquina o en la app del SII)."}
          </p>
        </div>
      )}

      {camera && !checkout && <ContinuousScanner onCode={onCode} />}

      {notice && (
        <Alert kind={notice.kind === "ok" ? "ok" : "danger"}>
          {notice.text}
          {notice.code && session.isAdmin && (
            <>
              {" "}
              <a href={`#/codigos?codigo=${encodeURIComponent(notice.code)}`}>Asignar a un producto</a>
              {" · "}
              <a href={`#/productos/nuevo?codigo=${encodeURIComponent(notice.code)}`}>Crear producto</a>
            </>
          )}
          {notice.code && !session.isAdmin && " Búscalo por nombre o agrégalo como monto libre."}
        </Alert>
      )}

      {!checkout && (
        <div className="pos-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto por nombre o código"
            aria-label="Buscar producto"
            enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const code = cleanCode(search);
              if (/^\d{6,}$/.test(code)) {
                onCode(code);
                setSearch("");
              } else if (results.length === 1) {
                addProduct(results[0]);
                setSearch("");
              }
            }}
          />
          <button type="button" onClick={addFreeAmount}>
            + Monto libre
          </button>
          {results.length > 0 && (
            <ul className="pos-results" role="listbox" aria-label="Productos encontrados">
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      addProduct(item);
                      setSearch("");
                    }}
                  >
                    <span>{item.label}</span>
                    <span className="pos-result-price">
                      {item.sale_price_clp === null ? "Sin precio" : formatClp(item.sale_price_clp)}
                      {item.sale_mode === "WEIGHT" || item.stock_unit !== "UNIT" ? " /kg" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {cart.length === 0 ? (
        !done && <p className="empty card">El carro está vacío. Escanea el primer producto.</p>
      ) : (
        <ul className="pos-cart" aria-label="Carro">
          {cart.map((line, index) => {
            const amount = lineTotal(line);
            const problem = problems[index];
            const autoFocus = focusKey.current === line.key;
            if (autoFocus) focusKey.current = null;
            return (
              <li key={line.key} className={`card pos-line${problem ? " incomplete" : ""}`}>
                <div className="pos-line-head">
                  {line.productId ? (
                    <strong>{line.label}</strong>
                  ) : (
                    <input
                      className="pos-free-label"
                      aria-label="Descripción del monto libre"
                      value={line.label}
                      maxLength={120}
                      onChange={(e) => updateLine(line.key, { label: e.target.value })}
                    />
                  )}
                  <button
                    type="button"
                    className="link pos-remove"
                    aria-label={`Quitar ${line.label}`}
                    onClick={() => removeLine(line.key)}
                  >
                    ✕
                  </button>
                </div>
                <div className="pos-line-body">
                  {line.weight ? (
                    <label className="pos-qty-input">
                      <input
                        inputMode="decimal"
                        value={line.quantity}
                        autoFocus={autoFocus && line.unitPrice !== null}
                        placeholder="0,250"
                        aria-label={`Kilos de ${line.label}`}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      />
                      kg
                    </label>
                  ) : (
                    <div className="pos-stepper">
                      <button type="button" aria-label={`Una menos de ${line.label}`} onClick={() => step(line, -1)}>
                        −
                      </button>
                      <span aria-label={`Cantidad de ${line.label}`}>{line.quantity}</span>
                      <button type="button" aria-label={`Una más de ${line.label}`} onClick={() => step(line, 1)}>
                        +
                      </button>
                    </div>
                  )}
                  {line.typedPrice ? (
                    <label className="pos-price-input">
                      $
                      <input
                        inputMode="numeric"
                        autoFocus={autoFocus}
                        value={line.unitPrice === null ? "" : String(line.unitPrice)}
                        placeholder={line.productId ? "Precio" : "Monto"}
                        aria-label={line.productId ? `Precio de ${line.label}` : `Monto de ${line.label}`}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                          updateLine(line.key, { unitPrice: digits ? Number(digits) : null });
                        }}
                      />
                    </label>
                  ) : (
                    <span className="muted">
                      {formatClp(line.unitPrice)}
                      {line.weight ? " /kg" : " c/u"}
                    </span>
                  )}
                  <strong className="pos-line-total">{amount === null ? "—" : formatClp(amount)}</strong>
                </div>
                {problem && <p className="field-error">{problem}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {cart.length > 0 && !checkout && (
        <div className="pos-bar">
          <div>
            <span className="muted">Total ({units} {units === 1 ? "artículo" : "artículos"})</span>
            <strong className="pos-total">{formatClp(total)}</strong>
          </div>
          <button type="button" className="primary pos-charge" disabled={!ready} onClick={startCheckout}>
            Cobrar
          </button>
        </div>
      )}

      {error && <Alert kind="danger">{error}</Alert>}

      {checkout && (
        <div className="card pos-checkout" ref={checkoutRef}>
          <h3>Cobrar {formatClp(total)}</h3>
          <div className="pos-methods" role="radiogroup" aria-label="Medio de pago">
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={checkout.method === method}
                className={checkout.method === method ? "selected" : ""}
                onClick={() => setCheckout({ ...checkout, method })}
              >
                {METHOD_LABEL[method]}
              </button>
            ))}
          </div>
          {checkout.method === "CASH" && (
            <>
              <label className="field">
                Recibido (opcional, para calcular el vuelto)
                <input
                  inputMode="numeric"
                  value={checkout.received}
                  placeholder={String(total)}
                  onChange={(e) => setCheckout({ ...checkout, received: e.target.value.replace(/[^\d.]/g, "") })}
                />
              </label>
              <div className="pos-cash-options">
                {cashSuggestions(total).map((amount) => (
                  <button key={amount} type="button" onClick={() => setCheckout({ ...checkout, received: String(amount) })}>
                    {formatClp(amount)}
                  </button>
                ))}
              </div>
              {change !== null && (
                <p className={`pos-change-line${change < 0 ? " danger" : ""}`}>
                  {change < 0 ? `Faltan ${formatClp(-change)}` : `Vuelto: ${formatClp(change)}`}
                </p>
              )}
            </>
          )}
          {checkout.method === "CARD" && <p className="hint">Cobra en la máquina de tarjetas y confirma cuando salga aprobado.</p>}
          {checkout.method === "TRANSFER" && <p className="hint">Confirma cuando veas la transferencia recibida.</p>}
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Registrando…" : "Confirmar venta"}
            </button>
            <button type="button" disabled={busy} onClick={() => setCheckout(null)}>
              Volver al carro
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
