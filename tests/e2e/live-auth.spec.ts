import { test } from "@playwright/test";
import { runSensitiveProcess } from "../live/sensitiveProcess.mjs";

test("real invitation enrollment, required TOTP, revocation, suspension and lost-device recovery", async () => {
  // The child keeps the original 30 minute ceiling. Runner teardown gets a margin;
  // no page, request or secret-bearing assertion belongs to this runner process.
  test.setTimeout(1810000);
  await runSensitiveProcess(new URL("../live/liveAuthWorker.ts", import.meta.url));
});
