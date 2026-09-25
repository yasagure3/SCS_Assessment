import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

// Dummy values are injected only into the isolated process environment, never
// command arguments or test titles. No live config or credential file is read.
const directory = resolve(".local/auth-output-regression", randomUUID());
const workspace = join(directory, "workspace"),
  artifacts = join(directory, "artifacts");
mkdirSync(join(workspace, ".local/live"), { recursive: true });
writeFileSync(
  join(workspace, ".local/live/cloud-results.json"),
  JSON.stringify({
    identifiers: {
      customerId: "anonymous-customer",
      caseId: "anonymous-case",
      assessmentId: "anonymous-assessment",
    },
    scale: { assessments: 500 },
  }),
);
const values = [
  "dummy-access-" + randomUUID(),
  "dummy-password-" + randomUUID(),
  "dummy-TOTP-" + randomUUID(),
];
const env = {
  ...process.env,
  SCS_OUTPUT_PROBE_WORKSPACE: workspace,
  SCS_OUTPUT_PROBE_ARTIFACTS: artifacts,
  SCS_OUTPUT_PROBE_TOKEN: values[0],
  SCS_OUTPUT_PROBE_PASSWORD: values[1],
  SCS_OUTPUT_PROBE_TOTP: values[2],
};
for (const name of Object.keys(env))
  if (
    /^(DEBUG.*|PWDEBUG|NODE_DEBUG.*|NODE_OPTIONS|NODE_V8_COVERAGE|SSLKEYLOGFILE|SCS_(?!OUTPUT_PROBE_))/.test(
      name,
    )
  )
    delete env[name];
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    require.resolve("@playwright/test/cli"),
    "test",
    "--config",
    "tests/live/output-regression/playwright.config.ts",
  ],
  { env, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
);
const files = [];
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(directory);
const clean = (bytes) =>
  values.every((value) => !Buffer.from(bytes ?? "").includes(Buffer.from(value)));
assert.ok(
  clean(result.stdout) && clean(result.stderr) && files.every((path) => clean(readFileSync(path))),
  "Secret reached output.",
);
// Only write logs after checking the captured buffers; no raw diagnostic file
// is ever used as an intermediate. Dummy failure artifacts are checked as well.
writeFileSync(join(directory, "runner.log"), result.stdout + result.stderr);
assert.equal(result.error, undefined);
assert.equal(result.status, 1, "Deliberate failures must retain exit 1.");
assert.match(result.stdout, /10 failed/);
assert.match(result.stdout, /1 passed/);
assert.ok(
  !files.some((path) => /\.(png|webm|zip|har)$/.test(path)),
  "Unexpected capture artifact.",
);
const contexts = files.filter((path) => path.endsWith("error-context.md"));
assert.equal(contexts.length, 10);
for (const kind of [
  "connection-refused",
  "invalid-http",
  "request-timeout",
  "http-error",
  "assertion",
  "auth-page",
  "performance",
])
  assert.equal(
    JSON.parse(readFileSync(join(workspace, `${kind}.json`), "utf8")).rawErrorObserved,
    true,
    `Actual secret-bearing failure not reached: ${kind}`,
  );
assert.equal(
  JSON.parse(readFileSync(join(workspace, "performance-preflight.json"), "utf8")).called,
  true,
);
for (const kind of ["deadline", "uncaught", "rejection", "success"])
  assert.equal(JSON.parse(readFileSync(join(workspace, `${kind}.json`), "utf8")).kind, kind);
const summary = {
  result: "passed",
  deliberateFailures: 10,
  positiveControls: 1,
  errorContextsChecked: contexts.length,
  filesChecked: files.length,
  secretsFound: 0,
  network: "127.0.0.1 only",
  directory,
};
writeFileSync(join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
