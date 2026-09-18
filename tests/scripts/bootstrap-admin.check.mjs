import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const script = resolve("scripts/bootstrap-admin.mjs");
const migration = readFileSync("migrations/0001_foundation.sql", "utf8");
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "scs-bootstrap-check-"));
  mkdirSync(join(directory, ".local"));
  const data = {
    pool: {
      UserPool: {
        Id: "fixture-pool",
        MfaConfiguration: "ON",
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      },
    },
    mfa: { MfaConfiguration: "ON", SoftwareTokenMfaConfiguration: { Enabled: true } },
    client: {
      UserPoolClient: {
        UserPoolId: "fixture-pool",
        ClientId: "fixture-client",
        ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
      },
    },
    user: {
      User: {
        Enabled: true,
        UserStatus: "FORCE_CHANGE_PASSWORD",
        Attributes: [
          { Name: "sub", Value: "11111111-1111-4111-8111-111111111111" },
          { Name: "email", Value: "admin@example.invalid" },
        ],
      },
    },
  };
  return {
    directory,
    data,
    run(output = ".local/bootstrap.sql") {
      for (const [key, value] of Object.entries(data))
        writeFileSync(join(directory, `${key}.json`), JSON.stringify(value));
      return spawnSync(
        process.execPath,
        [
          script,
          ...Object.keys(data).flatMap((key) => [`--${key}`, `${key}.json`]),
          "--out",
          output,
        ],
        { cwd: directory, encoding: "utf8", windowsHide: true },
      );
    },
  };
}
test("prepared SQL is repeatable and cannot introduce a second initial administrator", () => {
  const f = fixture();
  assert.equal(f.run().status, 0);
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  const sql = readFileSync(join(f.directory, ".local/bootstrap.sql"), "utf8");
  db.exec(sql);
  db.exec(sql);
  assert.equal(db.prepare("SELECT count(*) AS n FROM app_users").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_events").get().n, 1);
  f.data.user.User.Attributes[0].Value = "22222222-2222-4222-8222-222222222222";
  f.data.user.User.Attributes[1].Value = "another@example.invalid";
  assert.equal(f.run(".local/second.sql").status, 0);
  db.exec(readFileSync(join(f.directory, ".local/second.sql"), "utf8"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM app_users").get().n, 1);
  db.close();
});
test("unprotected provider configuration and wrong-pool clients do not produce SQL", () => {
  const f = fixture();
  f.data.pool.UserPool.MfaConfiguration = "OFF";
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(join(f.directory, ".local/bootstrap.sql")), false);
  f.data.pool.UserPool.MfaConfiguration = "ON";
  f.data.client.UserPoolClient.UserPoolId = "wrong-pool";
  assert.notEqual(f.run().status, 0);
});
test("private output cannot be written outside .local or overwritten", () => {
  const f = fixture();
  assert.notEqual(f.run("public.sql").status, 0);
  assert.equal(existsSync(join(f.directory, "public.sql")), false);
  assert.equal(f.run().status, 0);
  assert.notEqual(f.run().status, 0);
});
