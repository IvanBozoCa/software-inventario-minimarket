import { useState } from "react";
import type { FormEvent } from "react";
import { api, setAccessToken } from "../api";
import type { AccessStatus } from "../api";
import { sendMagicLink, signInWithGoogle, supabaseClient } from "../auth/supabase";
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
  const [showEmail, setShowEmail] = useState(false);

  const google = () => {
    setBusy(true);
    setError(null);
    // Si todo va bien el navegador sale hacia Google y no se vuelve aquí.
    signInWithGoogle(supabaseClient(url, anonKey)).catch((err: Error) => {
      setError(err.message);
      setBusy(false);
    });
  };

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
        Esta instalación de SIM está publicada en Internet. Entra con tu cuenta de Google
        autorizada; la sesión queda abierta en este dispositivo hasta que la cierres.
      </p>
      {notice && <div className="alert danger">{notice}</div>}
      <div className="actions">
        <button type="button" className="primary google-button" onClick={google} disabled={busy}>
          <GoogleMark />
          {busy && !showEmail ? "Abriendo Google…" : "Entrar con Google"}
        </button>
      </div>
      {!showEmail && error && <div className="alert danger">{error}</div>}
      {showEmail ? (
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
            <button type="submit" disabled={busy || !email.trim()}>
              {busy ? "Enviando…" : "Enviarme el enlace"}
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="link"
            onClick={() => {
              setError(null);
              setShowEmail(true);
            }}
          >
            Prefiero recibir un enlace por correo
          </button>
        </div>
      )}
    </section>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48" className="google-mark">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
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
