import { describe, expect, it } from "vite-plus/test";
import { createFileClient } from "./fileClient";
import { createSessionFetch } from "./sessionFetch";
import type { Session } from "./cognitoClient";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
const uploadBoundaries = [
  "file read",
  "digest",
  "upload 401",
  "upload 200",
  "upload JSON",
  "SDK refresh",
  "session publication",
] as const;
const downloadBoundaries = [
  "metadata HTTP",
  "metadata JSON",
  "content 401",
  "content 200",
  "content blob",
  "SDK refresh",
  "session publication",
] as const;
const transitions = [
  "refresh",
  "logout",
  "same-user login",
  "different-user login",
  "cancel",
] as const;
const cases = [
  ...uploadBoundaries.flatMap((boundary) =>
    transitions.map((transition) => ({ operation: "upload", boundary, transition })),
  ),
  ...downloadBoundaries.flatMap((boundary) =>
    transitions.map((transition) => ({ operation: "download", boundary, transition })),
  ),
];
const uploaded = { fileId: "file-id", status: "ready", sizeBytes: 9, sha256: "ab".repeat(32) };
const metadata = {
  id: "file-id",
  name: "anonymous.txt",
  mime: "text/plain",
  sizeBytes: 9,
  sha256: "ab".repeat(32),
  status: "ready",
  createdAt: "2026-09-25T00:00:00Z",
};

