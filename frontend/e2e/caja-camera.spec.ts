import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8010";

// Cámara siempre encendida, como pistola: con un video falso que muestra un
// código existente (ver scanner-camera.spec.ts para generarlo).
const fakeCamera = process.env.SIM_FAKE_CAMERA_Y4M;

test.skip(!fakeCamera, "Define SIM_FAKE_CAMERA_Y4M para probar la cámara");
test.use({
  permissions: ["camera"],
  launchOptions: {
    args: fakeCamera
      ? [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          `--use-file-for-fake-video-capture=${fakeCamera}`,
        ]
      : [],
  },
});

test("agrega el producto una sola vez mientras sigue frente a la cámara", async ({ page, request }) => {
  const code = "7802920000015";
  const found = await request.get(`${API}/products/by-barcode?code=${code}`);
  if (found.status() === 404) {
    await request.post(`${API}/products`, { data: { name: "Leche escaneada", barcode: code, sale_price_clp: 1290 } });
  }

  await page.goto("/#/caja");
  const quantity = page.getByLabel(/^Cantidad de Leche escaneada/);
  await expect(quantity).toHaveText("1", { timeout: 15000 });
  // El mismo código sigue a la vista: no se suma otra unidad.
  await page.waitForTimeout(3000);
  await expect(quantity).toHaveText("1");
});
