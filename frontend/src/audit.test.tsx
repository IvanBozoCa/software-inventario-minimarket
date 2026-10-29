// @vitest-environment jsdom
// Regresiones de la auditoría de experiencia de uso (29-10-2026).

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { describeValidationError } from "./api";
import { parseLocaleNumber, percentInputToRatio, priceWarning, readNumberField, toNumberInput } from "./format";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const OPEN = { required: false, authenticated: true, expires_at: null };

function product(id: string, name: string) {
  return {
    id,
    name,
    barcode: null,
    category_id: null,
    sale_price_clp: 2200,
    track_stock: true,
    active: true,
    brand: "Coca-Cola",
    variant: null,
    content_amount: "1.500",
    content_unit: "L",
    stock_unit: "UNIT",
    last_unit_cost_clp: "1450.00",
    extra_supply_cost_clp: "80.00",
    min_margin: null,
    upper_margin: null,
  };
}

function detailFor(id: string, name: string) {
  return {
    product: product(id, name),
    category_name: null,
    quantity: "24.000",
    pricing: {
      sale_price_clp: 2200,
      unit_cost_clp: "1450.00",
      extra_supply_cost_clp: "80.00",
      total_unit_cost_clp: "1530.00",
      min_margin: null,
      min_margin_source: null,
      upper_margin: null,
      upper_margin_source: null,
      price_at_min_margin: null,
      price_at_upper_margin: null,
      current_gross_margin: "0.3045",
      current_markup: "0.4379",
      range_available: false,
      needs_review: false,
      warnings: [],
    },
    cost_history: [],
    price_history: [],
    stock_movements: [],
    market: {
      stale_days: 30,
      has_references: false,
      has_stale: false,
      exact_regular_low: null,
      exact_regular_high: null,
      references: [],
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

type Handler = (init?: RequestInit) => Promise<Response>;

function mockApi(handlers: Record<string, Handler>) {
  const calls: { path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      calls.push({ path: key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const handler = handlers[key];
      return handler ? handler(init) : jsonResponse({ detail: `Sin respuesta simulada para ${key}` }, 500);
    }),
  );
  return calls;
}

const bodyOf = (calls: { path: string; body?: unknown }[], path: string) =>
  calls.filter((call) => call.path === path).at(-1)?.body as Record<string, unknown> | undefined;

describe("lectura de números (H-01, H-02, H-03, H-05, H-07)", () => {
  it("distingue el punto de miles del punto decimal", () => {
    expect(parseLocaleNumber("1.990")).toBe("1990");
    expect(parseLocaleNumber("1.234.567")).toBe("1234567");
    expect(parseLocaleNumber("1990.5")).toBe("1990.5");
    expect(parseLocaleNumber("1.5")).toBe("1.5");
    expect(parseLocaleNumber("2450.50")).toBe("2450.50");
    expect(parseLocaleNumber("1450.00")).toBe("1450.00");
    expect(parseLocaleNumber("1,5")).toBe("1.5");
    expect(parseLocaleNumber("2.450,50")).toBe("2450.50");
  });

  it("acepta $, % y espacios, y no inventa valores", () => {
    expect(parseLocaleNumber("$1.990")).toBe("1990");
    expect(parseLocaleNumber(" $ 1.100 ")).toBe("1100");
    expect(parseLocaleNumber("25%")).toBe("25");
    expect(parseLocaleNumber("")).toBeNull();
    expect(parseLocaleNumber("doce")).toBeUndefined();
    expect(parseLocaleNumber("1,5,5")).toBeUndefined();
    expect(parseLocaleNumber("1.99.0")).toBeUndefined();
  });

  it("un valor de la API vuelve a leerse igual (ida y vuelta)", () => {
    for (const value of ["1450.00", "80.00", "1.500", "0.750", "24.000", "1234567.00"]) {
      expect(Number(parseLocaleNumber(toNumberInput(value)))).toBe(Number(value));
    }
    expect(percentInputToRatio("25 %")).toBe("0.2500");
  });

  it("explica qué escribir en vez de descartar el dato", () => {
    expect(() => readNumberField("doce", "la cantidad", { example: "24" })).toThrow(/No se entiende la cantidad «doce»/);
    expect(() => readNumberField("1990.5", "el precio", { integer: true, example: "1.990" })).toThrow(/sin decimales/);
    expect(() => readNumberField("-3", "la cantidad", { example: "24" })).toThrow(/no puede ser negativo/);
    expect(readNumberField("", "el costo", { example: "1.100" })).toBeNull();
  });

  it("pide confirmar precios inusuales (H-06)", () => {
    expect(priceWarning(0, 2200)).toMatch(/\$0/);
    expect(priceWarning(23905, 2390)).toMatch(/cambia de/);
    expect(priceWarning(1000, 2200, 1530)).toMatch(/bajo el costo/);
    expect(priceWarning(2400, 2200, 1530)).toBeNull();
  });
});

describe("errores de la API en español (H-08)", () => {
  it("traduce los mensajes técnicos por campo", () => {
    expect(
      describeValidationError({ loc: ["body", "min_margin"], type: "less_than", msg: "Input should be less than 1", ctx: { lt: 1 } }),
    ).toBe("El margen mínimo debe ser menor que 100 %.");
    expect(
      describeValidationError({ loc: ["body", "name"], type: "string_too_long", msg: "String should have at most 200 characters", ctx: { max_length: 200 } }),
    ).toBe("El nombre puede tener como máximo 200 caracteres.");
    expect(
      describeValidationError({ loc: ["body", "market_stale_days"], type: "less_than_equal", ctx: { le: 3650 } }),
    ).toBe("El plazo debe ser como máximo 3.650.");
    expect(
      describeValidationError({ loc: ["body"], type: "value_error", msg: "Value error, El margen superior no puede ser menor" }),
    ).toBe("El margen superior no puede ser menor");
  });
});

describe("pantallas", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("guardar el costo sin cambios no lo multiplica por 100 (H-01)", async () => {
    window.location.hash = `#/productos/${A}`;
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(OPEN),
      [`GET /products/${A}/detail`]: () => jsonResponse(detailFor(A, "Bebida cola")),
      [`PUT /products/${A}/cost`]: () => jsonResponse(product(A, "Bebida cola")),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Actualizar costo" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar costo" }));
    await waitFor(() => expect(bodyOf(calls, `PUT /products/${A}/cost`)).toBeDefined());
    const body = bodyOf(calls, `PUT /products/${A}/cost`)!;
    expect(Number(body.last_unit_cost_clp)).toBe(1450);
    expect(Number(body.extra_supply_cost_clp)).toBe(80);
  });

  it("editar la ficha sin tocar el contenido conserva 1,5 L (H-02)", async () => {
    window.location.hash = `#/productos/${A}/editar`;
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(OPEN),
      "GET /categories": () => jsonResponse([]),
      [`GET /products/${A}`]: () => jsonResponse(product(A, "Bebida cola")),
      [`PATCH /products/${A}`]: () => jsonResponse(product(A, "Bebida cola")),
      [`GET /products/${A}/detail`]: () => jsonResponse(detailFor(A, "Bebida cola")),
    });
    render(<App />);
    expect(await screen.findByLabelText("Cantidad del contenido")).toHaveValue("1,5");
    fireEvent.change(screen.getByLabelText(/Marca/), { target: { value: "Coca-Cola Chile" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(bodyOf(calls, `PATCH /products/${A}`)).toBeDefined());
    expect(Number(bodyOf(calls, `PATCH /products/${A}`)!.content_amount)).toBe(1.5);
    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
  });

  it("al cambiar de producto no muestra el anterior y una dirección inexistente no permite desactivar (H-04)", async () => {
    window.location.hash = `#/productos/${A}`;
    let resolveB: (value: Response) => void = () => {};
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(OPEN),
      [`GET /products/${A}/detail`]: () => jsonResponse(detailFor(A, "Producto A")),
      [`GET /products/${B}/detail`]: () => new Promise<Response>((resolve) => (resolveB = resolve)),
      "GET /products/00000000-0000-0000-0000-000000000000/detail": () =>
        jsonResponse({ detail: "Producto no encontrado" }, 404),
    });
    render(<App />);
    expect(await screen.findByRole("heading", { level: 2, name: /Producto A/ })).toBeInTheDocument();

    await act(async () => {
      window.location.hash = `#/productos/${B}`;
    });
    expect(await screen.findByText("Cargando producto…")).toBeInTheDocument();
    expect(screen.queryByText("Producto A")).not.toBeInTheDocument();
    await act(async () => resolveB(await jsonResponse(detailFor(B, "Producto B"))));
    expect(await screen.findByRole("heading", { level: 2, name: /Producto B/ })).toBeInTheDocument();

    await act(async () => {
      window.location.hash = "#/productos/00000000-0000-0000-0000-000000000000";
    });
    expect(await screen.findByRole("heading", { name: "Producto no encontrado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inventario" })).toBeInTheDocument();

    await act(async () => {
      window.location.hash = "#/productos/abc";
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Producto no encontrado" })).toBeInTheDocument());
    expect(calls.some((call) => call.path.startsWith("PATCH"))).toBe(false);
    expect(calls.some((call) => call.path === "GET /products/abc/detail")).toBe(false);
  });

  it("no descarta costo, márgenes ni cantidad que no entiende (H-05)", async () => {
    window.location.hash = "#/productos/nuevo";
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(OPEN),
      "GET /categories": () => jsonResponse([]),
      "GET /products/overview": () => jsonResponse([]),
      "POST /products": () => jsonResponse({ ...product("nuevo", "Arroz") }, 201),
      "GET /products/nuevo/detail": () => jsonResponse(detailFor("nuevo", "Arroz")),
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/Nombre del producto/), { target: { value: "Arroz" } });
    fireEvent.change(screen.getByLabelText(/Precio de venta actual/), { target: { value: "$1.500" } });
    fireEvent.change(screen.getByLabelText(/Último costo unitario/), { target: { value: "$1.100" } });
    fireEvent.change(screen.getByLabelText(/Margen mínimo/), { target: { value: "25%" } });
    fireEvent.change(screen.getByLabelText(/Margen superior/), { target: { value: "40 %" } });
    fireEvent.change(screen.getByLabelText(/Cantidad inicial/), { target: { value: "doce" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear producto" }));

    expect((await screen.findAllByText(/No se entiende la cantidad inicial «doce»/)).length).toBeGreaterThan(0);
    expect(calls.some((call) => call.path === "POST /products")).toBe(false);

    fireEvent.change(screen.getByLabelText(/Cantidad inicial/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(bodyOf(calls, "POST /products")).toBeDefined());
    expect(bodyOf(calls, "POST /products")).toMatchObject({
      sale_price_clp: 1500,
      last_unit_cost_clp: "1100",
      min_margin: "0.2500",
      upper_margin: "0.4000",
      initial_quantity: "12",
    });
  });

  it("pide confirmar un precio de $0 antes de guardarlo (H-06)", async () => {
    window.location.hash = `#/productos/${A}`;
    const calls = mockApi({
      "GET /auth/status": () => jsonResponse(OPEN),
      [`GET /products/${A}/detail`]: () => jsonResponse(detailFor(A, "Bebida cola")),
      [`PUT /products/${A}/price`]: () => jsonResponse(product(A, "Bebida cola")),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar precio" }));
    fireEvent.change(screen.getByLabelText("Nuevo precio (CLP)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar nuevo precio" }));
    expect(await screen.findByText(/El precio queda en \$0/)).toBeInTheDocument();
    expect(calls.some((call) => call.path === `PUT /products/${A}/price`)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Sí, guardar/ }));
    await waitFor(() => expect(bodyOf(calls, `PUT /products/${A}/price`)).toEqual({ sale_price_clp: 0, note: null }));
  });

  it("si el servidor se cae al guardar lo dice en español y la cabecera deja de decir Conectado (H-09)", async () => {
    window.location.hash = `#/productos/${A}`;
    mockApi({
      "GET /auth/status": () => jsonResponse(OPEN),
      [`GET /products/${A}/detail`]: () => jsonResponse(detailFor(A, "Bebida cola")),
      [`PUT /products/${A}/price`]: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar precio" }));
    fireEvent.change(screen.getByLabelText("Nuevo precio (CLP)"), { target: { value: "2.300" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar nuevo precio" }));
    expect(await screen.findByText(/el cambio no se guardó/)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
    expect(screen.getByText("Sin conexión")).toBeInTheDocument();
  });

  it("una búsqueda sin resultados no dice que no hay productos (H-10)", async () => {
    mockApi({
      "GET /auth/status": () => jsonResponse(OPEN),
      "GET /categories": () => jsonResponse([]),
      "GET /products/overview": () => jsonResponse([]),
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Buscar producto"), { target: { value: "zzz" } });
    expect(await screen.findByText("Ningún producto coincide con «zzz».")).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay productos/)).not.toBeInTheDocument();
    expect(window.location.hash).toContain("q=zzz");
  });

  it("si la sesión vence al guardar, avisa que el cambio no se guardó (H-11)", async () => {
    window.location.hash = `#/productos/${A}`;
    mockApi({
      "GET /auth/status": () => jsonResponse({ required: true, authenticated: true, expires_at: null, mode: "password" }),
      [`GET /products/${A}/detail`]: () => jsonResponse(detailFor(A, "Bebida cola")),
      [`PUT /products/${A}/price`]: () => jsonResponse({ detail: "Sesión vencida" }, 401),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar precio" }));
    fireEvent.change(screen.getByLabelText("Nuevo precio (CLP)"), { target: { value: "2.300" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar nuevo precio" }));
    expect(await screen.findByText(/Tu sesión venció y el último cambio no se guardó/)).toBeInTheDocument();
    // El formulario sigue montado (oculto) con el valor escrito.
    expect(screen.getByDisplayValue("2.300")).toBeInTheDocument();
  });

  it("sin servidor al abrir ofrece Reintentar y se recupera (H-12)", async () => {
    let up = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (!up) return Promise.reject(new TypeError("Failed to fetch"));
        if (url.pathname === "/auth/status") return jsonResponse(OPEN);
        return jsonResponse([]);
      }),
    );
    render(<App />);
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    up = true;
    fireEvent.click(retry);
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
  });
});
