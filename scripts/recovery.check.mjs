import { test } from "node:test";
import assert from "node:assert/strict";
import { retentionCandidates, validateManifest, restoreSql } from "./recovery.mjs";
import * as recovery from "./recovery.mjs";
test("retention dry-run includes only contracts past their three-year anniversary", () => {
  assert.deepEqual(
    retentionCandidates(
      [
        { customerId: "expired", endedOn: "2023-09-24" },
        { customerId: "today", endedOn: "2023-09-25" },
        { customerId: "future", endedOn: "2023-09-26" },
        { customerId: "leap", endedOn: "2024-02-29" },
      ],
      "2026-09-25",
    ),
    [
      { customerId: "expired", endedOn: "2023-09-24", deleteAfter: "2026-09-24" },
      { customerId: "today", endedOn: "2023-09-25", deleteAfter: "2026-09-25" },
    ],
  );
});
const manifest = {
  schemaVersion: 1,
  sourceWorker: "scs-assessment-trial-run",
  sourceDatabase: "12345678-1234-1234-1234-123456789abc",
  createdAt: "2026-09-25T00:00:00.000Z",
  database: { key: "snapshots/run/database.sql", sha256: "a".repeat(64), sizeBytes: 9 },
  files: [
    {
      id: "file",
      objectKey: "file-key",
      sha256: "b".repeat(64),
      sizeBytes: 9,
      key: "snapshots/run/evidence/file-key",
    },
  ],
};
test("restore rejects source overwrite, unsafe keys, incomplete manifests and invalid checksums", () => {
  assert.equal(
    validateManifest(manifest, "scs-assessment-trial-run", "22345678-1234-1234-1234-123456789abc"),
    manifest,
  );
  for (const bad of [
    { ...manifest, database: { ...manifest.database, sha256: "" } },
    { ...manifest, files: [{ ...manifest.files[0], objectKey: "../private" }] },
    { ...manifest, schemaVersion: 2 },
  ])
    assert.throws(() =>
      validateManifest(bad, "scs-assessment-trial-run", "22345678-1234-1234-1234-123456789abc"),
    );
  assert.throws(() =>
    validateManifest(manifest, "scs-assessment-trial-run", manifest.sourceDatabase),
  );
});
test("restored evidence never inherits scan attestations or active token validity", () => {
  assert.equal(
    restoreSql("SELECT 1;", 1234567890),
    "SELECT 1;\nUPDATE file_scans SET status='failed';\nUPDATE files SET status='uploading' WHERE status='ready';\nUPDATE app_users SET revoked_before=MAX(COALESCE(revoked_before,0),1234567890);\n",
  );
});
test("invalid calendar dates and cross-database backup substitutions are rejected", () => {
  assert.throws(() =>
    retentionCandidates([{ customerId: "x", endedOn: "2023-02-30" }], "2026-09-25"),
  );
  assert.throws(() =>
    validateManifest(
      manifest,
      manifest.sourceWorker,
      "22345678-1234-1234-1234-123456789abc",
      "32345678-1234-1234-1234-123456789abc",
    ),
  );
});
test("table checksums ignore row/key ordering but detect one changed value", () => {
  const rows = [
    { id: 1, text: "匿名" },
    { id: 2, text: "record" },
  ];
  assert.equal(
    recovery.hashRows(rows),
    recovery.hashRows([
      { text: "record", id: 2 },
      { text: "匿名", id: 1 },
    ]),
  );
  assert.notEqual(
    recovery.hashRows(rows),
    recovery.hashRows([
      { id: 1, text: "changed" },
      { id: 2, text: "record" },
    ]),
  );
});
