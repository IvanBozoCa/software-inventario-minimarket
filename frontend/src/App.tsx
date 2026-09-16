import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8010";
const ACTIVE_SALE_KEY = "minimarket.activeSaleId";
const ACTIVE_PAYMENT_KEY = "minimarket.activePaymentId";

type SaleItem = {
  id: string;
  product_id: string | null;
  item_type: "PRODUCT" | "FREE_AMOUNT";
  description_snapshot: string;
  quantity: string;
  unit_price_clp: number;
  line_total_clp: number;
};

type Sale = {
  id: string;
  status: "DRAFT" | "PAYMENT_PENDING" | "COMPLETED" | "CANCELLED" | "VOIDED";
  subtotal_clp: number;
  total_clp: number;
  items: SaleItem[];
};

type Product = {
  id: string;
  name: string;
  barcode: string | null;
  sale_mode: "UNIT" | "WEIGHT" | "FREE_AMOUNT";
  price_mode: "FIXED" | "FREE";
  sale_price_clp: number | null;
};

type Payment = {
  id: string;
  sale_id: string;
  method: "CASH" | "CARD";
  status: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED";
  amount_clp: number;
  cash_received_clp: number | null;
  change_clp: number | null;
  provider: string | null;
  external_reference: string | null;
};

type CheckoutResponse = {
  sale: Sale;
  payment: Payment;
};

type ScanResponse = {
  result: "ADDED" | "UNKNOWN_BARCODE" | "MANUAL_PRICE_REQUIRED";
  message: string;
  sale: Sale;
};

type CheckoutMode = "sale" | "cash" | "card" | "completed";

function formatClp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

function cashSuggestions(total: number) {
  if (total <= 0) return [];

  const roundedThousand = Math.ceil(total / 1000) * 1000;
  return [...new Set([total, roundedThousand, 5000, 10000, 20000])]
    .filter((amount) => amount >= total)
    .sort((left, right) => left - right)
    .slice(0, 4);
}

async function readError(response: Response) {
  try {
    const body = await response.json();
    return body.detail ?? "No fue posible completar la acción";
  } catch {
    return "No fue posible completar la acción";
  }
}

