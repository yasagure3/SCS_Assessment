import { beforeAll, describe, expect, it } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "../../src/server/app";
import { DomainError } from "../../src/shared/errors";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import {
  verifyAccessToken,
  type AccessTokenClaims,
} from "../../src/server/modules/auth/domain/verifyAccessToken";

const issuer = "https://offline.invalid/test";
const clientId = "clock-test";
const timestamp = Date.UTC(2026, 8, 19, 9, 0, 0, 750);
const currentSecond = Math.floor(timestamp / 1000);
let privateKey: CryptoKey;
let getKey: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  getKey = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "clock-test", alg: "RS256" }],
  });
});

async function seedUser() {
  const id = crypto.randomUUID(),
    sub = crypto.randomUUID(),
    stamp = new Date(timestamp).toISOString();
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'staff','active',?,?)",
  )
    .bind(id, sub, `${id}@example.invalid`, stamp, stamp)
    .run();
  return { id, sub };
}

async function signToken(claims: AccessTokenClaims) {
  return new SignJWT({ ...claims, iss: issuer })
    .setProtectedHeader({ alg: "RS256", kid: "clock-test" })
    .sign(privateKey);
}

describe("session revocation across JWT clock tolerance", () => {
  it.each(
    [false, true].flatMap((providerFails) =>
      [-1, 0, 1, 5, 6].map((offset) => ({ providerFails, offset })),
    ),
  )(
    "enforces revocation for auth_time offset $offset with providerFails=$providerFails",
    async ({ providerFails, offset }) => {
      const user = await seedUser();
      let clock = timestamp;
      const options = { issuer, clientId, getKey, now: () => clock };
      const claims: AccessTokenClaims = {
        sub: user.sub,
        token_use: "access",
        client_id: clientId,
        iat: currentSecond + offset,
        auth_time: currentSecond + offset,
        exp: currentSecond + 600,
      };
      const token = await signToken(claims);
      const headers = { Authorization: `Bearer ${token}` };
      const duringProvider: number[] = [];
      const app = createApp({
        verify: async (value) => {
          try {
            return await verifyAccessToken(value, options);
          } catch {
            throw new DomainError("UNAUTHORIZED");
          }
        },
        access: (bindings) => new D1AccessRepository(bindings.DB, options.now),
        sessions: () => ({
          revoke: async () => {
            duringProvider.push((await app.request("/api/v1/me", { headers }, env)).status);
            if (providerFails) throw new Error("offline provider failure");
          },
        }),
      });

      const before = await app.request("/api/v1/me", { headers }, env);
      expect(before.status).toBe(offset <= 5 ? 200 : 401);
      const response = await app.request(
        "/api/v1/session/revoke",
        { method: "POST", headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } },
        env,
      );

      if (offset > 5) {
        expect(response.status).toBe(401);
        expect(duringProvider).toEqual([]);
        expect(
          await env.DB.prepare("SELECT count(*) AS n FROM auth_revocations WHERE user_id=?")
            .bind(user.id)
            .first(),
        ).toEqual({ n: 0 });
        expect(
          await env.DB.prepare("SELECT revoked_before FROM app_users WHERE id=?")
            .bind(user.id)
            .first(),
        ).toEqual({ revoked_before: null });
        return;
      }

      expect(response.status).toBe(200);
      expect((await response.json<{ data: { revokedAt: string } }>()).data).toEqual({
        revokedAt: new Date((currentSecond + 5) * 1000).toISOString(),
      });
      expect(duringProvider).toEqual([401]);
      expect(
        await env.DB.prepare(
          "SELECT revoked_before,status,error_code FROM auth_revocations WHERE user_id=?",
        )
          .bind(user.id)
          .first(),
      ).toEqual({
        revoked_before: currentSecond + 5,
        status: providerFails ? "failed" : "succeeded",
        error_code: providerFails ? "PROVIDER_FAILED" : null,
      });
      expect((await app.request("/api/v1/me", { headers }, env)).status).toBe(401);

      clock += 10_000;
      expect((await app.request("/api/v1/me", { headers }, env)).status).toBe(401);
      const refreshedClaims = { ...claims, iat: currentSecond + 10 };
      const refreshedToken = await signToken(refreshedClaims);
      expect(await verifyAccessToken(refreshedToken, options)).toEqual(refreshedClaims);
      expect(
        (
          await app.request(
            "/api/v1/me",
            { headers: { Authorization: `Bearer ${refreshedToken}` } },
            env,
          )
        ).status,
      ).toBe(401);

      // A new login at the cutoff remains blocked; one beyond it can authenticate.
      for (const [authTime, expectedStatus] of [
        [currentSecond + 5, 401],
        [currentSecond + 6, 200],
      ]) {
        const newToken = await signToken({ ...refreshedClaims, auth_time: authTime });
        expect(
          (
            await app.request(
              "/api/v1/me",
              { headers: { Authorization: `Bearer ${newToken}` } },
              env,
            )
          ).status,
        ).toBe(expectedStatus);
      }
    },
  );

  it("preserves a later existing cutoff when the application clock moves backwards", async () => {
    const user = await seedUser();
    const priorCutoff = currentSecond + 30;
    await env.DB.prepare("UPDATE app_users SET revoked_before=? WHERE id=?")
      .bind(priorCutoff, user.id)
      .run();
    const repository = new D1AccessRepository(env.DB, () => timestamp);
    const account = await repository.findBySubject(user.sub);
    expect(account).not.toBeNull();

    const result = await repository.revoke(account!, crypto.randomUUID(), "clock-regression");

    expect({ revokedAt: result.revokedAt }).toEqual({
      revokedAt: new Date(priorCutoff * 1000).toISOString(),
    });
    expect(
      await env.DB.prepare("SELECT revoked_before FROM app_users WHERE id=?").bind(user.id).first(),
    ).toEqual({ revoked_before: priorCutoff });
  });
});
