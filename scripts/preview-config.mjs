import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const fields = [
  "purpose",
  "offlineOnly",
  "cloudflareAccountId",
  "workerName",
  "databaseId",
  "cognitoRegion",
  "cognitoUserPoolId",
  "cognitoClientId",
];

// This validates public configuration, not resource existence or live MFA settings.
export function validatePreviewInput(input, { deploy = false } = {}) {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new Error(
      "Unexpected preview input fields. Only public resource identifiers are accepted.",
    );
  if (input.purpose !== "anonymous-preview" || typeof input.offlineOnly !== "boolean")
    throw new Error('Require purpose: "anonymous-preview" and an explicit boolean offlineOnly.');
  if (deploy && input.offlineOnly) throw new Error("offlineOnly configuration cannot be deployed.");
  if (
    typeof input.cloudflareAccountId !== "string" ||
    !/^[a-f0-9]{32}$/.test(input.cloudflareAccountId)
  )
    throw new Error("cloudflareAccountId must be a 32-character hex account ID.");
  if (
    typeof input.databaseId !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.databaseId)
  )
    throw new Error("databaseId must be a D1 UUID.");
  if (
    typeof input.workerName !== "string" ||
    !/^scs-assessment-preview(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(input.workerName) ||
    input.workerName.length > 40
  )
    throw new Error(
      "workerName must be scs-assessment-preview or scs-assessment-preview-<suffix> (max 40 characters).",
    );
  if (typeof input.cognitoRegion !== "string" || !/^[a-z]{2}-[a-z]+-\d$/.test(input.cognitoRegion))
    throw new Error("cognitoRegion must be an AWS commercial region.");
  if (
    typeof input.cognitoUserPoolId !== "string" ||
    !new RegExp(`^${input.cognitoRegion}_[A-Za-z0-9]{1,55}$`).test(input.cognitoUserPoolId)
  )
    throw new Error("cognitoUserPoolId must belong to cognitoRegion.");
  if (
    typeof input.cognitoClientId !== "string" ||
    !/^[a-z0-9]{20,128}$/.test(input.cognitoClientId)
  )
    throw new Error("cognitoClientId must be a public Cognito client ID.");
  const ids = [
    input.cloudflareAccountId,
    input.databaseId,
    input.cognitoUserPoolId,
    input.cognitoClientId,
  ];
  if (
    !input.offlineOnly &&
    ids.some((value) =>
      /dummy|fake|example|placeholder|changeme|replace|__|^0{8}|^1{8}/i.test(value),
    )
  )
    throw new Error(
      "Dummy identifiers are allowed only with offlineOnly: true; never deploy them.",
    );
  return input;
}

export function createPreviewConfig(input) {
  validatePreviewInput(input);
  const issuer = `https://cognito-idp.${input.cognitoRegion}.amazonaws.com/${input.cognitoUserPoolId}`;
  return {
    name: input.workerName,
    account_id: input.cloudflareAccountId,
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
        database_name: `${input.workerName}-db`,
        database_id: input.databaseId,
        migrations_dir: "../../migrations",
      },
    ],
    r2_buckets: [{ binding: "EVIDENCE_BUCKET", bucket_name: `${input.workerName}-evidence` }],
    vars: {
      COGNITO_ISSUER: issuer,
      COGNITO_CLIENT_ID: input.cognitoClientId,
      COGNITO_JWKS_URL: `${issuer}/.well-known/jwks.json`,
    },
  };
}

function readInput(inputPath, root, options) {
  const path = resolve(root, inputPath);
  if (
    !path.startsWith(resolve(root, ".local") + sep) ||
    path === resolve(root, ".local/preview/wrangler.json")
  )
    throw new Error(
      "Keep operator input in this checkout's .local directory, outside the generated wrangler.json.",
    );
  return validatePreviewInput(JSON.parse(readFileSync(path, "utf8")), options);
}

