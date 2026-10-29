// Sesión con Supabase Auth: cuenta de Google (principal) o enlace mágico. El backend publica en
// /auth/status la URL y la clave pública del proyecto; aquí creamos el cliente
// y mantenemos el JWT de Supabase como token de acceso de la API.
import { createClient } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { setAccessToken, setAccessTokenSource } from "../api";

let client: SupabaseClient | null = null;
let clientKey = "";

export function supabaseClient(url: string, anonKey: string): SupabaseClient {
  const key = `${url}|${anonKey}`;
  if (!client || clientKey !== key) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    clientKey = key;
    const current = client;
    // getSession() devuelve la sesión guardada y la renueva si el JWT venció.
    setAccessTokenSource(async () => {
      const { data } = await current.auth.getSession();
      return data.session?.access_token ?? null;
    });
  }
  return client;
}

// Lleva a la pantalla de Google; al volver, Supabase deja la sesión guardada en
// este navegador y se mantiene (se renueva sola) hasta cerrar sesión.
export async function signInWithGoogle(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    throw new Error(translateAuthError(error.message, "No se pudo abrir el acceso con Google"));
  }
}

export function applySession(session: Session | null): void {
  setAccessToken(session?.access_token ?? null);
}

export async function sendMagicLink(
  supabase: SupabaseClient,
  email: string,
): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) {
    throw new Error(translateAuthError(error.message));
  }
}

export function translateAuthError(
  message: string,
  fallback = "No se pudo enviar el enlace",
): string {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit")) {
    return "Se enviaron demasiados enlaces en poco tiempo. Espera unos minutos e inténtalo otra vez.";
  }
  if (lower.includes("invalid") && lower.includes("email")) {
    return "El correo no es válido.";
  }
  if (lower.includes("signups not allowed")) {
    return "Ese correo no está autorizado para entrar a SIM.";
  }
  if (lower.includes("provider is not enabled") || lower.includes("unsupported provider")) {
    return "El acceso con Google todavía no está activado en Supabase. Por ahora usa el enlace por correo.";
  }
  return `${fallback}: ${message}`;
}
