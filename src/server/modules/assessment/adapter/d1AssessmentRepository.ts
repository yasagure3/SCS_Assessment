import { type AssessmentRecord } from "../../../../shared/contracts/assessment";
import {
  canonical,
  DomainError,
  finalizeChange,
  validateDocument,
  type AssessmentRepository,
} from "../domain/assessment";
import { D1OperationLedger } from "./d1OperationLedger";

type StoredRecord = Omit<AssessmentRecord, "document"> & { documentJson: string };
const authorized =
  "EXISTS(SELECT 1 FROM app_users u WHERE u.id=? AND u.status='active' AND (u.role='admin' OR EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.customer_id=a.customer_id)))";
export class D1AssessmentRepository implements AssessmentRepository {
  private readonly db: D1Database;
  private readonly ledger: D1OperationLedger;
  constructor(db: D1Database) {
    this.db = db;
    this.ledger = new D1OperationLedger(db);
  }
  private async ids(standardId: string): Promise<string[]> {
    const rows = await this.db
      .prepare("SELECT criterion_id AS id FROM criteria WHERE standard_id=? ORDER BY order_no")
      .bind(standardId)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }
  replay(actorId: string, mutationId: string, requestHash: string) {
    return this.ledger.replay<AssessmentRecord>(actorId, mutationId, requestHash);
  }
  async get(id: string, actorId: string): Promise<AssessmentRecord> {
    const row = await this.db
      .prepare(
        `SELECT a.id,a.case_id AS caseId,a.customer_id AS customerId,a.standard_id AS standardId,a.previous_assessment_id AS previousAssessmentId,a.revision,a.document_json AS documentJson,a.created_at AS createdAt,a.updated_at AS updatedAt FROM assessments a WHERE a.id=? AND ${authorized}`,
      )
      .bind(id, actorId)
      .first<StoredRecord>();
    if (!row) throw new DomainError("NOT_FOUND");
    const { documentJson, ...record } = row;
    return {
      ...record,
      document: validateDocument(JSON.parse(documentJson), await this.ids(record.standardId)),
    };
  }
  async save(input: Parameters<AssessmentRepository["save"]>[0]): Promise<AssessmentRecord> {
    const current = await this.get(input.record.id, input.actorId);
    const replay = await this.ledger.replay<AssessmentRecord>(
      input.actorId,
      input.mutationId,
      input.requestHash,
    );
    if (replay !== null) return replay;
    const archived = await this.db
      .prepare(
        "SELECT 1 FROM cases k JOIN customers c ON c.id=k.customer_id WHERE k.id=? AND (k.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)",
      )
      .bind(current.caseId)
      .first();
    if (archived) throw new DomainError("ARCHIVED");
    if (current.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
    const document = validateDocument(
      await finalizeChange(current.document, input.record.document),
      await this.ids(current.standardId),
    );
    const changed = canonical(document) !== canonical(current.document);
    const next = {
      ...current,
      document,
      revision: current.revision + Number(changed),
      updatedAt: changed ? new Date().toISOString() : current.updatedAt,
    };
    const json = JSON.stringify(document);
    return this.ledger.execute({
      actorId: input.actorId,
      key: input.mutationId,
      requestHash: input.requestHash,
      resourceId: current.id,
      response: next,
      conditionSql: `EXISTS(SELECT 1 FROM assessments a JOIN cases k ON k.id=a.case_id JOIN customers c ON c.id=a.customer_id WHERE a.id=? AND a.revision=? AND k.archived_at IS NULL AND c.archived_at IS NULL AND ${authorized}) AND NOT EXISTS(SELECT 1 FROM json_each(?,'$.evidence') e WHERE json_extract(e.value,'$.fileId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM files f WHERE f.id=json_extract(e.value,'$.fileId') AND f.case_id=? AND f.customer_id=? AND f.status='ready'))`,
      conditionParams: [
        current.id,
        input.expectedRevision,
        input.actorId,
        json,
        current.caseId,
        current.customerId,
      ],
      writes: (reservationId) => {
        const statements: D1PreparedStatement[] = [];
        if (changed)
          statements.push(
            this.db
              .prepare(
                "UPDATE assessments SET document_json=?,revision=revision+1,mutation_id=?,request_hash=?,actor_id=?,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
              )
              .bind(
                json,
                input.mutationId,
                input.requestHash,
                input.actorId,
                next.updatedAt,
                current.id,
                input.expectedRevision,
                reservationId,
              ),
          );
        statements.push(
          this.db
            .prepare(
              "INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,?,?,'assessment',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
            )
            .bind(
              crypto.randomUUID(),
              input.actorId,
              current.customerId,
              input.action,
              current.id,
              current.revision,
              next.revision,
              input.requestId,
              new Date().toISOString(),
              reservationId,
            ),
        );
        return statements;
      },
    });
  }
}
