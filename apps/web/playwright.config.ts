import { defineConfig, devices } from "@playwright/test";

const PORT = 5190;

/** Smoke tests run the app on mock data, so they need no API and no keys. */
export default defineConfig({
  testDir: "e2e",
  testMatch: "smoke.e2e.ts",
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } }],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    env: { VITE_USE_MOCKS: "1" },
  },
});
