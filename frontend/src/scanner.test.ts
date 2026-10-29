import { describe, expect, it } from "vitest";

import { parseRoute } from "./router";
import { cleanCode, codeVariants } from "./scanner";

describe("lectura de códigos", () => {
  it("limpia espacios y saltos de línea del texto leído", () => {
    expect(cleanCode("  7802920000015\n")).toBe("7802920000015");
  });

  it("prueba la forma UPC-A y EAN-13 del mismo código", () => {
    expect(codeVariants("012345678905")).toEqual(["012345678905", "0012345678905"]);
    expect(codeVariants("0012345678905")).toEqual(["0012345678905", "012345678905"]);
    expect(codeVariants("7802920000015")).toEqual(["7802920000015"]);
    expect(codeVariants("SIM-QR-0001")).toEqual(["SIM-QR-0001"]);
  });

  it("el formulario de nuevo producto recibe el código escaneado", () => {
    expect(parseRoute("#/productos/nuevo?codigo=7801234567894")).toEqual({
      page: "product-new",
      barcode: "7801234567894",
    });
    expect(parseRoute("#/productos/nuevo")).toEqual({ page: "product-new" });
  });
});
