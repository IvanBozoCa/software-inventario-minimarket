import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8010";
const ACTIVE_SALE_KEY = "minimarket.activeSaleId";
const ACTIVE_PAYMENT_KEY = "minimarket.activePaymentId";
const ADMIN_TOKEN_KEY = "minimarket.adminToken";

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

type RecoveryResponse = {
  state: "NONE" | "FOUND" | "CONFLICT";
  sale: Sale | null;
  pending_payment_id: string | null;
  open_sale_count: number;
  message: string;
};

type AdminSecurityStatus = {
  configured: boolean;
  session_minutes: number;
};

type AdminUnlockResponse = {
  token: string;
  expires_at: string;
  session_minutes: number;
};

type AdminSessionResponse = {
  valid: boolean;
  expires_at: string | null;
};

type CheckoutMode = "sale" | "cash" | "card" | "completed";
type StartupMode = "checking" | "ready" | "recovery" | "conflict";
type AdminMode = "closed" | "setup" | "setup-confirm" | "pin" | "unlocked";

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
  const [startupMode, setStartupMode] = useState<StartupMode>("checking");
  const [recoveryMessage, setRecoveryMessage] = useState("");
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
  const [adminMode, setAdminMode] = useState<AdminMode>("closed");
  const [adminPin, setAdminPin] = useState("");
  const [adminFirstPin, setAdminFirstPin] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    sessionStorage.getItem(ADMIN_TOKEN_KEY),
  );
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

        const recoveryResponse = await fetch(`${API_BASE}/sales/recovery`);
        if (!recoveryResponse.ok) {
          throw new Error(await readError(recoveryResponse));
        }

        const recovery: RecoveryResponse = await recoveryResponse.json();
        if (cancelled) return;

        if (recovery.state === "CONFLICT") {
          localStorage.removeItem(ACTIVE_SALE_KEY);
          localStorage.removeItem(ACTIVE_PAYMENT_KEY);
          setSale(null);
          setPendingPaymentId(null);
          setRecoveryMessage(recovery.message);
          setStartupMode("conflict");
          setMessage("Se necesita revisión antes de vender");
          return;
        }

        if (recovery.state === "FOUND" && recovery.sale) {
          setSale(recovery.sale);
          setPendingPaymentId(recovery.pending_payment_id);
          setRecoveryMessage(recovery.message);
          setStartupMode("recovery");
          setMessage("Hay una venta sin terminar");
          return;
        }

        const draft = await requestDraft();
        if (!cancelled) {
          setSale(draft);
          setStartupMode("ready");
          setMessage("Venta en curso");
          window.setTimeout(() => barcodeRef.current?.focus(), 0);
        }
      } catch {
        if (!cancelled) {
          setBackendStatus("offline");
          setStartupMode("checking");
          setMessage("Sin conexión con el sistema local");
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const canEditSale = Boolean(
    startupMode === "ready" && sale && sale.status === "DRAFT" && !busy,
  );
  const canCheckout = Boolean(canEditSale && sale && sale.total_clp > 0);
  const receivedAmount = Number(cashReceived);
  const cashIsValid =
    Number.isInteger(receivedAmount) &&
    Boolean(sale) &&
    receivedAmount >= (sale?.total_clp ?? 0);
  const previewChange = cashIsValid && sale ? receivedAmount - sale.total_clp : null;

  function focusCashier() {
    if (startupMode === "ready" && sale?.status === "DRAFT" && checkoutMode === "sale") {
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }

  function resetAdminPad() {
    setAdminPin("");
    setAdminFirstPin("");
    setAdminError("");
  }

  function closeAdminView() {
    setAdminMode("closed");
    resetAdminPad();
    setMessage("Caja lista");
    focusCashier();
  }

  function clearAdminSession() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken(null);
  }

  async function openAdministration() {
    if (busy || backendStatus !== "ok") return;

    setBusy(true);
    setAdminError("");
    try {
      const statusResponse = await fetch(`${API_BASE}/admin/security/status`);
      if (!statusResponse.ok) {
        throw new Error(await readError(statusResponse));
      }
      const security: AdminSecurityStatus = await statusResponse.json();

      if (!security.configured) {
        resetAdminPad();
        setAdminMode("setup");
        return;
      }

      if (adminToken) {
        const sessionResponse = await fetch(`${API_BASE}/admin/security/session`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (sessionResponse.ok) {
          const session: AdminSessionResponse = await sessionResponse.json();
          if (session.valid) {
            setAdminMode("unlocked");
            setMessage("Administración desbloqueada");
            return;
          }
        }
        clearAdminSession();
      }

      setAdminPin("");
      setAdminError("");
      setAdminMode("pin");
    } catch {
      setMessage("No se pudo abrir Administración");
    } finally {
      setBusy(false);
    }
  }

  function appendAdminDigit(digit: string) {
    setAdminError("");
    setAdminPin((current) => (current.length < 8 ? `${current}${digit}` : current));
  }

  function eraseAdminDigit() {
    setAdminError("");
    setAdminPin((current) => current.slice(0, -1));
  }

  async function unlockWithPin(pin: string) {
    const response = await fetch(`${API_BASE}/admin/security/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const result: AdminUnlockResponse = await response.json();
    sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
    setAdminToken(result.token);
    setAdminPin("");
    setAdminFirstPin("");
    setAdminError("");
    setAdminMode("unlocked");
    setMessage("Administración desbloqueada");
  }

  async function confirmAdminPin() {
    if (busy) return;
    if (adminPin.length < 4) {
      setAdminError("El PIN debe tener al menos 4 números");
      return;
    }

    if (adminMode === "setup") {
      setAdminFirstPin(adminPin);
      setAdminPin("");
      setAdminError("");
      setAdminMode("setup-confirm");
      return;
    }

    if (adminMode === "setup-confirm") {
      if (adminPin !== adminFirstPin) {
        setAdminPin("");
        setAdminError("Los PIN no coinciden. Inténtalo nuevamente.");
        return;
      }

      setBusy(true);
      try {
        const setupResponse = await fetch(`${API_BASE}/admin/security/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: adminPin }),
        });
        if (!setupResponse.ok) {
          throw new Error(await readError(setupResponse));
        }
        await unlockWithPin(adminPin);
      } catch (error) {
        setAdminError(
          error instanceof Error ? error.message : "No se pudo configurar el PIN",
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (adminMode !== "pin") return;

    setBusy(true);
    try {
      await unlockWithPin(adminPin);
    } catch (error) {
      setAdminPin("");
      setAdminError(error instanceof Error ? error.message : "PIN incorrecto");
    } finally {
      setBusy(false);
    }
  }

  async function lockAdministration() {
    const token = adminToken;
    clearAdminSession();
    setAdminMode("closed");
    resetAdminPad();
    setMessage("Administración bloqueada. Caja lista.");
    focusCashier();

    if (!token) return;

    try {
      await fetch(`${API_BASE}/admin/security/lock`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // El bloqueo local se conserva aunque el backend ya no esté disponible.
    }
  }

  function continueRecoveredSale() {
    if (!sale || startupMode !== "recovery") return;

    localStorage.setItem(ACTIVE_SALE_KEY, sale.id);
    if (sale.status === "PAYMENT_PENDING") {
      if (pendingPaymentId) {
        localStorage.setItem(ACTIVE_PAYMENT_KEY, pendingPaymentId);
      }
      setCheckoutMode("card");
      setMessage("Cobro con tarjeta pendiente de confirmación");
    } else {
      localStorage.removeItem(ACTIVE_PAYMENT_KEY);
      setCheckoutMode("sale");
      setMessage("Venta recuperada");
    }

    setStartupMode("ready");
    setRecoveryMessage("");

    if (sale.status === "DRAFT") {
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    }
  }

  async function discardRecoveredSale() {
    if (!sale || startupMode !== "recovery" || busy) return;

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/sales/${sale.id}/discard`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      localStorage.removeItem(ACTIVE_SALE_KEY);
      localStorage.removeItem(ACTIVE_PAYMENT_KEY);

      const draft = await requestDraft();
      setSale(draft);
      setPendingPaymentId(null);
      setCompletedPayment(null);
      setCheckoutMode("sale");
      setCashReceived("");
      setShowSearch(false);
      setShowFreeAmount(false);
      setRecoveryMessage("");
      setStartupMode("ready");
      setMessage("Venta descartada. Nueva venta lista.");
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo descartar la venta",
      );
    } finally {
      setBusy(false);
    }
  }

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
      setMessage(
        error instanceof Error ? error.message : "No se pudo iniciar el cobro con tarjeta",
      );
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

  const adminTitle =
    adminMode === "setup"
      ? "Crea el PIN de administrador"
      : adminMode === "setup-confirm"
        ? "Repite el PIN para confirmar"
        : "Ingresa el PIN de administrador";

  const adminActionLabel =
    adminMode === "setup"
      ? "CONTINUAR"
      : adminMode === "setup-confirm"
        ? "CONFIRMAR PIN"
        : "ENTRAR";

  return (
    <main className="cashier-shell">
      <header className="cashier-header">
        <div>
          <span className="eyebrow">CAJA</span>
          <h1>Venta</h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="admin-entry-button"
            onClick={() => void openAdministration()}
            disabled={busy || backendStatus !== "ok"}
          >
            ADMINISTRACIÓN
          </button>
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
        </div>
      </header>

      <section className="status-banner" aria-live="polite">
        {message}
      </section>

      {startupMode === "checking" ? (
        <section className="recovery-shell" aria-live="polite">
          <div className="recovery-card">
            <span className="recovery-kicker">INICIANDO CAJA</span>
            <h2>Revisando ventas pendientes…</h2>
            <p>El sistema está comprobando que no haya una venta sin terminar.</p>
          </div>
        </section>
      ) : startupMode === "conflict" ? (
        <section className="recovery-shell" aria-live="polite">
          <div className="recovery-card recovery-conflict">
            <span className="recovery-kicker">REVISIÓN NECESARIA</span>
            <h2>Hay más de una venta pendiente</h2>
            <p>{recoveryMessage}</p>
            <strong className="recovery-stop-message">
              No inicies otra venta. Pide ayuda al administrador.
            </strong>
          </div>
        </section>
      ) : startupMode === "recovery" && sale ? (
        <section className="recovery-shell" aria-live="polite">
          <div className="recovery-card">
            <span className="recovery-kicker">VENTA SIN TERMINAR</span>
            <h2>¿Qué quieres hacer con esta venta?</h2>
            <p>{recoveryMessage}</p>

            <div className="recovery-summary">
              <span>
                {sale.status === "PAYMENT_PENDING"
                  ? "Cobro con tarjeta pendiente"
                  : `${sale.items.length} productos`}
              </span>
              <strong>{formatClp(sale.total_clp)}</strong>
            </div>

            {sale.status === "PAYMENT_PENDING" && (
              <p className="recovery-warning">
                Si la máquina de tarjeta alcanzó a aprobar el pago, elige CONTINUAR VENTA.
              </p>
            )}

            <div className="recovery-actions">
              <button
                type="button"
                className="continue-sale-button"
                onClick={continueRecoveredSale}
                disabled={busy}
              >
                CONTINUAR VENTA
              </button>
              <button
                type="button"
                className="discard-sale-button"
                onClick={() => void discardRecoveredSale()}
                disabled={busy}
              >
                DESCARTAR VENTA
              </button>
            </div>
          </div>
        </section>
      ) : (
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
                        {Number(item.quantity).toLocaleString("es-CL")} ×{" "}
                        {formatClp(item.unit_price_clp)}
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

                  <div
                    className={`change-preview ${previewChange === null ? "waiting" : ""}`}
                  >
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
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!canEditSale}
                  >
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
      )}

      {adminMode !== "closed" && (
        <div className="admin-overlay" role="dialog" aria-modal="true" aria-label="Acceso administrador">
          <section className="admin-lock-card">
            {adminMode === "unlocked" ? (
              <div className="admin-unlocked">
                <span className="admin-kicker">ADMINISTRACIÓN</span>
                <h2>Acceso autorizado</h2>
                <p>
                  La sesión administrativa queda disponible temporalmente. Las funciones de
                  inventario, productos, compras y reportes se incorporarán en este espacio.
                </p>
                <div className="admin-session-actions">
                  <button type="button" className="admin-primary-button" onClick={closeAdminView}>
                    VOLVER A CAJA
                  </button>
                  <button
                    type="button"
                    className="admin-lock-button"
                    onClick={() => void lockAdministration()}
                  >
                    BLOQUEAR ADMINISTRACIÓN
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span className="admin-kicker">
                  {adminMode === "setup" || adminMode === "setup-confirm"
                    ? "PRIMERA CONFIGURACIÓN"
                    : "ACCESO ADMINISTRADOR"}
                </span>
                <h2>{adminTitle}</h2>
                <p className="admin-help">
                  {adminMode === "setup"
                    ? "Elige entre 4 y 8 números. Este PIN protegerá las funciones sensibles."
                    : adminMode === "setup-confirm"
                      ? "Vuelve a marcar los mismos números para evitar errores."
                      : "Usa el teclado de la pantalla. Caja seguirá disponible al volver."}
                </p>

                <div className="pin-display" aria-label={`${adminPin.length} números ingresados`}>
                  {adminPin.length > 0 ? "● ".repeat(adminPin.length).trim() : "○ ○ ○ ○"}
                </div>

                {adminError && (
                  <p className="admin-error" role="alert">
                    {adminError}
                  </p>
                )}

                <div className="numeric-keypad" aria-label="Teclado numérico">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                    <button
                      type="button"
                      key={digit}
                      aria-label={`Número ${digit}`}
                      onClick={() => appendAdminDigit(digit)}
                      disabled={busy}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="keypad-secondary"
                    onClick={eraseAdminDigit}
                    disabled={busy || adminPin.length === 0}
                  >
                    BORRAR
                  </button>
                  <button
                    type="button"
                    aria-label="Número 0"
                    onClick={() => appendAdminDigit("0")}
                    disabled={busy}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    className="keypad-confirm"
                    onClick={() => void confirmAdminPin()}
                    disabled={busy || adminPin.length < 4}
                  >
                    {adminActionLabel}
                  </button>
                </div>

                <button
                  type="button"
                  className="admin-back-button"
                  onClick={closeAdminView}
                  disabled={busy}
                >
                  VOLVER A CAJA
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
