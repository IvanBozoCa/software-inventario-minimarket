import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DaySales, PaymentMethod, PosSale } from "../api";
import { Alert } from "../components/Alert";
import { formatClp, todayIso } from "../format";
import { useSession } from "../session";
import { useAutoClear } from "../useAutoClear";
import { METHOD_LABEL } from "../pos";

function time(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function quantity(value: string): string {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toLocaleString("es-CL", { maximumFractionDigits: 3 });
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Ventas del día: totales, por medio de pago, por vendedor y el detalle de cada venta. */
export default function SalesPage() {
  const session = useSession();
  const [day, setDay] = useState(todayIso);
  const [data, setData] = useState<DaySales | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const clearNotice = useCallback(() => setNotice(""), []);
  useAutoClear(notice, clearNotice);

  useEffect(() => {
    let cancelled = false;
    api
      .daySales(day)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError("");
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [day]);

  async function confirmVoid(sale: PosSale) {
    if (!voiding || !voiding.reason.trim()) {
      setError("Escribe el motivo de la anulación.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.voidSale(sale.id, voiding.reason.trim());
      setVoiding(null);
      setNotice(`Venta de ${formatClp(sale.total_clp)} anulada. Los productos volvieron al inventario.`);
      setData(await api.daySales(day));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isToday = day === todayIso();

  return (
    <section className="sales">
      <div className="page-header">
        <div>
          <h2>Ventas</h2>
          <p className="page-intro">
            {session.isAdmin ? "Ventas de todos los vendedores." : `Tus ventas, ${session.name}.`}
          </p>
        </div>
      </div>

      <div className="sales-day" role="group" aria-label="Día">
        <button type="button" aria-label="Día anterior" onClick={() => setDay((value) => shiftDay(value, -1))}>
          ‹
        </button>
        <input type="date" value={day} max={todayIso()} aria-label="Día" onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button
          type="button"
          aria-label="Día siguiente"
          disabled={isToday}
          onClick={() => setDay((value) => shiftDay(value, 1))}
        >
          ›
        </button>
        {!isToday && (
          <button type="button" className="link" onClick={() => setDay(todayIso())}>
            Hoy
          </button>
        )}
      </div>

      {error && <Alert kind="danger">{error}</Alert>}
      {notice && <Alert kind="ok">{notice}</Alert>}

      {!data && !error && <p className="loading-screen">Cargando ventas…</p>}

      {data && (
        <>
          <div className="sales-summary">
            <div className="card sales-total">
              <span className="muted">{isToday ? "Vendido hoy" : "Vendido ese día"}</span>
              <strong>{formatClp(data.total_clp)}</strong>
              <span className="muted">
                {data.count} {data.count === 1 ? "venta" : "ventas"}
                {data.voided_count > 0 && ` · ${data.voided_count} anulada${data.voided_count === 1 ? "" : "s"}`}
              </span>
            </div>
            <dl className="card sales-methods">
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((method) => (
                <div key={method}>
                  <dt>{METHOD_LABEL[method]}</dt>
                  <dd>{formatClp(data.by_method[method] ?? 0)}</dd>
                </div>
              ))}
            </dl>
          </div>

          {session.isAdmin && data.sellers.length > 0 && (
            <div className="card">
              <h3>Por vendedor</h3>
              <ul className="sales-sellers">
                {data.sellers.map((seller) => (
                  <li key={seller.seller_id ?? "none"}>
                    <span>{seller.seller_name}</span>
                    <span className="muted">
                      {seller.count} {seller.count === 1 ? "venta" : "ventas"}
                    </span>
                    <strong>{formatClp(seller.total_clp)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.sales.length === 0 ? (
            <p className="empty card">
              No hay ventas {isToday ? "hoy todavía" : "ese día"}. <a href="#/caja">Ir a la caja</a>
            </p>
          ) : (
            <ul className="sales-list" aria-label="Ventas del día">
              {data.sales.map((sale) => {
                const voided = sale.status === "VOIDED";
                const expanded = open === sale.id;
                const items = sale.lines.length;
                return (
                  <li key={sale.id} className={`card sale${voided ? " voided" : ""}`}>
                    <button
                      type="button"
                      className="sale-head"
                      aria-expanded={expanded}
                      onClick={() => {
                        setOpen(expanded ? null : sale.id);
                        setVoiding(null);
                      }}
                    >
                      <span className="sale-time">{time(sale.completed_at)}</span>
                      <span className="sale-meta">
                        {sale.payment_method ? METHOD_LABEL[sale.payment_method] : ""}
                        {session.isAdmin && sale.seller_name ? ` · ${sale.seller_name}` : ""}
                        {` · ${items} ${items === 1 ? "línea" : "líneas"}`}
                        {voided && " · Anulada"}
                      </span>
                      <strong className="sale-amount">{formatClp(sale.total_clp)}</strong>
                    </button>
                    {expanded && (
                      <div className="sale-body">
                        <ul className="sale-lines">
                          {sale.lines.map((line, index) => (
                            <li key={index}>
                              <span>
                                {quantity(line.quantity)} × {line.description}
                              </span>
                              <span>{formatClp(line.line_total_clp)}</span>
                            </li>
                          ))}
                        </ul>
                        {sale.change_clp !== null && sale.cash_received_clp !== null && (
                          <p className="muted">
                            Recibido {formatClp(sale.cash_received_clp)} · vuelto {formatClp(sale.change_clp)}
                          </p>
                        )}
                        {voided && (
                          <p className="muted">
                            Anulada por {sale.voided_by_name ?? "un administrador"}: {sale.void_reason}
                          </p>
                        )}
                        {!voided && session.isAdmin && !voiding && (
                          <button type="button" className="danger" onClick={() => setVoiding({ id: sale.id, reason: "" })}>
                            Anular venta
                          </button>
                        )}
                        {voiding?.id === sale.id && (
                          <div className="sale-void">
                            <label className="field">
                              Motivo de la anulación
                              <input
                                value={voiding.reason}
                                maxLength={300}
                                autoFocus
                                placeholder="Ej.: se cobró dos veces"
                                onChange={(e) => setVoiding({ id: sale.id, reason: e.target.value })}
                              />
                            </label>
                            <p className="hint">
                              Los productos vuelven al inventario. Si ya se entregó boleta, hay que anularla aparte.
                            </p>
                            <div className="actions">
                              <button type="button" className="danger" disabled={busy} onClick={() => void confirmVoid(sale)}>
                                {busy ? "Anulando…" : "Confirmar anulación"}
                              </button>
                              <button type="button" disabled={busy} onClick={() => setVoiding(null)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
