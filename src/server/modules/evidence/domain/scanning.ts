import type { StoredFile } from "./files";
export type ScanCopy = { key: string; version: string };
export interface ScanProvider {
  copy(attempt: string, file: StoredFile, bytes: Uint8Array): Promise<ScanCopy>;
  inspect(copy: ScanCopy, file: StoredFile): Promise<"pending" | "clean" | "blocked" | "failed">;
}
export interface MalwareScan {
  submit(file: StoredFile, bytes: Uint8Array): Promise<"pending" | "clean">;
  refresh(file: StoredFile): Promise<boolean>;
  download(file: StoredFile): Promise<ReadableStream<Uint8Array> | null>;
  restart(file: StoredFile): Promise<"pending" | "clean">;
}
