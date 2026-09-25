import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "../../../app";
import { DomainError } from "../../../../shared/errors";
import { FILE_TYPES } from "../../../../shared/contracts/files";
import type { EvidenceStore, FileRepository } from "../domain/files";
import { uploadEvidence } from "../usecase/uploadEvidence";
import { inspectEvidence } from "../domain/inspectEvidence";
import type { MalwareScan } from "../domain/scanning";
import { D1OperationLedger } from "../../assessment/adapter/d1OperationLedger";
import { operationHash } from "../../assessment/domain/assessment";
export function fileRoutes(
  repositories: (b: Bindings) => FileRepository,
  stores: (b: Bindings) => EvidenceStore,
  runtime = { now: () => new Date().toISOString(), newId: () => crypto.randomUUID() },
  scans?: (b: Bindings) => MalwareScan,
) {
  const app = new Hono<AppEnv>();
  app.post("/files/:id/rescan", async (c) => {
    if (c.get("principal").role !== "admin") throw new DomainError("FORBIDDEN");
    if (!scans) throw new DomainError("FILE_SCAN_UNAVAILABLE");
    const file = await repositories(c.env).get(
      z.uuid().parse(c.req.param("id")),
      c.get("principal").id,
    );
    const key = z.uuid().parse(c.req.header("Idempotency-Key")),
      attempt = runtime.newId();
    const ledger = new D1OperationLedger(c.env.DB);
    const reserved = await ledger.execute({
      actorId: c.get("principal").id,
      key,
      requestHash: await operationHash("POST", `/api/v1/files/${file.id}/rescan`, file.id, {}),
      resourceId: file.id,
      response: { attempt },
      conditionSql: "EXISTS(SELECT 1 FROM files WHERE id=?)",
      conditionParams: [file.id],
      writes: () => [],
    });
    if (reserved.attempt !== attempt)
      return c.json(
        { data: { fileId: file.id, status: file.status }, requestId: c.get("requestId") },
        202,
      );
    const status = await scans(c.env).restart(file);
    await c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,request_id,created_at) VALUES(?,?,?,'file.rescan','file',?,?,?)",
    )
      .bind(
        runtime.newId(),
        c.get("principal").id,
        file.customerId,
        file.id,
        c.get("requestId"),
        runtime.now(),
      )
      .run();
    return c.json(
      {
        data: { fileId: file.id, status: status === "pending" ? "uploading" : "ready" },
        requestId: c.get("requestId"),
      },
      202,
    );
  });
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
      scans?.(c.env),
    );
    return c.json({ data, requestId: c.get("requestId") }, 201);
  });
  app.get("/files/:id", async (c) => {
    let file = await repositories(c.env).get(
      z.uuid().parse(c.req.param("id")),
      c.get("principal").id,
    );
    const clean = scans ? await scans(c.env).refresh(file) : true;
    if (scans) file = await repositories(c.env).get(file.id, c.get("principal").id);
    const { id, name, mime, sizeBytes, sha256, createdAt } = file;
    const status = file.status === "ready" && !clean ? "uploading" : file.status;
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
    if (!scans && file.status !== "ready") throw new DomainError("FILE_NOT_READY");
    let body: Awaited<ReturnType<EvidenceStore["get"]>>;
    try {
      body = scans ? await scans(c.env).download(file) : await stores(c.env).get(file.objectKey);
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
