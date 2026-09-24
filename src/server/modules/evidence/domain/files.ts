import type { FileMetadata } from "../../../../shared/contracts/files";
export type StoredFile = FileMetadata & { objectKey: string; customerId: string; caseId: string };
export type FileInput = { name: string; mime: string; sha256: string };
export type FileContext = {
  actorId: string;
  requestId: string;
  now: () => string;
  newId: () => string;
};
export interface FileRepository {
  reserve(
    caseId: string,
    input: FileInput,
    key: string,
    hash: string,
    context: FileContext,
  ): Promise<{ file: StoredFile; owned: boolean }>;
  finish(
    id: string,
    status: "ready" | "rejected",
    size: number,
    context: FileContext,
  ): Promise<void>;
  get(id: string, actorId: string): Promise<StoredFile>;
}
// This port cannot fetch URLs or send file contents to an AI provider.
export interface EvidenceStore {
  put(
    key: string,
    body: ReadableStream<Uint8Array>,
    metadata: { sizeBytes: number; sha256: string; mime: string },
  ): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  head(key: string): Promise<{ sizeBytes: number; sha256: string } | null>;
}
