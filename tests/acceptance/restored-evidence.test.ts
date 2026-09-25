/// <reference types="node" />
// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AssertionError } from "node:assert";
import { backup, prepareRestore } from "../../scripts/cloud-backup.mjs";
import { hashBytes, type BackupManifest } from "../../scripts/recovery.mjs";
import { restoredEvidenceAcceptance } from "../live/restoredEvidence";

const orders = [
  ["ready", "uploading", "rejected"],
  ["ready", "rejected", "uploading"],
  ["uploading", "ready", "rejected"],
  ["uploading", "rejected", "ready"],
  ["rejected", "ready", "uploading"],
  ["rejected", "uploading", "ready"],
] as const;
const config = {
  workerName: "scs-assessment-trial-recovery",
  databaseId: "12345678-1234-4234-8234-123456789abc",
  restoreDatabaseId: "22345678-1234-4234-8234-123456789abc",
};

// Real backup/restore SQL and SQLite, with only remote provider HTTP replaced.
// The rejected bytes are synthetic: this does not attest to a real malware scan.
async function fixture(order: readonly string[]) {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/recovery-evidence-"));
  const files = order.map((status, index) => {
    const bytes = Buffer.from(`anonymous ${status} fixture`);
    return {
      id: `${index + 1}0000000-0000-4000-8000-000000000000`,
      objectKey: `object-${status}`,
      bytes,
      sha256: hashBytes(bytes),
      sizeBytes: bytes.length,
      status,
    };
  });
  const clean = files.find((file) => file.status === "ready")!,
    blocked = files.find((file) => file.status === "rejected")!;
  const identity = {
    schemaVersion: 1,
    sourceWorker: config.workerName,
    sourceDatabase: config.databaseId,
    clean: { fileId: clean.id, sha256: clean.sha256, sizeBytes: clean.sizeBytes },
    blocked: { fileId: blocked.id, sha256: blocked.sha256, sizeBytes: blocked.sizeBytes },
  };
  const sql = `CREATE TABLE files(id TEXT PRIMARY KEY,object_key TEXT,sha256 TEXT,size_bytes INTEGER,status TEXT);
CREATE TABLE file_scans(file_id TEXT,status TEXT);
CREATE TABLE app_users(id TEXT,revoked_before INTEGER);
${files.map((file) => `INSERT INTO files VALUES('${file.id}','${file.objectKey}','${file.sha256}',${file.sizeBytes},'${file.status}'); INSERT INTO file_scans VALUES('${file.id}','${file.status === "ready" ? "clean" : file.status === "rejected" ? "blocked" : "pending"}');`).join("\n")}`;
  const objects = new Map(files.map((file) => [`evidence/${file.objectKey}`, file.bytes]));
  const io = {
    cf: async (path: string) =>
      path.endsWith("/export")
        ? { result: { signed_url: "https://export.r2.cloudflarestorage.com/dump" } }
        : {
            name: `${config.workerName}-${path.includes(config.restoreDatabaseId) ? "restore-db" : "db"}`,
            file_size: 4096,
          },
    query: async () => [{ results: [] }],
    r2: async (kind: string, key: string, init: RequestInit = {}) => {
      if (key.startsWith("?list-type"))
        return new Response(
          `<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects]
            .filter(([k]) => k.startsWith(`${kind}/`))
            .map(
              ([k, bytes]) =>
                `<Contents><Key>${k.slice(kind.length + 1)}</Key><Size>${bytes.length}</Size><LastModified>2026-09-25T00:00:00Z</LastModified></Contents>`,
            )
            .join("")}</ListBucketResult>`,
        );
      const full = `${kind}/${key}`;
      if (init.method === "PUT") {
        if (objects.has(full)) return new Response(null, { status: 412 });
        objects.set(full, Buffer.from(init.body as Uint8Array));
        return new Response(null);
      }
      return objects.has(full)
        ? new Response(new Uint8Array(objects.get(full)!))
        : new Response(null, { status: 404 });
    },
  };
  const saved = await backup(config, io, root, async () => new Response(sql));
  const manifestPath = resolve(root, ".local/backups", saved.id, "manifest.json");
  const manifest: BackupManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const prepared = await prepareRestore(config, io, manifestPath, root);
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(prepared.sqlFile, "utf8"));
  const calls: string[] = [];
  const api = async (path: string, body?: unknown) => {
    calls.push(`${body === undefined ? "GET" : "POST"} ${path}`);
    const [, , id, action] = path.split("/");
    const file = db.prepare("SELECT * FROM files WHERE id=?").get(id);
    if (!file) return new Response(null, { status: 404 });
    if (action === "rescan") {
      // Provider verdict depends on the original fixture identity, never its order.
      db.prepare("UPDATE files SET status=? WHERE id=?").run(
        id === clean.id ? "ready" : "rejected",
        id,
      );
      return Response.json({ data: { fileId: id, status: "uploading" } }, { status: 202 });
    }
    if (action === "content")
      return file.status === "ready"
        ? new Response(new Uint8Array(objects.get(`restore/${String(file.object_key)}`)!))
        : new Response(null, { status: 409 });
    return Response.json({
      data: { id, status: file.status, sha256: file.sha256, sizeBytes: file.size_bytes },
    });
  };
  const pollReady = async (readStatus: () => Promise<string>) => {
    expect(await readStatus()).toBe("ready");
  };
  return { manifest, identity, api, pollReady, calls, db, objects, files, clean, blocked };
}

