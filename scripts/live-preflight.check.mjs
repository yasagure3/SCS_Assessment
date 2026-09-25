import { test } from "node:test";
import assert from "node:assert/strict";
import { withLivePreflight } from "./live-preflight.mjs";
import { createCloudConfig } from "./cloud-config.mjs";

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
const origin = `https://${config.workerName}.acceptance.workers.dev`;
function fixture(change = {}) {
  const desired = createCloudConfig(config),
    role = "arn:aws:iam::123456789012:role/scan";
  const observed = {
    account: config.awsAccountId,
    mfa: "ON",
    public: false,
    bindings: [
      { name: "DB", id: config.databaseId },
      { name: "EVIDENCE_BUCKET", bucket_name: `${config.workerName}-evidence` },
      ...Object.entries(desired.vars).map(([name, text]) => ({ name, text })),
    ],
    ...change,
  };
  const reads = [];
  const io = {
    aws: async (service, path, init) => {
      reads.push(service);
      if (service === "sts")
        return new Response(
          `<Account>${observed.account}</Account><Arn>arn:aws:iam::123456789012:user/operator</Arn>`,
        );
      if (service === "cognito") {
        const action = new Headers(init.headers).get("X-Amz-Target").split(".").at(-1);
        return Response.json(
          {
            DescribeUserPool: {
              UserPool: {
                Id: config.cognitoUserPoolId,
                Policies: { PasswordPolicy: { TemporaryPasswordValidityDays: 7 } },
                AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
              },
            },
            GetUserPoolMfaConfig: {
              MfaConfiguration: observed.mfa,
              SoftwareTokenMfaConfiguration: { Enabled: true },
            },
            DescribeUserPoolClient: {
              UserPoolClient: {
                ClientId: config.cognitoClientId,
                ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
                EnableTokenRevocation: true,
              },
            },
          }[action],
        );
      }
      if (service === "guardduty")
        return Response.json({
          protectedResource: { s3Bucket: { bucketName: config.scanBucket } },
          status: "ACTIVE",
          role,
        });
      if (path.startsWith("/?policy"))
        return Response.json({
          Statement: [
            {
              Sid: "OnlyScannerMayWriteVerdict",
              Effect: "Deny",
              Condition: { ArnNotEquals: { "aws:PrincipalArn": role } },
            },
          ],
        });
      if (path.startsWith("/?versioning")) return new Response("<Status>Enabled</Status>");
      return new Response(
        ["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"]
          .map((name) => `<${name}>true</${name}>`)
          .join(""),
      );
    },
    cf: async (path) => {
      reads.push(path);
      if (path.endsWith("domains/managed")) return { enabled: observed.public };
      if (path.endsWith("domains/custom")) return { domains: [] };
      if (path.endsWith("/settings")) return { bindings: observed.bindings };
      const restore = path.includes(config.restoreDatabaseId);
      return {
        name: `${config.workerName}-${restore ? "restore-db" : "db"}`,
        uuid: restore ? config.restoreDatabaseId : config.databaseId,
      };
    },
  };
  return { io, reads, observed };
}
for (const [name, change] of Object.entries({
  account: { account: "999999999999" },
  MFA: { mfa: "OFF" },
  private: { public: true },
  binding: { bindings: [] },
}))
  test(`refuses ${name} mismatch before any product read, write or external send`, async () => {
    const f = fixture(change);
    let effects = 0;
    await assert.rejects(
      () =>
        withLivePreflight(config, f.io, origin, async () => {
          effects++;
        }),
      /inventory|control|binding/i,
    );
    assert.equal(effects, 0);
    assert.equal(f.reads[0], "sts");
  });
test("verified inventory permits exactly the selected continuation and exposes measured identity", async () => {
  const f = fixture();
  let effects = 0;
  const result = await withLivePreflight(config, f.io, origin, async (observed) => {
    effects++;
    return observed;
  });
  assert.equal(effects, 1);
  assert.equal(result.awsAccountId, config.awsAccountId);
  assert.equal(result.evidencePublic, false);
});
