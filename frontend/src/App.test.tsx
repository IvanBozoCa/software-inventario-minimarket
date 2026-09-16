// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const emptyDraft = {
  id: "11111111-1111-1111-1111-111111111111",
  status: "DRAFT",
  subtotal_clp: 0,
  total_clp: 0,
  items: [],
};

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("inicia una venta borrador y muestra las acciones principales de caja", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return {
          ok: true,
          json: async () => ({ status: "ok" }),
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
    expect(screen.getByRole("button", { name: /^AGREGAR$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "BUSCAR PRODUCTO" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "AGREGAR MONTO" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "EFECTIVO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "TARJETA" })).toBeDisabled();
    expect(screen.getByText("Agrega productos para cobrar.")).toBeInTheDocument();
    expect(screen.getByText("Aún no hay productos")).toBeInTheDocument();
    expect(localStorage.getItem("minimarket.activeSaleId")).toBe(emptyDraft.id);
  });
});
