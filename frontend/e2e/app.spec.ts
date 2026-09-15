import { expect, test } from "@playwright/test";

test("frontend y backend funcionan juntos en modo caja", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Venta" })).toBeVisible();
  await expect(page.getByText("Sistema listo")).toBeVisible();
  await expect(page.getByText("Venta en curso")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "AGREGAR", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "BUSCAR PRODUCTO" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AGREGAR MONTO" })).toBeVisible();
});
