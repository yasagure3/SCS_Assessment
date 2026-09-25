import { beforeAll, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { cognitoAdmin } from "../../src/server/modules/auth/adapter/cognitoAdmin";
import { cognitoAdminTransport } from "../../src/server/modules/auth/adapter/cognitoAdminTransport";

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
const valid = {
  AWS_ACCOUNT_ID: "123456789012",
  AWS_REGION: "ap-northeast-1",
  AWS_ACCESS_KEY_ID: "synthetic-key",
  AWS_SECRET_ACCESS_KEY: "synthetic-secret",
  COGNITO_POOL_ID: "ap-northeast-1_Abcdef123",
};
it.each([
  ...Object.keys(valid).map(
    (field) => [field, { [field]: undefined }, 503, "SERVICE_UNAVAILABLE", 0] as const,
  ),
  ["account invalid", { AWS_ACCOUNT_ID: "invalid" }, 503, "SERVICE_UNAVAILABLE", 0],
  ["region mismatch", { AWS_REGION: "us-east-1" }, 503, "SERVICE_UNAVAILABLE", 0],
  ["pool mismatch", { COGNITO_POOL_ID: "ap-northeast-1_Other123" }, 503, "SERVICE_UNAVAILABLE", 0],
  ["provider failure", {}, 502, "PROVIDER_FAILED", 1],
] as const)(
  "classifies %s on initial invitation, retry and both replays without resending",
  async (_name, override, status, code, sent) => {
    const clock = Date.parse("2026-09-25T00:00:00Z"),
      actor = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'admin','active',?,?)",
    )
      .bind(
        actor,
        actor,
        `${actor}@example.invalid`,
        new Date(clock).toISOString(),
        new Date(clock).toISOString(),
      )
      .run();
    let calls = 0;
    const configuration = { ...valid, ...override };
    const app = createBusinessApp({
      verify: async (sub) => ({
        sub,
        client_id: "test",
        token_use: "access",
        iat: clock / 1000,
        auth_time: clock / 1000,
        exp: clock / 1000 + 600,
      }),
      access: (b) => new D1AccessRepository(b.DB, () => clock),
      sessions: () => ({ revoke: async () => {} }),
      administration: () =>
        cognitoAdmin({
          poolId: valid.COGNITO_POOL_ID,
          transport: cognitoAdminTransport(
            configuration,
            async () => {
              calls++;
              return Response.json({ __type: "InternalErrorException" }, { status: 500 });
            },
            () => new Date(clock),
          ),
        }),
      now: () => clock,
    });
    const email = `${crypto.randomUUID()}@example.invalid`,
      initialKey = crypto.randomUUID();
    const request = async (path: string, key: string, body: unknown) => {
      const response = await app.request(
        `/api/v1${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${actor}`,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(body),
        },
        env,
      );
      const result = await response.json<{ error: { code: string } }>();
      return { status: response.status, code: result.error.code };
    };
    const input = { email, role: "staff", customerIds: [] };
    expect(await request("/users/invitations", initialKey, input)).toEqual({ status, code });
    expect(await request("/users/invitations", initialKey, input)).toEqual({ status, code });
    expect(calls).toBe(sent);
    const invitation = await env.DB.prepare(
      "SELECT i.id,i.last_error_code AS error FROM invitations i JOIN app_users u ON u.id=i.user_id WHERE u.email_normalized=?",
    )
      .bind(email)
      .first<{ id: string; error: string }>();
    expect(invitation).toEqual({ id: expect.any(String), error: code });
    const path = `/users/invitations/${invitation!.id}/retry`,
      key = crypto.randomUUID();
    expect(await request(path, key, {})).toEqual({ status, code });
    expect(await request(path, key, {})).toEqual({ status, code });
    expect(calls).toBe(sent * 2);
  },
);
