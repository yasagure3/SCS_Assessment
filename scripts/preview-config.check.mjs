import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  validatePreviewInput,
  createPreviewConfig,
  preparePreview,
  previewBuildSettings,
  verifyPreviewOutput,
} from "./preview-config.mjs";

// Deliberately synthetic identifiers; no test makes a network request.
const input = {
  purpose: "anonymous-preview",
  offlineOnly: true,
  cloudflareAccountId: "00000000000000000000000000000000",
  workerName: "scs-assessment-preview",
  databaseId: "00000000-0000-4000-8000-000000000000",
  cognitoRegion: "ap-northeast-1",
  cognitoUserPoolId: "ap-northeast-1_DUMMY1234",
  cognitoClientId: "dummy0000000000000000000000",
};

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "scs-preview-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".local"));
  const inputPath = join(root, ".local", "preview-input.json");
  writeFileSync(inputPath, JSON.stringify(input));
  return { root, inputPath };
}

test("offline preparation emits an isolated Worker and one Cognito identity for both runtimes", (t) => {
  const { root, inputPath } = workspace(t);
  writeFileSync(join(root, "wrangler.jsonc"), "production configuration sentinel");
  writeFileSync(join(root, ".env.local"), "existing environment sentinel");
  const configPath = preparePreview(inputPath, root);
  const generated = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(generated, {
    name: "scs-assessment-preview",
    account_id: "00000000000000000000000000000000",
    main: "../../src/server/index.ts",
    compatibility_date: "2026-07-11",
    workers_dev: true,
    preview_urls: false,
    assets: {
      directory: "../../dist/client",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "scs-assessment-preview-db",
        database_id: input.databaseId,
        migrations_dir: "../../migrations",
      },
    ],
    r2_buckets: [{ binding: "EVIDENCE_BUCKET", bucket_name: "scs-assessment-preview-evidence" }],
    vars: {
      COGNITO_ISSUER: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_DUMMY1234",
      COGNITO_CLIENT_ID: input.cognitoClientId,
      COGNITO_JWKS_URL:
        "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_DUMMY1234/.well-known/jwks.json",
    },
  });
  assert.deepEqual(previewBuildSettings(inputPath, root), {
    configPath,
    envDir: false,
    define: {
      "import.meta.env.VITE_COGNITO_USER_POOL_ID": JSON.stringify(input.cognitoUserPoolId),
      "import.meta.env.VITE_COGNITO_CLIENT_ID": JSON.stringify(input.cognitoClientId),
      "import.meta.env.VITE_COGNITO_ENDPOINT": JSON.stringify(""),
    },
  });
  assert.equal(
    readFileSync(join(root, "wrangler.jsonc"), "utf8"),
    "production configuration sentinel",
  );
  assert.equal(readFileSync(join(root, ".env.local"), "utf8"), "existing environment sentinel");
});

/** @type {Array<[string, object, string]>} */
const invalidInputs = [
  [
    "missing account",
    { cloudflareAccountId: "" },
    "cloudflareAccountId must be a 32-character hex account ID.",
  ],
  ["unfilled database", { databaseId: "__D1_DATABASE_ID__" }, "databaseId must be a D1 UUID."],
  [
    "production Worker",
    { workerName: "scs-assessment" },
    "workerName must be scs-assessment-preview or scs-assessment-preview-<suffix> (max 40 characters).",
  ],
  [
    "foreign region pool",
    { cognitoUserPoolId: "us-east-1_DUMMY1234" },
    "cognitoUserPoolId must belong to cognitoRegion.",
  ],
  [
    "missing client",
    { cognitoClientId: "" },
    "cognitoClientId must be a public Cognito client ID.",
  ],
  [
    "secret added",
    { awsSecretAccessKey: "DO_NOT_PRINT_THIS" },
    "Unexpected preview input fields. Only public resource identifiers are accepted.",
  ],
  [
    "dummy input marked live",
    { offlineOnly: false },
    "Dummy identifiers are allowed only with offlineOnly: true; never deploy them.",
  ],
];
for (const [name, patch, error] of invalidInputs) {
  test(`configuration rejects ${name} before producing deployable output`, () => {
    assert.throws(() => validatePreviewInput({ ...input, ...patch }), { message: error });
  });
}

test("deploy refuses offline fixtures even when their shape is valid", () => {
  assert.throws(() => validatePreviewInput(input, { deploy: true }), {
    message: "offlineOnly configuration cannot be deployed.",
  });
});

