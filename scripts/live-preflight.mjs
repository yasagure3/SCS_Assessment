import assert from "node:assert/strict";
import { createCloudConfig, liveOrigin, verifyInventory } from "./cloud-config.mjs";
import { requireResponse } from "./cloud-io.mjs";

// This runs before /me, browser navigation, writes or provider generation. It is
// a hook prerequisite, never an ordinary test whose failure allows later tests.
export async function livePreflight(config, io, origin, restore = false) {
  liveOrigin(config, origin, restore);
  const caller = await (
    await requireResponse(
      await io.aws("sts", "/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "Action=GetCallerIdentity&Version=2011-06-15",
      }),
    )
  ).text();
  if (caller.includes(":root</Arn>")) throw new Error("Use a scoped operator identity.");
  assert.equal(
    caller.match(/<Account>(\d+)<\/Account>/)?.[1],
    config.awsAccountId,
    "AWS inventory account mismatch",
  );
  const cognito = async (action, body) =>
    (
      await requireResponse(
        await io.aws("cognito", "/", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
          },
          body: JSON.stringify(body),
        }),
      )
    ).json();
  const pool = (await cognito("DescribeUserPool", { UserPoolId: config.cognitoUserPoolId }))
    .UserPool;
  const mfa = await cognito("GetUserPoolMfaConfig", { UserPoolId: config.cognitoUserPoolId });
  const client = (
    await cognito("DescribeUserPoolClient", {
      UserPoolId: config.cognitoUserPoolId,
      ClientId: config.cognitoClientId,
    })
  ).UserPoolClient;
  assert.equal(
    pool.Policies.PasswordPolicy.TemporaryPasswordValidityDays,
    7,
    "Invitation control mismatch",
  );
  assert.deepEqual(
    client.ExplicitAuthFlows.slice().sort(),
    ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"],
    "Client control mismatch",
  );
  assert.equal(client.EnableTokenRevocation, true, "Revocation control mismatch");
  const plan = await (
    await requireResponse(
      await io.aws("guardduty", `/malware-protection-plan/${config.guardDutyPlanId}`),
    )
  ).json();
  const s3 = async (query) =>
    requireResponse(
      await io.aws("s3", `/?${query}=`, {
        headers: { "x-amz-expected-bucket-owner": config.awsAccountId },
      }),
    );
  const version = await (await s3("versioning")).text(),
    policy = await (await s3("policy")).json(),
    publicBlock = await (await s3("publicAccessBlock")).text();
  const privateBucket = async (kind) => {
    const managed = await io.cf(`r2/buckets/${config.workerName}-${kind}/domains/managed`),
      custom = await io.cf(`r2/buckets/${config.workerName}-${kind}/domains/custom`);
    return (
      managed.enabled === false &&
      Array.isArray(custom.domains) &&
      custom.domains.every((domain) => domain.enabled === false)
    );
  };
  const main = await io.cf(`d1/database/${config.databaseId}`),
    restored = await io.cf(`d1/database/${config.restoreDatabaseId}`);
  assert.deepEqual(
    [main.name, restored.name],
    [`${config.workerName}-db`, `${config.workerName}-restore-db`],
    "Database binding mismatch",
  );
  const desired = createCloudConfig(config, restore),
    settings = await io.cf(
      `workers/scripts/${config.workerName}${restore ? "-restore" : ""}/settings`,
    );
  const binding = (name) => settings.bindings.find((entry) => entry.name === name);
  assert.equal(
    binding("DB")?.id,
    restore ? config.restoreDatabaseId : config.databaseId,
    "Worker DB binding mismatch",
  );
  assert.equal(
    binding("EVIDENCE_BUCKET")?.bucket_name,
    `${config.workerName}-${restore ? "restore" : "evidence"}`,
    "Worker R2 binding mismatch",
  );
  for (const [name, value] of Object.entries(desired.vars))
    assert.equal(binding(name)?.text, value, `Worker ${name} binding mismatch`);
  const observed = {
    cloudflareAccountId: config.cloudflareAccountId,
    awsAccountId: caller.match(/<Account>(\d+)<\/Account>/)?.[1],
    workerName: config.workerName,
    databaseId: main.uuid ?? main.id,
    restoreDatabaseId: restored.uuid ?? restored.id,
    cognitoUserPoolId: pool.Id,
    cognitoClientId: client.ClientId,
    scanBucket: plan.protectedResource?.s3Bucket?.bucketName,
    guardDutyPlanId: config.guardDutyPlanId,
    guardDutyStatus: plan.status,
    mfa: mfa.MfaConfiguration,
    softwareToken: mfa.SoftwareTokenMfaConfiguration?.Enabled === true,
    inviteOnly: pool.AdminCreateUserConfig?.AllowAdminCreateUserOnly === true,
    clientSecret: Boolean(client.ClientSecret),
    scanVersioning: version.includes("<Status>Enabled</Status>") ? "Enabled" : "unknown",
    scanPublic: ![
      "BlockPublicAcls",
      "IgnorePublicAcls",
      "BlockPublicPolicy",
      "RestrictPublicBuckets",
    ].every((name) => publicBlock.includes(`<${name}>true</${name}>`)),
    evidencePublic: !(await privateBucket("evidence")),
    backupPublic: !(await privateBucket("backup")),
    restorePublic: !(await privateBucket("restore")),
    tagWritersRestricted: policy.Statement.some(
      (statement) =>
        statement.Sid === "OnlyScannerMayWriteVerdict" &&
        statement.Effect === "Deny" &&
        statement.Condition?.ArnNotEquals?.["aws:PrincipalArn"] === plan.role,
    ),
  };
  verifyInventory(config, observed);
  return observed;
}
export async function withLivePreflight(config, io, origin, continuation) {
  return continuation(await livePreflight(config, io, origin));
}
