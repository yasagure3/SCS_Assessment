import { z } from "zod";
import type {
  AccessManagementRepository,
  AccessWriteContext,
  InvitationAttempt,
} from "../domain/accessManagement";
import { DomainError } from "../domain/authorize";
import { ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS } from "../domain/tokenTime";
import type {
  InviteInput,
  UpdateUserInput,
  MembersInput,
  ManagedUser,
  Invitation,
  InvitationResult,
  Members,
} from "../../../../shared/contracts/access";
import type { ListQuery } from "../../../../shared/contracts/cases";
import type { ApiPage } from "../../../../shared/contracts/api";
import { D1OperationLedger } from "../../assessment/adapter/d1OperationLedger";
import { operationHash } from "../../assessment/domain/assessment";

const adminGuard =
  "EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active' AND role='admin')";
const reserved = "EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)";
const days7 = 7 * 86400000;
const lease = 5 * 60000;
type InvitationRow = {
  invitationId: string;
  userId: string;
  email: string;
  sub: string | null;
  role: "admin" | "staff";
  userStatus: ManagedUser["status"];
  status: InvitationResult["status"];
  expiresAt: string;
  lastErrorCode: string | null;
  attemptId: string | null;
  processingStartedAt: string | null;
};
const invitationColumns =
  "i.id AS invitationId,i.user_id AS userId,u.email_normalized AS email,u.cognito_sub AS sub,u.role,u.status AS userStatus,i.status,i.expires_at AS expiresAt,i.last_error_code AS lastErrorCode,i.attempt_id AS attemptId,i.processing_started_at AS processingStartedAt";
function after(query: ListQuery): string | null {
  try {
    return query.cursor ? z.uuid().parse(atob(query.cursor)) : null;
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
}
function page<T>(rows: T[], limit: number, id: (row: T) => string): ApiPage<T> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? btoa(id(items[items.length - 1])) : null };
}

