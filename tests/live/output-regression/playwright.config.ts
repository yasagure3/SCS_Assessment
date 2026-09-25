import { defineConfig } from "@playwright/test";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: ".",
  testMatch: "output.spec.ts",
  outputDir: process.env.SCS_OUTPUT_PROBE_ARTIFACTS,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 45000,
  use: { trace: "off", video: "off", screenshot: "off" },
});
