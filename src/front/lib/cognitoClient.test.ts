import { describe, it, expect, vi, afterEach } from "vite-plus/test";

describe("unconfigured authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("renders without Cognito configuration and cannot sign in", async () => {
    vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "");
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "");
    const client = await import("./cognitoClient");
    expect(client.userPool).toBeNull();
    expect(await client.getCurrentSession()).toBeNull();
    await expect(client.signIn("staff@example.com", "password")).rejects.toThrow(
      "認証サービスはまだ設定されていません。",
    );
  });
});
