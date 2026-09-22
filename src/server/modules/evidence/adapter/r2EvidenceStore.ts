import type { EvidenceStore } from "../domain/files";
export class R2EvidenceStore implements EvidenceStore {
  private readonly bucket: R2Bucket;
  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }
  async put(
    key: string,
    body: ReadableStream<Uint8Array>,
    metadata: { sizeBytes: number; sha256: string; mime: string },
  ) {
    await this.bucket.put(key, body, {
      httpMetadata: { contentType: metadata.mime },
      customMetadata: { sha256: metadata.sha256 },
      sha256: metadata.sha256,
    });
  }
  async get(key: string) {
    return (await this.bucket.get(key))?.body ?? null;
  }
  async head(key: string) {
    const row = await this.bucket.head(key);
    return row ? { sizeBytes: row.size, sha256: row.customMetadata?.sha256 ?? "" } : null;
  }
}
