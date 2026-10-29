import { expect, test } from "@playwright/test";

// Cámara en vivo con un video falso (.y4m) que muestra un código existente,
// por ejemplo generado con ffmpeg desde e2e/fixtures/ean13-existente.jpg:
//   ffmpeg -loop 1 -i e2e/fixtures/ean13-existente.jpg -t 2 -r 10 \
//     -vf scale=1280:960,format=yuv420p camara.y4m
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

test.beforeAll(async ({ request }) => {
  const code = "7802920000015";
  const found = await request.get(`http://127.0.0.1:8010/products/by-barcode?code=${code}`);
  if (found.status() === 404) {
    await request.post("http://127.0.0.1:8010/products", {
      data: { name: "Leche escaneada", barcode: code, sale_price_clp: 1290 },
    });
  }
});

test("la cámara lee el código sin sacar foto", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: "Escanear código" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Leche escaneada/ })).toBeVisible({
    timeout: 15000,
  });
});
