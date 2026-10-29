import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { MarketReference, Observation, PriceType } from "../api";
import { Alert } from "./Alert";
import { MAX_PRICE_CLP, SCOPE_LABEL, foldText, formatClp, formatContent, formatDate, readNumberField, todayIso } from "../format";

export function ObservationForm({
  referenceId,
  correcting,
  onSaved,
  onCancel,
}: {
  referenceId: string;
  /** Observación que se corrige: la original queda inválida y enlazada a la nueva. */
  correcting?: Observation;
  onSaved: (reference: MarketReference) => void;
  onCancel?: () => void;
}) {
  const [price, setPrice] = useState(correcting ? String(correcting.price_clp) : "");
  const [priceType, setPriceType] = useState<PriceType>(correcting?.price_type ?? "REGULAR");
  const [observedOn, setObservedOn] = useState(correcting?.observed_on ?? todayIso());
  const [validUntil, setValidUntil] = useState(correcting?.promo_valid_until ?? "");
  const [notes, setNotes] = useState(correcting?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    let numeric: number;
    try {
      numeric = Number(
        readNumberField(price, "el precio observado", {
          required: true,
          integer: true,
          positive: true,
          max: MAX_PRICE_CLP,
          example: "1.990",
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (priceType === "PROMO" && validUntil && validUntil < observedOn) {
      setError("La promoción no puede terminar antes de la fecha de observación.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        price_clp: numeric,
        price_type: priceType,
        observed_on: observedOn,
        promo_valid_until: priceType === "PROMO" && validUntil ? validUntil : null,
        notes: notes.trim() || null,
      };
      const updated = correcting
        ? await api.correctObservation(correcting.id, body)
        : await api.addObservation(referenceId, body);
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
        <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ej.: 1.990" autoFocus />
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
          <input type="date" value={validUntil} min={observedOn} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
      )}
      <label className="field">
        Notas <span className="hint">opcional</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        {correcting ? "Guardar corrección" : "Registrar precio"}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      )}
      {error && (
        <Alert kind="danger" style={{ width: "100%" }}>
          {error}
        </Alert>
      )}
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
  const [invalidating, setInvalidating] = useState<Observation | null>(null);
  const [correcting, setCorrecting] = useState<Observation | null>(null);
  const [reason, setReason] = useState("");

  const observations = showAll
    ? reference.observations
    : reference.observations.filter((o) => o.status === "VALID").slice(0, 4);
  const hiddenCount = reference.observations.length - observations.length;

  async function invalidate(event: FormEvent) {
    event.preventDefault();
    if (!invalidating) return;
    if (!reason.trim()) {
      setError("Escribe el motivo, por ejemplo «precio mal tipeado».");
      return;
    }
    try {
      onChanged(await api.invalidateObservation(invalidating.id, reason.trim()));
      setInvalidating(null);
      setReason("");
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const hasInvalid = reference.observations.some((o) => o.status === "INVALID");
  const scopeLabel = SCOPE_LABEL[reference.source.scope];
  const showLocality =
    reference.source.locality && foldText(reference.source.locality) !== foldText(scopeLabel);

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
            {reference.source.name} · {scopeLabel}
            {showLocality ? ` · ${reference.source.locality}` : ""}
          </span>
        </div>
        <div className="chips">
          {reference.match_type === "EXACT" && <span className="chip ok">Mismo producto</span>}
          {reference.match_type === "EQUIVALENT" && <span className="chip info">Producto equivalente</span>}
          {reference.last_observed_on === null ? (
            <span className="chip">{hasInvalid ? "Último precio invalidado" : "Sin precios registrados"}</span>
          ) : reference.stale ? (
            <span className="chip warn">Precio por verificar</span>
          ) : (
            <span className="chip ok">Observado {formatDate(reference.last_observed_on)}</span>
          )}
          {!reference.active && <span className="chip">Inactiva</span>}
        </div>
      </div>

      {error && <Alert kind="danger">{error}</Alert>}

      {observations.length > 0 && (
        <div className="table-wrap">
          <table className="cards compact-cards">
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
                  <td className="inline" data-label="Fecha">{formatDate(observation.observed_on)}</td>
                  <td className="inline" data-label="Tipo">
                    {observation.price_type === "PROMO" ? "Promoción" : "Habitual"}
                    {observation.promo_valid_until && (
                      <span className="sub">hasta {formatDate(observation.promo_valid_until)}</span>
                    )}
                  </td>
                  <td className="num price">{formatClp(observation.price_clp)}</td>
                  <td className="num" data-label="Por unidad">
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
                  <td className="notes">
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
                  <td className="row-actions">
                    {observation.status === "VALID" && (
                      <>
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setCorrecting(observation);
                            setInvalidating(null);
                            setAdding(false);
                          }}
                        >
                          Corregir precio
                        </button>
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setInvalidating(observation);
                            setCorrecting(null);
                            setReason("");
                          }}
                        >
                          Marcar inválido
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions reference-actions" style={{ marginTop: "0.6rem" }}>
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
      {invalidating && (
        <form className="inline-form" style={{ marginTop: "0.6rem" }} onSubmit={invalidate}>
          <label className="field">
            Motivo para marcar inválido el precio de {formatClp(invalidating.price_clp)} ({formatDate(invalidating.observed_on)})
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: precio mal tipeado" autoFocus />
          </label>
          <button type="submit" className="danger">
            Marcar inválido
          </button>
          <button type="button" onClick={() => setInvalidating(null)}>
            Cancelar
          </button>
        </form>
      )}
      {correcting && (
        <ObservationForm
          referenceId={reference.id}
          correcting={correcting}
          onSaved={(updated) => {
            setCorrecting(null);
            onChanged(updated);
          }}
          onCancel={() => setCorrecting(null)}
        />
      )}
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
