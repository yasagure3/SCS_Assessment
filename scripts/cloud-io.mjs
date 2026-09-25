import { awsSignedFetch } from "../src/server/platform/awsSignedFetch.ts";
export function cloudIo(config, env, transport = fetch) {
  if (
    config.offlineOnly ||
    config.purpose !== "anonymous-trial" ||
    env.SCS_LIVE_ALLOW !== config.workerName
  )
    throw new Error("Explicit dedicated anonymous-trial environment is required.");
  const apiToken = env.SCS_CF_API_TOKEN;
  if (!apiToken) throw new Error("SCS_CF_API_TOKEN is required (not read from disk).");
  const aws = {
    accessKeyId: env.SCS_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.SCS_AWS_SECRET_ACCESS_KEY,
    sessionToken: env.SCS_AWS_SESSION_TOKEN,
  };
  const r2 = {
    accessKeyId: env.SCS_R2_ACCESS_KEY_ID,
    secretAccessKey: env.SCS_R2_SECRET_ACCESS_KEY,
  };
  const splitBackupCredentials =
    env.SCS_R2_BACKUP_WRITE_ACCESS_KEY_ID !== undefined ||
    env.SCS_R2_BACKUP_WRITE_SECRET_ACCESS_KEY !== undefined;
  const backupWriter = {
    accessKeyId: env.SCS_R2_BACKUP_WRITE_ACCESS_KEY_ID,
    secretAccessKey: env.SCS_R2_BACKUP_WRITE_SECRET_ACCESS_KEY,
  };
  const now = () => new Date();
  async function cf(path, init = {}) {
    const response = await transport(
      `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/${path}`,
      {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
          ...init.headers,
        },
      },
    );
    const result = await response.json();
    if (!response.ok || result.success !== true)
      throw new Error(`Cloudflare operation failed (${response.status}).`);
    return result.result;
  }
  return {
    cf,
    async query(sql, params = [], database = config.databaseId) {
      if (![config.databaseId, config.restoreDatabaseId].includes(database))
        throw new Error("Unapproved database.");
      return cf(`d1/database/${database}/query`, {
        method: "POST",
        body: JSON.stringify({ sql, params }),
      });
    },
    async aws(service, path, init = {}) {
      if (!aws.accessKeyId || !aws.secretAccessKey)
        throw new Error("Dedicated SCS_AWS credentials are required.");
      const hosts = {
        sts: "sts.ap-northeast-1.amazonaws.com",
        cognito: "cognito-idp.ap-northeast-1.amazonaws.com",
        guardduty: "guardduty.ap-northeast-1.amazonaws.com",
        s3: `${config.scanBucket}.s3.ap-northeast-1.amazonaws.com`,
      };
      if (!hosts[service] || !path.startsWith("/")) throw new Error("Unapproved AWS endpoint.");
      return awsSignedFetch(
        aws,
        "ap-northeast-1",
        service === "cognito" ? "cognito-idp" : service,
        transport,
        now,
      )(`https://${hosts[service]}${path}`, { ...init, signal: AbortSignal.timeout(30000) });
    },
    async r2(kind, key, init = {}) {
      const writing = !["GET", "HEAD"].includes(init.method ?? "GET");
      if (splitBackupCredentials && writing && kind !== "backup")
        throw new Error("Backup credentials cannot write evidence or restore.");
      const credentials = splitBackupCredentials && writing ? backupWriter : r2;
      if (
        !["evidence", "backup", "restore"].includes(kind) ||
        !credentials.accessKeyId ||
        !credentials.secretAccessKey ||
        key.includes("..")
      )
        throw new Error("Dedicated R2 credentials and safe object key are required.");
      const [object, query] = key.split("?");
      const url = `https://${config.cloudflareAccountId}.r2.cloudflarestorage.com/${config.workerName}-${kind}/${object.split("/").map(encodeURIComponent).join("/")}${query === undefined ? "" : `?${query}`}`;
      return awsSignedFetch(
        credentials,
        "auto",
        "s3",
        transport,
        now,
      )(url, { ...init, signal: AbortSignal.timeout(60000) });
    },
  };
}
export async function requireResponse(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Provider HTTP ${response.status}`);
  }
  return response;
}
