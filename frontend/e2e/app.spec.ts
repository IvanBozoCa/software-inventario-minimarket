import { expect, test } from "@playwright/test";

test("frontend y backend completan una venta en efectivo", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Venta" })).toBeVisible();
  await expect(page.getByText("Sistema listo")).toBeVisible();
  await expect(page.getByText("Venta en curso")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "AGREGAR", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "EFECTIVO" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "TARJETA" })).toBeDisabled();

  await page.getByRole("button", { name: "AGREGAR MONTO" }).click();
  await page.getByLabel("Qué estás vendiendo").fill("Producto prueba E2E");
  await page.getByLabel("Monto").fill("1000");
  await page
    .locator(".action-card")
    .getByRole("button", { name: "AGREGAR MONTO", exact: true })
    .click();

  await expect(page.getByRole("button", { name: "EFECTIVO" })).toBeEnabled();
  await page.getByRole("button", { name: "EFECTIVO" }).click();

  await expect(page.getByText("¿Cuánto recibiste?")).toBeVisible();
  await expect(page.getByRole("button", { name: "COBRAR EN EFECTIVO" })).toBeEnabled();
  await page.getByRole("button", { name: "COBRAR EN EFECTIVO" }).click();

  await expect(page.getByText("VENTA TERMINADA")).toBeVisible();
  await expect(page.getByText("VUELTO")).toBeVisible();
  await expect(page.getByRole("button", { name: "NUEVA VENTA" })).toBeVisible();
});
