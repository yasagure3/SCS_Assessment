import { test } from "@playwright/test";
import { runSensitiveProcess } from "../sensitiveProcess.mjs";

for (const kind of [
  "connection-refused",
  "invalid-http",
  "request-timeout",
  "http-error",
  "assertion",
  "auth-page",
  "performance",
  "deadline",
  "uncaught",
  "rejection",
  "success",
]) {
  test(kind, async () => {
    await runSensitiveProcess(
      new URL("./probe.ts", import.meta.url),
      kind === "deadline" ? 5000 : 35000,
      {
        cwd: process.env.SCS_OUTPUT_PROBE_WORKSPACE,
        env: {
          SCS_OUTPUT_PROBE_CASE: kind,
          DEBUG: "pw:api",
          NODE_DEBUG: "http",
          PWDEBUG: "console",
        },
      },
    );
  });
}
