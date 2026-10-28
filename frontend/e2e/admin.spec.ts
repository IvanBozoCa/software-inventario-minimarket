import { expect, test } from "@playwright/test";

// Flujo principal del administrador: configurar márgenes, crear un producto con
// su costo, asociar una referencia de mercado y decidir el precio.
test("el administrador crea un producto, revisa el rango de precios y cambia el precio", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const categoryName = `Bebidas ${stamp}`;
  const productName = `Bebida cola ${stamp}`;

  await page.goto("/#/categorias");
  await page.getByLabel("Nombre").fill(categoryName);
  await page.getByLabel("Margen mínimo (%)").fill("25");
  await page.getByLabel("Margen superior (%)").fill("40");
  await page.getByRole("button", { name: "Crear categoría" }).click();
  await expect(page.getByRole("row", { name: new RegExp(categoryName) })).toContainText("25 %");

  await page.goto("/#/productos/nuevo");
  await page.getByLabel(/Nombre del producto/).fill(productName);
  await page.getByLabel("Categoría").selectOption({ label: categoryName });
  await page.getByLabel(/^Marca/).fill("Coca-Cola");
  await page.getByLabel("Cantidad del contenido").fill("1,5");
  await page.getByLabel("Unidad del contenido").selectOption("L");
  await page.getByLabel(/Cantidad inicial/).fill("24");
  await page.getByLabel(/Precio de venta actual/).fill("2200");
  await page.getByLabel(/Último costo unitario/).fill("1500");
  await page.getByRole("button", { name: "Crear producto" }).click();

  await expect(page.getByRole("heading", { level: 2, name: new RegExp(productName) })).toBeVisible();
  // 1500 / (1 - 0,25) = 2000 ; 1500 / (1 - 0,40) = 2500
  await expect(page.getByText("Rango de precios según márgenes")).toBeVisible();
  await expect(page.getByRole("row", { name: /Precio con margen mínimo/ })).toContainText("$2.000");
  await expect(page.getByRole("row", { name: /Precio con margen superior/ })).toContainText("$2.500");
  await expect(page.getByText("Pendiente de referencias")).toBeVisible();

  // Registrar una referencia local manualmente desde la pantalla de mercado.
  await page.goto("/#/mercado");
  await page.getByRole("button", { name: "Nueva fuente" }).click();
  await page.getByPlaceholder("Ej.: Almacén Don Pedro").fill(`Almacén ${stamp}`);
  await page.getByRole("button", { name: "Guardar fuente" }).click();
  await page.getByRole("button", { name: "Registrar precio observado" }).first().click();
  await page.getByLabel("Negocio o fuente").selectOption({ label: `Almacén ${stamp} · Pichilemu` });
  await page.getByLabel(/Producto propio relacionado/).selectOption({ label: `${productName} · Coca-Cola` });
  await page.getByLabel("Precio observado (CLP)").fill("2400");
  await page.getByRole("button", { name: "Guardar referencia" }).click();
  await expect(page.getByText(`Almacén ${stamp} · Pichilemu`).first()).toBeVisible();

  // Volver a la ficha: la referencia aparece como mismo producto y vigente.
  await page.goto("/#/");
  await page.getByLabel("Buscar producto").fill(productName);
  await page.getByRole("link", { name: productName }).click();
  await expect(page.getByText("Mismo producto", { exact: true })).toBeVisible();
  await expect(page.getByText(/el valor más bajo es/)).toContainText("$2.400");

  // Cambiar el precio es una acción explícita que queda en el historial.
  await page.getByRole("button", { name: "Cambiar precio" }).click();
  await page.getByLabel("Nuevo precio (CLP)").fill("2300");
  await page.getByRole("button", { name: "Confirmar nuevo precio" }).click();
  await expect(page.getByText(/Precio de venta actualizado/)).toBeVisible();
  const priceHistory = page.locator("section.card", { hasText: "Historial de precios de venta" });
  await expect(priceHistory.getByRole("row")).toHaveCount(3);

  // Un alza de costo sin revisar el precio genera una advertencia.
  await page.getByRole("button", { name: "Actualizar costo" }).click();
  await page.getByLabel(/Costo unitario de compra/).fill("1900");
  await page.getByRole("button", { name: "Guardar costo" }).click();
  await expect(page.getByText(/El costo subió de \$1\.500 a \$1\.900/)).toBeVisible();
  await expect(page.getByText(/está bajo el margen mínimo/)).toBeVisible();

  await page.goto("/#/");
  await page.getByLabel("Buscar producto").fill(productName);
  await expect(page.getByRole("row", { name: new RegExp(productName) })).toContainText("Revisar precio");
});