function App() {
  const [backendStatus, setBackendStatus] = useState<"checking" | "ok" | "offline">(
    "checking",
  );
  const [sale, setSale] = useState<Sale | null>(null);
  const [barcode, setBarcode] = useState("");
  const [message, setMessage] = useState("Listo para vender");
  const [busy, setBusy] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [showFreeAmount, setShowFreeAmount] = useState(false);
  const [freeAmount, setFreeAmount] = useState("");
  const [freeDescription, setFreeDescription] = useState("Producto sin código");
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>("sale");
  const [cashReceived, setCashReceived] = useState("");
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);
  const [completedPayment, setCompletedPayment] = useState<Payment | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  async function requestDraft() {
    const response = await fetch(`${API_BASE}/sales/draft`, { method: "POST" });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const draft: Sale = await response.json();
    localStorage.setItem(ACTIVE_SALE_KEY, draft.id);
    localStorage.removeItem(ACTIVE_PAYMENT_KEY);
    return draft;
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const health = await fetch(`${API_BASE}/health`);
        if (!health.ok) {
          throw new Error("Backend no disponible");
        }

        if (cancelled) return;
        setBackendStatus("ok");

        const storedSaleId = localStorage.getItem(ACTIVE_SALE_KEY);
        const storedPaymentId = localStorage.getItem(ACTIVE_PAYMENT_KEY);
        let activeSale: Sale | null = null;

        if (storedSaleId) {
          const saved = await fetch(`${API_BASE}/sales/${storedSaleId}`);
          if (saved.ok) {
            const candidate: Sale = await saved.json();
            if (candidate.status === "DRAFT" || candidate.status === "PAYMENT_PENDING") {
              activeSale = candidate;
            }
          }
        }

        if (!activeSale) {
          activeSale = await requestDraft();
        }

        if (!cancelled) {
          setSale(activeSale);
          if (activeSale.status === "PAYMENT_PENDING") {
            setPendingPaymentId(storedPaymentId);
            setCheckoutMode("card");
            setMessage(
              storedPaymentId
                ? "Cobro con tarjeta pendiente de confirmación"
                : "Hay un cobro con tarjeta pendiente que necesita recuperación",
            );
          } else {
            setMessage("Venta en curso");
            window.setTimeout(() => barcodeRef.current?.focus(), 0);
          }
        }
      } catch {
        if (!cancelled) {
          setBackendStatus("offline");
          setMessage("Sin conexión con el sistema local");
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const canEditSale = Boolean(sale && sale.status === "DRAFT" && !busy);
  const canCheckout = Boolean(canEditSale && sale && sale.total_clp > 0);
  const receivedAmount = Number(cashReceived);
  const cashIsValid = Number.isInteger(receivedAmount) && Boolean(sale) && receivedAmount >= (sale?.total_clp ?? 0);
  const previewChange = cashIsValid && sale ? receivedAmount - sale.total_clp : null;

  async function scanProduct(event: FormEvent) {
    event.preventDefault();
    if (!sale || sale.status !== "DRAFT" || !barcode.trim() || busy) return;

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/sales/${sale.id}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: barcode.trim() }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result: ScanResponse = await response.json();
      setSale(result.sale);
      setMessage(result.message);
      setBarcode("");

      if (result.result !== "ADDED") {
        setShowFreeAmount(true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo agregar el producto");
    } finally {
      setBusy(false);
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }

  async function searchProducts(event: FormEvent) {
    event.preventDefault();
    const term = searchTerm.trim();
    if (!term || busy || sale?.status !== "DRAFT") return;

    setBusy(true);
    try {
      const response = await fetch(
        `${API_BASE}/products?search=${encodeURIComponent(term)}`,
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const products: Product[] = await response.json();
      setSearchResults(products);
      setMessage(
        products.length === 0 ? "No encontramos ese producto" : "Elige un producto",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo buscar");
    } finally {
      setBusy(false);
    }
  }

  async function addSelectedProduct(product: Product) {
    if (!sale || sale.status !== "DRAFT" || busy) return;

    if (product.price_mode !== "FIXED" || product.sale_price_clp === null) {
      setFreeDescription(product.name);
      setShowFreeAmount(true);
      setMessage("Ingresa el monto de este producto");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/sales/${sale.id}/items/product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: product.id, quantity: "1.000" }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const updatedSale: Sale = await response.json();
      setSale(updatedSale);
      setMessage("Producto agregado");
      setShowSearch(false);
      setSearchTerm("");
      setSearchResults([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo agregar");
    } finally {
      setBusy(false);
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }

  async function addFreeAmount(event: FormEvent) {
    event.preventDefault();
    if (!sale || sale.status !== "DRAFT" || busy) return;

    const amount = Number(freeAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setMessage("Ingresa un monto válido");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/sales/${sale.id}/free-amount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_clp: amount,
          description: freeDescription.trim() || "Monto libre",
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const updatedSale: Sale = await response.json();
      setSale(updatedSale);
      setMessage("Monto agregado");
      setFreeAmount("");
      setFreeDescription("Producto sin código");
      setShowFreeAmount(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo agregar el monto");
    } finally {
      setBusy(false);
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }

  async function removeItem(itemId: string) {
    if (!sale || sale.status !== "DRAFT" || busy) return;

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/sales/${sale.id}/items/${itemId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const updatedSale: Sale = await response.json();
      setSale(updatedSale);
      setMessage("Producto quitado");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo quitar");
    } finally {
      setBusy(false);
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }

  function openCashPayment() {
    if (!sale || !canCheckout) return;
    setCashReceived(String(sale.total_clp));
    setCheckoutMode("cash");
    setMessage("Ingresa cuánto efectivo recibiste");
  }

  async function completeCash(event: FormEvent) {
    event.preventDefault();
    if (!sale || sale.status !== "DRAFT" || !cashIsValid || busy) return;

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/sales/${sale.id}/payments/cash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cash_received_clp: receivedAmount }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result: CheckoutResponse = await response.json();
      setSale(result.sale);
      setCompletedPayment(result.payment);
      setCheckoutMode("completed");
      setMessage("Venta terminada");
      localStorage.removeItem(ACTIVE_SALE_KEY);
      localStorage.removeItem(ACTIVE_PAYMENT_KEY);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cobrar");
    } finally {
      setBusy(false);
    }
  }

  async function startCardPayment() {
    if (!sale || !canCheckout || busy) return;

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/sales/${sale.id}/payments/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result: CheckoutResponse = await response.json();
      setSale(result.sale);
      setPendingPaymentId(result.payment.id);
      localStorage.setItem(ACTIVE_PAYMENT_KEY, result.payment.id);
      setCheckoutMode("card");
      setMessage("Cobra el total en la máquina y confirma cuando diga APROBADO");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar el cobro con tarjeta");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCardPayment() {
    if (!sale || sale.status !== "PAYMENT_PENDING" || !pendingPaymentId || busy) return;

    setBusy(true);
    try {
      const response = await fetch(
        `${API_BASE}/sales/${sale.id}/payments/${pendingPaymentId}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result: CheckoutResponse = await response.json();
      setSale(result.sale);
      setCompletedPayment(result.payment);
      setPendingPaymentId(null);
      setCheckoutMode("completed");
      setMessage("Venta terminada");
      localStorage.removeItem(ACTIVE_SALE_KEY);
      localStorage.removeItem(ACTIVE_PAYMENT_KEY);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo confirmar el pago");
    } finally {
      setBusy(false);
    }
  }

  async function startNewSale() {
    if (busy) return;

    setBusy(true);
    try {
      const draft = await requestDraft();
      setSale(draft);
      setPendingPaymentId(null);
      setCompletedPayment(null);
      setCheckoutMode("sale");
      setCashReceived("");
      setShowSearch(false);
      setShowFreeAmount(false);
      setSearchTerm("");
      setSearchResults([]);
      setMessage("Venta en curso");
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar una nueva venta");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cashier-shell">
      <header className="cashier-header">
        <div>
          <span className="eyebrow">CAJA</span>
          <h1>Venta</h1>
        </div>
        <div
          className={`connection ${backendStatus === "ok" ? "connected" : ""}`}
          aria-live="polite"
        >
          {backendStatus === "checking"
            ? "Conectando..."
            : backendStatus === "ok"
              ? "Sistema listo"
              : "Sin conexión"}
        </div>
      </header>

      <section className="status-banner" aria-live="polite">
        {message}
      </section>

      <div className="cashier-grid">
        <section className="sale-panel" aria-label="Venta en curso">
          <div className="panel-heading">
            <h2>Venta en curso</h2>
            <span>{sale?.items.length ?? 0} productos</span>
          </div>

          <div className="sale-items">
            {!sale || sale.items.length === 0 ? (
              <div className="empty-sale">
                <strong>Aún no hay productos</strong>
                <span>Escanea el primer producto para comenzar.</span>
              </div>
            ) : (
              sale.items.map((item) => (
                <article className="sale-item" key={item.id}>
                  <div>
                    <strong>{item.description_snapshot}</strong>
                    <span>
                      {Number(item.quantity).toLocaleString("es-CL")} × {formatClp(item.unit_price_clp)}
                    </span>
                  </div>
                  <div className="sale-item-total">
                    <strong>{formatClp(item.line_total_clp)}</strong>
                    <button
                      type="button"
                      className="remove-button"
                      onClick={() => void removeItem(item.id)}
                      disabled={!canEditSale}
                    >
                      Quitar
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="total-card">
            <span>TOTAL</span>
            <strong>{formatClp(sale?.total_clp ?? 0)}</strong>
          </div>
        </section>

        <section className="action-panel" aria-label="Acciones de caja">
          {checkoutMode === "completed" && completedPayment ? (
            <div className="completion-card" aria-live="polite">
              <span className="completion-label">VENTA TERMINADA</span>
              {completedPayment.method === "CASH" ? (
                <>
                  <span className="change-label">VUELTO</span>
                  <strong className="change-amount">
                    {formatClp(completedPayment.change_clp ?? 0)}
                  </strong>
                </>
              ) : (
                <strong className="card-approved">PAGO APROBADO</strong>
              )}
              <button
                type="button"
                className="new-sale-button"
                onClick={() => void startNewSale()}
                disabled={busy}
              >
                NUEVA VENTA
              </button>
            </div>
          ) : checkoutMode === "card" && sale?.status === "PAYMENT_PENDING" ? (
            <div className="card-payment-panel">
              <span className="payment-kicker">TARJETA</span>
              <h2>Cobra {formatClp(sale.total_clp)}</h2>
              <ol>
                <li>Ingresa este monto en la máquina de tarjeta.</li>
                <li>Espera a que la máquina indique que el pago fue aprobado.</li>
                <li>Recién entonces confirma aquí.</li>
              </ol>
              <button
                type="button"
                className="approve-card-button"
                onClick={() => void confirmCardPayment()}
                disabled={busy || !pendingPaymentId}
              >
                PAGO APROBADO
              </button>
              {!pendingPaymentId && (
                <p className="payment-warning">
                  Falta la referencia del pago pendiente. No inicies otra venta.
                </p>
              )}
            </div>
          ) : checkoutMode === "cash" && sale?.status === "DRAFT" ? (
            <div className="cash-payment-panel">
              <span className="payment-kicker">EFECTIVO</span>
              <h2>Total {formatClp(sale.total_clp)}</h2>
              <form onSubmit={completeCash} className="cash-payment-form">
                <label htmlFor="cash-received">¿Cuánto recibiste?</label>
                <input
                  id="cash-received"
                  type="number"
                  min={sale.total_clp}
                  step="1"
                  inputMode="numeric"
                  value={cashReceived}
                  onChange={(event) => setCashReceived(event.target.value)}
                  autoFocus
                />

                <div className="cash-shortcuts" aria-label="Montos rápidos">
                  {cashSuggestions(sale.total_clp).map((amount) => (
                    <button
                      type="button"
                      key={amount}
                      onClick={() => setCashReceived(String(amount))}
                    >
                      {amount === sale.total_clp ? "EXACTO" : formatClp(amount)}
                    </button>
                  ))}
                </div>

                <div className={`change-preview ${previewChange === null ? "waiting" : ""}`}>
                  <span>VUELTO</span>
                  <strong>
                    {previewChange === null ? "—" : formatClp(previewChange)}
                  </strong>
                </div>

                <button
                  type="submit"
                  className="cash-confirm-button"
                  disabled={busy || !cashIsValid}
                >
                  COBRAR EN EFECTIVO
                </button>
                <button
                  type="button"
                  className="back-button"
                  onClick={() => {
                    setCheckoutMode("sale");
                    setMessage("Venta en curso");
                    window.setTimeout(() => barcodeRef.current?.focus(), 0);
                  }}
                  disabled={busy}
                >
                  VOLVER
                </button>
              </form>
            </div>
          ) : (
            <>
              <form className="scan-form" onSubmit={scanProduct}>
                <label htmlFor="barcode">ESCANEAR PRODUCTO</label>
                <input
                  ref={barcodeRef}
                  id="barcode"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  placeholder="Escanea o escribe el código"
                  autoComplete="off"
                  disabled={!canEditSale}
                />
                <button className="primary-button" type="submit" disabled={!canEditSale}>
                  AGREGAR
                </button>
              </form>

              <div className="quick-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowSearch((value) => !value)}
                  disabled={!canEditSale}
                >
                  BUSCAR PRODUCTO
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowFreeAmount((value) => !value)}
                  disabled={!canEditSale}
                >
                  AGREGAR MONTO
                </button>
              </div>

              {showSearch && (
                <div className="action-card">
                  <h3>Buscar producto</h3>
                  <form onSubmit={searchProducts} className="inline-form">
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Nombre del producto"
                      autoFocus
                    />
                    <button type="submit" disabled={busy}>
                      Buscar
                    </button>
                  </form>
                  <div className="search-results">
                    {searchResults.map((product) => (
                      <button
                        type="button"
                        className="product-result"
                        key={product.id}
                        onClick={() => void addSelectedProduct(product)}
                        disabled={busy}
                      >
                        <span>{product.name}</span>
                        <strong>
                          {product.sale_price_clp === null
                            ? "Ingresar monto"
                            : formatClp(product.sale_price_clp)}
                        </strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showFreeAmount && (
                <div className="action-card">
                  <h3>Agregar monto</h3>
                  <form onSubmit={addFreeAmount} className="free-amount-form">
                    <label htmlFor="free-description">Qué estás vendiendo</label>
                    <input
                      id="free-description"
                      value={freeDescription}
                      onChange={(event) => setFreeDescription(event.target.value)}
                      maxLength={200}
                    />
                    <label htmlFor="free-amount">Monto</label>
                    <input
                      id="free-amount"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={freeAmount}
                      onChange={(event) => setFreeAmount(event.target.value)}
                      placeholder="$"
                    />
                    <button className="primary-button" type="submit" disabled={busy}>
                      AGREGAR MONTO
                    </button>
                  </form>
                </div>
              )}

              <div className="checkout-section">
                <span className="checkout-label">COBRAR</span>
                <div className="payment-actions">
                  <button
                    type="button"
                    className="cash-button"
                    onClick={openCashPayment}
                    disabled={!canCheckout}
                  >
                    EFECTIVO
                  </button>
                  <button
                    type="button"
                    className="card-button"
                    onClick={() => void startCardPayment()}
                    disabled={!canCheckout}
                  >
                    TARJETA
                  </button>
                </div>
                {!sale || sale.total_clp === 0 ? (
                  <span className="checkout-help">Agrega productos para cobrar.</span>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
