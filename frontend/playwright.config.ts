import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",

  use: {
    baseURL: "http://127.0.0.1:5173",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      name: "Backend",
      command: ".\\.venv\\Scripts\\python.exe scripts\\run_e2e_server.py",
      cwd: "../backend",
      url: "http://127.0.0.1:8010/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      name: "Frontend",
      command: "npx vite --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
