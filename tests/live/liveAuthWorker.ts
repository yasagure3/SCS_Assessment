import { chromium, devices, request } from "@playwright/test";
import { liveOrigin, readCloudInput } from "../../scripts/cloud-config.mjs";
import { liveAuthFlow } from "./liveAuthFlow";
import { requireSensitiveProcess } from "./sensitiveProcess.mjs";

export async function run() {
  requireSensitiveProcess();
  const config = readCloudInput(process.env.SCS_CLOUD_INPUT ?? "", process.cwd());
  const baseURL = liveOrigin(config, process.env.SCS_LIVE_BASE_URL ?? "");
  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || undefined });
  try {
    // Fresh, nonpersistent memory context: no trace/video/automatic screenshots.
    const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL });
    const api = await request.newContext({ baseURL });
    try {
      const page = await context.newPage();
      // Preserve the runner's original action/navigation timeout (the overall
      // process deadline still bounds the complete flow at 30 minutes).
      page.setDefaultTimeout(0);
      page.setDefaultNavigationTimeout(0);
      await liveAuthFlow(page, api, context);
    } finally {
      await api.dispose();
    }
  } finally {
    await browser.close();
  }
}
