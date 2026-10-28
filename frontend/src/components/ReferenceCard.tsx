import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { MarketReference, PriceType } from "../api";
import { SCOPE_LABEL, formatClp, formatContent, formatDate, todayIso } from "../format";

export function ObservationForm({
  referenceId,
  onSaved,
  onCancel,
}: {
  referenceId: string;
  onSaved: (reference: MarketReference) => void;
  onCancel?: () => void;
}) {
  const [price, setPrice] = useState("");
  const [priceType, setPriceType] = useState<PriceType>("REGULAR");
  const [observedOn, setObservedOn] = useState(todayIso());
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(price.replace(/\./g, ""));
    if (!price.trim() || Number.isNaN(numeric) || numeric <= 0) {
      setError("Ingresa el precio observado en pesos.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await api.addObservation(referenceId, {
        price_clp: Math.round(numeric),
        price_type: priceType,
        observed_on: observedOn,
        promo_valid_until: priceType === "PROMO" && validUntil ? validUntil : null,
        notes: notes.trim() || null,
      });
      setPrice("");
      setNotes("");
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="inline-form" style={{ marginTop: "0.6rem" }}>
      <label className="field">
        Precio observado (CLP)
        <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="field">
        Tipo
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
      <label className="field">
        Notas <span className="hint">opcional</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        Registrar precio
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      )}
      {error && <div className="alert danger" style={{ width: "100%" }}>{error}</div>}
    </form>
  );
}

export function ReferenceCard({
  reference,
  onChanged,
  actions,
}: {
  reference: MarketReference;
  onChanged: (reference: MarketReference) => void;
  actions?: React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");

  const observations = showAll
    ? reference.observations
    : reference.observations.filter((o) => o.status === "VALID").slice(0, 4);
  const hiddenCount = reference.observations.length - observations.length;

  async function invalidate(observationId: string) {
    const reason = window.prompt("Motivo para marcar este precio como inválido:");
    if (!reason || !reason.trim()) return;
    try {
      onChanged(await api.invalidateObservation(observationId, reason.trim()));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <div className="page-header" style={{ marginBottom: "0.4rem" }}>
        <div>
          <strong>{reference.product_name}</strong>
          <span className="sub">
            {[reference.brand, reference.variant, formatContent(reference.content_amount, reference.content_unit)]
              .filter(Boolean)
              .join(" · ") || "Sin marca ni presentación registradas"}
          </span>
          <span className="sub">
            {reference.source.name} · {SCOPE_LABEL[reference.source.scope]}
            {reference.source.locality ? ` · ${reference.source.locality}` : ""}
          </span>
        </div>
        <div className="chips">
          {reference.match_type === "EXACT" && <span className="chip ok">Mismo producto</span>}
          {reference.match_type === "EQUIVALENT" && <span className="chip info">Producto equivalente</span>}
          {reference.last_observed_on === null ? (
            <span className="chip">Sin precios registrados</span>
          ) : reference.stale ? (
            <span className="chip warn">Precio por verificar</span>
          ) : (
            <span className="chip ok">Observado {formatDate(reference.last_observed_on)}</span>
          )}
          {!reference.active && <span className="chip">Inactiva</span>}
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {observations.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th className="num">Precio</th>
                <th className="num">Precio unitario</th>
                <th>Estado</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {observations.map((observation) => (
                <tr key={observation.id} className={observation.status === "INVALID" ? "inactive" : ""}>
                  <td>{formatDate(observation.observed_on)}</td>
                  <td>
                    {observation.price_type === "PROMO" ? "Promoción" : "Habitual"}
                    {observation.promo_valid_until && (
                      <span className="sub">hasta {formatDate(observation.promo_valid_until)}</span>
                    )}
                  </td>
                  <td className="num">{formatClp(observation.price_clp)}</td>
                  <td className="num">
                    {observation.unit_price_clp
                      ? `${formatClp(observation.unit_price_clp)} / ${observation.unit_price_label}`
                      : "—"}
                  </td>
                  <td>
                    <div className="chips">
                      {observation.status === "INVALID" && (
                        <span className="chip">Inválido{observation.invalid_reason ? `: ${observation.invalid_reason}` : ""}</span>
                      )}
                      {observation.status === "VALID" && observation.promo_expired && (
                        <span className="chip">Promoción vencida</span>
                      )}
                      {observation.status === "VALID" && observation.stale && (
                        <span className="chip warn">Hace {observation.age_days} días</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {observation.notes}
                    {observation.url && (
                      <>
                        {" "}
                        <a href={observation.url} target="_blank" rel="noreferrer">
                          fuente
                        </a>
                      </>
                    )}
                  </td>
                  <td>
                    {observation.status === "VALID" && (
                      <button type="button" className="link" onClick={() => void invalidate(observation.id)}>
                        Marcar inválido
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions" style={{ marginTop: "0.6rem" }}>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}>
            Registrar precio observado
          </button>
        )}
        {hiddenCount > 0 && !showAll && (
          <button type="button" className="link" onClick={() => setShowAll(true)}>
            Ver historial completo ({reference.observations.length})
          </button>
        )}
        {showAll && (
          <button type="button" className="link" onClick={() => setShowAll(false)}>
            Ver solo vigentes
          </button>
        )}
        {reference.product_url && (
          <a href={reference.product_url} target="_blank" rel="noreferrer" className="muted" style={{ alignSelf: "center" }}>
            Página del producto
          </a>
        )}
        {actions}
      </div>
      {adding && (
        <ObservationForm
          referenceId={reference.id}
          onSaved={(updated) => {
            setAdding(false);
            onChanged(updated);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}
