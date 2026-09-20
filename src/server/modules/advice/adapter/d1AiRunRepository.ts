import type { AiRunDto } from "../../../../shared/contracts/aiAdvice";
import type { Advice, AssessmentRecord } from "../../../../shared/contracts/assessment";
import type { AiContext, AiRunRepository } from "../domain/aiPort";
import { DomainError } from "../../assessment/domain/assessment";
import { D1AssessmentRepository } from "../../assessment/adapter/d1AssessmentRepository";
import { D1OperationLedger } from "../../assessment/adapter/d1OperationLedger";

type Row = Omit<AiRunDto, "draft"> & { draftJson: string | null };
const columns =
  "id AS runId,criterion_id AS criterionId,status,draft_json AS draftJson,input_hash AS inputHash,basis_hash AS basisHash,error_code AS errorCode";
const active = "status IN ('pending','running')";
const reserved = "EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)";
const authorized =
  "EXISTS(SELECT 1 FROM app_users u WHERE u.id=? AND u.status='active' AND (u.role='admin' OR EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.customer_id=a.customer_id)))";
export class D1AiRunRepository implements AiRunRepository {
  private readonly db: D1Database;
  private readonly now: () => number;
  private readonly ledger: D1OperationLedger;
  private readonly assessments: D1AssessmentRepository;
  constructor(db: D1Database, now: () => number) {
    this.db = db;
    this.now = now;
    this.ledger = new D1OperationLedger(db);
    this.assessments = new D1AssessmentRepository(db);
  }
  private cutoff() {
    return new Date(this.now() - 60000).toISOString();
  }
  private async expire(actorId: string) {
    await this.db
      .prepare(
        `UPDATE ai_runs SET status='failed',error_code='AI_TIMEOUT' WHERE requested_by=? AND ${active} AND created_at<=?`,
      )
      .bind(actorId, this.cutoff())
      .run();
  }
  async replay(context: AiContext, assessmentId: string) {
    await this.assessments.get(assessmentId, context.actorId);
    const receipt = await this.ledger.replay<{ runId: string }>(
      context.actorId,
      context.key,
      context.requestHash,
    );
    return receipt ? this.get(assessmentId, receipt.runId, context.actorId) : null;
  }
  async get(assessmentId: string, runId: string, actorId: string): Promise<AiRunDto> {
    const record = await this.assessments.get(assessmentId, actorId);
    await this.db
      .prepare(
        `UPDATE ai_runs SET status='failed',error_code='AI_TIMEOUT' WHERE id=? AND assessment_id=? AND ${active} AND created_at<=?`,
      )
      .bind(runId, assessmentId, this.cutoff())
      .run();
    const row = await this.db
      .prepare(`SELECT ${columns} FROM ai_runs WHERE id=? AND assessment_id=?`)
      .bind(runId, assessmentId)
      .first<Row>();
    if (!row) throw new DomainError("NOT_FOUND");
    if (
      row.basisHash !== record.document.responses[row.criterionId]?.basisHash &&
      row.status !== "failed"
    ) {
      await this.db
        // Keep an in-flight provider in the concurrency slot until finish/expiry.
        .prepare("UPDATE ai_runs SET status='stale' WHERE id=? AND status='succeeded'")
        .bind(runId)
        .run();
      row.status = "stale";
    }
    const { draftJson, ...rest } = row;
    return { ...rest, draft: draftJson ? (JSON.parse(draftJson) as Advice) : null };
  }
  private async rateLimited(actorId: string) {
    return Boolean(
      await this.db
        .prepare(
          `SELECT 1 WHERE EXISTS(SELECT 1 FROM ai_runs WHERE requested_by=? AND ${active}) OR (SELECT count(*) FROM ai_runs WHERE requested_by=? AND created_at>?)>=5`,
        )
        .bind(actorId, actorId, this.cutoff())
        .first(),
    );
  }
  async reserve(
    record: AssessmentRecord,
    criterionId: string,
    inputHash: string,
    context: AiContext,
  ) {
    const replay = await this.replay(context, record.id);
    if (replay) return { run: replay, execute: false };
    await this.expire(context.actorId);
    const archived = await this.db
      .prepare(
        "SELECT 1 FROM cases k JOIN customers c ON c.id=k.customer_id WHERE k.id=? AND (k.archived_at IS NOT NULL OR c.archived_at IS NOT NULL)",
      )
      .bind(record.caseId)
      .first();
    if (archived) throw new DomainError("ARCHIVED");
    const runId = crypto.randomUUID(),
      stamp = new Date(this.now()).toISOString();
    let receipt: { runId: string };
    try {
      receipt = await this.ledger.execute({
        ...context,
        resourceId: runId,
        response: { runId },
        conditionSql: `EXISTS(SELECT 1 FROM assessments a JOIN cases k ON k.id=a.case_id JOIN customers c ON c.id=a.customer_id WHERE a.id=? AND a.revision=? AND k.archived_at IS NULL AND c.archived_at IS NULL AND ${authorized}) AND NOT EXISTS(SELECT 1 FROM ai_runs WHERE requested_by=? AND ${active}) AND (SELECT count(*) FROM ai_runs WHERE requested_by=? AND created_at>?)<5`,
        conditionParams: [
          record.id,
          record.revision,
          context.actorId,
          context.actorId,
          context.actorId,
          this.cutoff(),
        ],
        writes: (reservationId) => [
          this.db
            .prepare(
              `INSERT INTO ai_runs(id,assessment_id,criterion_id,input_hash,basis_hash,status,requested_by,created_at) SELECT ?,?,?,?,?,'running',?,? WHERE ${reserved}`,
            )
            .bind(
              runId,
              record.id,
              criterionId,
              inputHash,
              record.document.responses[criterionId].basisHash,
              context.actorId,
              stamp,
              reservationId,
            ),
          this.db
            .prepare(
              `INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,?,'advice.generate','ai_run',?,?,?,?,? WHERE ${reserved}`,
            )
            .bind(
              crypto.randomUUID(),
              context.actorId,
              record.customerId,
              runId,
              record.revision,
              record.revision,
              context.requestId,
              stamp,
              reservationId,
            ),
        ],
      });
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "CONFLICT" &&
        (await this.rateLimited(context.actorId))
      )
        throw new DomainError("AI_RATE_LIMIT");
      throw error;
    }
    return {
      run: await this.get(record.id, receipt.runId, context.actorId),
      execute: receipt.runId === runId,
    };
  }
  async finish(
    assessmentId: string,
    runId: string,
    actorId: string,
    draft: Advice | null,
    errorCode: string | null,
  ) {
    // Never resurrect an expired or stale run, even if a provider returns after its deadline.
    await this.db
      .prepare(
        `UPDATE ai_runs SET status=?,draft_json=?,error_code=? WHERE id=? AND assessment_id=? AND ${active} AND created_at>?`,
      )
      .bind(
        errorCode ? "failed" : "succeeded",
        draft ? JSON.stringify(draft) : null,
        errorCode,
        runId,
        assessmentId,
        this.cutoff(),
      )
      .run();
    return this.get(assessmentId, runId, actorId);
  }
}
