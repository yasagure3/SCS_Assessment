import type { MasterImportRepository } from "../domain/masterImport";
import { masterCriteria } from "../domain/masterImport";
import { digest, DomainError } from "../domain/assessment";
import { D1OperationLedger } from "./d1OperationLedger";
import type { MasterImportResult } from "../../../../shared/contracts/masterImport";

export class D1MasterImportRepository implements MasterImportRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  replay(actorId: string, key: string, hash: string) {
    return new D1OperationLedger(this.db).replay<MasterImportResult>(actorId, key, hash);
  }
  async save(input: Parameters<MasterImportRepository["save"]>[0]) {
    const { source, command, document, preview, actorId, requestId, requestHash, now } = input;
    const archived = await this.db
      .prepare(
        "SELECT 1 FROM cases k JOIN customers c ON c.id=k.customer_id WHERE k.id=? AND (k.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)",
      )
      .bind(source.caseId)
      .first();
    if (archived) throw new DomainError("ARCHIVED");
    const criteria = masterCriteria(command.workbook),
      standardId = `scs-import-${crypto.randomUUID()}`,
      assessmentId = crypto.randomUUID();
    const contentHash = await digest(criteria);
    const response = { standardId, assessmentId, preview };
    return new D1OperationLedger(this.db).execute({
      actorId,
      key: command.mutationId,
      requestHash,
      resourceId: assessmentId,
      response,
      conditionSql:
        "EXISTS(SELECT 1 FROM assessments a JOIN cases k ON k.id=a.case_id JOIN customers c ON c.id=a.customer_id JOIN app_users u ON u.id=? WHERE a.id=? AND a.revision=? AND u.status='active' AND u.role='admin' AND k.archived_at IS NULL AND c.archived_at IS NULL)",
      conditionParams: [actorId, source.id, command.expectedRevision],
      writes: (reservationId) => {
        const guard = "EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)";
        const statements = [
          this.db
            .prepare(
              `INSERT INTO standards(id,publication_date,level,source_url,source_sha256,content_sha256,expected_count) SELECT ?,?,3,'',?,?,81 WHERE ${guard}`,
            )
            .bind(
              standardId,
              now.slice(0, 10),
              command.workbook.fileSha256,
              contentHash,
              reservationId,
            ),
        ];
        for (const c of criteria)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO criteria(standard_id,criterion_id,requirement_id,category,order_no,requirement_text,official_text,source_row) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`,
              )
              .bind(
                standardId,
                c.id,
                c.requirementId,
                c.category,
                c.orderNo,
                c.requirementText,
                c.officialText,
                c.sourceRow,
                reservationId,
              ),
          );
        statements.push(
          this.db
            .prepare(`UPDATE standards SET sealed_at=? WHERE id=? AND ${guard}`)
            .bind(now, standardId, reservationId),
          this.db
            .prepare(`INSERT INTO master_import_sources SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`)
            .bind(
              standardId,
              source.standardId,
              command.workbook.fileName,
              command.workbook.sheet,
              command.workbook.headerRow,
              JSON.stringify(command.workbook.masterRows),
              actorId,
              now,
              reservationId,
            ),
          this.db
            .prepare(
              `INSERT INTO assessments(id,case_id,customer_id,standard_id,revision,document_json,mutation_id,request_hash,actor_id,created_at,updated_at) SELECT ?,?,?,?,1,?,?,?,?,?,? WHERE ${guard}`,
            )
            .bind(
              assessmentId,
              source.caseId,
              source.customerId,
              standardId,
              JSON.stringify(document),
              command.mutationId,
              requestHash,
              actorId,
              now,
              now,
              reservationId,
            ),
        );
        for (const [action, type, id] of [
          ["standard.import", "standard", standardId],
          ["assessment.master-import", "assessment", assessmentId],
        ])
          statements.push(
            this.db
              .prepare(
                `INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,?,?,?,?,NULL,1,?,? WHERE ${guard}`,
              )
              .bind(
                crypto.randomUUID(),
                actorId,
                source.customerId,
                action,
                type,
                id,
                requestId,
                now,
                reservationId,
              ),
          );
        return statements;
      },
    });
  }
}
