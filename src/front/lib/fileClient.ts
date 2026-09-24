import { FILE_TYPES, type FileMetadata, type FileUploaded } from "../../shared/contracts/files";
import type { ApiFailure, ApiSuccess } from "../../shared/contracts/api";
import { ApiError } from "./fetcher";
import { sessionFetch } from "./sessionFetch";
import { getSessionGeneration } from "./cognitoClient";
export function createFileClient(io: {
  fetch: typeof fetch;
  generation: () => number;
  digest: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  save: (blob: Blob, name: string) => void;
}) {
  function operation(signal?: AbortSignal) {
    const generation = io.generation();
    return () => {
      signal?.throwIfAborted();
      if (generation !== io.generation())
        throw new DOMException(
          "ログイン状態が変わったため、ファイル操作を中止しました。",
          "AbortError",
        );
    };
  }
  async function request(active: () => void, token: string, path: string, init?: RequestInit) {
    active();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await io.fetch(path, {
      ...init,
      cache: "no-store",
      headers,
    });
    active();
    if (!response.ok) {
      const failure = (await response.json().catch(() => undefined)) as ApiFailure | undefined;
      active();
      throw new ApiError(response.status, failure);
    }
    return response;
  }
  return {
    async upload(
      token: string,
      caseId: string,
      file: File,
      key: string,
      signal: AbortSignal,
    ): Promise<FileUploaded> {
      const active = operation(signal);
      active();
      const bytes = await file.arrayBuffer();
      active();
      const digest = await io.digest(bytes);
      active();
      const sha256 = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const response = await request(active, token, `/api/v1/cases/${caseId}/files`, {
        method: "POST",
        signal,
        body: bytes,
        headers: {
          "Idempotency-Key": key,
          "X-File-Name": encodeURIComponent(file.name),
          "X-Content-SHA256": sha256,
          "Content-Type": FILE_TYPES[file.name.split(".").at(-1)!.toLowerCase()],
        },
      });
      active();
      const result = (await response.json()) as ApiSuccess<FileUploaded>;
      active();
      return result.data;
    },
    async download(token: string, id: string, signal?: AbortSignal) {
      const active = operation(signal);
      const metadataResponse = await request(active, token, `/api/v1/files/${id}`, { signal });
      active();
      const metadata = (await metadataResponse.json()) as ApiSuccess<FileMetadata>;
      active();
      const response = await request(active, token, `/api/v1/files/${id}/content`, { signal });
      active();
      const blob = await response.blob();
      active();
      io.save(blob, metadata.data.name);
    },
  };
}
export const browserFileClient = createFileClient({
  fetch: sessionFetch,
  generation: getSessionGeneration,
  digest: (bytes) => crypto.subtle.digest("SHA-256", bytes),
  save: (blob, name) => {
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
});
