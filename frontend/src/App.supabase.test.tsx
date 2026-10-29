// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cliente de Supabase simulado: controla la sesión y registra los envíos de enlace.
const fakeAuth = {
  session: null as null | { access_token: string; user: { email: string } },
  signInWithOtp: vi.fn(async () => ({ error: null as null | { message: string } })),
  signInWithOAuth: vi.fn(async () => ({ data: {}, error: null as null | { message: string } })),
  getSession: vi.fn(async () => ({ data: { session: fakeAuth.session } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signOut: vi.fn(async () => ({ error: null })),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: fakeAuth })),
}));

import App from "./App";

const SUPABASE_STATUS = {
  required: true,
  authenticated: false,
  expires_at: null,
  mode: "supabase",
  supabase_url: "https://ejemplo.supabase.co",
  supabase_anon_key: "sb_publishable_prueba",
  email: null,
};

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );

function mockApi(handlers: Record<string, (init?: RequestInit) => Promise<Response>>) {
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      calls.push({ path: key, init });
      const handler = handlers[key];
      if (!handler) {
        return jsonResponse({ detail: `Sin respuesta simulada para ${key}` }, 500);
      }
      return handler(init);
    }),
  );
  return calls;
}

const authHeader = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization;

describe("App con acceso por Google o enlace mágico (Supabase)", () => {
  beforeEach(() => {
    window.location.hash = "";
    window.localStorage.removeItem("sim.accessToken");
    fakeAuth.session = null;
    fakeAuth.signInWithOtp.mockClear();
    fakeAuth.signInWithOAuth.mockClear();
    fakeAuth.signOut.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("entra con Google", async () => {
    mockApi({ "GET /auth/status": () => jsonResponse(SUPABASE_STATUS) });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Entrar con Google" }));

    await waitFor(() =>
      expect(fakeAuth.signInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "google" }),
      ),
    );
  });

  it("avisa si Google no está activado en Supabase", async () => {
    mockApi({ "GET /auth/status": () => jsonResponse(SUPABASE_STATUS) });
    fakeAuth.signInWithOAuth.mockResolvedValueOnce({
      data: {},
      error: { message: "Unsupported provider: provider is not enabled" },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Entrar con Google" }));

    expect(await screen.findByText(/todavía no está activado/)).toBeInTheDocument();
  });

  it("pide el correo y envía el enlace", async () => {
    mockApi({ "GET /auth/status": () => jsonResponse(SUPABASE_STATUS) });

    render(<App />);

    expect(await screen.findByText("Acceso al administrador")).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prefiero recibir un enlace por correo" }));

    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: " Admin@Minimarket.cl " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el enlace" }));

    expect(await screen.findByText("Revisa tu correo")).toBeInTheDocument();
    expect(screen.getByText("admin@minimarket.cl")).toBeInTheDocument();
    expect(fakeAuth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "admin@minimarket.cl" }),
    );
  });

  it("traduce el error cuando Supabase rechaza el envío", async () => {
    mockApi({ "GET /auth/status": () => jsonResponse(SUPABASE_STATUS) });
    fakeAuth.signInWithOtp.mockResolvedValueOnce({ error: { message: "email rate limit exceeded" } });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Prefiero recibir un enlace por correo" }));
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "a@b.cl" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el enlace" }));

    expect(await screen.findByText(/demasiados enlaces/)).toBeInTheDocument();
  });

  it("entra con la sesión de Supabase cuando el correo está autorizado y permite cerrarla", async () => {
    fakeAuth.session = { access_token: "sb-tok", user: { email: "admin@minimarket.cl" } };
    const calls = mockApi({
      "GET /auth/status": (init) =>
        authHeader(init) === "Bearer sb-tok"
          ? jsonResponse({ ...SUPABASE_STATUS, authenticated: true, email: "admin@minimarket.cl" })
          : jsonResponse(SUPABASE_STATUS),
      "GET /categories": () => jsonResponse([]),
      "GET /products/overview": () => jsonResponse([]),
    });

    render(<App />);

    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(window.localStorage.getItem("sim.accessToken")).toBe("sb-tok");
    await waitFor(() => {
      const overviewCall = calls.find((call) => call.path === "GET /products/overview");
      expect(authHeader(overviewCall?.init)).toBe("Bearer sb-tok");
    });

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión (admin@minimarket.cl)" }));
    expect(await screen.findByText("Acceso al administrador")).toBeInTheDocument();
    expect(window.localStorage.getItem("sim.accessToken")).toBeNull();
    expect(fakeAuth.signOut).toHaveBeenCalled();
  });

  it("usa el token renovado por Supabase aunque el guardado esté vencido", async () => {
    window.localStorage.setItem("sim.accessToken", "vencido");
    fakeAuth.session = { access_token: "sb-tok", user: { email: "admin@minimarket.cl" } };
    const calls = mockApi({
      "GET /auth/status": (init) =>
        authHeader(init) === "Bearer sb-tok"
          ? jsonResponse({ ...SUPABASE_STATUS, authenticated: true, email: "admin@minimarket.cl" })
          : jsonResponse(SUPABASE_STATUS),
      "GET /categories": () => jsonResponse([]),
      "GET /products/overview": () => jsonResponse([]),
    });

    render(<App />);
    expect(await screen.findByText("Conectado")).toBeInTheDocument();

    // Supabase renovó el JWT (por ejemplo, tras horas con la pestaña en segundo plano).
    fakeAuth.session = { access_token: "sb-tok-2", user: { email: "admin@minimarket.cl" } };
    window.location.hash = "#/categorias";
    await waitFor(() => {
      const last = calls.filter((call) => call.path === "GET /categories").at(-1);
      expect(authHeader(last?.init)).toBe("Bearer sb-tok-2");
    });
    expect(window.localStorage.getItem("sim.accessToken")).toBe("sb-tok-2");
  });

  it("rechaza una sesión de Supabase con un correo no autorizado", async () => {
    fakeAuth.session = { access_token: "sb-tok", user: { email: "intruso@correo.cl" } };
    mockApi({ "GET /auth/status": () => jsonResponse(SUPABASE_STATUS) });

    render(<App />);

    expect(await screen.findByText(/intruso@correo.cl no está autorizado/)).toBeInTheDocument();
    await waitFor(() => expect(fakeAuth.signOut).toHaveBeenCalled());
    expect(window.localStorage.getItem("sim.accessToken")).toBeNull();
  });
});
