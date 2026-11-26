// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function mockApi(handlers: Record<string, (init?: RequestInit) => Promise<Response>>) {
  const calls: { key: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      calls.push({ key, init });
      const handler = handlers[key];
      return handler ? handler(init) : jsonResponse({ detail: `Sin respuesta simulada para ${key}` }, 500);
    }),
  );
  return calls;
}

const OPEN = { required: false, authenticated: true, expires_at: null, mode: "none" };

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Arroz",
  brand: "Miraflores",
  variant: null,
  content_amount: "1",
  content_unit: "KG",
  category_id: null,
  category_name: null,
  active: true,
  track_stock: true,
  stock_unit: "UNIT",
  quantity: "11",
  sale_price_clp: 1500,
  total_unit_cost_clp: null,
  current_gross_margin: null,
  cost_pending: true,
  margins_pending: true,
  market_reference_count: 0,
  market_references_stale: false,
  needs_review: false,
};

const OWNER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "ivan@gmail.com",
  name: "Ivan",
  role: "ADMIN",
  can_edit_prices: true,
  active: true,
  owner: true,
  created_at: "2026-11-26T12:00:00Z",
  last_seen_at: "2026-11-26T12:00:00Z",
};

describe("Usuarios y roles", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("un vendedor solo ve el inventario, sin crear productos ni cambiar precios", async () => {
    mockApi({
      "GET /auth/status": () =>
        jsonResponse({ ...OPEN, role: "SELLER", name: "Papá", email: "papa@gmail.com", can_edit_prices: false }),
      "GET /products/overview": () => jsonResponse([ROW]),
      "GET /categories": () => jsonResponse([]),
    });

    render(<App />);

    expect(await screen.findAllByText("Arroz")).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Nuevo producto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuarios" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Precios de mercado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cambiar precio de Arroz/ })).not.toBeInTheDocument();
    // La cantidad sí se puede ajustar.
    expect(screen.getByRole("button", { name: "Cambiar cantidad de Arroz" })).toBeInTheDocument();

    window.location.hash = "#/usuarios";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText("Esta sección es solo para administradores")).toBeInTheDocument();
  });

  it("el administrador da acceso a su papá como vendedor", async () => {
    let users = [OWNER];
    const calls = mockApi({
      "GET /auth/status": () =>
        jsonResponse({ ...OPEN, role: "ADMIN", name: "Ivan", email: OWNER.email, can_edit_prices: true }),
      "GET /users": () => jsonResponse(users),
      "POST /users": (init) => {
        const body = JSON.parse(String(init?.body));
        const created = { ...OWNER, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ...body, owner: false, last_seen_at: null };
        users = [...users, created];
        return jsonResponse(created, 201);
      },
    });
    window.location.hash = "#/usuarios";

    render(<App />);

    expect(await screen.findByText("Dueño")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Papá" } });
    fireEvent.change(screen.getByLabelText("Correo (Gmail)"), { target: { value: " Papa@Gmail.com " } });
    fireEvent.click(screen.getByLabelText("Puede cambiar precios"));
    fireEvent.click(screen.getByRole("button", { name: "Dar acceso" }));

    expect(await screen.findByText("Papá ya puede entrar a SIM con papa@gmail.com.")).toBeInTheDocument();
    const post = calls.find((call) => call.key === "POST /users");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      name: "Papá",
      email: "papa@gmail.com",
      role: "SELLER",
      can_edit_prices: true,
    });
    const card = (await screen.findByText("papa@gmail.com")).closest("article")!;
    expect(within(card).getByText("Vendedor", { selector: ".chip" })).toBeInTheDocument();
    expect(within(card).getByText("Todavía no entra")).toBeInTheDocument();
  });

  it("avisa si el correo no es válido sin llamar a la API", async () => {
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse({ ...OPEN, role: "ADMIN", name: "Ivan", email: OWNER.email }),
      "GET /users": () => jsonResponse([OWNER]),
    });
    window.location.hash = "#/usuarios";
    render(<App />);
    await screen.findByText("Dueño");

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Papá" } });
    fireEvent.change(screen.getByLabelText("Correo (Gmail)"), { target: { value: "papa" } });
    fireEvent.click(screen.getByRole("button", { name: "Dar acceso" }));

    expect(await screen.findByText(/Escribe un correo válido/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.key === "POST /users")).toBe(false));
  });
});
