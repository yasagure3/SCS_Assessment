import assert from "node:assert/strict";
import { hashBytes, type BackupManifest } from "../../scripts/recovery.mjs";
import { z } from "zod";

const fileIdentity = z.object({
  fileId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(10485760),
});
export const recoveryEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  sourceWorker: z.string(),
  sourceDatabase: z.uuid(),
  clean: fileIdentity,
  blocked: fileIdentity,
});

// Preparation produces this identity record before backup. A later full-suite
// run may upload new files, so selection must use the explicitly saved record.
export async function restoredEvidenceAcceptance(
  manifest: BackupManifest,
  identity: unknown,
  api: (path: string, body?: unknown) => Promise<Response>,
  pollReady: (readStatus: () => Promise<string>) => Promise<void>,
) {
  const prepared = recoveryEvidenceSchema.parse(identity);
  if (
    prepared.sourceWorker !== manifest.sourceWorker ||
    prepared.sourceDatabase !== manifest.sourceDatabase ||
    prepared.clean.fileId === prepared.blocked.fileId ||
    prepared.clean.sha256 === prepared.blocked.sha256
  )
    throw new Error("Recovery evidence identities do not match the backup environment.");
  for (const [role, expected] of Object.entries({
    clean: prepared.clean,
    blocked: prepared.blocked,
  })) {
    const matches = manifest.files.filter((file) => file.id === expected.fileId);
    if (
      matches.length !== 1 ||
      matches[0].sha256 !== expected.sha256 ||
      matches[0].sizeBytes !== expected.sizeBytes
    )
      throw new Error(`Prepared ${role} evidence is missing, ambiguous or changed in the backup.`);
  }
  const metadata = async (file: z.infer<typeof fileIdentity>) => {
    const response = await api(`/files/${file.fileId}`);
    assert.equal(response.status, 200);
    const { data } = z
      .object({
        data: z.object({
          id: z.uuid(),
          sha256: z.string(),
          sizeBytes: z.number(),
          status: z.enum(["uploading", "ready", "rejected"]),
        }),
      })
      .parse(await response.json());
    assert.deepEqual({ fileId: data.id, sha256: data.sha256, sizeBytes: data.sizeBytes }, file);
    return data.status;
  };
  const deniedBlocked = async () => {
    assert.equal(await metadata(prepared.blocked), "rejected");
    assert.equal((await api(`/files/${prepared.blocked.fileId}/content`)).status, 409);
  };
  await deniedBlocked();
  assert.equal(await metadata(prepared.clean), "uploading");
  assert.equal((await api(`/files/${prepared.clean.fileId}/content`)).status, 409);
  const rescanned = await api(`/files/${prepared.clean.fileId}/rescan`, {});
  assert.equal(rescanned.status, 202);
  const rescan = z
    .object({ data: z.object({ fileId: z.uuid(), status: z.literal("uploading") }) })
    .parse(await rescanned.json());
  assert.deepEqual(rescan.data, { fileId: prepared.clean.fileId, status: "uploading" });
  await pollReady(() => metadata(prepared.clean));
  const downloaded = await api(`/files/${prepared.clean.fileId}/content`);
  assert.equal(downloaded.status, 200);
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  assert.deepEqual(
    { sizeBytes: bytes.length, sha256: hashBytes(bytes) },
    { sizeBytes: prepared.clean.sizeBytes, sha256: prepared.clean.sha256 },
  );
  await deniedBlocked();
  return {
    cleanFileId: prepared.clean.fileId,
    cleanSha256: prepared.clean.sha256,
    blockedFileId: prepared.blocked.fileId,
    blockedSha256: prepared.blocked.sha256,
    blockedDownloadDenied: true,
  };
}