describe("file operation login boundary", () => {
  it.each(cases)(
    "$operation at $boundary with $transition",
    async ({ operation, boundary, transition }) => {
      let generation = 1;
      let session: Session | null = { accessToken: "fresh", email: "same@example.invalid" };
      const reached = deferred(),
        release = deferred();
      const abort = new AbortController();
      const bytes = new TextEncoder().encode("anonymous").buffer;
      const calls: {
        path: string;
        method: string;
        authorization: string | null;
        key: string | null;
        body: BodyInit | null | undefined;
      }[] = [];
      const saved: { blob: Blob; name: string }[] = [];
      async function pause(at: string) {
        if (at === boundary) {
          reached.resolve();
          await release.promise;
        }
      }
      function jsonResponse(data: unknown, stage: string) {
        const response = Response.json({ data });
        const json = response.json.bind(response);
        response.json = async () => {
          await pause(stage);
          return json();
        };
        return response;
      }
      const transport = createSessionFetch({
        generation: () => generation,
        session: async () => {
          await pause("SDK refresh");
          return session;
        },
        updated: async () => {
          await pause("session publication");
        },
        fetch: async (input, init) => {
          const path =
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            headers = new Headers(init?.headers);
          const authorization = headers.get("Authorization");
          calls.push({
            path,
            method: init?.method ?? "GET",
            authorization,
            key: headers.get("Idempotency-Key"),
            body: init?.body,
          });
          if (path === "/api/v1/files/file-id") {
            await pause("metadata HTTP");
            return jsonResponse(metadata, "metadata JSON");
          }
          const stage = operation === "upload" ? "upload" : "content";
          if (authorization === "Bearer expired") {
            await pause(`${stage} 401`);
            return Response.json(
              {
                error: { code: "UNAUTHORIZED", message: "ログインし直してください。" },
                requestId: "test",
              },
              { status: 401 },
            );
          }
          await pause(`${stage} 200`);
          if (operation === "upload") return jsonResponse(uploaded, "upload JSON");
          const response = new Response(bytes);
          const blob = response.blob.bind(response);
          response.blob = async () => {
            await pause("content blob");
            return blob();
          };
          return response;
        },
      });
      const client = createFileClient({
        generation: () => generation,
        fetch: transport,
        digest: async (received) => {
          expect(received).toEqual(bytes);
          await pause("digest");
          return new Uint8Array(32).fill(171).buffer;
        },
        save: (blob, name) => saved.push({ blob, name }),
      });
      const file = Object.assign(new File([bytes], "anonymous.txt"), {
        arrayBuffer: async () => {
          await pause("file read");
          return bytes;
        },
      });
      const operationResult =
        operation === "upload"
          ? client.upload("expired", "case-id", file, "same-operation", abort.signal)
          : client.download("expired", "file-id", abort.signal);
      const pending = operationResult.then(
        (value) => ({ value }),
        (error) => ({ error: { name: error.name, message: error.message } }),
      );
      await reached.promise;
      if (transition === "cancel") abort.abort(new DOMException("file cancelled", "AbortError"));
      else if (transition !== "refresh") {
        generation++;
        session = null;
        if (transition !== "logout") {
          generation++;
          session = {
            accessToken: "new-login",
            email:
              transition === "same-user login" ? "same@example.invalid" : "other@example.invalid",
          };
        }
      }
      release.resolve();
      const result = await pending;
      const normal = transition === "refresh";
      const uploadCall = {
        path: "/api/v1/cases/case-id/files",
        method: "POST",
        authorization: "Bearer expired",
        key: "same-operation",
        body: bytes,
      };
      const metadataCall = {
        path: "/api/v1/files/file-id",
        method: "GET",
        authorization: "Bearer expired",
        key: null,
        body: undefined,
      };
      const contentCall = { ...metadataCall, path: "/api/v1/files/file-id/content" };
      let expectedCalls =
        operation === "upload"
          ? [uploadCall, { ...uploadCall, authorization: "Bearer fresh" }]
          : [metadataCall, contentCall, { ...contentCall, authorization: "Bearer fresh" }];
      if (!normal) {
        const issued = {
          "file read": 0,
          digest: 0,
          "upload 401": 1,
          "upload 200": 2,
          "upload JSON": 2,
          "metadata HTTP": 1,
          "metadata JSON": 1,
          "content 401": 2,
          "content 200": 3,
          "content blob": 3,
          "SDK refresh": operation === "upload" ? 1 : 2,
          "session publication": operation === "upload" ? 1 : 2,
        }[boundary];
        expectedCalls = expectedCalls.slice(0, issued);
      }
      expect({
        result,
        calls,
        saved: await Promise.all(
          saved.map(async ({ blob, name }) => ({ name, content: await blob.text() })),
        ),
      }).toEqual({
        result: normal
          ? { value: operation === "upload" ? uploaded : undefined }
          : {
              error: {
                name: "AbortError",
                message:
                  transition === "cancel"
                    ? "file cancelled"
                    : "ログイン状態が変わったため、ファイル操作を中止しました。",
              },
            },
        calls: expectedCalls,
        saved:
          normal && operation === "download"
            ? [{ name: "anonymous.txt", content: "anonymous" }]
            : [],
      });
    },
  );
  it.each(["upload", "download"])(
    "discards an authorization error body resolved after logout during %s",
    async (operation) => {
      let generation = 1;
      const reached = deferred(),
        release = deferred();
      const saved: string[] = [];
      const calls: string[] = [];
      const client = createFileClient({
        generation: () => generation,
        fetch: async (path) => {
          calls.push(typeof path === "string" ? path : path instanceof URL ? path.href : path.url);
          const response = Response.json(
            {
              error: { code: "ACCOUNT_DISABLED", message: "アカウント停止" },
              requestId: "request-id",
            },
            { status: 403 },
          );
          const json = response.json.bind(response);
          response.json = async () => {
            reached.resolve();
            await release.promise;
            return json();
          };
          return response;
        },
        digest: async () => new Uint8Array(32).fill(171).buffer,
        save: (_blob, name) => saved.push(name),
      });
      const bytes = new TextEncoder().encode("anonymous").buffer;
      const file = Object.assign(new File([bytes], "anonymous.txt"), {
        arrayBuffer: async () => bytes,
      });
      const pending = (
        operation === "upload"
          ? client.upload("old", "case-id", file, "key", new AbortController().signal)
          : client.download("old", "file-id")
      ).catch((error) => ({ name: error.name, message: error.message }));
      await reached.promise;
      generation++;
      release.resolve();
      expect({ result: await pending, calls, saved }).toEqual({
        result: {
          name: "AbortError",
          message: "ログイン状態が変わったため、ファイル操作を中止しました。",
        },
        calls: [operation === "upload" ? "/api/v1/cases/case-id/files" : "/api/v1/files/file-id"],
        saved: [],
      });
    },
  );
});
