import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backup, prepareRestore } from "./cloud-backup.mjs";
import { hashBytes, hashRows } from "./recovery.mjs";

function fixture(extraSql = "", extraObjects = []) {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/backup-check-"));
  const config = {
    workerName: "scs-assessment-trial-check",
    databaseId: "12345678-1234-1234-1234-123456789abc",
    restoreDatabaseId: "22345678-1234-1234-1234-123456789abc",
  };
  const evidence = Buffer.from("anonymous evidence"),
    objects = new Map([["evidence/file-key", evidence], ...extraObjects]);
  const sql =
    Buffer.from(`CREATE TABLE files(id TEXT,object_key TEXT,sha256 TEXT,size_bytes INTEGER,status TEXT);
INSERT INTO files VALUES('file','file-key','${hashBytes(evidence)}',${evidence.length},'ready');
CREATE TABLE file_scans(file_id TEXT,status TEXT); INSERT INTO file_scans VALUES('file','clean');
CREATE TABLE app_users(id TEXT,revoked_before INTEGER); INSERT INTO app_users VALUES('user',1);${extraSql}`);
  const io = {
    cf: async (path) =>
      path.endsWith("/export")
        ? { result: { signed_url: "https://export.r2.cloudflarestorage.com/dump" } }
        : {
            name: `${config.workerName}-${path.includes(config.restoreDatabaseId) ? "restore-db" : "db"}`,
            file_size: 4096,
          },
    query: async () => [{ results: [] }],
    r2: async (kind, key, init = {}) => {
      if (key.startsWith("?list-type"))
        return new Response(
          `<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects]
            .filter(([k]) => k.startsWith(`${kind}/`))
            .map(
              ([k, v]) =>
                `<Contents><Key>${k.slice(kind.length + 1)}</Key><Size>${v.length}</Size><LastModified>2026-09-25T00:00:00Z</LastModified></Contents>`,
            )
            .join("")}</ListBucketResult>`,
        );
      const full = `${kind}/${key}`;
      if (init.method === "PUT") {
        if (objects.has(full)) return new Response(null, { status: 412 });
        objects.set(full, Buffer.from(init.body));
        return new Response(null, { status: 200 });
      }
      return objects.has(full)
        ? new Response(objects.get(full))
        : new Response(null, { status: 404 });
    },
  };
  return { root, config, io, objects, sql, evidence };
}
test("backup binds a real SQLite export and evidence hashes, then prepares only an empty isolated restore", async () => {
  const f = fixture();
  const result = await backup(f.config, f.io, f.root, async () => new Response(f.sql));
  assert.equal(result.fileCount, 1);
  const path = resolve(f.root, ".local/backups", result.id, "manifest.json");
  assert.equal(hashBytes(readFileSync(path)), result.manifestSha256);
  const prepared = await prepareRestore(f.config, f.io, path, f.root);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(prepared.sqlFile, "utf8"));
    assert.deepEqual({ ...db.prepare("SELECT status FROM files").get() }, { status: "uploading" });
    assert.deepEqual(
      { ...db.prepare("SELECT status FROM file_scans").get() },
      { status: "failed" },
    );
    assert.equal(db.prepare("SELECT revoked_before FROM app_users").get().revoked_before > 1, true);
    for (const table of prepared.tableChecksums)
      assert.equal(hashRows(db.prepare(`SELECT * FROM "${table.name}"`).all()), table.sha256);
  } finally {
    db.close();
  }
  assert.deepEqual(f.objects.get("restore/file-key"), f.evidence);
  assert.equal(prepared.status, "prepared-not-restored");
  const occupied = {
    ...f.io,
    query: async () => [{ results: [{ name: "existing_customer_data" }] }],
  };
  await assert.rejects(() => prepareRestore(f.config, occupied, path, f.root), /must be empty/);
});
test("corrupted backup bytes fail before any restore object is written", async () => {
  const f = fixture();
  const result = await backup(f.config, f.io, f.root, async () => new Response(f.sql));
  const path = resolve(f.root, ".local/backups", result.id, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  f.objects.set(`backup/${manifest.database.key}`, Buffer.from("corrupted"));
  await assert.rejects(() => prepareRestore(f.config, f.io, path, f.root), /checksum mismatch/);
  assert.equal(f.objects.has("restore/file-key"), false);
});

test("retains rejected stored evidence and historical references while identifying never-stored rejected uploads", async () => {
  const bytes = Buffer.from("previously attached clean evidence");
  const f = fixture(
    `
INSERT INTO files VALUES('rejected','rejected-key','${hashBytes(bytes)}',${bytes.length},'ready');
INSERT INTO file_scans VALUES('rejected','clean');
CREATE TABLE reports(id TEXT, snapshot TEXT);
INSERT INTO reports VALUES('old-report','{"fileId":"rejected"}');
UPDATE files SET status='rejected' WHERE id='rejected';
UPDATE file_scans SET status='failed' WHERE file_id='rejected';
INSERT INTO files VALUES('never-stored','absent-key','${hashBytes(bytes)}',${bytes.length},'rejected');
INSERT INTO files VALUES('uploading','uploading-key','${hashBytes(bytes)}',${bytes.length},'uploading');
INSERT INTO files VALUES('zero-upload','zero-key','${hashBytes(bytes)}',0,'uploading');`,
    [
      ["evidence/rejected-key", bytes],
      ["evidence/uploading-key", bytes],
    ],
  );
  const result = await backup(f.config, f.io, f.root, async () => new Response(f.sql));
  const path = resolve(f.root, ".local/backups", result.id, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(
    manifest.files.map((file) => file.id),
    ["file", "rejected", "uploading"],
  );
  assert.deepEqual(manifest.omittedFiles, [
    { id: "never-stored", reason: "rejected-without-stored-object" },
    { id: "zero-upload", reason: "uploading-without-stored-object" },
  ]);
  const prepared = await prepareRestore(f.config, f.io, path, f.root);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(prepared.sqlFile, "utf8"));
    assert.deepEqual(
      { ...db.prepare("SELECT status FROM files WHERE id='rejected'").get() },
      { status: "rejected" },
    );
    assert.deepEqual(
      { ...db.prepare("SELECT snapshot FROM reports").get() },
      { snapshot: '{"fileId":"rejected"}' },
    );
    assert.deepEqual(
      { ...db.prepare("SELECT status FROM file_scans WHERE file_id='rejected'").get() },
      { status: "failed" },
    );
  } finally {
    db.close();
  }
  assert.deepEqual(f.objects.get("restore/rejected-key"), bytes);
  assert.deepEqual(f.objects.get("restore/uploading-key"), bytes);
});

