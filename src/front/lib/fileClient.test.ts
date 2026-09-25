import { describe, it, expect } from "vite-plus/test";
import { createFileClient } from "./fileClient";

describe("authenticated file transfer", () => {
  it("waits for the asynchronous malware verdict before returning an attachable file", async () => {
    const calls: string[] = [];
    const client = createFileClient({
      generation: () => 1,
      digest: async () => new Uint8Array(32).buffer,
      save: () => {},
      wait: async () => {},
      fetch: async (input) => {
        calls.push(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        return Response.json({
          data:
            calls.length === 1
              ? { fileId: "scan-file", status: "uploading", sizeBytes: 9, sha256: "0".repeat(64) }
              : {
                  id: "scan-file",
                  status: calls.length === 2 ? "uploading" : "ready",
                  sizeBytes: 9,
                  sha256: "0".repeat(64),
                },
        });
      },
    });
    const file = Object.assign(new File(["anonymous"], "anonymous.txt"), {
      arrayBuffer: async () => new TextEncoder().encode("anonymous").buffer,
    });
    expect(await client.upload("token", "case", file, "key", new AbortController().signal)).toEqual(
      { fileId: "scan-file", status: "ready", sizeBytes: 9, sha256: "0".repeat(64) },
    );
    expect(calls).toEqual([
      "/api/v1/cases/case/files",
      "/api/v1/files/scan-file",
      "/api/v1/files/scan-file",
    ]);
  });
  it("sends canonical MIME, client hash and operation key, then saves a named attachment using authorized requests", async () => {
    const calls: {
        path: string;
        headers: Record<string, string>;
        method: string;
        body: unknown;
      }[] = [],
      saved: { blob: Blob; name: string }[] = [];
    const bytes = new TextEncoder().encode("anonymous").buffer;
    const client = createFileClient({
      generation: () => 1,
      fetch: async (input, init) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push({
          path,
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          method: init?.method ?? "GET",
          body: init?.body,
        });
        if (init?.method === "POST")
          return Response.json({
            data: { fileId: "file-id", status: "ready", sizeBytes: 9, sha256: "ab".repeat(32) },
          });
        if (path.endsWith("/content"))
          return new Response(bytes, {
            headers: { "Content-Type": "text/plain", "Content-Disposition": "attachment" },
          });
        return Response.json({
          data: {
            id: "file-id",
            name: "匿名.txt",
            mime: "text/plain",
            sizeBytes: 9,
            sha256: "ab".repeat(32),
            status: "ready",
            createdAt: "2026-09-20T00:00:00Z",
          },
        });
      },
      digest: async (received) => {
        expect(received).toEqual(bytes);
        return new Uint8Array(32).fill(171).buffer;
      },
      save: (blob, name) => saved.push({ blob, name }),
    });
    const file = Object.assign(
      new File(["anonymous"], "匿名.txt", { type: "application/octet-stream" }),
      { arrayBuffer: async () => bytes },
    );
    expect(
      await client.upload("memory-token", "case-id", file, "key-id", new AbortController().signal),
    ).toEqual({ fileId: "file-id", status: "ready", sizeBytes: 9, sha256: "ab".repeat(32) });
    await client.download("memory-token", "file-id");
    expect(calls).toEqual([
      {
        path: "/api/v1/cases/case-id/files",
        headers: {
          authorization: "Bearer memory-token",
          "content-type": "text/plain",
          "idempotency-key": "key-id",
          "x-file-name": encodeURIComponent("匿名.txt"),
          "x-content-sha256": "ab".repeat(32),
        },
        method: "POST",
        body: bytes,
      },
      {
        path: "/api/v1/files/file-id",
        headers: { authorization: "Bearer memory-token" },
        method: "GET",
        body: undefined,
      },
      {
        path: "/api/v1/files/file-id/content",
        headers: { authorization: "Bearer memory-token" },
        method: "GET",
        body: undefined,
      },
    ]);
    expect(saved).toEqual([{ blob: expect.any(Blob), name: "匿名.txt" }]);
    expect(await saved[0].blob.text()).toBe("anonymous");
  });
  it("reports a denied download and never saves a blob", async () => {
    const saved: string[] = [];
    const client = createFileClient({
      generation: () => 1,
      fetch: async () =>
        Response.json(
          {
            error: { code: "ACCOUNT_DISABLED", message: "アカウント停止" },
            requestId: "request-id",
          },
          { status: 403 },
        ),
      digest: async () => new ArrayBuffer(0),
      save: (_blob, name) => saved.push(name),
    });
    await expect(client.download("stopped-token", "file-id")).rejects.toMatchObject({
      status: 403,
      code: "ACCOUNT_DISABLED",
      requestId: "request-id",
      message: "アカウント停止",
    });
    expect(saved).toEqual([]);
  });
});
