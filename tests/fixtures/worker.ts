import { createBusinessApp } from "../../src/server/businessApp";
import { DomainError } from "../../src/shared/errors";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { seedAssessment } from "./assessment";
import { FakeAiProvider } from "./ai";
// Only loaded by the local test configuration. Real production routes have no fixture endpoints.
const invitationDeliveries: { email: string; sub: string }[] = [];
const fakeAi = new FakeAiProvider();
const expiredTokens = new Set<string>();
const refreshedTokens = new Map<string, string>();
const app = createBusinessApp({
  ai: () => fakeAi,
  verify: async (token, bindings) => {
    if (expiredTokens.has(token)) throw new DomainError("UNAUTHORIZED");
    token = token.replace(/_REFRESH_\d+$/, "");
    const access = /^E2E_ACCESS_TOKEN_(.+)_(\d+)$/.exec(token);
    if (access) {
      const user = await bindings.DB.prepare(
        "SELECT cognito_sub AS sub FROM app_users WHERE email_normalized=?",
      )
        .bind(decodeURIComponent(access[1]))
        .first<{ sub: string | null }>();
      if (!user?.sub) throw new DomainError("UNAUTHORIZED");
      const authTime = Number(access[2]);
      return {
        sub: user.sub,
        client_id: "fixture-client",
        token_use: "access",
        auth_time: authTime,
        iat: authTime,
        exp: authTime + 3600,
      };
    }
    if (!/^E2E_ONLY_TOKEN_\d+$/.test(token)) throw new DomainError("UNAUTHORIZED");
    const authTime = Number(token.slice("E2E_ONLY_TOKEN_".length));
    return {
      sub: "fixture-sub",
      client_id: "fixture-client",
      token_use: "access",
      auth_time: authTime,
      iat: authTime,
      exp: authTime + 3600,
    };
  },
  access: (bindings) => new D1AccessRepository(bindings.DB),
  sessions: () => ({ revoke: async () => {} }),
  administration: () => ({
    provision: async (user) => `fixture-invited-${user.id}`,
    sendInvitation: async (user) => {
      invitationDeliveries.push({ email: user.email, sub: user.sub });
    },
  }),
});
app.post("/__fixture/access-reset", async (c) => {
  invitationDeliveries.length = 0;
  const id = crypto.randomUUID(),
    stamp = new Date().toISOString();
  if (c.req.query("paginateUsers") === "true") {
    // Keep a repeatable full first page without deleting identities or immutable receipts.
    await c.env.DB.batch(
      Array.from({ length: 50 }, (_, index) =>
        c.env.DB.prepare(
          "INSERT OR IGNORE INTO app_users(id,email_normalized,role,status,created_at,updated_at) VALUES(?,?,'staff','suspended',?,?)",
        ).bind(
          `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
          `access-pagination-${index + 1}@example.invalid`,
          stamp,
          stamp,
        ),
      ),
    );
  }
  await c.env.DB.prepare(
    "UPDATE app_users SET email_normalized=id||'@example.invalid',cognito_sub=NULL WHERE email_normalized='access-admin@example.invalid'",
  ).run();
  await c.env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,'access-admin@example.invalid','admin','active',?,?)",
  )
    .bind(id, `fixture-admin-${id}`, stamp, stamp)
    .run();
  const assigned = crypto.randomUUID(),
    unassigned = crypto.randomUUID();
  for (const [customerId, name] of [
    [assigned, `割当会社-${assigned}`],
    [unassigned, `非割当会社-${unassigned}`],
  ])
    await c.env.DB.prepare("INSERT INTO customers VALUES(?,?,NULL,1,?,?,?)")
      .bind(customerId, name, id, stamp, stamp)
      .run();
  return c.json({ assigned, unassigned });
});
app.get("/__fixture/invitation-deliveries", (c) => c.json(invitationDeliveries));
app.post("/__fixture/expire-session", async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  expiredTokens.add(token);
  return c.json({ expired: true });
});
app.post("/__fixture/refresh-session", async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  if (!expiredTokens.has(token)) return c.json({ token });
  if (!refreshedTokens.has(token))
    refreshedTokens.set(
      token,
      `${token.replace(/_REFRESH_\d+$/, "")}_REFRESH_${refreshedTokens.size + 1}`,
    );
  return c.json({ token: refreshedTokens.get(token) });
});
app.post("/__fixture/reset", async (c) => {
  expiredTokens.clear();
  refreshedTokens.clear();
  fakeAi.received = [];
  fakeAi.configured = true;
  const stamp = new Date().toISOString();
  // A new identity per run avoids reusing immutable activation receipts.
  await c.env.DB.prepare(
    "UPDATE app_users SET cognito_sub=NULL WHERE cognito_sub='fixture-sub'",
  ).run();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,'fixture-sub',?,'staff','invited',?,?)",
  )
    .bind(id, `${id}@example.invalid`, stamp, stamp)
    .run();
  return c.json({ ok: true });
});
app.get("/__fixture/ai-inputs", (c) => c.json(fakeAi.received));
app.post("/__fixture/ai-unconfigured", (c) => {
  fakeAi.configured = false;
  return c.json({ ok: true });
});
app.post("/__fixture/suspend", async (c) => {
  await c.env.DB.prepare(
    "UPDATE app_users SET status='suspended',revision=revision+1 WHERE cognito_sub='fixture-sub'",
  ).run();
  return c.json({ ok: true });
});
app.post("/__fixture/assessment/:id", async (c) => {
  const actor = await c.env.DB.prepare(
    "SELECT id FROM app_users WHERE cognito_sub='fixture-sub'",
  ).first<{ id: string }>();
  if (!actor) return c.json({ error: "fixture actor missing" }, 404);
  return c.json(await seedAssessment(c.env.DB, c.req.param("id"), actor.id));
});
export default app;
