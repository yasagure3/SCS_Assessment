import { createBusinessApp } from "../../src/server/businessApp";
import { DomainError } from "../../src/shared/errors";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
// Only loaded by the local test configuration. Real production routes have no fixture endpoints.
const app = createBusinessApp({
  verify: async (token) => {
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
});
app.post("/__fixture/reset", async (c) => {
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
app.post("/__fixture/suspend", async (c) => {
  await c.env.DB.prepare(
    "UPDATE app_users SET status='suspended',revision=revision+1 WHERE cognito_sub='fixture-sub'",
  ).run();
  return c.json({ ok: true });
});
export default app;
