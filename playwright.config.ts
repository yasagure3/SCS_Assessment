import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5180);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("E2E_PORT must be an integer between 1024 and 65535");
}
const baseURL = `http://127.0.0.1:${port}`;
const fixturePort = port === 65535 ? port - 1 : port + 1;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      testMatch: "**/smoke.spec.ts",
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL || undefined },
    },
    {
      name: "chromium-flows",
      testIgnore: "**/smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_CHANNEL || undefined,
        baseURL: `http://127.0.0.1:${fixturePort}`,
      },
    },
  ],
  webServer: [
    {
      command: `vp dev --host 127.0.0.1 --port ${port} --strictPort`,
      url: `${baseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `vp exec node tests/fixtures/start.mjs ${fixturePort}`,
      url: `http://127.0.0.1:${fixturePort}/api/health`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
