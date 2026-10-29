import { useState } from "react";
import type { FormEvent } from "react";
import { api, setAccessToken } from "../api";
import type { AccessStatus } from "../api";
import { sendMagicLink, supabaseClient } from "../auth/supabase";
import { Alert } from "../components/Alert";

type Props = {
  status: AccessStatus;
  // Mensaje previo (por ejemplo, correo no autorizado) que se muestra al entrar.
  notice?: string | null;
  onLoggedIn: () => void;
};

// Pantalla de acceso para la instalación publicada en Internet. En el equipo
// local el backend no exige acceso y esta pantalla nunca se muestra.
export default function LoginPage({ status, notice, onLoggedIn }: Props) {
  if (status.mode === "supabase" && status.supabase_url && status.supabase_anon_key) {
    return (
      <MagicLinkForm
        url={status.supabase_url}
        anonKey={status.supabase_anon_key}
        notice={notice ?? null}
      />
    );
  }
  return <PasswordForm onLoggedIn={onLoggedIn} notice={notice ?? null} />;
}

function MagicLinkForm({ url, anonKey, notice }: { url: string; anonKey: string; notice: string | null }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const target = email.trim().toLowerCase();
    sendMagicLink(supabaseClient(url, anonKey), target)
      .then(() => setSentTo(target))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  if (sentTo) {
    return (
      <section className="card login-card">
        <h2>Revisa tu correo</h2>
        <p>
          Enviamos un enlace de acceso a <strong>{sentTo}</strong>. Ábrelo desde este mismo
          dispositivo y entrarás a SIM. Si no llega en unos minutos, revisa la carpeta de spam.
        </p>
        <div className="actions">
          <button type="button" className="link" onClick={() => setSentTo(null)}>
            Usar otro correo
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card login-card">
      <h2>Acceso al administrador</h2>
      <p className="muted">
        Esta instalación de SIM está publicada en Internet. Escribe tu correo autorizado y te
        enviaremos un enlace para entrar, sin contraseña.
      </p>
      {notice && <div className="alert danger">{notice}</div>}
      <form onSubmit={submit} className="form-grid">
        <label className="field wide">
          Correo
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
        </label>
        {error && <div className="alert danger wide">{error}</div>}
        <div className="actions wide">
          <button type="submit" className="primary" disabled={busy || !email.trim()}>
            {busy ? "Enviando…" : "Enviarme el enlace"}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordForm({ onLoggedIn, notice }: { onLoggedIn: () => void; notice: string | null }) {
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
      {notice && <Alert kind="warn">{notice}</Alert>}
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
