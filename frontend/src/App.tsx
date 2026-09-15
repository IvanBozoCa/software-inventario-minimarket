import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8010";
const ACTIVE_SALE_KEY = "minimarket.activeSaleId";

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

type ScanResponse = {
  result: "ADDED" | "UNKNOWN_BARCODE" | "MANUAL_PRICE_REQUIRED";
  message: string;
  sale: Sale;
};

function formatClp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
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
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function createDraft() {
      const response = await fetch(`${API_BASE}/sales/draft`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const draft: Sale = await response.json();
      localStorage.setItem(ACTIVE_SALE_KEY, draft.id);
      return draft;
    }

    async function initialize() {
      try {
        const health = await fetch(`${API_BASE}/health`);
        if (!health.ok) {
          throw new Error("Backend no disponible");
        }

        if (cancelled) return;
        setBackendStatus("ok");

        const storedSaleId = localStorage.getItem(ACTIVE_SALE_KEY);
        let activeSale: Sale | null = null;

        if (storedSaleId) {
          const saved = await fetch(`${API_BASE}/sales/${storedSaleId}`);
          if (saved.ok) {
            const candidate: Sale = await saved.json();
            if (candidate.status === "DRAFT") {
              activeSale = candidate;
            }
          }
        }

        if (!activeSale) {
          activeSale = await createDraft();
        }

        if (!cancelled) {
          setSale(activeSale);
          setMessage("Venta en curso");
          window.setTimeout(() => barcodeRef.current?.focus(), 0);
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

  async function scanProduct(event: FormEvent) {
    event.preventDefault();
    if (!sale || !barcode.trim() || busy) return;

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
    if (!term || busy) return;

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
    if (!sale || busy) return;

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
    if (!sale || busy) return;

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
    if (!sale || busy) return;

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
                      disabled={busy}
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
          <form className="scan-form" onSubmit={scanProduct}>
            <label htmlFor="barcode">ESCANEAR PRODUCTO</label>
            <input
              ref={barcodeRef}
              id="barcode"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="Escanea o escribe el código"
              autoComplete="off"
              disabled={!sale || busy}
            />
            <button className="primary-button" type="submit" disabled={!sale || busy}>
              AGREGAR
            </button>
          </form>

          <div className="quick-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowSearch((value) => !value)}
              disabled={!sale || busy}
            >
              BUSCAR PRODUCTO
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowFreeAmount((value) => !value)}
              disabled={!sale || busy}
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
        </section>
      </div>
    </main>
  );
}

export default App;
