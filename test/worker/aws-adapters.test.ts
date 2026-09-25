import { expect, it } from "vitest";
import { awsSignedFetch } from "../../src/server/platform/awsSignedFetch";
import { s3ScanProvider } from "../../src/server/modules/evidence/adapter/s3ScanProvider";
import { cognitoAdminTransport } from "../../src/server/modules/auth/adapter/cognitoAdminTransport";

const credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const now = () => new Date("2015-08-30T12:36:00Z");
it("signs AWS's documented IAM request reproducibly without putting credentials in the URL", async () => {
  let request: Request | undefined;
  const transport: typeof fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response("ok");
  };
  await awsSignedFetch(
    credentials,
    "us-east-1",
    "iam",
    transport,
    now,
  )("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", {
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
  });
  expect(request!.headers.get("Authorization")).toBe(
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
  );
  expect(request!.url).toBe("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08");
});
const config = {
  AWS_ACCOUNT_ID: "111122223333",
  AWS_REGION: "ap-northeast-1",
  S3_SCAN_BUCKET: "scs-trial-scan-111122223333",
  AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AWS_SECRET_ACCESS_KEY: "synthetic-test-secret",
  COGNITO_POOL_ID: "ap-northeast-1_Abcdef123",
};
const file = {
  id: "file",
  objectKey: "object",
  customerId: "customer",
  caseId: "case",
  name: "anonymous.txt",
  mime: "text/plain",
  sizeBytes: 9,
  sha256: "a".repeat(64),
  status: "uploading" as const,
  createdAt: "2026-09-25T00:00:00Z",
};
it.each([
  ["NO_THREATS_FOUND", "clean"],
  ["THREATS_FOUND", "blocked"],
  ["UNSUPPORTED", "blocked"],
  ["ACCESS_DENIED", "blocked"],
  ["FAILED", "failed"],
  ["UNRECOGNIZED", "failed"],
  ["", "pending"],
])("maps trusted S3 %s to %s for only the exact version and hash", async (tag, expected) => {
  const requests: Request[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return request.method === "HEAD"
      ? new Response(null, {
          headers: {
            "x-amz-version-id": "version1",
            "content-length": "9",
            "x-amz-meta-sha256": file.sha256,
            "x-amz-meta-file-id": "file",
            "x-amz-meta-r2-key": "object",
          },
        })
      : new Response(
          `<Tagging><TagSet>${tag ? `<Tag><Key>GuardDutyMalwareScanStatus</Key><Value>${tag}</Value></Tag>` : ""}</TagSet></Tagging>`,
        );
  };
  expect(
    await s3ScanProvider(config, transport, now).inspect(
      { key: "scan/attempt", version: "version1" },
      file,
    ),
  ).toBe(expected);
  expect(
    requests.map((r) => ({
      method: r.method,
      url: r.url,
      owner: r.headers.get("x-amz-expected-bucket-owner"),
    })),
  ).toEqual([
    {
      method: "HEAD",
      url: "https://scs-trial-scan-111122223333.s3.ap-northeast-1.amazonaws.com/scan/attempt?versionId=version1",
      owner: "111122223333",
    },
    {
      method: "GET",
      url: "https://scs-trial-scan-111122223333.s3.ap-northeast-1.amazonaws.com/scan/attempt?tagging=&versionId=version1",
      owner: "111122223333",
    },
  ]);
});
it("rejects S3 version substitution instead of reading an attacker controlled tag", async () => {
  let count = 0;
  const transport: typeof fetch = async () => {
    count++;
    return new Response(null, { headers: { "x-amz-version-id": "other" } });
  };
  expect(
    await s3ScanProvider(config, transport, now).inspect(
      { key: "scan/attempt", version: "version1" },
      file,
    ),
  ).toBe("failed");
  expect(count).toBe(1);
});
it("signs a bounded Cognito request and preserves only its error code", async () => {
  let request: Request | undefined;
  const transport: typeof fetch = async (input, init) => {
    request = new Request(input, init);
    return Response.json(
      { __type: "UserNotFoundException", message: "private provider body" },
      { status: 400 },
    );
  };
  await expect(
    cognitoAdminTransport(config, transport, now)(
      "AdminGetUser",
      { UserPoolId: config.COGNITO_POOL_ID, Username: "anonymous@example.invalid" },
      AbortSignal.timeout(5000),
    ),
  ).rejects.toThrow("UserNotFoundException");
  expect(request!.url).toBe("https://cognito-idp.ap-northeast-1.amazonaws.com/");
  expect(request!.headers.get("x-amz-target")).toBe(
    "AWSCognitoIdentityProviderService.AdminGetUser",
  );
});
