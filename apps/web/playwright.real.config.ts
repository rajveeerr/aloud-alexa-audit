import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 5182;
const API = process.env.REAL_API_URL ?? "http://localhost:4100";

/**
 * End to end against the real stack: the API with its worker (replaying recorded model calls) on
 * MySQL and Redis from docker compose, and the web app in real mode. The dev server proxies /v1
 * to the API, so the browser sees one origin. Run `bun run db:up` first. An API already listening
 * on 4100 is reused; otherwise one is started with a raised widget limit so reruns aren't blocked.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "real.e2e.ts",
  // One audit pipeline and one API key's rate limit, so run in order.
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } }],
  webServer: [
    {
      command: "bun run dev",
      cwd: "../..",
      url: `${API}/v1/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { API_KEY_DEV: "dev-key", PUBLIC_RATE_LIMIT: "1000" },
    },
    {
      command: `bunx vite --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { API_PROXY: API, VITE_API_URL: `http://localhost:${WEB_PORT}`, VITE_API_KEY: "dev-key", VITE_USE_MOCKS: "" },
    },
  ],
});
