export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (bytes: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", bytes));
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
async function hmac(key: Uint8Array, value: string) {
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      encoder.encode(value),
    ),
  );
}
// Only adapter-owned HTTPS URLs are supplied. Redirects never carry signed credentials elsewhere.
export function awsSignedFetch(
  credentials: AwsCredentials,
  region: string,
  service: string,
  transport: typeof fetch,
  now: () => Date,
) {
  return async (url: string, init: RequestInit = {}) => {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password)
      throw new Error("AWS_ENDPOINT_INVALID");
    const body = init.body
      ? new Uint8Array(await new Response(init.body).arrayBuffer())
      : new Uint8Array();
    const date = now()
        .toISOString()
        .replace(/[:-]|\.\d{3}/g, ""),
      day = date.slice(0, 8);
    const headers = new Headers(init.headers);
    headers.set("host", target.host);
    headers.set("x-amz-date", date);
    if (credentials.sessionToken) headers.set("x-amz-security-token", credentials.sessionToken);
    const payloadHash = await sha(body);
    if (service === "s3") headers.set("x-amz-content-sha256", payloadHash);
    const names = Array.from(headers.keys()).sort();
    const canonicalHeaders = names
      .map((name) => `${name}:${headers.get(name)!.trim().replace(/\s+/g, " ")}\n`)
      .join("");
    const query = Array.from(target.searchParams)
      .map(([k, v]) => [encode(k), encode(v)])
      .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const canonical = [
      init.method ?? "GET",
      target.pathname,
      query,
      canonicalHeaders,
      names.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${day}/${region}/${service}/aws4_request`;
    const key = await hmac(
      await hmac(
        await hmac(await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`), day), region),
        service,
      ),
      "aws4_request",
    );
    const signature = hex(
      (
        await hmac(
          key,
          `AWS4-HMAC-SHA256\n${date}\n${scope}\n${await sha(encoder.encode(canonical))}`,
        )
      ).buffer,
    );
    headers.set(
      "Authorization",
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    );
    const response = await transport(url, {
      ...init,
      headers,
      redirect: "manual",
      ...(body.length ? { body } : {}),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("AWS_REDIRECT_REFUSED");
    }
    return response;
  };
}
export type AwsConfiguration = {
  AWS_ACCOUNT_ID?: string;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
};
export function awsCredentials(config: AwsConfiguration): AwsCredentials {
  if (
    !/^\d{12}$/.test(config.AWS_ACCOUNT_ID ?? "") ||
    config.AWS_REGION !== "ap-northeast-1" ||
    !config.AWS_ACCESS_KEY_ID ||
    !config.AWS_SECRET_ACCESS_KEY
  )
    throw new Error("AWS_NOT_CONFIGURED");
  return {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    sessionToken: config.AWS_SESSION_TOKEN,
  };
}
