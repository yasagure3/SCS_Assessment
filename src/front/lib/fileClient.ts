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
  wait?: (signal: AbortSignal) => Promise<void>;
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
      for (let attempt = 0; result.data.status === "uploading" && attempt < 60; attempt++) {
        if (!io.wait)
          throw new Error("ファイルを検査しています。しばらく待ってから再確認してください。");
        await io.wait(signal);
        active();
        const metadata = (await (
          await request(active, token, `/api/v1/files/${result.data.fileId}`, { signal })
        ).json()) as ApiSuccess<FileMetadata>;
        active();
        result.data = {
          fileId: metadata.data.id,
          status: metadata.data.status,
          sizeBytes: metadata.data.sizeBytes,
          sha256: metadata.data.sha256,
        };
      }
      if (result.data.status === "uploading")
        throw new Error("安全性検査が続いています。同じファイルの登録ボタンで再確認できます。");
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
  wait: (signal) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("送信を中止しました。", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 2000);
      signal.addEventListener("abort", abort, { once: true });
    }),
  save: (blob, name) => {
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
});
