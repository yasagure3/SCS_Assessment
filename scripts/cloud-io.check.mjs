import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudIo } from "./cloud-io.mjs";
test("daily backup signs read/list with reader and all backup write phases with backup-only writer", async () => {
  const config = {
    purpose: "anonymous-trial",
    offlineOnly: false,
    workerName: "scs-assessment-trial-check",
    cloudflareAccountId: "abcdefabcdefabcdefabcdefabcdefab",
  };
  const calls = [];
  const env = {
    SCS_LIVE_ALLOW: config.workerName,
    SCS_CF_API_TOKEN: "synthetic",
    SCS_R2_ACCESS_KEY_ID: "reader",
    SCS_R2_SECRET_ACCESS_KEY: "read-secret",
    SCS_R2_BACKUP_WRITE_ACCESS_KEY_ID: "writer",
    SCS_R2_BACKUP_WRITE_SECRET_ACCESS_KEY: "write-secret",
  };
  const io = cloudIo(config, env, async (url, init) => {
    calls.push({
      path: new URL(url).pathname,
      method: init.method ?? "GET",
      key: new Headers(init.headers).get("Authorization").match(/Credential=([^/]+)/)[1],
    });
    return new Response("ok");
  });
  for (const kind of ["evidence", "backup", "restore"]) await io.r2(kind, "?list-type=2");
  await io.r2("evidence", "object");
  for (const method of ["PUT", "POST", "DELETE"]) await io.r2("backup", "object", { method });
  assert.deepEqual(
    calls.map(({ method, key }) => ({ method, key })),
    [
      ...Array.from({ length: 4 }, () => ({ method: "GET", key: "reader" })),
      ...["PUT", "POST", "DELETE"].map((method) => ({ method, key: "writer" })),
    ],
  );
  for (const kind of ["evidence", "restore"])
    await assert.rejects(
      () => io.r2(kind, "object", { method: "PUT" }),
      /Backup credentials cannot write/,
    );
  assert.equal(calls.length, 7);
});
