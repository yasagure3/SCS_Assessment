import { FILE_TYPES, type FileMetadata, type FileUploaded } from "../../shared/contracts/files";
import type { ApiFailure, ApiSuccess } from "../../shared/contracts/api";
import { ApiError } from "./fetcher";
import { sessionFetch } from "./sessionFetch";
export function createFileClient(io: {
  fetch: typeof fetch;
  digest: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  save: (blob: Blob, name: string) => void;
}) {
  async function request(token: string, path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await io.fetch(path, {
      ...init,
      cache: "no-store",
      headers,
    });
    if (!response.ok)
      throw new ApiError(
        response.status,
        (await response.json().catch(() => undefined)) as ApiFailure | undefined,
      );
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
      const bytes = await file.arrayBuffer(),
        sha256 = Array.from(new Uint8Array(await io.digest(bytes)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      signal.throwIfAborted();
      const response = await request(token, `/api/v1/cases/${caseId}/files`, {
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
      return ((await response.json()) as ApiSuccess<FileUploaded>).data;
    },
    async download(token: string, id: string) {
      const metadata = (
        (await (await request(token, `/api/v1/files/${id}`)).json()) as ApiSuccess<FileMetadata>
      ).data;
      const response = await request(token, `/api/v1/files/${id}/content`);
      io.save(await response.blob(), metadata.name);
    },
  };
}
export const browserFileClient = createFileClient({
  fetch: sessionFetch,
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
