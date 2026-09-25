import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Failure-only orchestration regression: run the actual acceptance file with
// network IO replaced in an isolated child. It can never produce live evidence.
test("every individually selected real-cloud case fails its hook before /me or side effects on wrong account", () => {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/preflight-gate-")),
    inputPath = resolve(root, "input.json"),
    trace = resolve(root, "requests.jsonl");
  const config = {
    purpose: "anonymous-trial",
    offlineOnly: false,
    cloudflareAccountId: "abcdefabcdefabcdefabcdefabcdefab",
    awsAccountId: "123456789012",
    workerName: "scs-assessment-trial-check",
    databaseId: "12345678-1234-1234-1234-123456789abc",
    restoreDatabaseId: "22345678-1234-1234-1234-123456789abc",
    cognitoUserPoolId: "ap-northeast-1_Abc123",
    cognitoClientId: "abcdefghijklmnopqrstuv1234",
    scanBucket: "scs-trial-scan-123456789012",
    guardDutyPlanId: "abcd12345678",
    openAiMode: "trial",
  };
  writeFileSync(inputPath, JSON.stringify(config));
  const setup = resolve(root, "setup.mjs"),
    runner = resolve(root, "vitest.config.mjs");
  writeFileSync(
    setup,
    `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  const endpoint = String(url); appendFileSync(${JSON.stringify(trace)}, JSON.stringify(endpoint)+'\\n');
  if (endpoint === 'https://sts.ap-northeast-1.amazonaws.com/') return new Response('<Account>999999999999</Account><Arn>arn:aws:iam::999999999999:user/operator</Arn>');
  throw new Error('Unexpected request after mismatched inventory');
};`,
  );
  writeFileSync(
    runner,
    `export default { test: { environment:'node', include:['tests/live/cloud.live.test.ts'], setupFiles:[${JSON.stringify(setup)}], retry:0, maxWorkers:1, fileParallelism:false, hookTimeout:10000 } };`,
  );
  for (const selected of [
    "creates at most",
    "rolls back",
    "holds actual",
    "sends the exact",
    "reads restored",
  ]) {
    writeFileSync(trace, "");
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/vitest/vitest.mjs"), "run", "-c", runner, "-t", selected],
      {
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          SCS_CLOUD_INPUT: inputPath,
          SCS_LIVE_ALLOW: config.workerName,
          SCS_LIVE_BASE_URL: `https://${config.workerName}.acceptance.workers.dev`,
          SCS_CF_API_TOKEN: "synthetic",
          SCS_AWS_ACCESS_KEY_ID: "synthetic",
          SCS_AWS_SECRET_ACCESS_KEY: "synthetic",
          SCS_LIVE_TOKENS_JSON: JSON.stringify(
            Array.from({ length: 5 }, (_, i) => `synthetic.${i}.token`),
          ),
          SCS_LIVE_OTHER_TOKEN: "synthetic.other.token",
          SCS_OPENAI_API_KEY: "synthetic",
          SCS_OPENAI_DATA_CONFIRMED: "true",
          SCS_COST_ESTIMATE_CONFIRMED: config.workerName,
        },
      },
    );
    assert.equal(
      result.status,
      1,
      `${selected}: expected hook failure, got ${result.status}: ${result.stderr}`,
    );
    assert.match(result.stdout + result.stderr, /AWS inventory account mismatch/);
    assert.equal(existsSync(trace), true);
    assert.deepEqual(
      readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
      ["https://sts.ap-northeast-1.amazonaws.com/"],
    );
  }
});
