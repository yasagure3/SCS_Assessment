import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// Offline SQL preparation only. No AWS/D1 request and no invitation email is sent.
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, all) => (index % 2 === 0 ? [...pairs, [value, all[index + 1]]] : pairs),
      [],
    ),
);
const required = ["--pool", "--mfa", "--client", "--user", "--out"];
if (required.some((key) => !args[key]) || Object.keys(args).some((key) => !required.includes(key)))
  throw new Error(
    "Usage: vp exec node scripts/bootstrap-admin.mjs --pool pool.json --mfa mfa.json --client client.json --user invited-user.json --out .local/bootstrap-admin.sql",
  );
const read = async (key) => JSON.parse(await readFile(args[key], "utf8"));
const [poolResult, mfa, clientResult, userResult] = await Promise.all([
  read("--pool"),
  read("--mfa"),
  read("--client"),
  read("--user"),
]);
const pool = poolResult.UserPool,
  client = clientResult.UserPoolClient,
  user = userResult.User;
if (
  !pool?.Id ||
  pool.MfaConfiguration !== "ON" ||
  pool.AdminCreateUserConfig?.AllowAdminCreateUserOnly !== true ||
  mfa.MfaConfiguration !== "ON" ||
  mfa.SoftwareTokenMfaConfiguration?.Enabled !== true
)
  throw new Error("Require invite-only pool with mandatory TOTP MFA.");
const allowed = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"];
if (
  client?.UserPoolId !== pool.Id ||
  !client.ClientId ||
  client.ClientSecret ||
  !Array.isArray(client.ExplicitAuthFlows) ||
  !allowed.every((flow) => client.ExplicitAuthFlows.includes(flow)) ||
  client.ExplicitAuthFlows.some((flow) => !allowed.includes(flow))
)
  throw new Error("Require matching public SRP client with refresh-token authentication only.");
if (user?.Enabled !== true || user.UserStatus !== "FORCE_CHANGE_PASSWORD")
  throw new Error("Require the confirmed result of a newly issued administrator invitation.");
const attributes = Object.fromEntries(
  (user.Attributes ?? []).map((item) => [item.Name, item.Value]),
);
const sub = attributes.sub,
  email = attributes.email?.trim().toLowerCase();
if (
  typeof sub !== "string" ||
  !/^[0-9a-f-]{36}$/i.test(sub) ||
  !email ||
  email.length > 254 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
)
  throw new Error("Invitation must include a valid sub and email.");
const output = resolve(args["--out"]),
  privateRoot = resolve(".local");
if (!output.startsWith(privateRoot + sep) || !output.endsWith(".sql"))
  throw new Error("Write the prepared SQL to a .sql file inside this checkout's .local directory.");
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const id = randomUUID(),
  eventId = randomUUID(),
  now = new Date().toISOString();
const sql = `-- Prepared from checked Cognito configuration. Review before local or approved remote execution.
-- The public API never bootstraps administrators. Existing admins (including pending invitations) block this insert.
INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at)
SELECT ${literal(id)},${literal(sub)},${literal(email)},'admin','invited',${literal(now)},${literal(now)}
WHERE NOT EXISTS(SELECT 1 FROM app_users WHERE role='admin');
INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,request_id,created_at)
SELECT ${literal(eventId)},${literal(id)},'user.bootstrap','app_user',${literal(id)},${literal(eventId)},${literal(now)}
WHERE EXISTS(SELECT 1 FROM app_users WHERE id=${literal(id)}) AND NOT EXISTS(SELECT 1 FROM audit_events WHERE id=${literal(eventId)});
SELECT id,role,status FROM app_users WHERE id=${literal(id)};
`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, sql, { encoding: "utf8", flag: "wx" });
console.log(
  "Prepared administrator SQL in .local. No services were changed. Review the SQL and execute only against the approved target.",
);
