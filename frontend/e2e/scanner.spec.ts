import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Lectura del código del producto desde una foto (Chromium de escritorio no
// trae BarcodeDetector, así que esto prueba el camino de ZXing que usa el
// iPhone). Las fotos de e2e/fixtures simulan una foto: fondo, giro y desenfoque.
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const API = "http://127.0.0.1:8010";

const EXISTING_CODE = "7802920000015"; // ean13-existente.jpg
const NEW_CODE = "7801234567894"; // ean13-nuevo.jpg
const QR_TEXT = "SIM-QR-0001"; // qr.jpg

test.beforeAll(async ({ request }) => {
  const found = await request.get(`${API}/products/by-barcode?code=${EXISTING_CODE}`);
  if (found.status() === 404) {
    const created = await request.post(`${API}/products`, {
      data: { name: "Leche escaneada", barcode: EXISTING_CODE, sale_price_clp: 1290 },
    });
    expect(created.ok()).toBeTruthy();
  }
});

async function scanPhoto(page: import("@playwright/test").Page, file: string) {
  await page.getByLabel("Foto del código").setInputFiles(path.join(FIXTURES, file));
}

test("una foto de un código existente abre la ficha del producto", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: "Escanear código" }).click();
  await expect(page.getByRole("dialog", { name: "Escanear producto" })).toBeVisible();
  await scanPhoto(page, "ean13-existente.jpg");
  await expect(page.getByRole("heading", { level: 2, name: /Leche escaneada/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("una foto de un código nuevo abre el formulario con el código completado", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: "Escanear código" }).click();
  await scanPhoto(page, "ean13-nuevo.jpg");
  await expect(page.getByRole("heading", { level: 2, name: "Nuevo producto" })).toBeVisible();
  await expect(page.getByLabel("Código de barras")).toHaveValue(NEW_CODE);
});

test("en el formulario se puede leer un QR y se avisa si el código ya existe", async ({ page }) => {
  await page.goto("/#/productos/nuevo");
  await page.getByRole("button", { name: "Escanear", exact: true }).click();
  await scanPhoto(page, "qr.jpg");
  await expect(page.getByLabel("Código de barras")).toHaveValue(QR_TEXT);

  await page.getByRole("button", { name: "Escanear", exact: true }).click();
  await scanPhoto(page, "ean13-existente.jpg");
  await expect(page.getByLabel("Código de barras")).toHaveValue(EXISTING_CODE);
  await expect(page.getByText(/Ese código ya pertenece a/)).toContainText("Leche escaneada");
});

test("una foto sin código muestra cómo repetirla", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: "Escanear código" }).click();
  await scanPhoto(page, "sin-codigo.jpg");
  await expect(page.getByRole("alert")).toContainText("No se encontró un código en la foto");
  await page.getByRole("button", { name: "Cerrar escáner" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