for (const kind of ["evidence", "backup", "restore"])
  test(`dedicated backup refuses missing ${kind} List before writing any backup`, async () => {
    const f = fixture();
    const restricted = {
      ...f.io,
      r2: (bucket, key, init) =>
        bucket === kind && key.startsWith("?list-type")
          ? Promise.resolve(new Response(null, { status: 403 }))
          : f.io.r2(bucket, key, init),
    };
    await assert.rejects(
      () => backup(f.config, restricted, f.root, async () => new Response(f.sql)),
      /Provider HTTP 403/,
    );
    assert.deepEqual([...f.objects.keys()], ["evidence/file-key"]);
  });
test("dedicated backup uses only evidence Get/List, backup Get/Put/List and restore List", async () => {
  const f = fixture(),
    calls = [];
  const restricted = {
    ...f.io,
    r2: (kind, key, init = {}) => {
      const operation = key.startsWith("?list-type")
        ? "List"
        : init.method === "PUT"
          ? "Put"
          : "Get";
      calls.push(`${kind}:${operation}`);
      const allowed = [
        "evidence:List",
        "evidence:Get",
        "backup:List",
        "backup:Get",
        "backup:Put",
        "restore:List",
      ];
      return allowed.includes(`${kind}:${operation}`)
        ? f.io.r2(kind, key, init)
        : Promise.resolve(new Response(null, { status: 403 }));
    },
  };
  const result = await backup(f.config, restricted, f.root, async () => new Response(f.sql));
  assert.equal(result.fileCount, 1);
  assert.deepEqual(
    calls.sort((a, b) => a.localeCompare(b)),
    [
      "backup:List",
      "backup:Put",
      "backup:Put",
      "backup:Put",
      "evidence:Get",
      "evidence:List",
      "restore:List",
    ],
  );
});

test("rejected objects with mismatched stored bytes fail without publishing a manifest", async () => {
  const bytes = Buffer.from("expected bytes");
  const f = fixture(
    `INSERT INTO files VALUES('rejected','rejected-key','${hashBytes(bytes)}',${bytes.length},'rejected');`,
    [["evidence/rejected-key", Buffer.from("corrupt bytes")]],
  );
  await assert.rejects(
    () => backup(f.config, f.io, f.root, async () => new Response(f.sql)),
    /checksum/,
  );
  assert.equal([...f.objects.keys()].filter((key) => key.endsWith("manifest.json")).length, 0);
});
