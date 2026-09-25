import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readCloudInput } from "./cloud-config.mjs";
import { cloudIo, requireResponse } from "./cloud-io.mjs";
import {
  hashBytes,
  hashRows,
  validateManifest,
  restoreSql,
  retentionCandidates,
} from "./recovery.mjs";

export async function objectInventory(io, kind) {
  const objects = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const xml = await (
      await requireResponse(
        await io.r2(
          kind,
          `?list-type=2&max-keys=1000${cursor ? `&continuation-token=${encodeURIComponent(cursor)}` : ""}`,
        ),
      )
    ).text();
    const decode = (s) =>
      s
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'");
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = match[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1],
        size = Number(match[1].match(/<Size>(\d+)<\/Size>/)?.[1]),
        modified = match[1].match(/<LastModified>([^<]+)<\/LastModified>/)?.[1];
      if (!key || !Number.isSafeInteger(size) || !Number.isFinite(Date.parse(modified)))
        throw new Error("Invalid R2 inventory.");
      objects.push({ key: decode(key), size, modified });
    }
    if (xml.includes("<IsTruncated>false</IsTruncated>")) return objects;
    cursor = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!cursor) throw new Error("Incomplete R2 inventory.");
    cursor = decode(cursor);
  }
  throw new Error("R2 inventory exceeded the bounded trial scope.");
}

