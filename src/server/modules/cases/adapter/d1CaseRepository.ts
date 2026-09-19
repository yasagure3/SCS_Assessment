import { z } from "zod";
import type {
  Customer,
  CaseRecord,
  CaseCreated,
  AssessmentListItem,
  CreateCase,
  PatchEntity,
  ListQuery,
} from "../../../../shared/contracts/cases";
import type { AssessmentDocument } from "../../../../shared/contracts/assessment";
import type { ApiPage } from "../../../../shared/contracts/api";
import type { CaseRepository, WriteContext } from "../domain/case";
import { DomainError } from "../../../../shared/errors";
import { D1OperationLedger } from "../../assessment/adapter/d1OperationLedger";

const columns =
  "id,name,revision,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt";
const auth = (customerColumn: string) =>
  `EXISTS(SELECT 1 FROM app_users u WHERE u.id=? AND u.status='active' AND (u.role='admin' OR EXISTS(SELECT 1 FROM customer_memberships m WHERE m.user_id=u.id AND m.customer_id=${customerColumn})))`;
const cursorSchema = z.strictObject({ updatedAt: z.iso.datetime(), id: z.uuid() });
function cursor(query: ListQuery) {
  try {
    return query.cursor ? cursorSchema.parse(JSON.parse(atob(query.cursor))) : null;
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
}
function page<T extends { id: string; updatedAt: string }>(rows: T[], limit: number): ApiPage<T> {
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? btoa(JSON.stringify({ updatedAt: last.updatedAt, id: last.id }))
        : null,
  };
}
export class D1CaseRepository implements CaseRepository {
  private readonly db: D1Database;
  private readonly ledger: D1OperationLedger;
  constructor(db: D1Database) {
    this.db = db;
    this.ledger = new D1OperationLedger(db);
  }
  private async active(actorId: string) {
    if (
      !(await this.db
        .prepare("SELECT id FROM app_users WHERE id=? AND status='active'")
        .bind(actorId)
        .first())
    )
      throw new DomainError("ACCOUNT_DISABLED");
  }
  async customer(id: string, actorId: string): Promise<Customer> {
    const row = await this.db
      .prepare(`SELECT ${columns} FROM customers c WHERE c.id=? AND ${auth("c.id")}`)
      .bind(id, actorId)
      .first<Customer>();
    if (!row) throw new DomainError("NOT_FOUND");
    return row;
  }
  async case(id: string, actorId: string): Promise<CaseRecord> {
    const row = await this.db
      .prepare(
        `SELECT ${columns},customer_id AS customerId FROM cases k WHERE k.id=? AND ${auth("k.customer_id")}`,
      )
      .bind(id, actorId)
      .first<CaseRecord>();
    if (!row) throw new DomainError("NOT_FOUND");
    return row;
  }
  async customers(actorId: string, query: ListQuery): Promise<ApiPage<Customer>> {
    await this.active(actorId);
    const after = cursor(query);
    const rows = await this.db
      .prepare(
        `SELECT ${columns} FROM customers c WHERE ${auth("c.id")} AND instr(lower(c.name),lower(?))>0 AND (? IS NULL OR c.updated_at<? OR (c.updated_at=? AND c.id<?)) ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`,
      )
      .bind(
        actorId,
        query.q,
        after?.updatedAt ?? null,
        after?.updatedAt ?? null,
        after?.updatedAt ?? null,
        after?.id ?? null,
        query.limit + 1,
      )
      .all<Customer>();
    return page(rows.results, query.limit);
  }
  async cases(customerId: string, actorId: string, query: ListQuery): Promise<ApiPage<CaseRecord>> {
    await this.customer(customerId, actorId);
    const after = cursor(query);
    const rows = await this.db
      .prepare(
        `SELECT ${columns},customer_id AS customerId FROM cases k WHERE k.customer_id=? AND ${auth("k.customer_id")} AND instr(lower(k.name),lower(?))>0 AND (? IS NULL OR k.updated_at<? OR (k.updated_at=? AND k.id<?)) ORDER BY k.updated_at DESC,k.id DESC LIMIT ?`,
      )
      .bind(
        customerId,
        actorId,
        query.q,
        after?.updatedAt ?? null,
        after?.updatedAt ?? null,
        after?.updatedAt ?? null,
        after?.id ?? null,
        query.limit + 1,
      )
      .all<CaseRecord>();
    return page(rows.results, query.limit);
  }
  async assessments(
    caseId: string,
    actorId: string,
    query: ListQuery,
  ): Promise<ApiPage<AssessmentListItem>> {
    await this.case(caseId, actorId);
    const after = cursor(query);
    const rows = await this.db
      .prepare(
        `SELECT a.id,a.standard_id AS standardId,json_extract(a.document_json,'$.diagnosisDate') AS diagnosisDate,a.revision,a.previous_assessment_id AS previousAssessmentId,a.created_at AS createdAt,a.updated_at AS updatedAt FROM assessments a WHERE a.case_id=? AND ${auth("a.customer_id")} AND (? IS NULL OR a.updated_at<? OR (a.updated_at=? AND a.id<?)) ORDER BY a.updated_at DESC,a.id DESC LIMIT ?`,
      )
      .bind(
        caseId,
        actorId,
        after?.updatedAt ?? null,
        after?.updatedAt ?? null,
        after?.updatedAt ?? null,
        after?.id ?? null,
        query.limit + 1,
      )
      .all<AssessmentListItem>();
    return page(rows.results, query.limit);
  }
  async criterionIds(standardId: string) {
    const result = await this.db
      .prepare("SELECT criterion_id AS id FROM criteria WHERE standard_id=? ORDER BY order_no")
      .bind(standardId)
      .all<{ id: string }>();
    return result.results.map((row) => row.id);
  }
  private audit(
    context: WriteContext,
    action: string,
    type: string,
    id: string,
    customerId: string,
    from: number | null,
    to: number,
    reservationId: string,
  ) {
    return this.db
      .prepare(
        "INSERT INTO audit_events(id,actor_id,customer_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
      )
      .bind(
        crypto.randomUUID(),
        context.actorId,
        customerId,
        action,
        type,
        id,
        from,
        to,
        context.requestId,
        new Date().toISOString(),
        reservationId,
      );
  }
  async createCustomer(name: string, context: WriteContext): Promise<Customer> {
    await this.active(context.actorId);
    const replay = await this.ledger.replay<Customer>(
      context.actorId,
      context.key,
      context.requestHash,
    );
    if (replay) {
      await this.customer(replay.id, context.actorId);
      return replay;
    }
    const id = crypto.randomUUID(),
      now = new Date().toISOString(),
      response: Customer = {
        id,
        name,
        revision: 1,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    return this.ledger.execute({
      ...context,
      resourceId: id,
      response,
      conditionSql: "EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active')",
      conditionParams: [context.actorId],
      writes: (reservationId) => [
        this.db
          .prepare(
            "INSERT INTO customers(id,name,revision,created_by,created_at,updated_at) SELECT ?,?,1,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(id, name, context.actorId, now, now, reservationId),
        this.db
          .prepare(
            "INSERT INTO customer_memberships(customer_id,user_id,created_by,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(id, context.actorId, context.actorId, now, reservationId),
        this.audit(context, "customer.create", "customer", id, id, null, 1, reservationId),
      ],
    });
  }
  async createCase(
    customerId: string,
    input: CreateCase,
    document: AssessmentDocument,
    context: WriteContext,
  ): Promise<CaseCreated> {
    const customer = await this.customer(customerId, context.actorId),
      replay = await this.ledger.replay<CaseCreated>(
        context.actorId,
        context.key,
        context.requestHash,
      );
    if (replay) return replay;
    if (customer.archivedAt) throw new DomainError("ARCHIVED");
    const id = crypto.randomUUID(),
      assessmentId = crypto.randomUUID(),
      now = new Date().toISOString();
    const response: CaseCreated = {
      case: {
        id,
        customerId,
        name: input.name,
        revision: 1,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      assessmentId,
      assessmentRevision: 1,
    };
    return this.ledger.execute({
      ...context,
      resourceId: id,
      response,
      conditionSql: `EXISTS(SELECT 1 FROM customers c WHERE c.id=? AND c.archived_at IS NULL AND ${auth("c.id")})`,
      conditionParams: [customerId, context.actorId],
      writes: (reservationId) => [
        this.db
          .prepare(
            "INSERT INTO cases(id,customer_id,name,revision,created_by,created_at,updated_at) SELECT ?,?,?,1,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(id, customerId, input.name, context.actorId, now, now, reservationId),
        this.db
          .prepare(
            "INSERT INTO assessments(id,case_id,customer_id,standard_id,revision,document_json,mutation_id,request_hash,actor_id,created_at,updated_at) SELECT ?,?,?,?,1,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            assessmentId,
            id,
            customerId,
            input.standardId,
            JSON.stringify(document),
            context.key,
            context.requestHash,
            context.actorId,
            now,
            now,
            reservationId,
          ),
        this.audit(context, "case.create", "case", id, customerId, null, 1, reservationId),
        this.audit(
          context,
          "assessment.create",
          "assessment",
          assessmentId,
          customerId,
          null,
          1,
          reservationId,
        ),
      ],
    });
  }
  async patchCustomer(id: string, input: PatchEntity, context: WriteContext): Promise<Customer> {
    return this.patch("customers", await this.customer(id, context.actorId), input, context);
  }
  async patchCase(id: string, input: PatchEntity, context: WriteContext): Promise<CaseRecord> {
    const current = await this.case(id, context.actorId);
    return this.patch("cases", current, input, context);
  }
  private async patch<T extends Customer | CaseRecord>(
    table: "customers" | "cases",
    current: T,
    input: PatchEntity,
    context: WriteContext,
  ): Promise<T> {
    const replay = await this.ledger.replay<T>(context.actorId, context.key, context.requestHash);
    if (replay) return replay;
    if (current.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
    const customerId = "customerId" in current ? current.customerId : current.id;
    if (table === "cases" && (await this.customer(customerId, context.actorId)).archivedAt)
      throw new DomainError("ARCHIVED");
    if (
      current.archivedAt &&
      input.archived !== false &&
      input.name !== undefined &&
      input.name !== current.name
    )
      throw new DomainError("ARCHIVED");
    const now = new Date().toISOString(),
      archivedAt =
        input.archived === undefined
          ? current.archivedAt
          : input.archived
            ? (current.archivedAt ?? now)
            : null;
    const changed =
      (input.name ?? current.name) !== current.name || archivedAt !== current.archivedAt;
    const next = {
      ...current,
      name: input.name ?? current.name,
      archivedAt,
      revision: current.revision + Number(changed),
      updatedAt: changed ? now : current.updatedAt,
    };
    const column = table === "customers" ? "e.id" : "e.customer_id";
    const parentGuard =
      table === "cases"
        ? " AND EXISTS(SELECT 1 FROM customers c WHERE c.id=e.customer_id AND c.archived_at IS NULL)"
        : "";
    return this.ledger.execute({
      ...context,
      resourceId: current.id,
      response: next,
      conditionSql: `EXISTS(SELECT 1 FROM ${table} e WHERE e.id=? AND e.revision=? AND ${auth(column)}${parentGuard})`,
      conditionParams: [current.id, input.expectedRevision, context.actorId],
      writes: (reservationId) => [
        ...(changed
          ? [
              this.db
                .prepare(
                  `UPDATE ${table} SET name=?,archived_at=?,revision=revision+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)`,
                )
                .bind(next.name, next.archivedAt, next.updatedAt, current.id, reservationId),
            ]
          : []),
        this.audit(
          context,
          table === "customers" ? "customer.update" : "case.update",
          table === "customers" ? "customer" : "case",
          current.id,
          customerId,
          current.revision,
          next.revision,
          reservationId,
        ),
      ],
    });
  }
}
