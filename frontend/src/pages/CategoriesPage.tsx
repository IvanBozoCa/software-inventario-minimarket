import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { Category } from "../api";
import { Alert } from "../components/Alert";
import { useAutoClear } from "../useAutoClear";
import { formatPercent, parseLocaleNumber, percentInputToRatio, ratioToPercentInput } from "../format";

type Draft = { name: string; min_margin: string; upper_margin: string };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Draft>({ name: "", min_margin: "", upper_margin: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({ name: "", min_margin: "", upper_margin: "" });
  const [error, setError] = useState("");
  // Error de la fila en edición: se muestra junto a la fila, no arriba.
  const [rowError, setRowError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clearNotice = useCallback(() => setNotice(""), []);
  useAutoClear(notice, clearNotice);

  async function reload() {
    try {
      setCategories(await api.categories(true));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    api
      .categories(true)
      .then(setCategories)
      .catch((err: Error) => setError(err.message));
  }, []);

  function validate(value: Draft): string | null {
    if (!value.name.trim()) return "El nombre es obligatorio.";
    const min = percentInputToRatio(value.min_margin);
    const upper = percentInputToRatio(value.upper_margin);
    if (value.name.trim().length > 120) return "El nombre puede tener como máximo 120 caracteres.";
    const unreadable = (text: string) => text.trim() !== "" && parseLocaleNumber(text) === undefined;
    if (unreadable(value.min_margin) || unreadable(value.upper_margin) || (value.min_margin.trim() && min === null) || (value.upper_margin.trim() && upper === null)) {
      return "Los márgenes deben ser números (por ejemplo 25 para 25 %).";
    }
    for (const ratio of [min, upper]) {
      if (ratio !== null && (Number(ratio) < 0 || Number(ratio) >= 1)) {
        return "Cada margen debe estar entre 0 % y menos de 100 %.";
      }
    }
    if (min !== null && upper !== null && Number(upper) < Number(min)) {
      return "El margen superior no puede ser menor que el mínimo.";
    }
    return null;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.createCategory({
        name: draft.name.trim(),
        min_margin: percentInputToRatio(draft.min_margin),
        upper_margin: percentInputToRatio(draft.upper_margin),
      });
      setDraft({ name: "", min_margin: "", upper_margin: "" });
      setNotice(`Categoría «${draft.name.trim()}» creada.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(category: Category) {
    setEditingId(category.id);
    setEditDraft({
      name: category.name,
      min_margin: ratioToPercentInput(category.min_margin),
      upper_margin: ratioToPercentInput(category.upper_margin),
    });
    setError("");
    setRowError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError("");
  }

  async function saveEdit(category: Category) {
    const problem = validate(editDraft);
    if (problem) {
      setRowError(problem);
      return;
    }
    setBusy(true);
    try {
      await api.updateCategory(category.id, {
        name: editDraft.name.trim(),
        min_margin: percentInputToRatio(editDraft.min_margin),
        upper_margin: percentInputToRatio(editDraft.upper_margin),
      });
      setEditingId(null);
      setRowError("");
      setNotice("Cambios guardados.");
      await reload();
    } catch (err) {
      setRowError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(category: Category) {
    setBusy(true);
    setConfirmingId(null);
    try {
      await api.updateCategory(category.id, { active: !category.active });
      setNotice(category.active ? `Categoría «${category.name}» desactivada.` : `Categoría «${category.name}» reactivada.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Categorías y márgenes</h2>
          <p className="page-intro">
            Cada categoría define el margen mínimo objetivo y el margen superior de referencia (sobre el
            precio de venta). No hay valores predeterminados: defínelos según tu negocio.
          </p>
        </div>
      </div>

      {error && <Alert kind="danger">{error}</Alert>}
      {notice && <Alert kind="ok">{notice}</Alert>}

      <form className="card" onSubmit={create}>
        <h3>Nueva categoría</h3>
        <div className="inline-form">
          <label className="field">
            Nombre
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej.: Bebidas" />
          </label>
          <label className="field">
            Margen mínimo (%)
            <input inputMode="decimal" value={draft.min_margin} onChange={(e) => setDraft({ ...draft, min_margin: e.target.value })} placeholder="Ej.: 20" />
          </label>
          <label className="field">
            Margen superior (%)
            <input inputMode="decimal" value={draft.upper_margin} onChange={(e) => setDraft({ ...draft, upper_margin: e.target.value })} placeholder="Ej.: 35" />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            Crear categoría
          </button>
        </div>
      </form>

      <div className="card table-wrap">
        {categories.length === 0 ? (
          <p className="empty">Todavía no hay categorías.</p>
        ) : (
          <table className="cards compact-cards">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Margen mínimo</th>
                <th className="num">Margen superior</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) =>
                editingId === category.id ? (
                  <tr key={category.id}>
                    <td>
                      <input aria-label="Nombre de la categoría" value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                    </td>
                    <td className="num">
                      <input aria-label="Margen mínimo (%)" inputMode="decimal" value={editDraft.min_margin} onChange={(e) => setEditDraft({ ...editDraft, min_margin: e.target.value })} />
                    </td>
                    <td className="num">
                      <input aria-label="Margen superior (%)" inputMode="decimal" value={editDraft.upper_margin} onChange={(e) => setEditDraft({ ...editDraft, upper_margin: e.target.value })} />
                    </td>
                    <td>{category.active ? "Activa" : "Inactiva"}</td>
                    <td>
                      <button type="button" className="primary" disabled={busy} onClick={() => void saveEdit(category)}>
                        Guardar
                      </button>{" "}
                      <button type="button" onClick={cancelEdit}>
                        Cancelar
                      </button>
                      {rowError && (
                        <Alert kind="danger" style={{ marginTop: "0.4rem" }}>
                          {rowError}
                        </Alert>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr key={category.id} className={category.active ? "" : "inactive"}>
                    <td className="row-title">{category.name}</td>
                    <td className="num" data-label="Margen mínimo">
                      {category.min_margin === null ? <span className="chip warn">Sin definir</span> : formatPercent(category.min_margin)}
                    </td>
                    <td className="num" data-label="Margen superior">
                      {category.upper_margin === null ? <span className="chip warn">Sin definir</span> : formatPercent(category.upper_margin)}
                    </td>
                    <td className="inline">{category.active ? <span className="muted">Activa</span> : <span className="chip">Inactiva</span>}</td>
                    <td>
                      <button type="button" className="link" onClick={() => startEdit(category)}>
                        Editar
                      </button>
                      {category.active ? (
                        <button type="button" className="link" disabled={busy} onClick={() => setConfirmingId(category.id)}>
                          Desactivar
                        </button>
                      ) : (
                        <button type="button" className="link" disabled={busy} onClick={() => void toggleActive(category)}>
                          Reactivar
                        </button>
                      )}
                      {confirmingId === category.id && (
                        <Alert kind="warn">
                          ¿Desactivar «{category.name}»? Ya no aparecerá al crear productos. Sus productos conservan
                          la categoría y siguen usando sus márgenes.{" "}
                          <button type="button" className="danger" onClick={() => void toggleActive(category)}>
                            Sí, desactivar
                          </button>{" "}
                          <button type="button" onClick={() => setConfirmingId(null)}>
                            No
                          </button>
                        </Alert>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