function rejectLocalSecrets(directory) {
  if (readdirSync(directory).some((name) => /^\.(?:env|dev\.vars)(?:\.|$)/.test(name)))
    throw new Error("The generated preview directory must not contain .env or .dev.vars files.");
}

export function preparePreview(inputPath, root, options) {
  const input = readInput(inputPath, root, options);
  const configPath = resolve(root, ".local/preview/wrangler.json");
  mkdirSync(dirname(configPath), { recursive: true });
  rejectLocalSecrets(dirname(configPath));
  writeFileSync(configPath, `${JSON.stringify(createPreviewConfig(input), null, 2)}\n`);
  return configPath;
}

export function previewBuildSettings(inputPath, root) {
  const input = readInput(inputPath, root);
  const configPath = resolve(root, ".local/preview/wrangler.json");
  rejectLocalSecrets(dirname(configPath));
  if (!isDeepStrictEqual(JSON.parse(readFileSync(configPath, "utf8")), createPreviewConfig(input)))
    throw new Error(
      "Prepared preview configuration differs from the input. Run preview preparation again.",
    );
  return {
    configPath,
    envDir: false,
    define: {
      "import.meta.env.VITE_COGNITO_USER_POOL_ID": JSON.stringify(input.cognitoUserPoolId),
      "import.meta.env.VITE_COGNITO_CLIENT_ID": JSON.stringify(input.cognitoClientId),
      "import.meta.env.VITE_COGNITO_ENDPOINT": JSON.stringify(""),
    },
  };
}

function readClientJavaScript(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readClientJavaScript(path);
      return entry.name.endsWith(".js") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}

export function verifyPreviewOutput(inputPath, root, options) {
  const input = readInput(inputPath, root, options);
  previewBuildSettings(inputPath, root);
  const expected = createPreviewConfig(input);
  const configPath = resolve(root, "dist", input.workerName.replaceAll("-", "_"), "wrangler.json");
  const built = JSON.parse(readFileSync(configPath, "utf8"));
  const resourceIdentity = (config) => ({
    name: config.name,
    account_id: config.account_id,
    d1_databases: config.d1_databases?.map(({ binding, database_name, database_id }) => ({
      binding,
      database_name,
      database_id,
    })),
    r2_buckets: config.r2_buckets?.map(({ binding, bucket_name }) => ({ binding, bucket_name })),
    vars: config.vars,
  });
  if (!isDeepStrictEqual(resourceIdentity(built), resourceIdentity(expected)))
    throw new Error(
      "Built Worker account, name, resources or Cognito settings differ from the preview input.",
    );
  if (
    !built.assets?.directory ||
    resolve(dirname(configPath), built.assets.directory) !== resolve(root, "dist/client") ||
    built.assets.not_found_handling !== "single-page-application" ||
    !isDeepStrictEqual(built.assets.run_worker_first, ["/api/*"])
  )
    throw new Error("Built assets must serve only dist/client with /api/* handled by the Worker.");
  const client = readClientJavaScript(resolve(root, "dist/client"));
  const containsLiteral = (value) =>
    ['"', "'", "`"].some((quote) => client.includes(`${quote}${value}${quote}`));
  if (!containsLiteral(input.cognitoUserPoolId) || !containsLiteral(input.cognitoClientId))
    throw new Error("Built SPA does not contain the same Cognito pool and client as the Worker.");
  return configPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, inputPath, ...extra] = process.argv.slice(2);
  if (
    !["prepare", "verify", "verify-deploy", "prepare-deploy"].includes(action) ||
    !inputPath ||
    extra.length
  )
    throw new Error(
      "Usage: node scripts/preview-config.mjs <prepare|verify|prepare-deploy|verify-deploy> .local/preview-input.json",
    );
  const run = action.startsWith("prepare") ? preparePreview : verifyPreviewOutput;
  const configPath = run(inputPath, process.cwd(), { deploy: action.endsWith("-deploy") });
  console.log(configPath);
}
