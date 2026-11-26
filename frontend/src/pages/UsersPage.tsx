import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { AppUser } from "../api";
import { Alert } from "../components/Alert";
import { ROLE_LABEL, useSession } from "../session";
import type { UserRole } from "../session";
import { useAutoClear } from "../useAutoClear";

type Draft = { name: string; email: string; role: UserRole; can_edit_prices: boolean };

const EMPTY: Draft = { name: "", email: "", role: "SELLER", can_edit_prices: false };

function lastSeen(value: string | null): string {
  if (!value) return "Todavía no entra";
  const date = new Date(value);
  return `Última vez: ${date.toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

export default function UsersPage() {
  const session = useSession();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(""), []);
  useAutoClear(notice, clearNotice);

  const reload = useCallback(async () => {
    try {
      setUsers(await api.users());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    api
      .users()
      .then(setUsers)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoaded(true));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const email = draft.email.trim().toLowerCase();
    if (!draft.name.trim()) return setError("Escribe el nombre de la persona.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return setError("Escribe un correo válido, por ejemplo nombre@gmail.com.");
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.createUser({
        ...draft,
        email,
        can_edit_prices: draft.role === "ADMIN" || draft.can_edit_prices,
      });
      setDraft(EMPTY);
      setNotice(`${created.name} ya puede entrar a SIM con ${created.email}.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function update(user: AppUser, changes: Parameters<typeof api.updateUser>[1], message: string) {
    setBusy(true);
    setError("");
    setConfirmingId(null);
    try {
      await api.updateUser(user.id, changes);
      setNotice(message);
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
          <h2>Usuarios</h2>
          <p className="page-intro">
            Quién puede entrar a SIM. Cada persona entra con su propia cuenta de Google (o con un enlace a
            su correo), así cada venta y cada cambio queda a su nombre.
          </p>
        </div>
      </div>

      {error && <Alert kind="danger">{error}</Alert>}
      {notice && <Alert kind="ok">{notice}</Alert>}

      <form className="card" onSubmit={create} noValidate>
        <h3>Dar acceso a una persona</h3>
        <div className="inline-form users-form">
          <label className="field">
            Nombre
            <input
              value={draft.name}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Ej.: Papá"
            />
          </label>
          <label className="field">
            Correo (Gmail)
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="off"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="nombre@gmail.com"
            />
          </label>
          <label className="field">
            Rol
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}>
              <option value="SELLER">Vendedor</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </label>
          {draft.role === "SELLER" && (
            <label className="check">
              <input
                type="checkbox"
                checked={draft.can_edit_prices}
                onChange={(e) => setDraft({ ...draft, can_edit_prices: e.target.checked })}
              />
              Puede cambiar precios
            </label>
          )}
          <button type="submit" className="primary" disabled={busy}>
            Dar acceso
          </button>
        </div>
        <p className="hint roles-help">
          <strong>Administrador:</strong> todo, incluidos precios, costos, categorías y usuarios.{" "}
          <strong>Vendedor:</strong> busca y escanea productos, ve precios y ajusta cantidades; cambia
          precios solo si lo autorizas.
        </p>
      </form>

      <div className="user-list">
        {loaded && users.length === 0 && <p className="empty card">Todavía no hay usuarios registrados.</p>}
        {users.map((user) => {
          const isMe = session.email !== null && user.email === session.email;
          const locked = user.owner || isMe;
          return (
            <article key={user.id} className={`card user-card${user.active ? "" : " inactive"}`}>
              <div className="user-head">
                <div>
                  <h3>
                    {user.name}
                    {isMe && <span className="muted"> (tú)</span>}
                  </h3>
                  <p className="muted user-email">{user.email}</p>
                </div>
                <div className="user-chips">
                  {user.owner && <span className="chip ok">Dueño</span>}
                  <span className={`chip${user.role === "ADMIN" ? " info" : ""}`}>{ROLE_LABEL[user.role]}</span>
                  {!user.active && <span className="chip warn">Sin acceso</span>}
                </div>
              </div>
              <p className="hint">{lastSeen(user.last_seen_at)}</p>

              {user.active && (
                <div className="user-controls">
                  <label className="field">
                    Rol
                    <select
                      value={user.role}
                      disabled={busy || locked}
                      aria-label={`Rol de ${user.name}`}
                      onChange={(e) => {
                        const role = e.target.value as UserRole;
                        void update(user, { role }, `${user.name} ahora es ${ROLE_LABEL[role].toLowerCase()}.`);
                      }}
                    >
                      <option value="SELLER">Vendedor</option>
                      <option value="ADMIN">Administrador</option>
                    </select>
                  </label>
                  {user.role === "SELLER" && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={user.can_edit_prices}
                        disabled={busy}
                        onChange={(e) =>
                          void update(
                            user,
                            { can_edit_prices: e.target.checked },
                            e.target.checked
                              ? `${user.name} ya puede cambiar precios.`
                              : `${user.name} ya no puede cambiar precios.`,
                          )
                        }
                      />
                      Puede cambiar precios
                    </label>
                  )}
                </div>
              )}
              {user.owner && (
                <p className="hint">Correo dueño de SIM: siempre es administrador y no se puede quitar desde aquí.</p>
              )}

              {!locked && (
                <div className="actions">
                  {user.active ? (
                    <button type="button" className="link danger-link" disabled={busy} onClick={() => setConfirmingId(user.id)}>
                      Quitar acceso
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void update(user, { active: true }, `${user.name} puede volver a entrar.`)}
                    >
                      Devolver acceso
                    </button>
                  )}
                </div>
              )}
              {confirmingId === user.id && (
                <Alert kind="warn">
                  ¿Quitar el acceso a {user.name}? No podrá volver a entrar, pero sus ventas y cambios se
                  conservan.{" "}
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void update(user, { active: false }, `${user.name} ya no puede entrar.`)}
                  >
                    Sí, quitar
                  </button>{" "}
                  <button type="button" onClick={() => setConfirmingId(null)}>
                    No
                  </button>
                </Alert>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