async function boundedBytes(response, limit) {
  await requireResponse(response);
  if (!response.body) throw new Error("Provider body missing.");
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) throw new Error("Approved transfer limit exceeded.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}
async function saveObject(io, kind, key, bytes) {
  // D1 export can exceed the single-request memory limit of the deployed Worker;
  // this operator process uses multipart uploads with bounded 8 MiB parts.
  if (bytes.length <= 10 * 1024 * 1024) {
    await requireResponse(
      await io.r2(kind, key, { method: "PUT", headers: { "If-None-Match": "*" }, body: bytes }),
    );
    return;
  }
  const start = await (
    await requireResponse(await io.r2(kind, `${key}?uploads=`, { method: "POST" }))
  ).text();
  const uploadId = start.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!uploadId) throw new Error("Multipart upload missing.");
  const parts = [];
  try {
    for (let offset = 0; offset < bytes.length; offset += 8 * 1024 * 1024) {
      const number = parts.length + 1;
      const result = await requireResponse(
        await io.r2(kind, `${key}?partNumber=${number}&uploadId=${encodeURIComponent(uploadId)}`, {
          method: "PUT",
          body: bytes.subarray(offset, offset + 8 * 1024 * 1024),
        }),
      );
      const etag = result.headers.get("etag");
      if (!etag) throw new Error("Multipart checksum missing.");
      parts.push(
        `<Part><PartNumber>${number}</PartNumber><ETag>${etag.replaceAll('"', "&quot;")}</ETag></Part>`,
      );
    }
    await requireResponse(
      await io.r2(kind, `${key}?uploadId=${encodeURIComponent(uploadId)}`, {
        method: "POST",
        body: `<CompleteMultipartUpload>${parts.join("")}</CompleteMultipartUpload>`,
      }),
    );
  } catch (error) {
    await io.r2(kind, `${key}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" });
    throw error;
  }
}
export async function backup(
  config,
  io,
  root,
  transport = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const startedAt = new Date().toISOString(),
    id = crypto.randomUUID(),
    prefix = `snapshots/${id}`;
  const dbInfo = await io.cf(`d1/database/${config.databaseId}`);
  if (dbInfo.name !== `${config.workerName}-db` || dbInfo.file_size > 1000000000)
    throw new Error("D1 identity or size exceeds approval.");
  let exported = await io.cf(`d1/database/${config.databaseId}/export`, {
    method: "POST",
    body: JSON.stringify({ output_format: "polling" }),
  });
  for (let attempt = 0; !exported.result?.signed_url && attempt < 120; attempt++) {
    if (!exported.at_bookmark || exported.error) throw new Error("D1 export failed.");
    await wait(2000);
    exported = await io.cf(`d1/database/${config.databaseId}/export`, {
      method: "POST",
      body: JSON.stringify({ output_format: "polling", current_bookmark: exported.at_bookmark }),
    });
  }
  const url = new URL(exported.result?.signed_url ?? "");
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname.endsWith(".r2.cloudflarestorage.com") ||
      url.hostname.endsWith(".r2.cloudflarestorage.com.cn")
    )
  )
    throw new Error("Unexpected D1 export download origin.");
  const sql = await boundedBytes(
    await transport(url, { redirect: "error", signal: AbortSignal.timeout(300000) }),
    1000000000,
  );
  const inventories = await Promise.all(
    ["evidence", "backup", "restore"].map((kind) => objectInventory(io, kind)),
  );
  const storedBytes = inventories.flat().reduce((n, object) => n + object.size, 0);
  const directory = resolve(root, ".local/backups", id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "database.sql"), sql, { flag: "wx" });
  const local = new DatabaseSync(resolve(directory, "inspection.sqlite"));
  let files;
  try {
    local.exec(sql.toString("utf8"));
    files = local
      .prepare(
        "SELECT id,object_key AS objectKey,sha256,size_bytes AS sizeBytes,status FROM files ORDER BY id",
      )
      .all();
  } finally {
    local.close();
  }
  // Distribution status is not retention status. A failed reinspection leaves
  // authoritative bytes and old report references intact and must be backed up.
  const storedKeys = new Set(inventories[0].map((object) => object.key));
  const omittedFiles = [];
  files = files.filter((file) => {
    if (storedKeys.has(file.objectKey)) return true;
    if (file.status === "rejected" || (file.status === "uploading" && file.sizeBytes === 0)) {
      omittedFiles.push({ id: file.id, reason: `${file.status}-without-stored-object` });
      return false;
    }
    throw new Error("Retained evidence object missing.");
  });
  let total = sql.length;
  const plannedBytes = sql.length + files.reduce((n, file) => n + file.sizeBytes, 0) + 65536;
  if (storedBytes + plannedBytes > 2000000000)
    throw new Error("Cumulative evidence, backup and restore storage would exceed 2 GB.");
  const manifest = {
    schemaVersion: 1,
    sourceWorker: config.workerName,
    sourceDatabase: config.databaseId,
    createdAt: startedAt,
    database: { key: `${prefix}/database.sql`, sha256: hashBytes(sql), sizeBytes: sql.length },
    files: [],
    omittedFiles,
  };
  for (const file of files) {
    const bytes = await boundedBytes(await io.r2("evidence", file.objectKey), 10485760);
    total += bytes.length;
    if (total > 2000000000 || bytes.length !== file.sizeBytes || hashBytes(bytes) !== file.sha256)
      throw new Error("Evidence backup checksum or total-size mismatch.");
    const key = `${prefix}/evidence/${file.objectKey}`;
    await saveObject(io, "backup", key, bytes);
    const { status: _status, ...entry } = file;
    manifest.files.push({ ...entry, key });
  }
  await saveObject(io, "backup", manifest.database.key, sql);
  validateManifest(manifest, config.workerName, config.restoreDatabaseId);
  const serialized = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await saveObject(io, "backup", `${prefix}/manifest.json`, serialized);
  writeFileSync(resolve(directory, "manifest.json"), serialized, { flag: "wx" });
  return {
    id,
    createdAt: startedAt,
    finishedAt: new Date().toISOString(),
    manifestSha256: hashBytes(serialized),
    fileCount: files.length,
    totalBytes: total,
  };
}
export async function prepareRestore(config, io, manifestPath, root) {
  const startedAt = new Date().toISOString();
  const manifest = validateManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    config.workerName,
    config.restoreDatabaseId,
    config.databaseId,
  );
  const target = await io.cf(`d1/database/${config.restoreDatabaseId}`);
  if (target.name !== `${config.workerName}-restore-db`)
    throw new Error("Restore target mismatch.");
  const tables = await io.query(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'",
    [],
    config.restoreDatabaseId,
  );
  if (tables[0].results.length)
    throw new Error("Restore target must be empty; never overwrite it.");
  const storedBytes = (
    await Promise.all(["evidence", "backup", "restore"].map((kind) => objectInventory(io, kind)))
  )
    .flat()
    .reduce((n, object) => n + object.size, 0);
  if (storedBytes + manifest.files.reduce((n, file) => n + file.sizeBytes, 0) > 2000000000)
    throw new Error("Restore would exceed cumulative storage approval.");
  const sql = await boundedBytes(await io.r2("backup", manifest.database.key), 1000000000);
  if (sql.length !== manifest.database.sizeBytes || hashBytes(sql) !== manifest.database.sha256)
    throw new Error("Database backup checksum mismatch.");
  for (const file of manifest.files) {
    const bytes = await boundedBytes(await io.r2("backup", file.key), 10485760);
    if (bytes.length !== file.sizeBytes || hashBytes(bytes) !== file.sha256)
      throw new Error("Evidence backup checksum mismatch.");
    await requireResponse(
      await io.r2("restore", file.objectKey, {
        method: "PUT",
        headers: { "If-None-Match": "*", "x-amz-meta-sha256": file.sha256 },
        body: bytes,
      }),
    );
  }
  const directory = resolve(root, ".local/restore", crypto.randomUUID());
  mkdirSync(directory, { recursive: true });
  const recoverySql = restoreSql(sql.toString("utf8"), Math.floor(Date.now() / 1000) + 5);
  const expected = new DatabaseSync(":memory:");
  let tableChecksums;
  try {
    expected.exec(recoverySql);
    tableChecksums = expected
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unexpected backup table.");
        const rows = expected.prepare(`SELECT * FROM "${name}"`).all();
        return { name, rows: rows.length, sha256: hashRows(rows) };
      });
  } finally {
    expected.close();
  }
  writeFileSync(resolve(directory, "restore.sql"), recoverySql, { flag: "wx" });
  const report = {
    startedAt,
    preparedAt: new Date().toISOString(),
    backupCreatedAt: manifest.createdAt,
    databaseId: config.restoreDatabaseId,
    sqlFile: resolve(directory, "restore.sql"),
    status: "prepared-not-restored",
    tableChecksums,
    restoreSqlSha256: hashBytes(recoverySql),
  };
  writeFileSync(resolve(directory, "measurement.json"), JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, input, manifest] = process.argv.slice(2),
    root = process.cwd(),
    config = readCloudInput(input, root),
    io = cloudIo(config, process.env);
  if (mode === "backup") console.log(JSON.stringify(await backup(config, io, root)));
  else if (mode === "prepare-restore" && manifest)
    console.log(JSON.stringify(await prepareRestore(config, io, manifest, root)));
  else if (mode === "retention-dry-run") {
    const rows = await io.query(
      "SELECT customer_id AS customerId,ended_on AS endedOn FROM customer_contracts ORDER BY customer_id",
    );
    const candidates = retentionCandidates(rows[0].results, new Date().toISOString().slice(0, 10));
    for (const candidate of candidates) {
      candidate.files = (
        await io.query(
          "SELECT id,object_key AS objectKey,sha256,size_bytes AS sizeBytes FROM files WHERE customer_id=? ORDER BY id",
          [candidate.customerId],
        )
      )[0].results;
      candidate.assessments = (
        await io.query(
          "SELECT a.id FROM assessments a JOIN cases c ON c.id=a.case_id WHERE c.customer_id=? ORDER BY a.id",
          [candidate.customerId],
        )
      )[0].results;
    }
    const expiredBackupObjects = (await objectInventory(io, "backup")).filter(
      (object) => Date.now() - Date.parse(object.modified) >= 30 * 86400000,
    );
    console.log(
      JSON.stringify({
        mode: "dry-run",
        at: new Date().toISOString(),
        worker: config.workerName,
        databaseId: config.databaseId,
        candidates,
        expiredBackupObjects,
        planHash: hashBytes(JSON.stringify({ candidates, expiredBackupObjects })),
        deleted: 0,
      }),
    );
  } else
    throw new Error(
      "Usage: cloud-backup.mjs backup|prepare-restore|retention-dry-run .local/cloud-input.json [manifest.json]",
    );
}
