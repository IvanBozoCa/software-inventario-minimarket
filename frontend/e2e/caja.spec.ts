import { devices, expect, test } from "@playwright/test";

// Caja en el celular: armar el carro, cobrar y ver la venta en Ventas, con el
// stock descontado. Pantalla de celular y sin cámara (se agrega por nombre).
const API = "http://127.0.0.1:8010";

test.use({ viewport: devices["Pixel 7"].viewport, hasTouch: true, isMobile: true });

test("se cobra una venta en efectivo, aparece en Ventas y descuenta el stock", async ({ page, request }) => {
  const stamp = Date.now().toString().slice(-6);
  const name = `Galletas caja ${stamp}`;
  const created = await request.post(`${API}/products`, {
    data: { name, sale_price_clp: 990, initial_quantity: "10" },
  });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();

  await page.addInitScript(() => window.localStorage.setItem("sim-pos-camera", "false"));
  await page.goto("/#/caja");
  await expect(page.getByRole("heading", { level: 2, name: "Caja" })).toBeVisible();

  const search = page.getByLabel("Buscar producto");
  await search.fill(`galletas caja ${stamp}`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: `Una más de ${name}` }).click();
  await page.getByRole("button", { name: `Una más de ${name}` }).click();
  await expect(page.locator(".pos-total")).toHaveText("$2.970");

  await page.getByRole("button", { name: "Cobrar" }).click();
  await page.getByRole("button", { name: "$5.000" }).click();
  await expect(page.getByText("Vuelto: $2.030")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.getByText("Venta registrada · $2.970")).toBeVisible();

  const catalog: { id: string; quantity: string }[] = await (await request.get(`${API}/pos/catalog`)).json();
  expect(Number(catalog.find((item) => item.id === product.id)?.quantity)).toBe(7);

  await page.getByRole("link", { name: "Ventas" }).click();
  const sale = page.getByRole("list", { name: "Ventas del día" }).getByRole("button", { name: /\$2\.970/ }).first();
  await expect(sale).toBeVisible();
  await sale.click();
  await expect(page.getByText(`3 × ${name}`)).toBeVisible();
});
