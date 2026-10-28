import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function addFreeAmount(page: Page, description: string, amount: string) {
  await page.getByRole("button", { name: "AGREGAR MONTO" }).click();
  await page.getByLabel("Qué estás vendiendo").fill(description);
  await page.getByLabel("Monto").fill(amount);
  await page
    .locator(".action-card")
    .getByRole("button", { name: "AGREGAR MONTO", exact: true })
    .click();
}

test("frontend y backend recuperan, descartan y protegen ventas interrumpidas", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Venta" })).toBeVisible();
  await expect(page.getByText("Sistema listo")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Venta en curso" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "EFECTIVO" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "TARJETA" })).toBeDisabled();

  // DRAFT: reiniciar, continuar y completar en efectivo.
  await addFreeAmount(page, "Producto prueba E2E", "1000");
  await expect(page.getByRole("button", { name: "EFECTIVO" })).toBeEnabled();

  await page.reload();

  await expect(page.getByText("VENTA SIN TERMINAR", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "CONTINUAR VENTA" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DESCARTAR VENTA" })).toBeVisible();
  await page.getByRole("button", { name: "CONTINUAR VENTA" }).click();

  await page.getByRole("button", { name: "EFECTIVO" }).click();
  await expect(page.getByText("¿Cuánto recibiste?")).toBeVisible();
  await page.getByRole("button", { name: "COBRAR EN EFECTIVO" }).click();

  await expect(page.getByText("VENTA TERMINADA", { exact: true })).toBeVisible();
  await expect(page.getByText("VUELTO", { exact: true })).toBeVisible();

  // DRAFT: reiniciar y descartar. Debe abrir una venta nueva vacía.
  await page.getByRole("button", { name: "NUEVA VENTA" }).click();
  await addFreeAmount(page, "Venta para descartar", "700");
  await page.reload();

  await expect(page.getByText("VENTA SIN TERMINAR", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "DESCARTAR VENTA" }).click();

  await expect(page.getByText("Venta descartada. Nueva venta lista.")).toBeVisible();
  await expect(page.getByText("Aún no hay productos")).toBeVisible();
  await expect(page.getByRole("button", { name: "EFECTIVO" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "TARJETA" })).toBeDisabled();

  // PAYMENT_PENDING: reiniciar no puede aprobar la tarjeta automáticamente.
  await addFreeAmount(page, "Venta tarjeta pendiente", "1200");
  await page.getByRole("button", { name: "TARJETA" }).click();
  await expect(page.getByRole("button", { name: "PAGO APROBADO" })).toBeVisible();

  await page.reload();

  await expect(page.getByText("VENTA SIN TERMINAR", { exact: true })).toBeVisible();
  await expect(page.getByText("Cobro con tarjeta pendiente", { exact: true })).toBeVisible();
  await expect(page.getByText("VENTA TERMINADA", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "CONTINUAR VENTA" }).click();
  await expect(page.getByRole("button", { name: "PAGO APROBADO" })).toBeVisible();
  await expect(page.getByText("VENTA TERMINADA", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "PAGO APROBADO" }).click();
  await expect(page.getByText("VENTA TERMINADA", { exact: true })).toBeVisible();
  await expect(page.getByText("PAGO APROBADO", { exact: true })).toBeVisible();
});
