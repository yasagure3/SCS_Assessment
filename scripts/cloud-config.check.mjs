import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCloudInput, createCloudConfig, verifyInventory } from "./cloud-config.mjs";
import * as cloud from "./cloud-config.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const input = {
  purpose: "anonymous-trial",
  offlineOnly: true,
  cloudflareAccountId: "a".repeat(32),
  awsAccountId: "222233334444",
  workerName: "scs-assessment-trial",
  databaseId: "12345678-1234-1234-1234-123456789abc",
  restoreDatabaseId: "22345678-1234-1234-1234-123456789abc",
  cognitoUserPoolId: "ap-northeast-1_Abcdef12",
  cognitoClientId: "a".repeat(26),
  scanBucket: "scs-trial-scan-222233334444",
  guardDutyPlanId: "a".repeat(32),
  openAiMode: "disabled",
};
test("generates isolated names and fail closed cloud bindings from public-only input", () => {
  const config = createCloudConfig(input);
  assert.equal(config.name, "scs-assessment-trial");
  assert.deepEqual(config.r2_buckets, [
    { binding: "EVIDENCE_BUCKET", bucket_name: "scs-assessment-trial-evidence" },
  ]);
  assert.equal(config.vars.OPENAI_MODE, "disabled");
  assert.equal(
    config.vars.COGNITO_JWKS_URL,
    "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_Abcdef12/.well-known/jwks.json",
  );
});
test("rejects preview identifiers, repeated databases, secret fields and mismatched observed accounts", () => {
  for (const change of [
    { workerName: "scs-assessment-preview" },
    { restoreDatabaseId: input.databaseId },
    { apiKey: "do-not-read" },
    { scanBucket: "existing-customer-bucket" },
  ])
    assert.throws(() => validateCloudInput({ ...input, ...change }));
  assert.throws(() => verifyInventory(input, { awsAccountId: "999988887777" }));
});
test("accepts only complete, private inventory matching the selected environment", () => {
  const inventory = {
    cloudflareAccountId: input.cloudflareAccountId,
    awsAccountId: input.awsAccountId,
    databaseId: input.databaseId,
    restoreDatabaseId: input.restoreDatabaseId,
    workerName: input.workerName,
    cognitoUserPoolId: input.cognitoUserPoolId,
    cognitoClientId: input.cognitoClientId,
    scanBucket: input.scanBucket,
    guardDutyPlanId: input.guardDutyPlanId,
    guardDutyStatus: "ACTIVE",
    mfa: "ON",
    softwareToken: true,
    inviteOnly: true,
    clientSecret: false,
    scanVersioning: "Enabled",
    scanPublic: false,
    evidencePublic: false,
    backupPublic: false,
    restorePublic: false,
    tagWritersRestricted: true,
  };
  assert.equal(verifyInventory(input, inventory), true);
  assert.throws(() => verifyInventory(input, { ...inventory, evidencePublic: true }));
});
test("only the exact dedicated HTTPS Worker origin may receive live credentials", () => {
  assert.equal(
    cloud.liveOrigin(input, "https://scs-assessment-trial.operator.workers.dev"),
    "https://scs-assessment-trial.operator.workers.dev",
  );
  for (const url of [
    "https://scs-assessment-trial.evil.invalid",
    "https://scs-assessment-trial.other.operator.workers.dev",
    "https://user:secret@scs-assessment-trial.operator.workers.dev",
    "http://scs-assessment-trial.operator.workers.dev",
    "https://scs-assessment-trial.operator.workers.dev/?secret=x",
  ])
    assert.throws(() => cloud.liveOrigin(input, url));
});
test("built resources and SPA must match public inputs and deployment cannot use offline or production inputs", () => {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/cloud-check-"));
  mkdirSync(resolve(root, ".local"));
  const source = resolve(root, ".local/input.json");
  writeFileSync(source, JSON.stringify(input));
  cloud.prepareCloud(source, root);
  const directory = resolve(root, "dist", input.workerName.replaceAll("-", "_"));
  mkdirSync(directory, { recursive: true });
  mkdirSync(resolve(root, "dist/client"));
  writeFileSync(
    resolve(root, "dist/client/app.js"),
    `const pool=${JSON.stringify(input.cognitoUserPoolId)},client=${JSON.stringify(input.cognitoClientId)};`,
  );
  const built = {
    ...createCloudConfig(input),
    assets: { ...createCloudConfig(input).assets, directory: "../client" },
  };
  writeFileSync(resolve(directory, "wrangler.json"), JSON.stringify(built));
  assert.equal(cloud.verifyCloudOutput(source, root), resolve(directory, "wrangler.json"));
  assert.throws(() => cloud.verifyCloudOutput(source, root, true));
  built.vars.COGNITO_CLIENT_ID = "swapped-client";
  writeFileSync(resolve(directory, "wrangler.json"), JSON.stringify(built));
  assert.throws(() => cloud.verifyCloudOutput(source, root));
});
test("recovery Worker always uses isolated restore D1 and R2 and disables AI", () => {
  const result = cloud.createCloudConfig({ ...input, openAiMode: "trial" }, true);
  assert.equal(result.name, `${input.workerName}-restore`);
  assert.deepEqual(
    result.d1_databases.map(({ binding, database_id, database_name }) => ({
      binding,
      database_id,
      database_name,
    })),
    [
      {
        binding: "DB",
        database_id: input.restoreDatabaseId,
        database_name: `${input.workerName}-restore-db`,
      },
    ],
  );
  assert.deepEqual(result.r2_buckets, [
    { binding: "EVIDENCE_BUCKET", bucket_name: `${input.workerName}-restore` },
  ]);
  assert.equal(result.vars.OPENAI_MODE, "disabled");
  assert.equal(
    cloud.liveOrigin(input, `https://${input.workerName}-restore.operator.workers.dev`, true),
    `https://${input.workerName}-restore.operator.workers.dev`,
  );
});
