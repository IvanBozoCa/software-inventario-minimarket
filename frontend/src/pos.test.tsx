// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { lineTotal } from "./pos";

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function mockApi(handlers: Record<string, (init?: RequestInit, url?: URL) => Promise<Response>>) {
  const calls: { key: string; init?: RequestInit; url: URL }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      calls.push({ key, init, url });
      const handler = handlers[key];
      return handler ? handler(init, url) : jsonResponse({ detail: `Sin respuesta simulada para ${key}` }, 500);
    }),
  );
  return calls;
}

const OPEN = { required: false, authenticated: true, expires_at: null, mode: "none" };
const SELLER = { ...OPEN, role: "SELLER", name: "Papá", email: "papa@gmail.com", can_edit_prices: false };
const ADMIN = { ...OPEN, role: "ADMIN", name: "Ivan", email: "ivan@gmail.com", can_edit_prices: true };

const item = (overrides: Record<string, unknown>) => ({
  id: "11111111-1111-4111-8111-111111111111",
  label: "Arroz Miraflores 1 kg",
  name: "Arroz",
  brand: "Miraflores",
  variant: null,
  barcode: "7801234567890",
  category_name: "Abarrotes",
  sale_price_clp: 1500,
  sale_mode: "UNIT",
  stock_unit: "UNIT",
  track_stock: true,
  quantity: "10",
  ...overrides,
});

const RICE = item({});
const BREAD = item({
  id: "22222222-2222-4222-8222-222222222222",
  label: "Marraqueta",
  name: "Marraqueta",
  brand: null,
  barcode: null,
  category_name: "Panadería",
  sale_price_clp: 2800,
  sale_mode: "WEIGHT",
  stock_unit: "KG",
});
const CANDY = item({
  id: "33333333-3333-4333-8333-333333333333",
  label: "Calugón",
  name: "Calugón",
  brand: null,
  barcode: "1234567",
  sale_price_clp: null,
});

function sale(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    status: "COMPLETED",
    total_clp: 3000,
    payment_method: "CASH",
    cash_received_clp: 5000,
    change_clp: 2000,
    seller_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    seller_name: "Papá",
    completed_at: "2026-11-26T15:30:00Z",
    voided_at: null,
    void_reason: null,
    voided_by_name: null,
    lines: [{ product_id: RICE.id, description: RICE.label, quantity: "2.000", unit_price_clp: 1500, line_total_clp: 3000 }],
    warnings: [],
    ...overrides,
  };
}

function go(hash: string) {
  window.location.hash = hash;
}

