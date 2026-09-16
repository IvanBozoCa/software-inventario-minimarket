// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const emptyDraft = {
  id: "11111111-1111-1111-1111-111111111111",
  status: "DRAFT",
  subtotal_clp: 0,
  total_clp: 0,
  items: [],
};

const interruptedSale = {
  id: "22222222-2222-2222-2222-222222222222",
  status: "DRAFT",
  subtotal_clp: 2500,
  total_clp: 2500,
  items: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      product_id: null,
      item_type: "FREE_AMOUNT",
      description_snapshot: "Venta pendiente",
      quantity: "1.000",
      unit_price_clp: 2500,
      line_total_clp: 2500,
    },
  ],
};

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("inicia una venta borrador cuando no hay ventas pendientes", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ status: "ok" }),
        };
      }

      if (url.endsWith("/sales/recovery")) {
        return {
          ok: true,
          json: async () => ({
            state: "NONE",
            sale: null,
            pending_payment_id: null,
            open_sale_count: 0,
            message: "No hay ventas pendientes de recuperación",
          }),
        };
      }

      if (url.endsWith("/sales/draft") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => emptyDraft,
        };
      }

      throw new Error(`Solicitud inesperada: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Venta" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Sistema listo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ADMINISTRACIÓN" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^AGREGAR$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "BUSCAR PRODUCTO" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "AGREGAR MONTO" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "EFECTIVO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "TARJETA" })).toBeDisabled();
    expect(screen.getByText("Agrega productos para cobrar.")).toBeInTheDocument();
    expect(screen.getByText("Aún no hay productos")).toBeInTheDocument();
    expect(localStorage.getItem("minimarket.activeSaleId")).toBe(emptyDraft.id);
  });

  it("pide continuar o descartar cuando encuentra una venta interrumpida", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ status: "ok" }),
        };
      }

      if (url.endsWith("/sales/recovery")) {
        return {
          ok: true,
          json: async () => ({
            state: "FOUND",
            sale: interruptedSale,
            pending_payment_id: null,
            open_sale_count: 1,
            message: "Hay una venta pendiente. Puedes continuarla o descartarla.",
          }),
        };
      }

      throw new Error(`Solicitud inesperada: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("VENTA SIN TERMINAR")).toBeInTheDocument();
    expect(screen.getByText("$2.500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CONTINUAR VENTA" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "DESCARTAR VENTA" })).toBeEnabled();
    expect(localStorage.getItem("minimarket.activeSaleId")).toBeNull();
  });

  it("desbloquea administración usando sólo el teclado numérico táctil", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return { ok: true, json: async () => ({ status: "ok" }) };
      }

      if (url.endsWith("/sales/recovery")) {
        return {
          ok: true,
          json: async () => ({
            state: "NONE",
            sale: null,
            pending_payment_id: null,
            open_sale_count: 0,
            message: "No hay ventas pendientes de recuperación",
          }),
        };
      }

      if (url.endsWith("/sales/draft") && init?.method === "POST") {
        return { ok: true, json: async () => emptyDraft };
      }

      if (url.endsWith("/admin/security/status")) {
        return {
          ok: true,
          json: async () => ({ configured: true, session_minutes: 15 }),
        };
      }

      if (url.endsWith("/admin/security/unlock") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            token: "token-prueba",
            expires_at: "2026-09-16T03:30:00Z",
            session_minutes: 15,
          }),
        };
      }

      throw new Error(`Solicitud inesperada: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    const adminButton = await screen.findByRole("button", { name: "ADMINISTRACIÓN" });
    fireEvent.click(adminButton);

    expect(
      await screen.findByRole("heading", { name: "Ingresa el PIN de administrador" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Número 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Número 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Número 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Número 4" }));
    fireEvent.click(screen.getByRole("button", { name: "ENTRAR" }));

    expect(await screen.findByText("Acceso autorizado")).toBeInTheDocument();
    expect(sessionStorage.getItem("minimarket.adminToken")).toBe("token-prueba");
  });
});
