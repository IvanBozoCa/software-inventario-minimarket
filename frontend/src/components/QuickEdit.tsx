import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

/**
 * Edición en el lugar de un número de la lista (precio o cantidad).
 *
 * `validate` lee el texto y devuelve el valor listo para guardar o lanza un
 * error con el mensaje a mostrar; `confirm` puede devolver un aviso que exige
 * un segundo «Guardar» antes de enviar (precio en $0, bajo el costo, etc.).
 */
export default function QuickEdit<T>({
  label,
  initial,
  inputMode,
  placeholder,
  validate,
  confirm,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  inputMode: "numeric" | "decimal";
  placeholder: string;
  validate: (raw: string) => T;
  confirm?: (value: T) => string | null;
  onSave: (value: T) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ value: T; warning: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let value: T;
    try {
      value = validate(text);
    } catch (err) {
      setError((err as Error).message);
      setPending(null);
      return;
    }
    setError("");
    const warning = confirm?.(value) ?? null;
    if (warning && pending?.value !== value) {
      setPending({ value, warning });
      return;
    }
    setPending(null);
    setBusy(true);
    try {
      await onSave(value);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form className="quick-edit-form" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
      <div className="quick-edit-row">
        <input
          aria-label={label}
          inputMode={inputMode}
          enterKeyHint="done"
          value={text}
          placeholder={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            setPending(null);
          }}
          onFocus={(event) => event.target.select()}
          aria-invalid={error ? true : undefined}
          disabled={busy}
          autoFocus
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Guardando…" : pending ? "Sí, guardar" : "Guardar"}
        </button>
        <button type="button" className="quick-edit-cancel" onClick={onCancel} disabled={busy} aria-label="Cancelar">
          ✕
        </button>
      </div>
      {error && (
        <p className="quick-edit-msg danger" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <p className="quick-edit-msg warn" role="alert">
          {pending.warning} Pulsa «Sí, guardar» para confirmar.
        </p>
      )}
    </form>
  );
}
