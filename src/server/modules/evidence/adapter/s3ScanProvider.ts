import type { ScanProvider } from "../domain/scanning";
import {
  awsCredentials,
  awsSignedFetch,
  type AwsConfiguration,
} from "../../../platform/awsSignedFetch";
export function s3ScanProvider(
  config: AwsConfiguration & { S3_SCAN_BUCKET?: string },
  transport: typeof fetch,
  now: () => Date,
): ScanProvider {
  const request = (url: string, init: RequestInit) =>
    awsSignedFetch(
      awsCredentials(config),
      "ap-northeast-1",
      "s3",
      transport,
      now,
    )(url, { ...init, signal: AbortSignal.timeout(15000) });
  function endpoint(key: string) {
    if (
      !/^scs-(trial|prod)-scan-[a-z0-9-]+$/.test(config.S3_SCAN_BUCKET ?? "") ||
      !/^scan\/[a-zA-Z0-9-]+$/.test(key)
    )
      throw new Error("SCAN_NOT_CONFIGURED");
    return `https://${config.S3_SCAN_BUCKET}.s3.ap-northeast-1.amazonaws.com/${key}`;
  }
  const owner = () => ({ "x-amz-expected-bucket-owner": config.AWS_ACCOUNT_ID ?? "" });
  return {
    async copy(attempt, file, bytes) {
      const key = `scan/${attempt}`;
      const result = await request(endpoint(key), {
        method: "PUT",
        headers: {
          ...owner(),
          "Content-Type": "application/octet-stream",
          "If-None-Match": "*",
          "x-amz-meta-sha256": file.sha256,
          "x-amz-meta-file-id": file.id,
          "x-amz-meta-r2-key": file.objectKey,
          "x-amz-server-side-encryption": "AES256",
        },
        body: bytes,
      });
      const version = result.headers.get("x-amz-version-id");
      if (!result.ok || !version || version === "null") {
        await result.body?.cancel();
        throw new Error("SCAN_COPY_FAILED");
      }
      await result.body?.cancel();
      return { key, version };
    },
    async inspect(copy, file) {
      const query = `versionId=${encodeURIComponent(copy.version)}`;
      const head = await request(`${endpoint(copy.key)}?${query}`, {
        method: "HEAD",
        headers: owner(),
      });
      if (
        !head.ok ||
        head.headers.get("x-amz-version-id") !== copy.version ||
        Number(head.headers.get("content-length")) !== file.sizeBytes ||
        head.headers.get("x-amz-meta-sha256") !== file.sha256 ||
        head.headers.get("x-amz-meta-file-id") !== file.id ||
        head.headers.get("x-amz-meta-r2-key") !== file.objectKey
      )
        return "failed";
      const response = await request(`${endpoint(copy.key)}?tagging=&${query}`, {
        headers: owner(),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return "failed";
      }
      const text = await response.text();
      if (text.length > 16384 || /<!DOCTYPE|<!ENTITY/i.test(text)) return "failed";
      const tags = Array.from(
        text.matchAll(
          /<Tag>\s*<Key>GuardDutyMalwareScanStatus<\/Key>\s*<Value>([^<]*)<\/Value>\s*<\/Tag>/g,
        ),
      );
      if (tags.length === 0) return "pending";
      if (tags.length !== 1) return "failed";
      switch (tags[0][1]) {
        case "NO_THREATS_FOUND":
          return "clean";
        case "THREATS_FOUND":
        case "UNSUPPORTED":
        case "ACCESS_DENIED":
          return "blocked";
        default:
          return "failed";
      }
    },
  };
}
