import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { cognitoAdmin } from "../../src/server/modules/auth/adapter/cognitoAdmin";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
describe("invitation provider error contracts", () => {
  it.each([
    ["unconfigured", 503, "SERVICE_UNAVAILABLE"],
    ["failure", 502, "PROVIDER_FAILED"],
    ["timeout", 504, "PROVIDER_TIMEOUT"],
  ] as const)(
    "preserves %s status for initial issue, explicit retry and same-key replays",
    async (mode, status, code) => {
      const actor = crypto.randomUUID(),
        clock = Date.parse("2026-09-19T10:00:00.000Z"),
        stamp = new Date(clock).toISOString();
      await env.DB.prepare(
        "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'admin','active',?,?)",
      )
        .bind(actor, actor, `${actor}@example.invalid`, stamp, stamp)
        .run();
      let calls = 0;
      const provider =
        mode === "unconfigured"
          ? cognitoAdmin()
          : cognitoAdmin({
              poolId: "ap-northeast-1_test",
              transport: async () => {
                calls++;
                if (mode === "failure") throw new Error("ServiceFailure");
                return new Promise(() => {});
              },
            });
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
        administration: () => provider,
        now: () => clock,
      });
      async function request(path: string, key: string, body: unknown) {
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
        const result = await response.json<{
          error: { code: string; message: string };
          requestId: string;
        }>();
        return { status: response.status, code: result.error.code };
      }
      const initialKey = crypto.randomUUID(),
        input = { email: `${crypto.randomUUID()}@example.invalid`, role: "staff", customerIds: [] };
      expect(await request("/users/invitations", initialKey, input)).toEqual({ status, code });
      expect(await request("/users/invitations", initialKey, input)).toEqual({ status, code });
      const invitation = await env.DB.prepare(
        "SELECT id,status,last_error_code AS errorCode FROM invitations WHERE created_by=?",
      )
        .bind(actor)
        .first<{ id: string; status: string; errorCode: string }>();
      expect(invitation).toEqual({ id: expect.any(String), status: "failed", errorCode: code });
      const retryKey = crypto.randomUUID(),
        path = `/users/invitations/${invitation!.id}/retry`;
      expect(await request(path, retryKey, {})).toEqual({ status, code });
      expect(await request(path, retryKey, {})).toEqual({ status, code });
      expect(calls).toBe(mode === "unconfigured" ? 0 : 2);
      expect(
        await env.DB.prepare(
          "SELECT status,last_error_code AS errorCode FROM invitations WHERE id=?",
        )
          .bind(invitation!.id)
          .first(),
      ).toEqual({ status: "failed", errorCode: code });
    },
    20000,
  );
});
