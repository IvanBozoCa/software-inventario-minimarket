// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { parseRoute } from "./router";
import { formatClp, formatPercent, percentInputToRatio, ratioToPercentInput } from "./format";

const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";

const overviewRow = {
  id: PRODUCT_ID,
  name: "Bebida cola",
  brand: "Coca-Cola",
  variant: "Original",
  content_amount: "1.500",
  content_unit: "L",
  category_id: null,
  category_name: "Bebidas",
  active: true,
  track_stock: true,
  stock_unit: "UNIT",
  quantity: "24.000",
  sale_price_clp: 2200,
  total_unit_cost_clp: null,
  current_gross_margin: null,
  cost_pending: true,
  margins_pending: false,
  market_reference_count: 0,
  market_references_stale: false,
  needs_review: false,
};

const detail = {
  product: {
    id: PRODUCT_ID,
    name: "Bebida cola",
    barcode: null,
    category_id: null,
    sale_price_clp: 2200,
    track_stock: true,
    active: true,
    brand: "Coca-Cola",
    variant: "Original",
    content_amount: "1.500",
    content_unit: "L",
    stock_unit: "UNIT",
    last_unit_cost_clp: "1500.00",
    extra_supply_cost_clp: null,
    min_margin: null,
    upper_margin: null,
  },
  category_name: "Bebidas",
  quantity: "24.000",
  pricing: {
    sale_price_clp: 2200,
    unit_cost_clp: "1500.00",
    extra_supply_cost_clp: null,
    total_unit_cost_clp: "1500.00",
    min_margin: "0.2500",
    min_margin_source: "CATEGORY",
    upper_margin: "0.4000",
    upper_margin_source: "CATEGORY",
    price_at_min_margin: "2000.00",
    price_at_upper_margin: "2500.00",
    current_gross_margin: "0.3182",
    current_markup: "0.4667",
    range_available: true,
    needs_review: false,
    warnings: [],
  },
  cost_history: [],
  price_history: [
    {
      id: "p1",
      previous_price_clp: null,
      new_price_clp: 2200,
      note: "Precio inicial",
      changed_at: "2026-10-28T12:00:00Z",
    },
  ],
  stock_movements: [],
  market: {
    stale_days: 30,
    has_references: true,
    has_stale: true,
    exact_regular_low: {
      price_clp: 2250,
      reference_id: "r1",
      source_name: "Lider.cl",
      scope: "WEB",
      observed_on: "2026-10-28",
    },
    exact_regular_high: {
      price_clp: 2290,
      reference_id: "r2",
      source_name: "Jumbo.cl",
      scope: "WEB",
      observed_on: "2026-10-28",
    },
    references: [
      {
        id: "r3",
        source: { id: "s1", name: "Almacén local", scope: "PICHILEMU", locality: "Pichilemu" },
        product_name: "Bebida cola",
        brand: "Coca-Cola",
        variant: null,
        content_amount: "2.000",
        content_unit: "L",
        product_url: null,
        product_id: PRODUCT_ID,
        match_type: "EQUIVALENT",
        notes: null,
        active: true,
        last_observed_on: "2026-08-01",
        stale: true,
        observations: [
          {
            id: "o1",
            reference_id: "r3",
            price_clp: 2000,
            price_type: "REGULAR",
            promo_valid_from: null,
            promo_valid_until: null,
            observed_on: "2026-08-01",
            url: null,
            notes: null,
            status: "VALID",
            invalid_reason: null,
            replaced_by_id: null,
            age_days: 88,
            stale: true,
            promo_expired: false,
            promo_current: false,
            unit_price_clp: "1000.00",
            unit_price_label: "L",
          },
        ],
      },
    ],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

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

describe("router", () => {
  it("interpreta las rutas de la administración", () => {
    expect(parseRoute("")).toEqual({ page: "inventory" });
    expect(parseRoute("#/productos/nuevo")).toEqual({ page: "product-new" });
    expect(parseRoute("#/productos/abc")).toEqual({ page: "product", id: "abc" });
    expect(parseRoute("#/productos/abc/editar")).toEqual({ page: "product-edit", id: "abc" });
    expect(parseRoute("#/categorias")).toEqual({ page: "categories" });
    expect(parseRoute("#/mercado")).toEqual({ page: "market" });
  });
});

describe("formato", () => {
  it("muestra pesos chilenos y porcentajes", () => {
    expect(formatClp(2200)).toMatch(/\$\s?2\.200/);
    expect(formatClp("1586.67", true)).toMatch(/1\.586,67/);
    expect(formatClp(null)).toBe("—");
    expect(formatPercent("0.3182")).toBe("31,8 %");
  });

  it("convierte márgenes entre porcentaje y proporción", () => {
    expect(percentInputToRatio("25")).toBe("0.2500");
    expect(percentInputToRatio("12,5")).toBe("0.1250");
    expect(percentInputToRatio("")).toBeNull();
    expect(ratioToPercentInput("0.2500")).toBe("25");
  });
});

describe("App", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("muestra el inventario con indicadores de costo pendiente", async () => {
    mockApi({
      "GET /auth/status": () => jsonResponse({ required: false, authenticated: true, expires_at: null }),
      "GET /categories": () => jsonResponse([]),
      "GET /products/overview": () => jsonResponse([overviewRow]),
    });

    render(<App />);

    expect(await screen.findByText("Bebida cola")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Costo pendiente")).toBeInTheDocument();
    expect(within(table).getByText("Sin referencias")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Costo pendiente (1)" })).toBeInTheDocument();
    expect(screen.getByText(/2\.200/)).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
  });

  it("pone precio y corrige la cantidad directo desde el inventario", async () => {
    const OTHER_ID = "22222222-2222-2222-2222-222222222222";
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse({ required: false, authenticated: true, expires_at: null }),
      "GET /categories": () => jsonResponse([]),
      "GET /products/overview": () =>
        jsonResponse([
          { ...overviewRow, sale_price_clp: null },
          { ...overviewRow, id: OTHER_ID, name: "Bebida limón", sale_price_clp: null },
        ]),
      [`PUT /products/${PRODUCT_ID}/price`]: () => jsonResponse({ ...detail.product, sale_price_clp: 1990 }),
      [`PUT /products/${PRODUCT_ID}/stock`]: () => jsonResponse(null),
    });

    render(<App />);

    await screen.findByText("2 productos no tienen precio de venta.");
    fireEvent.click(screen.getByRole("button", { name: "Ponerles precio" }));
    expect(screen.getByRole("button", { name: "Sin precio (2)" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Poner precio a Bebida cola" }));
    fireEvent.change(screen.getByLabelText("Precio de venta de Bebida cola"), { target: { value: "1.990" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === `PUT /products/${PRODUCT_ID}/price`)).toBe(true),
    );
    const priceCall = calls.find((call) => call.path === `PUT /products/${PRODUCT_ID}/price`);
    expect(JSON.parse(String(priceCall?.init?.body)).sale_price_clp).toBe(1990);
    // Se abre el siguiente producto sin precio para seguir de corrido.
    expect(await screen.findByLabelText("Precio de venta de Bebida limón")).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText("Precio de venta de Bebida limón"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Todos (2)" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Cambiar cantidad de Bebida cola/ })[0]);
    const quantity = screen.getByLabelText("Cantidad de Bebida cola (unidades)");
    expect(quantity).toHaveValue("24");
    fireEvent.change(quantity, { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/va sin decimales/)).toBeInTheDocument();
    fireEvent.change(quantity, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === `PUT /products/${PRODUCT_ID}/stock`)).toBe(true),
    );
    const stockCall = calls.find((call) => call.path === `PUT /products/${PRODUCT_ID}/stock`);
    expect(JSON.parse(String(stockCall?.init?.body)).quantity).toBe("30");
  });

  it("avisa cuando el sistema local no responde", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    render(<App />);
    expect(await screen.findByText("No se pudo conectar con el servidor de SIM")).toBeInTheDocument();
  });

  it("pide la contraseña cuando la instalación está protegida y guarda el token", async () => {
    window.localStorage.removeItem("sim.accessToken");
    const calls = mockApi({
      "GET /auth/status": () =>
        jsonResponse({ required: true, authenticated: false, expires_at: null }),
      "POST /auth/login": (init) =>
        JSON.parse(String(init?.body)).password === "clave-segura"
          ? jsonResponse({ token: "tok-123", expires_at: "2026-10-29T00:00:00Z", session_hours: 12 })
          : jsonResponse({ detail: "Contraseña incorrecta" }, 401),
      "GET /categories": () => jsonResponse([]),
      "GET /products/overview": () => jsonResponse([overviewRow]),
    });

    render(<App />);

    expect(await screen.findByText("Acceso al administrador")).toBeInTheDocument();
    expect(screen.queryByText("Inventario")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "mala" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Contraseña incorrecta")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "clave-segura" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Bebida cola")).toBeInTheDocument();
    expect(window.localStorage.getItem("sim.accessToken")).toBe("tok-123");
    const overviewCall = calls.find((call) => call.path === "GET /products/overview");
    expect((overviewCall?.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText("Acceso al administrador")).toBeInTheDocument();
    expect(window.localStorage.getItem("sim.accessToken")).toBeNull();
  });

  it("muestra la ficha con rango de precios, referencias y permite cambiar el precio", async () => {
    window.location.hash = `#/productos/${PRODUCT_ID}`;
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse({ required: false, authenticated: true, expires_at: null }),
      [`GET /products/${PRODUCT_ID}/detail`]: () => jsonResponse(detail),
      [`PUT /products/${PRODUCT_ID}/price`]: () => jsonResponse({ ...detail.product, sale_price_clp: 2400 }),
    });

    render(<App />);

    expect(await screen.findByRole("heading", { level: 2, name: /Bebida cola/ })).toBeInTheDocument();
    expect(screen.getByText("Rango de precios según márgenes")).toBeInTheDocument();
    expect(screen.getByText(/Precio con margen mínimo \(25 %\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/2\.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\.500/).length).toBeGreaterThan(0);
    expect(screen.getByText("Producto equivalente")).toBeInTheDocument();
    expect(screen.getByText("Precio por verificar")).toBeInTheDocument();
    expect(screen.getByText(/Lider\.cl/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar precio" }));
    const input = screen.getByLabelText("Nuevo precio (CLP)");
    fireEvent.change(input, { target: { value: "2400" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar nuevo precio" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === `PUT /products/${PRODUCT_ID}/price`)).toBe(true);
    });
    const priceCall = calls.find((call) => call.path === `PUT /products/${PRODUCT_ID}/price`);
    expect(JSON.parse(String(priceCall?.init?.body))).toEqual({ sale_price_clp: 2400, note: null });
    expect(await screen.findByText(/Precio de venta actualizado/)).toBeInTheDocument();
  });

  it("crea un producto desde el formulario con los datos mínimos", async () => {
    window.location.hash = "#/productos/nuevo";
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse({ required: false, authenticated: true, expires_at: null }),
      "GET /categories": () => jsonResponse([]),
      "POST /products": () => jsonResponse({ ...detail.product, id: "nuevo" }, 201),
      "GET /products/nuevo/detail": () => jsonResponse(detail),
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText(/Nombre del producto/), { target: { value: "Pan hallulla" } });
    fireEvent.change(screen.getByLabelText(/Precio de venta actual/), { target: { value: "1800" } });
    fireEvent.change(screen.getByLabelText(/Cantidad inicial disponible/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => {
      expect(calls.some((call) => call.path === "POST /products")).toBe(true);
    });
    const body = JSON.parse(String(calls.find((call) => call.path === "POST /products")?.init?.body));
    expect(body).toMatchObject({
      name: "Pan hallulla",
      sale_price_clp: 1800,
      initial_quantity: "12",
      last_unit_cost_clp: null,
      min_margin: null,
    });
    await waitFor(() => expect(window.location.hash).toBe("#/productos/nuevo"));
  });

  it("valida los márgenes de una categoría antes de enviarlos", async () => {
    window.location.hash = "#/categorias";
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse({ required: false, authenticated: true, expires_at: null }),
      "GET /categories": () => jsonResponse([]),
      "POST /categories": () =>
        jsonResponse({ id: "c1", name: "Bebidas", active: true, min_margin: "0.2000", upper_margin: "0.3500" }, 201),
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Bebidas" } });
    fireEvent.change(screen.getByLabelText("Margen mínimo (%)"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Margen superior (%)"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear categoría" }));
    expect(await screen.findByText(/no puede ser menor que el mínimo/)).toBeInTheDocument();
    expect(calls.some((call) => call.path === "POST /categories")).toBe(false);

    fireEvent.change(screen.getByLabelText("Margen mínimo (%)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear categoría" }));
    await waitFor(() => expect(calls.some((call) => call.path === "POST /categories")).toBe(true));
    const body = JSON.parse(String(calls.find((call) => call.path === "POST /categories")?.init?.body));
    expect(body).toEqual({ name: "Bebidas", min_margin: "0.2000", upper_margin: "0.3500" });
  });
});
