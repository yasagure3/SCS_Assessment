import { z } from "zod";
import type { ReportRepository, ReportSource } from "../domain/reportSnapshot";
import type {
  ReportFile,
  ReportReviewer,
  SavedReport,
  ReportListItem,
  ReportListQuery,
} from "../../../../shared/contracts/reports";
import { D1AssessmentRepository } from "../../assessment/adapter/d1AssessmentRepository";
import { D1StandardRepository } from "../../assessment/adapter/d1StandardRepository";
import { D1OperationLedger } from "../../assessment/adapter/d1OperationLedger";
import { DomainError } from "../../assessment/domain/assessment";
const authorized = (column: string) =>
  `EXISTS(SELECT 1 FROM app_users u WHERE u.id=? AND u.status='active' AND (u.role='admin' OR EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.customer_id=${column})))`;
const cursorSchema = z.strictObject({ id: z.uuid(), createdAt: z.iso.datetime() });
export class D1ReportRepository implements ReportRepository {
  private readonly db: D1Database;
  private readonly assessments: D1AssessmentRepository;
  private readonly ledger: D1OperationLedger;
  constructor(db: D1Database) {
    this.db = db;
    this.assessments = new D1AssessmentRepository(db);
    this.ledger = new D1OperationLedger(db);
  }
  async source(id: string, actorId: string): Promise<ReportSource> {
    const record = await this.assessments.get(id, actorId);
    const names = await this.db
      .prepare(
        `SELECT c.id AS customerId,c.name AS customerName,c.revision AS customerRevision,c.archived_at AS customerArchivedAt,k.id AS caseId,k.name AS caseName,k.revision AS caseRevision,k.archived_at AS caseArchivedAt FROM cases k JOIN customers c ON c.id=k.customer_id WHERE k.id=? AND ${authorized("c.id")}`,
      )
      .bind(record.caseId, actorId)
      .first<{
        customerId: string;
        customerName: string;
        customerRevision: number;
        customerArchivedAt: string | null;
        caseId: string;
        caseName: string;
        caseRevision: number;
        caseArchivedAt: string | null;
      }>();
    if (!names) throw new DomainError("NOT_FOUND");
    const files = await this.db
      .prepare(
        `SELECT f.id,f.original_name AS originalName,f.mime,f.size_bytes AS sizeBytes,f.sha256 FROM files f WHERE f.case_id=? AND f.customer_id=? AND f.status='ready' AND f.id IN (SELECT json_extract(value,'$.fileId') FROM json_each(?,'$.evidence')) AND ${authorized("f.customer_id")}`,
      )
      .bind(record.caseId, record.customerId, JSON.stringify(record.document), actorId)
      .all<ReportFile>();
    const reviewerIds = [
      ...new Set([
        ...Object.values(record.document.responses).flatMap((r) =>
          r.confirmedAdvice ? [r.confirmedAdvice.by] : [],
        ),
        ...record.document.evidence.flatMap((e) =>
          Object.values(e.reviews).flatMap((r) => (r.by ? [r.by] : [])),
        ),
        ...record.document.tasks.flatMap((t) => (t.review.by ? [t.review.by] : [])),
      ]),
    ];
    const reviewers = await this.db
      .prepare(
        "SELECT id,email_normalized AS email FROM app_users WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id",
      )
      .bind(JSON.stringify(reviewerIds))
      .all<ReportReviewer>();
    return {
      record,
      standard: await new D1StandardRepository(this.db).get(record.standardId),
      customer: {
        id: names.customerId,
        name: names.customerName,
        revision: names.customerRevision,
        archivedAt: names.customerArchivedAt,
      },
      case: {
        id: names.caseId,
        name: names.caseName,
        revision: names.caseRevision,
        archivedAt: names.caseArchivedAt,
      },
      files: files.results,
      reviewers: reviewers.results,
    };
  }
  async replay(id: string, actorId: string, key: string, hash: string) {
    await this.assessments.get(id, actorId);
    return this.ledger.replay<SavedReport>(actorId, key, hash);
  }
  async save(
    source: ReportSource,
    report: SavedReport,
    context: Parameters<ReportRepository["save"]>[2],
  ) {
    const { record } = source,
      { snapshot } = report;
    return this.ledger.execute({
      ...context,
      resourceId: report.reportId,
      response: report,
      conditionSql: `EXISTS(SELECT 1 FROM assessments a JOIN customers c ON c.id=a.customer_id JOIN cases k ON k.id=a.case_id WHERE a.id=? AND a.revision=? AND c.revision=? AND c.name=? AND k.revision=? AND k.name=? AND c.archived_at IS NULL AND k.archived_at IS NULL AND trim(json_extract(a.document_json,'$.scope.companies'))<>'' AND trim(json_extract(a.document_json,'$.scope.sites'))<>'' AND trim(json_extract(a.document_json,'$.scope.departments'))<>'' AND trim(json_extract(a.document_json,'$.scope.systems'))<>'' AND json_extract(a.document_json,'$.diagnosisDate') IS NOT NULL AND ${authorized("a.customer_id")})`,
      conditionParams: [
        record.id,
        record.revision,
        source.customer.revision,
        source.customer.name,
        source.case.revision,
        source.case.name,
        context.actorId,
      ],
      writes: (reservationId) => [
        this.db
          .prepare(
            "INSERT INTO reports(id,assessment_id,customer_id,assessment_revision,snapshot_json,snapshot_sha256,schema_version,renderer_version,created_by,created_at) SELECT ?,a.id,a.customer_id,a.revision,?,?,?,?,?,? FROM assessments a JOIN customers c ON c.id=a.customer_id JOIN cases k ON k.id=a.case_id WHERE a.id=? AND a.revision=? AND c.revision=? AND k.revision=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            report.reportId,
            JSON.stringify(snapshot),
            report.snapshotSha256,
            snapshot.schemaVersion,
            snapshot.rendererVersion,
            context.actorId,
            snapshot.createdAt,
            record.id,
            record.revision,
            source.customer.revision,
            source.case.revision,
            reservationId,
          ),
        this.db
          .prepare(
            "INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,?,'report.finalize','report',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            report.reportId,
            context.actorId,
            record.customerId,
            report.reportId,
            record.revision,
            record.revision,
            context.requestId,
            snapshot.createdAt,
            reservationId,
          ),
      ],
    });
  }
  async list(id: string, actorId: string, query: ReportListQuery) {
    await this.assessments.get(id, actorId);
    let after: z.infer<typeof cursorSchema> | null = null;
    if (query.cursor) {
      try {
        after = cursorSchema.parse(JSON.parse(atob(query.cursor)));
      } catch {
        throw new DomainError("VALIDATION_ERROR");
      }
      if (
        !(await this.db
          .prepare(
            `SELECT id FROM reports r WHERE r.id=? AND r.assessment_id=? AND r.created_at=? AND ${authorized("r.customer_id")}`,
          )
          .bind(after.id, id, after.createdAt, actorId)
          .first())
      )
        throw new DomainError("VALIDATION_ERROR");
    }
    const rows = await this.db
      .prepare(
        `SELECT r.id,r.assessment_revision AS assessmentRevision,r.created_at AS createdAt,r.created_by AS createdBy FROM reports r WHERE r.assessment_id=? AND ${authorized("r.customer_id")} AND (? IS NULL OR r.created_at<? OR (r.created_at=? AND r.id<?)) ORDER BY r.created_at DESC,r.id DESC LIMIT ?`,
      )
      .bind(
        id,
        actorId,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.createdAt ?? null,
        after?.id ?? null,
        query.limit + 1,
      )
      .all<ReportListItem>();
    const items = rows.results.slice(0, query.limit),
      last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.results.length > query.limit && last
          ? btoa(JSON.stringify({ id: last.id, createdAt: last.createdAt }))
          : null,
    };
  }
  async get(id: string, actorId: string): Promise<SavedReport> {
    const row = await this.db
      .prepare(
        `SELECT r.id AS reportId,r.snapshot_sha256 AS snapshotSha256,r.snapshot_json AS snapshotJson FROM reports r WHERE r.id=? AND ${authorized("r.customer_id")}`,
      )
      .bind(id, actorId)
      .first<{ reportId: string; snapshotSha256: string; snapshotJson: string }>();
    if (!row) throw new DomainError("NOT_FOUND");
    return {
      reportId: row.reportId,
      snapshotSha256: row.snapshotSha256,
      snapshot: JSON.parse(row.snapshotJson),
    };
  }
}
