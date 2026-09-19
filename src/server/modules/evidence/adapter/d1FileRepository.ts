import { DomainError } from "../../../../shared/errors";
import type { FileContext, FileInput, FileRepository, StoredFile } from "../domain/files";
import { D1OperationLedger } from "../../assessment/adapter/d1OperationLedger";
const auth = (column: string) =>
  `EXISTS(SELECT 1 FROM app_users u WHERE u.id=? AND u.status='active' AND (u.role='admin' OR EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.customer_id=${column})))`;
const columns =
  "id,customer_id AS customerId,case_id AS caseId,object_key AS objectKey,original_name AS name,mime,size_bytes AS sizeBytes,sha256,status,created_at AS createdAt";
export class D1FileRepository implements FileRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async get(id: string, actorId: string): Promise<StoredFile> {
    const row = await this.db
      .prepare(`SELECT ${columns} FROM files f WHERE f.id=? AND ${auth("f.customer_id")}`)
      .bind(id, actorId)
      .first<StoredFile>();
    if (!row) throw new DomainError("NOT_FOUND");
    return row;
  }
  async reserve(caseId: string, input: FileInput, key: string, hash: string, context: FileContext) {
    const allowed = await this.db
      .prepare(
        `SELECT k.customer_id AS customerId,k.archived_at AS caseArchived,c.archived_at AS customerArchived FROM cases k JOIN customers c ON c.id=k.customer_id WHERE k.id=? AND ${auth("k.customer_id")}`,
      )
      .bind(caseId, context.actorId)
      .first<{
        customerId: string;
        caseArchived: string | null;
        customerArchived: string | null;
      }>();
    if (!allowed) throw new DomainError("NOT_FOUND");
    const ledger = new D1OperationLedger(this.db),
      replay = await ledger.replay<{ id: string }>(context.actorId, key, hash);
    if (replay) return { file: await this.get(replay.id, context.actorId), owned: false };
    if (allowed.caseArchived || allowed.customerArchived) throw new DomainError("ARCHIVED");
    const id = context.newId(),
      objectKey = context.newId(),
      stamp = context.now();
    const result = await ledger.execute({
      actorId: context.actorId,
      key,
      requestHash: hash,
      resourceId: id,
      response: { id },
      conditionSql: `EXISTS(SELECT 1 FROM cases k JOIN customers c ON c.id=k.customer_id WHERE k.id=? AND k.archived_at IS NULL AND c.archived_at IS NULL AND ${auth("k.customer_id")})`,
      conditionParams: [caseId, context.actorId],
      writes: (reservation) => [
        this.db
          .prepare(
            "INSERT INTO files SELECT ?,?,?,?,?,?,0,?,'uploading',?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            id,
            allowed.customerId,
            caseId,
            objectKey,
            input.name,
            input.mime,
            input.sha256,
            context.actorId,
            stamp,
            reservation,
          ),
        this.db
          .prepare(
            "INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,request_id,created_at) SELECT ?,?,?,'file.upload.reserve','file',?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            context.newId(),
            context.actorId,
            allowed.customerId,
            id,
            context.requestId,
            stamp,
            reservation,
          ),
      ],
    });
    return { file: await this.get(result.id, context.actorId), owned: result.id === id };
  }
  async finish(id: string, status: "ready" | "rejected", size: number, context: FileContext) {
    // Only the reserving actor can finalize an uploading row. Ready requires current access.
    const condition = `id=? AND created_by=? AND status='uploading'${status === "ready" ? ` AND ${auth("files.customer_id")} AND EXISTS(SELECT 1 FROM cases k JOIN customers c ON c.id=k.customer_id WHERE k.id=files.case_id AND k.archived_at IS NULL AND c.archived_at IS NULL)` : ""}`;
    const params =
      status === "ready" ? [id, context.actorId, context.actorId] : [id, context.actorId];
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,request_id,created_at) SELECT ?,?,customer_id,?,'file',id,?,? FROM files WHERE ${condition}`,
        )
        .bind(
          context.newId(),
          context.actorId,
          `file.upload.${status}`,
          context.requestId,
          context.now(),
          ...params,
        ),
      this.db
        .prepare(`UPDATE files SET status=?,size_bytes=? WHERE ${condition}`)
        .bind(status, size, ...params),
    ]);
    if (results[1].meta.changes !== 1) throw new DomainError("CONFLICT");
  }
}
