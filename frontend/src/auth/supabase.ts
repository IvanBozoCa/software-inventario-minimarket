// Sesión por enlace mágico con Supabase Auth. El backend publica en
// /auth/status la URL y la clave pública del proyecto; aquí creamos el cliente
// y mantenemos el JWT de Supabase como token de acceso de la API.
import { createClient } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { setAccessToken } from "../api";

let client: SupabaseClient | null = null;
let clientKey = "";

export function supabaseClient(url: string, anonKey: string): SupabaseClient {
  const key = `${url}|${anonKey}`;
  if (!client || clientKey !== key) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    clientKey = key;
  }
  return client;
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

export function translateAuthError(message: string): string {
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
  return `No se pudo enviar el enlace: ${message}`;
}
