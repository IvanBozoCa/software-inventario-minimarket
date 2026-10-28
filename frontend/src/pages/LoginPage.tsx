import { useState } from "react";
import type { FormEvent } from "react";
import { api, setAccessToken } from "../api";

type Props = {
  onLoggedIn: () => void;
};

// Pantalla de acceso para la instalación publicada en Internet. En el equipo
// local el backend no exige contraseña y esta pantalla nunca se muestra.
export default function LoginPage({ onLoggedIn }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    api
      .login(password)
      .then((result) => {
        setAccessToken(result.token);
        setPassword("");
        onLoggedIn();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="card login-card">
      <h2>Acceso al administrador</h2>
      <p className="muted">
        Esta instalación de SIM está publicada en Internet y protegida con una contraseña única.
      </p>
      <form onSubmit={submit} className="form-grid">
        <label className="field wide">
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
        </label>
        {error && <div className="alert danger wide">{error}</div>}
        <div className="actions wide">
          <button type="submit" className="primary" disabled={busy || !password}>
            {busy ? "Verificando…" : "Entrar"}
          </button>
        </div>
      </form>
    </section>
  );
}