test("build refuses changed generated bindings and local secret files", (t) => {
  const { root, inputPath } = workspace(t);
  const configPath = preparePreview(inputPath, root);
  const config = createPreviewConfig(input);
  config.vars.COGNITO_CLIENT_ID = "anotherclient0000000000000";
  writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => previewBuildSettings(inputPath, root), {
    message:
      "Prepared preview configuration differs from the input. Run preview preparation again.",
  });
  preparePreview(inputPath, root);
  writeFileSync(join(root, ".local", "preview", ".dev.vars"), "DO_NOT_READ=secret");
  assert.throws(() => previewBuildSettings(inputPath, root), {
    message: "The generated preview directory must not contain .env or .dev.vars files.",
  });
});

function outputFixture(root) {
  const workerDirectory = join(root, "dist", "scs_assessment_preview");
  mkdirSync(workerDirectory, { recursive: true });
  mkdirSync(join(root, "dist", "client", "assets"), { recursive: true });
  const config = createPreviewConfig(input);
  config.main = "index.js";
  config.assets.directory = "../client";
  writeFileSync(join(workerDirectory, "index.js"), "export default {};");
  writeFileSync(
    join(root, "dist", "client", "assets", "app.js"),
    `const pool = ${JSON.stringify(input.cognitoUserPoolId)}; const client = ${JSON.stringify(input.cognitoClientId)};`,
  );
  writeFileSync(join(workerDirectory, "wrangler.json"), JSON.stringify(config));
  return { config, workerDirectory };
}

test("generated build verification returns only the checked preview deployment file", (t) => {
  const { root, inputPath } = workspace(t);
  preparePreview(inputPath, root);
  const { workerDirectory } = outputFixture(root);
  assert.equal(verifyPreviewOutput(inputPath, root), resolve(workerDirectory, "wrangler.json"));
});

test("build verification accepts the template literals emitted by the production minifier", (t) => {
  const { root, inputPath } = workspace(t);
  preparePreview(inputPath, root);
  const { workerDirectory } = outputFixture(root);
  writeFileSync(
    join(root, "dist", "client", "assets", "app.js"),
    `const pool = \`${input.cognitoUserPoolId}\`; const client = '${input.cognitoClientId}';`,
  );
  assert.equal(verifyPreviewOutput(inputPath, root), resolve(workerDirectory, "wrangler.json"));
});

/** @type {Array<[string, (config: ReturnType<typeof createPreviewConfig>) => void, string]>} */
const invalidBuilds = [
  [
    "different account",
    (c) => {
      c.account_id = "11111111111111111111111111111111";
    },
    "Built Worker account, name, resources or Cognito settings differ from the preview input.",
  ],
  [
    "different database",
    (c) => {
      c.d1_databases[0].database_id = "11111111-1111-4111-8111-111111111111";
    },
    "Built Worker account, name, resources or Cognito settings differ from the preview input.",
  ],
  [
    "different bucket",
    (c) => {
      c.r2_buckets[0].bucket_name = "production-evidence";
    },
    "Built Worker account, name, resources or Cognito settings differ from the preview input.",
  ],
  [
    "different issuer",
    (c) => {
      c.vars.COGNITO_ISSUER = "https://example.invalid";
    },
    "Built Worker account, name, resources or Cognito settings differ from the preview input.",
  ],
  [
    "entire dist directory",
    (c) => {
      c.assets.directory = "..";
    },
    "Built assets must serve only dist/client with /api/* handled by the Worker.",
  ],
  [
    "SPA swallowing API",
    (c) => {
      c.assets.run_worker_first = [];
    },
    "Built assets must serve only dist/client with /api/* handled by the Worker.",
  ],
];
for (const [name, mutate, error] of invalidBuilds) {
  test(`build verification blocks ${name}`, (t) => {
    const { root, inputPath } = workspace(t);
    preparePreview(inputPath, root);
    const { config, workerDirectory } = outputFixture(root);
    mutate(config);
    writeFileSync(join(workerDirectory, "wrangler.json"), JSON.stringify(config));
    assert.throws(() => verifyPreviewOutput(inputPath, root), { message: error });
  });
}

test("build verification blocks a SPA built for another Cognito pool", (t) => {
  const { root, inputPath } = workspace(t);
  preparePreview(inputPath, root);
  outputFixture(root);
  writeFileSync(join(root, "dist", "client", "assets", "app.js"), 'const pool = "other-pool";');
  assert.throws(() => verifyPreviewOutput(inputPath, root), {
    message: "Built SPA does not contain the same Cognito pool and client as the Worker.",
  });
});
