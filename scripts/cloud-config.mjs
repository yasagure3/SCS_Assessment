import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
const fields = [
  "purpose",
  "offlineOnly",
  "cloudflareAccountId",
  "awsAccountId",
  "workerName",
  "databaseId",
  "restoreDatabaseId",
  "cognitoUserPoolId",
  "cognitoClientId",
  "scanBucket",
  "guardDutyPlanId",
  "openAiMode",
];
export function validateCloudInput(input) {
  if (
    !input ||
    Object.keys(input).some((k) => !fields.includes(k)) ||
    fields.some((k) => !(k in input))
  )
    throw new Error("Only the complete public cloud input schema is accepted.");
  const stage =
    input.purpose === "anonymous-trial" ? "trial" : input.purpose === "production" ? "prod" : null;
  if (
    !stage ||
    typeof input.offlineOnly !== "boolean" ||
    !new RegExp(`^scs-assessment-${stage}(?:-[a-z0-9]+)*$`).test(input.workerName) ||
    input.workerName.length > 40
  )
    throw new Error("Environment name does not match purpose.");
  if (!/^[a-f0-9]{32}$/.test(input.cloudflareAccountId) || !/^\d{12}$/.test(input.awsAccountId))
    throw new Error("Invalid approved account IDs.");
  for (const id of [input.databaseId, input.restoreDatabaseId])
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
      throw new Error("Invalid database identity.");
  if (input.databaseId === input.restoreDatabaseId)
    throw new Error("Restore database must be isolated.");
  if (
    !/^ap-northeast-1_[A-Za-z0-9]+$/.test(input.cognitoUserPoolId) ||
    !/^[a-z0-9]{20,128}$/.test(input.cognitoClientId)
  )
    throw new Error("Invalid Tokyo Cognito identity.");
  if (
    !new RegExp(`^scs-${stage}-scan-${input.awsAccountId}(?:-[a-z0-9]+)*$`).test(
      input.scanBucket,
    ) ||
    !/^[a-z0-9]{8,64}$/.test(input.guardDutyPlanId)
  )
    throw new Error("Invalid dedicated scan resources.");
  if (
    !["disabled", "trial", "monthly"].includes(input.openAiMode) ||
    (stage === "trial" && input.openAiMode === "monthly")
  )
    throw new Error("Invalid OpenAI mode.");
  if (
    !input.offlineOnly &&
    Object.values(input).some(
      (value) =>
        typeof value === "string" &&
        /dummy|fake|example|placeholder|changeme|replace|__|^0{8}|^1{8}/i.test(value),
    )
  )
    throw new Error("Dummy identifiers are offline only.");
  return input;
}
export function createCloudConfig(input, restore = false) {
  validateCloudInput(input);
  const issuer = `https://cognito-idp.ap-northeast-1.amazonaws.com/${input.cognitoUserPoolId}`;
  return {
    name: input.workerName + (restore ? "-restore" : ""),
    account_id: input.cloudflareAccountId,
    main: "../../src/server/index.ts",
    compatibility_date: "2026-07-11",
    workers_dev: input.purpose === "anonymous-trial",
    preview_urls: false,
    assets: {
      directory: "../../dist/client",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: `${input.workerName}-${restore ? "restore-db" : "db"}`,
        database_id: restore ? input.restoreDatabaseId : input.databaseId,
        migrations_dir: "../../migrations",
      },
    ],
    r2_buckets: [
      {
        binding: "EVIDENCE_BUCKET",
        bucket_name: `${input.workerName}-${restore ? "restore" : "evidence"}`,
      },
    ],
    vars: {
      COGNITO_ISSUER: issuer,
      COGNITO_POOL_ID: input.cognitoUserPoolId,
      COGNITO_CLIENT_ID: input.cognitoClientId,
      COGNITO_JWKS_URL: `${issuer}/.well-known/jwks.json`,
      AWS_ACCOUNT_ID: input.awsAccountId,
      AWS_REGION: "ap-northeast-1",
      S3_SCAN_BUCKET: input.scanBucket,
      OPENAI_MODE: restore ? "disabled" : input.openAiMode,
      OPENAI_MODEL: "gpt-6-sol",
    },
  };
}
export function verifyInventory(input, observed) {
  validateCloudInput(input);
  for (const key of [
    "cloudflareAccountId",
    "awsAccountId",
    "workerName",
    "databaseId",
    "restoreDatabaseId",
    "cognitoUserPoolId",
    "cognitoClientId",
    "scanBucket",
    "guardDutyPlanId",
  ])
    if (observed[key] !== input[key]) throw new Error(`Resource inventory mismatch: ${key}`);
  for (const [key, value] of Object.entries({
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
  }))
    if (observed[key] !== value) throw new Error(`Required provider control missing: ${key}`);
  return true;
}
export function readCloudInput(inputPath, root) {
  const path = resolve(root, inputPath);
  if (!path.startsWith(resolve(root, ".local") + sep))
    throw new Error("Keep operator input in this checkout .local.");
  return validateCloudInput(JSON.parse(readFileSync(path, "utf8")));
}
export function prepareCloud(inputPath, root, restore = false) {
  const input = readCloudInput(inputPath, root),
    path = resolve(
      root,
      restore ? ".local/cloud-restore/wrangler.json" : ".local/cloud/wrangler.json",
    );
  mkdirSync(dirname(path), { recursive: true });
  if (readdirSync(dirname(path)).some((name) => /^\.(env|dev\.vars)(\.|$)/.test(name)))
    throw new Error("Do not keep secrets next to generated configuration.");
  writeFileSync(path, JSON.stringify(createCloudConfig(input, restore), null, 2) + "\n");
  return path;
}
export function cloudBuildSettings(inputPath, root, restore = false) {
  const input = readCloudInput(inputPath, root),
    configPath = resolve(
      root,
      restore ? ".local/cloud-restore/wrangler.json" : ".local/cloud/wrangler.json",
    );
  if (
    readdirSync(dirname(configPath)).some((name) => /^\.(env|dev\.vars)(\.|$)/.test(name)) ||
    !isDeepStrictEqual(
      JSON.parse(readFileSync(configPath, "utf8")),
      createCloudConfig(input, restore),
    )
  )
    throw new Error("Cloud build configuration changed; prepare it again.");
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
export function liveOrigin(input, value, restore = false) {
  validateCloudInput(input);
  const url = new URL(value);
  if (
    input.purpose !== "anonymous-trial" ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !new RegExp(
      `^${input.workerName}${restore ? "-restore" : ""}\\.[a-z0-9-]+\\.workers\\.dev$`,
    ).test(url.hostname)
  )
    throw new Error("Live URL must match the dedicated trial Worker origin.");
  return url.origin;
}
export function verifyCloudOutput(inputPath, root, deploy = false, restore = false) {
  const input = readCloudInput(inputPath, root);
  if (
    deploy &&
    (input.offlineOnly ||
      input.purpose !== "anonymous-trial" ||
      process.env.SCS_LIVE_ALLOW !== input.workerName)
  )
    throw new Error(
      "Deployment requires an explicitly named live anonymous trial. Production publication is a separate decision.",
    );
  cloudBuildSettings(inputPath, root, restore);
  const configPath = resolve(
    root,
    "dist",
    (input.workerName + (restore ? "-restore" : "")).replaceAll("-", "_"),
    "wrangler.json",
  );
  const built = JSON.parse(readFileSync(configPath, "utf8")),
    expected = createCloudConfig(input, restore);
  const identity = ({
    name,
    account_id,
    workers_dev,
    preview_urls,
    vars,
    d1_databases,
    r2_buckets,
  }) => ({
    name,
    account_id,
    workers_dev,
    preview_urls,
    vars,
    d1_databases: d1_databases?.map(({ binding, database_name, database_id }) => ({
      binding,
      database_name,
      database_id,
    })),
    r2_buckets: r2_buckets?.map(({ binding, bucket_name }) => ({ binding, bucket_name })),
  });
  if (!isDeepStrictEqual(identity(built), identity(expected)))
    throw new Error("Built Worker differs from the approved cloud identity.");
  if (
    !built.assets?.directory ||
    resolve(dirname(configPath), built.assets.directory) !== resolve(root, "dist/client") ||
    built.assets.not_found_handling !== "single-page-application" ||
    !isDeepStrictEqual(built.assets.run_worker_first, ["/api/*"])
  )
    throw new Error("Built assets are not the isolated client distribution.");
  const readJs = (directory) =>
    readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? readJs(resolve(directory, entry.name))
          : entry.name.endsWith(".js")
            ? [readFileSync(resolve(directory, entry.name), "utf8")]
            : [],
      )
      .join("\n");
  const client = readJs(resolve(root, "dist/client"));
  for (const value of [input.cognitoUserPoolId, input.cognitoClientId])
    if (!['"', "'", "`"].some((quote) => client.includes(`${quote}${value}${quote}`)))
      throw new Error("Built browser Cognito identity does not match Worker.");
  return configPath;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, input, target] = process.argv.slice(2);
  if (
    !["prepare", "verify", "verify-deploy"].includes(action) ||
    !input ||
    ![undefined, "restore"].includes(target)
  )
    throw new Error(
      "Usage: vp exec node scripts/cloud-config.mjs prepare|verify|verify-deploy .local/cloud-input.json",
    );
  console.log(
    action === "prepare"
      ? prepareCloud(input, process.cwd(), target === "restore")
      : verifyCloudOutput(input, process.cwd(), action === "verify-deploy", target === "restore"),
  );
}
