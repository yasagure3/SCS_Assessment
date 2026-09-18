import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import { createApp } from "../../src/server/app";
import productionApp from "../../src/server/index";
import { authorizeCustomer, requireAdmin } from "../../src/server/modules/auth/domain/authorize";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { resolvePrincipal } from "../../src/server/modules/auth/usecase/resolvePrincipal";
import { revokeSession } from "../../src/server/modules/auth/usecase/revokeSession";
import type { AccessTokenClaims } from "../../src/server/modules/auth/domain/verifyAccessToken";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const now = Math.floor(Date.now() / 1000);
const claims = (sub: string): AccessTokenClaims => ({
  sub,
  client_id: "test-client",
  token_use: "access",
  iat: now,
  auth_time: now - 5,
  exp: now + 600,
});
async function user(status = "active", role = "staff") {
  const id = crypto.randomUUID(),
    sub = crypto.randomUUID(),
    stamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(id, sub, `${id}@example.invalid`, role, status, stamp, stamp)
    .run();
  return { id, sub };
}
function appFor(sub: string) {
  return createApp({
    verify: async () => claims(sub),
    access: (bindings) => new D1AccessRepository(bindings.DB),
    sessions: () => ({ revoke: async () => {} }),
  });
}
const headers = { Authorization: "Bearer test-token" };
describe("invitation and current application authorization", () => {
  it("claims external revocation only once for concurrent duplicate operations", async () => {
    const u = await user(),
      repository = new D1AccessRepository(env.DB);
    const principal = await resolvePrincipal(claims(u.sub), repository, "test");
    const provider = { revoke: vi.fn().mockResolvedValue(undefined) },
      key = crypto.randomUUID();
    const results = await Promise.all([
      revokeSession(principal, "token", key, "one", repository, provider),
      revokeSession(principal, "token", key, "two", repository, provider),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(provider.revoke).toHaveBeenCalledTimes(1);
    expect(
      (
        await env.DB.prepare("SELECT status FROM auth_revocations WHERE user_id=?")
          .bind(u.id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("succeeded");
  });
  it("revokes existing tokens before contacting a failed external provider and preserves a retry record", async () => {
    const u = await user();
    const app = createApp({
      verify: async () => claims(u.sub),
      access: (bindings) => new D1AccessRepository(bindings.DB),
      sessions: () => ({
        revoke: async () => {
          throw new Error("provider unavailable");
        },
      }),
    });
    const response = await app.request(
      "/api/v1/session/revoke",
      { method: "POST", headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } },
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json<{ data: { revokedAt: string } }>()).data.revokedAt).toBeTruthy();
    expect((await app.request("/api/v1/me", { headers }, env)).status).toBe(401);
    expect(
      await env.DB.prepare("SELECT status,error_code FROM auth_revocations WHERE user_id=?")
        .bind(u.id)
        .first(),
    ).toEqual({ status: "failed", error_code: "PROVIDER_FAILED" });
    const events = await env.DB.prepare(
      "SELECT action FROM audit_events WHERE actor_id=? ORDER BY action",
    )
      .bind(u.id)
      .all<{ action: string }>();
    expect(events.results.map((e) => e.action)).toEqual([
      "session.revoke",
      "session.revoke.provider_claim",
      "session.revoke.provider_failed",
    ]);
  });
  it("rejects anonymous requests and fails closed when the provider is not configured", async () => {
    expect((await productionApp.request("/api/v1/me", {}, env)).status).toBe(401);
    const result = await productionApp.request(
      "/api/v1/me",
      { headers },
      { ...env, COGNITO_ISSUER: "", COGNITO_CLIENT_ID: "" },
    );
    expect(result.status).toBe(503);
    expect((await result.json<{ error: { code: string } }>()).error.code).toBe(
      "SERVICE_UNAVAILABLE",
    );
  });
  it("does not accept an uninvited subject, even with a verified token", async () => {
    expect((await appFor(crypto.randomUUID()).request("/api/v1/me", { headers }, env)).status).toBe(
      403,
    );
  });
  it("activates the subject-bound invitation exactly once with an audit event", async () => {
    const u = await user("invited"),
      app = appFor(u.sub);
    const results = await Promise.all([
      app.request("/api/v1/me", { headers }, env),
      app.request("/api/v1/me", { headers }, env),
    ]);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      const body = await result.json<{ data: { id: string; status: string }; requestId: string }>();
      expect(body.data).toMatchObject({ id: u.id, status: "active" });
      expect(body.data).not.toHaveProperty("sub");
      expect(body.requestId).toBeTruthy();
    }
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) AS n FROM audit_events WHERE resource_id=? AND action='user.activate'",
        )
          .bind(u.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (
        await env.DB.prepare("SELECT revision FROM app_users WHERE id=?")
          .bind(u.id)
          .first<{ revision: number }>()
      )?.revision,
    ).toBe(2);
  });
  it("does not activate an invitation which has no bound Cognito subject", async () => {
    const u = await user("invited");
    await env.DB.prepare("UPDATE app_users SET cognito_sub=NULL WHERE id=?").bind(u.id).run();
    expect((await appFor(u.sub).request("/api/v1/me", { headers }, env)).status).toBe(403);
  });
  it("rolls back activation and receipt if auditing fails", async () => {
    const u = await user("invited");
    await env.DB.exec(
      "CREATE TRIGGER auth_audit_failure BEFORE INSERT ON audit_events WHEN NEW.request_id='activation-failure' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
    );
    try {
      await expect(
        resolvePrincipal(claims(u.sub), new D1AccessRepository(env.DB), "activation-failure"),
      ).rejects.toThrow();
      expect(
        (
          await env.DB.prepare("SELECT status FROM app_users WHERE id=?")
            .bind(u.id)
            .first<{ status: string }>()
        )?.status,
      ).toBe("invited");
      expect(
        (
          await env.DB.prepare("SELECT count(*) AS n FROM operation_receipts WHERE actor_id=?")
            .bind(u.id)
            .first<{ n: number }>()
        )?.n,
      ).toBe(0);
    } finally {
      await env.DB.exec("DROP TRIGGER auth_audit_failure;");
    }
  });
  it("honors suspension, login revocation, and removed membership on the next request", async () => {
    const u = await user(),
      app = appFor(u.sub),
      customer = crypto.randomUUID(),
      stamp = new Date().toISOString();
    await env.DB.prepare("INSERT INTO customers VALUES(?,?,NULL,1,?,?,?)")
      .bind(customer, "匿名顧客", u.id, stamp, stamp)
      .run();
    await env.DB.prepare("INSERT INTO customer_memberships VALUES(?,?,?,?)")
      .bind(customer, u.id, u.id, stamp)
      .run();
    const repo = new D1AccessRepository(env.DB);
    const p = await resolvePrincipal(claims(u.sub), repo, "test");
    expect(() => authorizeCustomer(p, customer)).not.toThrow();
    expect(() => requireAdmin(p)).toThrow("FORBIDDEN");
    await env.DB.prepare("DELETE FROM customer_memberships WHERE user_id=?").bind(u.id).run();
    expect(() => authorizeCustomer(p, "other")).toThrow("NOT_FOUND");
    expect(() => authorizeCustomer({ ...p, customerIds: [] }, customer)).toThrow("NOT_FOUND");
    expect(
      (
        await (
          await app.request("/api/v1/me", { headers }, env)
        ).json<{ data: { customerIds: string[] } }>()
      ).data.customerIds,
    ).toEqual([]);
    await env.DB.prepare("UPDATE app_users SET revoked_before=? WHERE id=?").bind(now, u.id).run();
    expect((await app.request("/api/v1/me", { headers }, env)).status).toBe(401);
    await env.DB.prepare("UPDATE app_users SET revoked_before=NULL,status='suspended' WHERE id=?")
      .bind(u.id)
      .run();
    expect((await app.request("/api/v1/me", { headers }, env)).status).toBe(403);
  });
  it("loads current admin role and uses server generated request IDs", async () => {
    const u = await user("active", "admin"),
      app = appFor(u.sub);
    const result = await app.request(
      "/api/v1/me",
      { headers: { ...headers, "X-Request-ID": "untrusted-input" } },
      env,
    );
    const body = await result.json<{ data: { role: string }; requestId: string }>();
    expect(body.data.role).toBe("admin");
    expect(body.requestId).not.toBe("untrusted-input");
    const p = await resolvePrincipal(claims(u.sub), new D1AccessRepository(env.DB), "test");
    expect(() => authorizeCustomer(p, "any")).not.toThrow();
    expect(() => requireAdmin(p)).not.toThrow();
  });
});