it.each(orders)(
  "restores %s/%s/%s without selecting pending or rejected bytes as the clean evidence",
  async (...order) => {
    const f = await fixture(order);
    try {
      expect(f.manifest.files.map((file) => file.id)).toEqual(f.files.map((file) => file.id));
      expect(f.files.map((file) => f.objects.get(`restore/${file.objectKey}`))).toEqual(
        f.files.map((file) => file.bytes),
      );
      expect(f.db.prepare("SELECT id,status FROM files ORDER BY id").all()).toEqual(
        f.files.map((file) => ({
          id: file.id,
          status: file.status === "ready" ? "uploading" : file.status,
        })),
      );
      const result = await restoredEvidenceAcceptance(f.manifest, f.identity, f.api, f.pollReady);
      expect(result).toEqual({
        cleanFileId: f.clean.id,
        cleanSha256: f.clean.sha256,
        blockedFileId: f.blocked.id,
        blockedSha256: f.blocked.sha256,
        blockedDownloadDenied: true,
      });
      expect(f.calls).toEqual([
        `GET /files/${f.blocked.id}`,
        `GET /files/${f.blocked.id}/content`,
        `GET /files/${f.clean.id}`,
        `GET /files/${f.clean.id}/content`,
        `POST /files/${f.clean.id}/rescan`,
        `GET /files/${f.clean.id}`,
        `GET /files/${f.clean.id}/content`,
        `GET /files/${f.blocked.id}`,
        `GET /files/${f.blocked.id}/content`,
      ]);
    } finally {
      f.db.close();
    }
  },
);

it.each([
  "wrong worker",
  "wrong database",
  "new preparation ID after backup",
  "clean hash mismatch",
  "blocked hash mismatch",
  "size mismatch",
  "missing blocked evidence",
  "duplicate clean ID",
] as const)("rejects %s before any restored-file API request", async (scenario) => {
  const f = await fixture(orders[0]);
  try {
    const identity = structuredClone(f.identity),
      manifest = structuredClone(f.manifest);
    let message = "Prepared clean evidence is missing, ambiguous or changed in the backup.";
    if (scenario === "wrong worker" || scenario === "wrong database") {
      if (scenario === "wrong worker") identity.sourceWorker = "scs-assessment-trial-other";
      else identity.sourceDatabase = config.restoreDatabaseId;
      message = "Recovery evidence identities do not match the backup environment.";
    } else if (scenario === "new preparation ID after backup") {
      identity.clean.fileId = "40000000-0000-4000-8000-000000000000";
    } else if (scenario === "clean hash mismatch") identity.clean.sha256 = "a".repeat(64);
    else if (scenario === "blocked hash mismatch") {
      identity.blocked.sha256 = "b".repeat(64);
      message = "Prepared blocked evidence is missing, ambiguous or changed in the backup.";
    } else if (scenario === "size mismatch") identity.clean.sizeBytes++;
    else if (scenario === "missing blocked evidence") {
      manifest.files = manifest.files.filter((file) => file.id !== identity.blocked.fileId);
      message = "Prepared blocked evidence is missing, ambiguous or changed in the backup.";
    } else manifest.files.push({ ...manifest.files[0] });
    await expect(
      restoredEvidenceAcceptance(manifest, identity, f.api, f.pollReady),
    ).rejects.toEqual(new Error(message));
    expect(f.calls).toEqual([]);
  } finally {
    f.db.close();
  }
});

it.each([1, 2])(
  "fails recovery if the blocked download leaks on denial check %s",
  async (leakAt) => {
    const f = await fixture(orders[4]);
    let blockedDownloads = 0;
    try {
      const leakingApi = async (path: string, body?: unknown) => {
        const response = await f.api(path, body);
        if (path === `/files/${f.blocked.id}/content` && ++blockedDownloads === leakAt)
          return new Response(new Uint8Array(f.blocked.bytes));
        return response;
      };
      await expect(
        restoredEvidenceAcceptance(f.manifest, f.identity, leakingApi, f.pollReady),
      ).rejects.toBeInstanceOf(AssertionError);
      expect(blockedDownloads).toBe(leakAt);
      expect(f.calls.filter((call) => call.startsWith("POST "))).toEqual(
        leakAt === 1 ? [] : [`POST /files/${f.clean.id}/rescan`],
      );
    } finally {
      f.db.close();
    }
  },
);

it("fails recovery when the clean reinspection download has different bytes", async () => {
  const f = await fixture(orders[0]);
  let cleanDownloads = 0;
  try {
    const corruptedApi = async (path: string, body?: unknown) => {
      const response = await f.api(path, body);
      if (path === `/files/${f.clean.id}/content` && ++cleanDownloads === 2)
        return new Response("corrupted recovery bytes");
      return response;
    };
    await expect(
      restoredEvidenceAcceptance(f.manifest, f.identity, corruptedApi, f.pollReady),
    ).rejects.toBeInstanceOf(AssertionError);
    expect(cleanDownloads).toBe(2);
    expect(f.calls.filter((call) => call.startsWith("POST "))).toEqual([
      `POST /files/${f.clean.id}/rescan`,
    ]);
  } finally {
    f.db.close();
  }
});
