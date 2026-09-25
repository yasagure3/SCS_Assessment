import { createHash } from "node:crypto";
export function retentionCandidates(contracts, today) {
  const dateValid = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!dateValid(today)) throw new Error("A UTC date is required.");
  return contracts
    .map((row) => {
      if (!dateValid(row.endedOn)) throw new Error("Contract end is unconfirmed.");
      const date = new Date(`${row.endedOn}T00:00:00Z`),
        month = date.getUTCMonth();
      date.setUTCFullYear(date.getUTCFullYear() + 3);
      if (date.getUTCMonth() !== month) date.setUTCDate(0);
      return { ...row, deleteAfter: date.toISOString().slice(0, 10) };
    })
    .filter((row) => row.deleteAfter <= today);
}
export const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const hashRows = (rows) =>
  hashBytes(
    JSON.stringify(
      rows
        .map((row) =>
          JSON.stringify(
            Object.fromEntries(
              Object.keys(row)
                .sort()
                .map((key) => [key, row[key]]),
            ),
          ),
        )
        .sort(),
    ),
  );
export function validateManifest(manifest, worker, restoreDatabase, sourceDatabase) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.sourceWorker !== worker ||
    !/^scs-assessment-(trial|prod)-?[a-z0-9-]*$/.test(worker) ||
    manifest.sourceDatabase === restoreDatabase ||
    (sourceDatabase !== undefined && manifest.sourceDatabase !== sourceDatabase) ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Backup environment or manifest is invalid.");
  for (const entry of [manifest.database, ...manifest.files])
    if (
      !entry ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes <= 0 ||
      !/^snapshots\/[a-zA-Z0-9-]+\/(database\.sql|evidence\/[a-zA-Z0-9-]+)$/.test(entry.key)
    )
      throw new Error("Backup object manifest is invalid.");
  if (
    manifest.files.some(
      (file) => !/^[a-zA-Z0-9-]+$/.test(file.objectKey) || file.sizeBytes > 10485760,
    ) ||
    new Set(manifest.files.map((file) => file.objectKey)).size !== manifest.files.length
  )
    throw new Error("Evidence manifest is invalid.");
  if (
    manifest.database.sizeBytes > 1000000000 ||
    manifest.files.reduce((n, f) => n + f.sizeBytes, manifest.database.sizeBytes) > 2000000000
  )
    throw new Error("Approved recovery size exceeded.");
  return manifest;
}
export function restoreSql(sql, revokedBefore) {
  if (!Number.isSafeInteger(revokedBefore) || revokedBefore <= 0)
    throw new Error("A revocation boundary is required.");
  return `${sql}\nUPDATE file_scans SET status='failed';\nUPDATE files SET status='uploading' WHERE status='ready';\nUPDATE app_users SET revoked_before=MAX(COALESCE(revoked_before,0),${revokedBefore});\n`;
}
