import { expect, test } from "@playwright/test";

test("frontend y backend funcionan juntos", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Software Inventario Minimarket",
    }),
  ).toBeVisible();

  await expect(
    page.getByText("Sistema local iniciado correctamente."),
  ).toBeVisible();

  await expect(page.getByText("Backend: ok")).toBeVisible();
});