export class D1AccessManagementRepository implements AccessManagementRepository {
  private readonly ledger: D1OperationLedger;
  private readonly db: D1Database;
  private readonly now: () => number;
  constructor(db: D1Database, now: () => number) {
    this.db = db;
    this.now = now;
    this.ledger = new D1OperationLedger(db);
  }
  private async admin(actorId: string) {
    if (!(await this.db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(actorId).first()))
      throw new DomainError("FORBIDDEN");
  }
  private audit(
    context: AccessWriteContext,
    action: string,
    type: string,
    id: string,
    reservationId: string,
    from: number | null = null,
    to: number | null = null,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${reserved}`,
      )
      .bind(
        crypto.randomUUID(),
        context.actorId,
        action,
        type,
        id,
        from,
        to,
        context.requestId,
        new Date(this.now()).toISOString(),
        reservationId,
      );
  }
  private async user(id: string): Promise<ManagedUser> {
    const row = await this.db
      .prepare("SELECT id,email_normalized AS email,role,status,revision FROM app_users WHERE id=?")
      .bind(id)
      .first<Omit<ManagedUser, "customerIds">>();
    if (!row) throw new DomainError("NOT_FOUND");
    const memberships = await this.db
      .prepare(
        "SELECT customer_id AS id FROM customer_memberships WHERE user_id=? ORDER BY customer_id",
      )
      .bind(id)
      .all<{ id: string }>();
    return { ...row, customerIds: memberships.results.map((row) => row.id) };
  }
  async users(actorId: string, query: ListQuery) {
    await this.admin(actorId);
    const cursor = after(query);
    const rows = await this.db
      .prepare(
        `SELECT id FROM app_users WHERE ${adminGuard} AND (? IS NULL OR id>?) ORDER BY id LIMIT ?`,
      )
      .bind(actorId, cursor, cursor, query.limit + 1)
      .all<{ id: string }>();
    return page(
      await Promise.all(rows.results.map((row) => this.user(row.id))),
      query.limit,
      (row) => row.id,
    );
  }
  private display(row: InvitationRow): Invitation {
    const expired = row.status === "sent" && Date.parse(row.expiresAt) <= this.now();
    const retryAllowed =
      row.userStatus === "invited" &&
      (row.status === "pending" ||
        row.status === "failed" ||
        row.status === "expired" ||
        expired ||
        (row.status === "processing" &&
          Date.parse(row.processingStartedAt!) <= this.now() - lease));
    return {
      invitationId: row.invitationId,
      userId: row.userId,
      email: row.email,
      role: row.role,
      userStatus: row.userStatus,
      status: expired ? "expired" : row.status,
      expiresAt: row.expiresAt,
      lastErrorCode: row.lastErrorCode,
      retryAllowed,
    };
  }
  private async invitation(id: string): Promise<InvitationRow> {
    const row = await this.db
      .prepare(
        `SELECT ${invitationColumns} FROM invitations i JOIN app_users u ON u.id=i.user_id WHERE i.id=?`,
      )
      .bind(id)
      .first<InvitationRow>();
    if (!row) throw new DomainError("NOT_FOUND");
    return row;
  }
  async invitations(actorId: string, query: ListQuery) {
    await this.admin(actorId);
    const cursor = after(query);
    const rows = await this.db
      .prepare(
        `SELECT ${invitationColumns} FROM invitations i JOIN app_users u ON u.id=i.user_id WHERE ${adminGuard} AND (? IS NULL OR i.id>?) ORDER BY i.id LIMIT ?`,
      )
      .bind(actorId, cursor, cursor, query.limit + 1)
      .all<InvitationRow>();
    return page(
      rows.results.map((row) => this.display(row)),
      query.limit,
      (row) => row.invitationId,
    );
  }
  async invitationResult(id: string, actorId: string) {
    await this.admin(actorId);
    const row = this.display(await this.invitation(id));
    return {
      invitationId: row.invitationId,
      status: row.status,
      expiresAt: row.expiresAt,
      lastErrorCode: row.lastErrorCode,
    };
  }
  async reserve(input: InviteInput, context: AccessWriteContext) {
    await this.admin(context.actorId);
    const replay = await this.ledger.replay<{ invitationId: string }>(
      context.actorId,
      context.key,
      context.requestHash,
    );
    if (replay) return replay.invitationId;
    if (
      await this.db
        .prepare("SELECT id FROM app_users WHERE email_normalized=?")
        .bind(input.email)
        .first()
    )
      throw new DomainError("INVITATION_EXISTS");
    const customerJson = JSON.stringify(input.customerIds);
    const valid = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM customers WHERE archived_at IS NULL AND id IN (SELECT value FROM json_each(?))",
      )
      .bind(customerJson)
      .first<{ count: number }>();
    if (valid!.count !== input.customerIds.length) throw new DomainError("VALIDATION_ERROR");
    const userId = crypto.randomUUID(),
      invitationId = crypto.randomUUID(),
      now = new Date(this.now()).toISOString(),
      expiresAt = new Date(this.now() + days7).toISOString();
    const result = await this.ledger.execute({
      ...context,
      resourceId: invitationId,
      response: { invitationId },
      conditionSql: `${adminGuard} AND NOT EXISTS(SELECT 1 FROM app_users WHERE email_normalized=?) AND (SELECT COUNT(*) FROM customers WHERE archived_at IS NULL AND id IN (SELECT value FROM json_each(?)))=?`,
      conditionParams: [context.actorId, input.email, customerJson, input.customerIds.length],
      writes: (reservationId) => [
        this.db
          .prepare(
            `INSERT INTO app_users(id,email_normalized,role,status,revision,created_at,updated_at) SELECT ?,?,?,'invited',1,?,? WHERE ${reserved}`,
          )
          .bind(userId, input.email, input.role, now, now, reservationId),
        this.db
          .prepare(
            `INSERT INTO invitations(id,user_id,status,expires_at,created_by,created_at) SELECT ?,?,'pending',?,?,? WHERE ${reserved}`,
          )
          .bind(invitationId, userId, expiresAt, context.actorId, now, reservationId),
        this.db
          .prepare(
            `INSERT INTO customer_memberships(customer_id,user_id,created_by,created_at) SELECT value,?,?,? FROM json_each(?) WHERE ${reserved}`,
          )
          .bind(userId, context.actorId, now, customerJson, reservationId),
        this.db
          .prepare(
            `UPDATE customers SET revision=revision+1,updated_at=? WHERE id IN (SELECT value FROM json_each(?)) AND ${reserved}`,
          )
          .bind(now, customerJson, reservationId),
        this.audit(context, "invitation.reserve", "invitation", invitationId, reservationId),
      ],
    });
    return result.invitationId;
  }
  async claim(
    invitationId: string,
    retry: boolean,
    context: AccessWriteContext,
  ): Promise<InvitationAttempt | null> {
    await this.admin(context.actorId);
    const claimContext = retry
      ? context
      : {
          ...context,
          key: `invitation-attempt:${context.key}`,
          requestHash: await operationHash("SYSTEM", "/invitations/issue", invitationId, {}),
        };
    if (await this.ledger.replay(claimContext.actorId, claimContext.key, claimContext.requestHash))
      return null;
    const row = await this.invitation(invitationId);
    if (row.userStatus !== "invited") throw new DomainError("INVITATION_NOT_RETRYABLE");
    if (retry ? !this.display(row).retryAllowed : row.status !== "pending") {
      if (retry) throw new DomainError("INVITATION_NOT_RETRYABLE");
      return null;
    }
    const attemptId = crypto.randomUUID(),
      now = new Date(this.now()).toISOString(),
      cutoff = new Date(this.now() - lease).toISOString();
    const result = await this.ledger.execute({
      ...claimContext,
      resourceId: invitationId,
      response: { attemptId },
      conditionSql: `${adminGuard} AND EXISTS(SELECT 1 FROM invitations i JOIN app_users u ON u.id=i.user_id WHERE i.id=? AND u.status='invited' AND ${retry ? "(i.status IN ('pending','failed','expired') OR (i.status='sent' AND i.expires_at<=?) OR (i.status='processing' AND i.processing_started_at<=?))" : "i.status='pending'"})`,
      conditionParams: retry
        ? [context.actorId, invitationId, now, cutoff]
        : [context.actorId, invitationId],
      writes: (reservationId) => [
        this.db
          .prepare(
            `UPDATE invitations SET status='processing',attempt_id=?,processing_started_at=?,last_error_code=NULL WHERE id=? AND ${reserved}`,
          )
          .bind(attemptId, now, invitationId, reservationId),
        this.audit(context, "invitation.processing", "invitation", invitationId, reservationId),
      ],
    });
    return result.attemptId === attemptId
      ? { invitationId, userId: row.userId, email: row.email, sub: row.sub, attemptId }
      : null;
  }
  async bindSubject(attempt: InvitationAttempt, sub: string, context: AccessWriteContext) {
    await this.ledger.execute({
      ...context,
      key: `invitation-subject:${attempt.attemptId}`,
      requestHash: await operationHash("SYSTEM", "/invitations/subject", attempt.invitationId, {
        sub,
      }),
      resourceId: attempt.invitationId,
      response: { sub },
      conditionSql:
        "EXISTS(SELECT 1 FROM invitations i JOIN app_users u ON u.id=i.user_id WHERE i.id=? AND i.attempt_id=? AND i.status='processing' AND u.status='invited' AND u.cognito_sub IS NULL)",
      conditionParams: [attempt.invitationId, attempt.attemptId],
      writes: (reservationId) => [
        this.db
          .prepare(
            `UPDATE app_users SET cognito_sub=?,revision=revision+1,updated_at=? WHERE id=? AND ${reserved}`,
          )
          .bind(sub, new Date(this.now()).toISOString(), attempt.userId, reservationId),
        this.audit(
          context,
          "invitation.subject",
          "invitation",
          attempt.invitationId,
          reservationId,
        ),
      ],
    });
  }
  async finish(attempt: InvitationAttempt, errorCode: string | null, context: AccessWriteContext) {
    const status = errorCode ? "failed" : "sent",
      expiresAt = new Date(this.now() + days7).toISOString();
    await this.ledger.execute({
      ...context,
      key: `invitation-result:${attempt.attemptId}`,
      requestHash: await operationHash("SYSTEM", "/invitations/result", attempt.invitationId, {
        status,
        errorCode,
      }),
      resourceId: attempt.invitationId,
      response: { status },
      conditionSql:
        "EXISTS(SELECT 1 FROM invitations WHERE id=? AND attempt_id=? AND status='processing')",
      conditionParams: [attempt.invitationId, attempt.attemptId],
      writes: (reservationId) => [
        this.db
          .prepare(
            `UPDATE invitations SET status=?,last_error_code=?,expires_at=? WHERE id=? AND ${reserved}`,
          )
          .bind(status, errorCode, expiresAt, attempt.invitationId, reservationId),
        this.audit(
          context,
          `invitation.${status}`,
          "invitation",
          attempt.invitationId,
          reservationId,
        ),
      ],
    });
  }
  async updateUser(id: string, input: UpdateUserInput, context: AccessWriteContext) {
    await this.admin(context.actorId);
    const replay = await this.ledger.replay<ManagedUser>(
      context.actorId,
      context.key,
      context.requestHash,
    );
    if (replay) return replay;
    const current = await this.user(id);
    if (current.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
    const notActivated = await this.db
      .prepare(
        "SELECT 1 FROM invitations WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM audit_events WHERE action='user.activate' AND resource_id=?)",
      )
      .bind(id, id)
      .first();
    const nextStatus: ManagedUser["status"] =
      input.status === "active" && (current.status === "invited" || notActivated)
        ? "invited"
        : input.status;
    const removingAdmin =
      current.role === "admin" &&
      current.status === "active" &&
      (input.role !== "admin" || input.status !== "active");
    const adminCount = await this.db
      .prepare("SELECT COUNT(*) AS count FROM app_users WHERE role='admin' AND status='active'")
      .first<{ count: number }>();
    if (removingAdmin && adminCount!.count <= 1) throw new DomainError("LAST_ADMIN");
    const changed = input.role !== current.role || nextStatus !== current.status,
      response = {
        ...current,
        role: input.role,
        status: nextStatus,
        revision: current.revision + Number(changed),
      };
    const stamp = new Date(this.now()).toISOString(),
      cutoff = Math.floor(this.now() / 1000) + ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS;
    try {
      return await this.ledger.execute({
        ...context,
        resourceId: id,
        response,
        conditionSql: `${adminGuard} AND EXISTS(SELECT 1 FROM app_users WHERE id=? AND revision=?) AND (?=0 OR (SELECT COUNT(*) FROM app_users WHERE role='admin' AND status='active')>1)`,
        conditionParams: [context.actorId, id, input.expectedRevision, Number(removingAdmin)],
        writes: (reservationId) => [
          ...(changed
            ? [
                this.db
                  .prepare(
                    `UPDATE app_users SET role=?,status=?,revision=revision+1,updated_at=?,revoked_before=CASE WHEN ?='suspended' THEN max(COALESCE(revoked_before,0),?) ELSE revoked_before END WHERE id=? AND ${reserved}`,
                  )
                  .bind(input.role, nextStatus, stamp, input.status, cutoff, id, reservationId),
              ]
            : []),
          this.audit(
            context,
            "user.update",
            "app_user",
            id,
            reservationId,
            current.revision,
            response.revision,
          ),
        ],
      });
    } catch (error) {
      if (
        removingAdmin &&
        (await this.db
          .prepare("SELECT COUNT(*) AS count FROM app_users WHERE role='admin' AND status='active'")
          .first<{ count: number }>())!.count <= 1
      )
        throw new DomainError("LAST_ADMIN");
      throw error;
    }
  }
  async members(customerId: string, actorId: string): Promise<Members> {
    await this.admin(actorId);
    const customer = await this.db
      .prepare("SELECT revision FROM customers WHERE id=?")
      .bind(customerId)
      .first<{ revision: number }>();
    if (!customer) throw new DomainError("NOT_FOUND");
    const rows = await this.db
      .prepare(
        "SELECT user_id AS id FROM customer_memberships WHERE customer_id=? ORDER BY user_id",
      )
      .bind(customerId)
      .all<{ id: string }>();
    return { customerId, revision: customer.revision, userIds: rows.results.map((row) => row.id) };
  }
  async replaceMembers(customerId: string, input: MembersInput, context: AccessWriteContext) {
    await this.admin(context.actorId);
    const current = await this.members(customerId, context.actorId),
      replay = await this.ledger.replay<Members>(context.actorId, context.key, context.requestHash);
    if (replay) return replay;
    if (current.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
    const json = JSON.stringify([...input.userIds].sort());
    const valid = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM app_users WHERE status IN ('active','invited') AND id IN (SELECT value FROM json_each(?))",
      )
      .bind(json)
      .first<{ count: number }>();
    if (valid!.count !== input.userIds.length) throw new DomainError("VALIDATION_ERROR");
    const changed = JSON.stringify(current.userIds) !== json,
      response = {
        customerId,
        revision: current.revision + Number(changed),
        userIds: [...input.userIds].sort(),
      },
      stamp = new Date(this.now()).toISOString();
    return this.ledger.execute({
      ...context,
      resourceId: customerId,
      response,
      conditionSql: `${adminGuard} AND EXISTS(SELECT 1 FROM customers WHERE id=? AND revision=? AND archived_at IS NULL) AND (SELECT COUNT(*) FROM app_users WHERE status IN ('active','invited') AND id IN (SELECT value FROM json_each(?)))=?`,
      conditionParams: [
        context.actorId,
        customerId,
        input.expectedRevision,
        json,
        input.userIds.length,
      ],
      writes: (reservationId) => [
        ...(changed
          ? [
              this.db
                .prepare(`DELETE FROM customer_memberships WHERE customer_id=? AND ${reserved}`)
                .bind(customerId, reservationId),
              this.db
                .prepare(
                  `INSERT INTO customer_memberships SELECT ?,value,?,? FROM json_each(?) WHERE ${reserved}`,
                )
                .bind(customerId, context.actorId, stamp, json, reservationId),
              this.db
                .prepare(
                  `UPDATE customers SET revision=revision+1,updated_at=? WHERE id=? AND ${reserved}`,
                )
                .bind(stamp, customerId, reservationId),
            ]
          : []),
        this.audit(
          context,
          "customer.members",
          "customer",
          customerId,
          reservationId,
          current.revision,
          response.revision,
        ),
      ],
    });
  }
}
