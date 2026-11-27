// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const ADMIN = { required: false, authenticated: true, expires_at: null, mode: "none", role: "ADMIN", name: "Ivan", email: "ivan@gmail.com", can_edit_prices: true };

const item = (id: string, label: string, barcode: string | null) => ({
  id,
  label,
  name: label,
  brand: null,
  variant: null,
  barcode,
  category_name: "Abarrotes",
  sale_price_clp: 1000,
  sale_mode: "UNIT",
  stock_unit: "UNIT",
  track_stock: true,
  quantity: "5",
});

const RICE = item("11111111-1111-4111-8111-111111111111", "Arroz Miraflores 1 kg", "7801234567890");
const SUGAR = item("22222222-2222-4222-8222-222222222222", "Azúcar Iansa 750 g", null);
const TEA = item("33333333-3333-4333-8333-333333333333", "Té Supremo Oro", null);

describe("Asignar códigos de barra", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("escanea (o escribe) un código desconocido y lo asigna al producto que se toca", async () => {
    window.location.hash = "#/codigos";
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(ADMIN),
      "GET /pos/catalog": () => jsonResponse([RICE, SUGAR, TEA]),
      [`PATCH /products/${SUGAR.id}`]: (init) => jsonResponse({ ...SUGAR, barcode: JSON.parse(String(init?.body)).barcode }),
    });
    render(<App />);
    expect(await screen.findByText(/productos tienen código/)).toHaveTextContent("1 de 3 productos tienen código. Faltan 2.");

    fireEvent.change(screen.getByLabelText("Escribir código de barras"), { target: { value: "7802000000017" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar código" }));
    expect(await screen.findByText(/toca abajo el producto/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Azúcar Iansa 750 g/ }));
    expect(await screen.findByText(/Código 7802000000017 guardado en Azúcar Iansa 750 g/)).toBeInTheDocument();
    const patch = calls.find((call) => call.key === `PATCH /products/${SUGAR.id}`);
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ barcode: "7802000000017" });
    expect(screen.getByText(/productos tienen código/)).toHaveTextContent("2 de 3");
  });

  it("no repite un código que ya es de otro producto", async () => {
    window.location.hash = `#/codigos?producto=${TEA.id}`;
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(ADMIN),
      "GET /pos/catalog": () => jsonResponse([RICE, SUGAR, TEA]),
    });
    render(<App />);
    expect(await screen.findByText(/Escanea el código de/)).toHaveTextContent("Té Supremo Oro");

    fireEvent.change(screen.getByLabelText("Escribir código de barras"), { target: { value: "7801234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar código" }));
    expect(await screen.findByText(/ya es de Arroz Miraflores 1 kg/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.key.startsWith("PATCH"))).toBe(false));
  });
});
