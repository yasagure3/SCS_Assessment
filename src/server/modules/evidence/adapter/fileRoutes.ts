import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { DomainError } from "../../../../shared/errors";
import { FILE_TYPES } from "../../../../shared/contracts/files";
import type { EvidenceStore, FileRepository } from "../domain/files";
import { uploadEvidence } from "../usecase/uploadEvidence";
import { inspectEvidence } from "../domain/inspectEvidence";
export function fileRoutes(
  repositories: (b: Bindings) => FileRepository,
  stores: (b: Bindings) => EvidenceStore,
  runtime = { now: () => new Date().toISOString(), newId: () => crypto.randomUUID() },
) {
  const app = new Hono<AppEnv>();
  app.post("/cases/:caseId/files", async (c) => {
    let name: string;
    try {
      name = decodeURIComponent(c.req.header("X-File-Name") ?? "");
    } catch {
      throw new DomainError("FILE_INVALID");
    }
    const mime = c.req.header("Content-Type") ?? "",
      extension = name.split(".").at(-1)?.toLowerCase();
    if (
      !name.trim() ||
      Array.from(name).length > 200 ||
      Array.from(name).some(
        (ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === "/" || ch === "\\",
      ) ||
      !extension ||
      FILE_TYPES[extension] !== mime
    )
      throw new DomainError("FILE_INVALID");
    const sha256 = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(c.req.header("X-Content-SHA256"));
    const data = await uploadEvidence(
      repositories(c.env),
      stores(c.env),
      z.uuid().parse(c.req.param("caseId")),
      { name, mime, sha256 },
      z.uuid().parse(c.req.header("Idempotency-Key")),
      c.req.raw.body,
      { actorId: c.get("principal").id, requestId: c.get("requestId"), ...runtime },
      inspectEvidence,
    );
    return c.json({ data, requestId: c.get("requestId") }, 201);
  });
  app.get("/files/:id", async (c) => {
    const { id, name, mime, sizeBytes, sha256, status, createdAt } = await repositories(c.env).get(
      z.uuid().parse(c.req.param("id")),
      c.get("principal").id,
    );
    return c.json({
      data: { id, name, mime, sizeBytes, sha256, status, createdAt },
      requestId: c.get("requestId"),
    });
  });
  app.get("/files/:id/content", async (c) => {
    const file = await repositories(c.env).get(
      z.uuid().parse(c.req.param("id")),
      c.get("principal").id,
    );
    if (file.status !== "ready") throw new DomainError("FILE_NOT_READY");
    let body: Awaited<ReturnType<EvidenceStore["get"]>>;
    try {
      body = await stores(c.env).get(file.objectKey);
    } catch {
      throw new DomainError("FILE_STORAGE_FAILED");
    }
    if (!body) throw new DomainError("FILE_NOT_READY");
    return new Response(body, {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `attachment; filename="download.${file.name.split(".").at(-1)!.toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
  return app;
}
