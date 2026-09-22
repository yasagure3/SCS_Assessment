import { DomainError, operationHash } from "../../assessment/domain/assessment";
import { MAX_FILE_BYTES } from "../../../../shared/contracts/files";
import type { EvidenceStore, FileContext, FileInput, FileRepository } from "../domain/files";

export async function uploadEvidence(
  repository: FileRepository,
  store: EvidenceStore,
  caseId: string,
  input: FileInput,
  key: string,
  body: ReadableStream<Uint8Array> | null,
  context: FileContext,
  inspect: (bytes: Uint8Array, input: FileInput) => void,
) {
  const hash = await operationHash("POST", `/api/v1/cases/${caseId}/files`, caseId, input);
  const reservation = await repository.reserve(caseId, input, key, hash, context),
    file = reservation.file;
  const result = () => ({
    fileId: file.id,
    status: file.status,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
  });
  if (!reservation.owned) {
    await body?.cancel().catch(() => {});
    return result();
  }
  let size = 0;
  try {
    if (!body) throw new DomainError("FILE_INVALID");
    const reader = body.getReader(),
      chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_FILE_BYTES) throw new DomainError("PAYLOAD_TOO_LARGE");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (size === 0) throw new DomainError("FILE_INVALID");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    inspect(bytes, input);
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (actual !== input.sha256) throw new DomainError("FILE_HASH_MISMATCH");
    let stored: Awaited<ReturnType<EvidenceStore["head"]>>;
    try {
      await store.put(file.objectKey, new Blob([bytes]).stream(), {
        sizeBytes: size,
        sha256: actual,
        mime: input.mime,
      });
      stored = await store.head(file.objectKey);
    } catch {
      // Provider failures must not be classified as interrupted/invalid client input.
      throw new DomainError("FILE_STORAGE_FAILED");
    }
    if (!stored || stored.sizeBytes !== size || stored.sha256 !== actual)
      throw new DomainError("FILE_STORAGE_FAILED");
    await repository.finish(file.id, "ready", size, context);
    file.status = "ready";
    file.sizeBytes = size;
    return result();
  } catch (error) {
    await repository.finish(file.id, "rejected", Math.min(size, MAX_FILE_BYTES), context);
    if (error instanceof DomainError) throw error;
    throw new DomainError("FILE_UPLOAD_FAILED");
  }
}