describe("Caja en el celular", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Sin cámara en las pruebas: se agrega por búsqueda o tecleando el código.
    window.localStorage.setItem("sim-pos-camera", "false");
    go("#/caja");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("redondea las líneas por peso igual que el servidor", () => {
    const base = { key: "a", productId: "x", label: "Pan", typedPrice: false, weight: true };
    expect(lineTotal({ ...base, unitPrice: 2800, quantity: "0,25" })).toBe(700);
    expect(lineTotal({ ...base, unitPrice: 1990, quantity: "0,25" })).toBe(498);
    expect(lineTotal({ ...base, unitPrice: 1000, quantity: "1,0005" })).toBe(1001);
    expect(lineTotal({ ...base, unitPrice: 1500, quantity: "abc" })).toBeNull();
  });

  it("un vendedor arma el carro, cobra en efectivo y ve el vuelto", async () => {
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(SELLER),
      "GET /pos/catalog": () => jsonResponse([RICE, BREAD, CANDY]),
      "POST /pos/sales": (init) => {
        const body = JSON.parse(String(init?.body));
        return jsonResponse(sale({ total_clp: body.expected_total_clp, change_clp: 5000 - body.expected_total_clp }), 201);
      },
    });
    render(<App />);

    // El vendedor ve Caja, Ventas e Inventario, pero no Ajustes.
    const nav = await screen.findByRole("navigation", { name: "Secciones" });
    expect(within(nav).getByRole("link", { name: "Caja" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Ventas" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Ajustes" })).not.toBeInTheDocument();
    expect(await screen.findByText(/Vendes como Papá/)).toBeInTheDocument();

    const search = screen.getByLabelText("Buscar producto");
    // Código tecleado (como lo entrega una pistola lectora) + Enter.
    await waitFor(() => expect(calls.some((call) => call.key === "GET /pos/catalog")).toBe(true));
    fireEvent.change(search, { target: { value: "7801234567890" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(await screen.findByText("+ Arroz Miraflores 1 kg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Una más de Arroz Miraflores 1 kg" }));
    expect(screen.getByLabelText("Cantidad de Arroz Miraflores 1 kg")).toHaveTextContent("2");

    // Pan por peso, buscado por nombre.
    fireEvent.change(search, { target: { value: "marraq" } });
    fireEvent.click(await screen.findByRole("button", { name: /Marraqueta/ }));
    const kilos = screen.getByLabelText("Kilos de Marraqueta");
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeDisabled();
    fireEvent.change(kilos, { target: { value: "0,25" } });

    // Producto sin precio en SIM: se escribe en la caja.
    fireEvent.change(search, { target: { value: "1234567" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Precio de Calugón"), { target: { value: "$ 300" } });

    // 3.000 + 700 + 300
    expect(screen.getByText("$4.000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    fireEvent.click(screen.getByRole("button", { name: "$5.000" }));
    expect(screen.getByText("Vuelto: $1.000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));

    expect(await screen.findByText("Venta registrada · $4.000")).toBeInTheDocument();
    expect(screen.getByText("Vuelto $1.000")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Carro" })).not.toBeInTheDocument();

    const post = calls.find((call) => call.key === "POST /pos/sales")!;
    const body = JSON.parse(String(post.init?.body));
    expect(body).toMatchObject({
      payment_method: "CASH",
      cash_received_clp: 5000,
      expected_total_clp: 4000,
      lines: [
        { product_id: CANDY.id, quantity: "1", unit_price_clp: 300, description: null },
        { product_id: BREAD.id, quantity: "0.25", unit_price_clp: 2800, description: null },
        { product_id: RICE.id, quantity: "2", unit_price_clp: 1500, description: null },
      ],
    });
    expect(body.client_ref).toMatch(/^[A-Za-z0-9]{8,}$/);
    expect(window.localStorage.getItem("sim-cart-v1")).toBe("[]");
  });

  it("avisa si el código no está en SIM y permite un monto libre", async () => {
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(SELLER),
      "GET /pos/catalog": () => jsonResponse([RICE]),
      "POST /pos/sales": () => jsonResponse(sale({ total_clp: 1200, payment_method: "CARD", change_clp: null }), 201),
    });
    render(<App />);
    const search = await screen.findByLabelText("Buscar producto");
    await waitFor(() => expect(calls.some((call) => call.key === "GET /pos/catalog")).toBe(true));

    fireEvent.change(search, { target: { value: "7809999999999" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(await screen.findByText(/El código 7809999999999 no está en SIM/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Crear producto" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Monto libre" }));
    fireEvent.change(screen.getByLabelText("Descripción del monto libre"), { target: { value: "Verduras" } });
    fireEvent.change(screen.getByLabelText("Monto de Verduras"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta" }));
    expect(screen.getByText(/Cobra en la máquina de tarjetas/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));

    expect(await screen.findByText(/Entrega el voucher/)).toBeInTheDocument();
    const body = JSON.parse(String(calls.find((call) => call.key === "POST /pos/sales")!.init?.body));
    expect(body).toMatchObject({
      payment_method: "CARD",
      cash_received_clp: null,
      lines: [{ product_id: null, quantity: "1", unit_price_clp: 1200, description: "Verduras" }],
    });
  });

  it("si cambió un precio, actualiza el carro y pide revisar antes de cobrar", async () => {
    let catalog = [RICE];
    mockApi({
      "GET /auth/status": () => jsonResponse(SELLER),
      "GET /pos/catalog": () => jsonResponse(catalog),
      "POST /pos/sales": () => {
        catalog = [{ ...RICE, sale_price_clp: 1700 }];
        return jsonResponse(
          { detail: "Cambió el precio de algún producto desde que abriste la caja. Revisa el carro.", price_changes: [] },
          409,
        );
      },
    });
    render(<App />);
    const search = await screen.findByLabelText("Buscar producto");
    fireEvent.change(search, { target: { value: "arroz" } });
    fireEvent.click(await screen.findByRole("button", { name: /Arroz Miraflores/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Transferencia" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));

    expect(await screen.findByText(/Cambió el precio de algún producto/)).toBeInTheDocument();
    expect(screen.getByText(/El total ya está actualizado/)).toBeInTheDocument();
    expect(screen.getByText("$1.700 c/u")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeEnabled();
  });

  it("el carro se conserva si se cierra la pantalla", async () => {
    mockApi({
      "GET /auth/status": () => jsonResponse(SELLER),
      "GET /pos/catalog": () => jsonResponse([RICE]),
    });
    const first = render(<App />);
    const search = await screen.findByLabelText("Buscar producto");
    fireEvent.change(search, { target: { value: "arroz" } });
    fireEvent.click(await screen.findByRole("button", { name: /Arroz Miraflores/ }));
    first.unmount();

    render(<App />);
    expect(await screen.findByLabelText("Cantidad de Arroz Miraflores 1 kg")).toHaveTextContent("1");
  });
});

describe("Ventas del día", () => {
  beforeEach(() => {
    window.localStorage.clear();
    go("#/ventas");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const DAY = {
    day: "2026-11-26",
    count: 2,
    total_clp: 8000,
    by_method: { CASH: 3000, CARD: 5000, TRANSFER: 0 },
    sellers: [
      { seller_id: "a", seller_name: "Ivan", count: 1, total_clp: 5000 },
      { seller_id: "b", seller_name: "Papá", count: 1, total_clp: 3000 },
    ],
    voided_count: 0,
    sales: [
      sale({ id: "s2", total_clp: 5000, payment_method: "CARD", seller_name: "Ivan", cash_received_clp: null, change_clp: null }),
      sale({ id: "s1" }),
    ],
  };

  it("el administrador ve el total por vendedor y anula una venta con motivo", async () => {
    let voided = false;
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(ADMIN),
      "GET /pos/sales": () =>
        jsonResponse(
          voided
            ? {
                ...DAY,
                count: 1,
                total_clp: 5000,
                voided_count: 1,
                sales: [DAY.sales[0], { ...DAY.sales[1], status: "VOIDED", void_reason: "Cobro doble", voided_by_name: "Ivan" }],
              }
            : DAY,
        ),
      "POST /pos/sales/s1/void": () => {
        voided = true;
        return jsonResponse(sale({ id: "s1", status: "VOIDED" }));
      },
    });
    render(<App />);

    expect(await screen.findByText("$8.000")).toBeInTheDocument();
    expect(screen.getByText("Por vendedor")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    expect(within(nav).getByRole("link", { name: "Ajustes" })).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Ventas del día" });
    fireEvent.click(within(list).getAllByRole("button")[1]);
    expect(screen.getByText("2 × Arroz Miraflores 1 kg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar anulación" }));
    expect(await screen.findByText("Escribe el motivo de la anulación.")).toBeInTheDocument();
    expect(calls.some((call) => call.key === "POST /pos/sales/s1/void")).toBe(false);

    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), { target: { value: "Cobro doble" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar anulación" }));
    expect(await screen.findByText(/Venta de \$3\.000 anulada/)).toBeInTheDocument();
    expect(await screen.findByText(/1 anulada/)).toBeInTheDocument();
    const voidCall = calls.find((call) => call.key === "POST /pos/sales/s1/void")!;
    expect(JSON.parse(String(voidCall.init?.body))).toEqual({ reason: "Cobro doble" });
  });

  it("un vendedor ve solo sus ventas y no puede anular", async () => {
    mockApi({
      "GET /auth/status": () => jsonResponse(SELLER),
      "GET /pos/sales": () =>
        jsonResponse({ ...DAY, count: 1, total_clp: 3000, sellers: [DAY.sellers[1]], sales: [DAY.sales[1]] }),
    });
    render(<App />);
    expect(await screen.findByText("Tus ventas, Papá.")).toBeInTheDocument();
    expect(screen.queryByText("Por vendedor")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("list", { name: "Ventas del día" })).getByRole("button"));
    expect(screen.getByText("2 × Arroz Miraflores 1 kg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
  });
});
