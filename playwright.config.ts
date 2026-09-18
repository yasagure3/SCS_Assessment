import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5180);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("E2E_PORT must be an integer between 1024 and 65535");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: `vp dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
