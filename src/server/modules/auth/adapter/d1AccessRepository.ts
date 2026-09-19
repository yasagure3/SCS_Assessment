import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { appUsers } from "../../../db/schema";
import type { AccessRepository, AppUser } from "../domain/authorize";
import type { AccessTokenClaims } from "../domain/verifyAccessToken";
import { ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS } from "../domain/tokenTime";
import { D1OperationLedger } from "../../assessment/adapter/d1OperationLedger";
import { operationHash, DomainError } from "../../assessment/domain/assessment";

export class D1AccessRepository implements AccessRepository {
  private readonly db: D1Database;
  private readonly now: () => number;
  constructor(db: D1Database, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }
  async findBySubject(sub: string): Promise<AppUser | null> {
    return (
      (await drizzle(this.db).select().from(appUsers).where(eq(appUsers.cognitoSub, sub)).get()) ??
      null
    );
  }
  async customerIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .prepare(
        "SELECT customer_id AS id FROM customer_memberships WHERE user_id=? ORDER BY customer_id",
      )
      .bind(userId)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }
  async activate(user: AppUser, claims: AccessTokenClaims, requestId: string): Promise<void> {
    const now = new Date(this.now()).toISOString();
    const invitation = await this.db
      .prepare("SELECT status,expires_at AS expiresAt FROM invitations WHERE user_id=?")
      .bind(user.id)
      .first<{ status: string; expiresAt: string }>();
    if (invitation && (invitation.status !== "sent" || invitation.expiresAt <= now))
      throw new DomainError("ACCOUNT_DISABLED");
    await new D1OperationLedger(this.db).execute({
      actorId: user.id,
      key: `activate:${user.id}`,
      requestHash: await operationHash("SYSTEM", "/users/activate", user.id, { sub: claims.sub }),
      resourceId: user.id,
      response: { activated: true },
      conditionSql:
        "EXISTS(SELECT 1 FROM app_users WHERE id=? AND cognito_sub=? AND status='invited' AND revision=? AND (revoked_before IS NULL OR revoked_before<?)) AND NOT EXISTS(SELECT 1 FROM invitations WHERE user_id=? AND (status<>'sent' OR expires_at<=?))",
      conditionParams: [user.id, claims.sub, user.revision, claims.auth_time, user.id, now],
      writes: (reservationId) => [
        this.db
          .prepare(
            "UPDATE app_users SET status='active',revision=revision+1,updated_at=? WHERE id=? AND status='invited' AND revision=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(now, user.id, user.revision, reservationId),
        this.db
          .prepare(
            "INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,'user.activate','app_user',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            crypto.randomUUID(),
            user.id,
            user.id,
            user.revision,
            user.revision + 1,
            requestId,
            now,
            reservationId,
          ),
      ],
    });
  }
  async revoke(
    user: AppUser,
    key: string,
    requestId: string,
  ): Promise<{ id: string; revokedAt: string }> {
    const id = crypto.randomUUID(),
      timestamp = this.now(),
      cutoff = Math.max(
        Math.floor(timestamp / 1000) + ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
        user.revokedBefore ?? 0,
      ),
      now = new Date(timestamp).toISOString();
    return new D1OperationLedger(this.db).execute({
      actorId: user.id,
      key,
      requestHash: await operationHash("POST", "/api/v1/session/revoke", user.id, {}),
      resourceId: user.id,
      response: { id, revokedAt: new Date(cutoff * 1000).toISOString() },
      conditionSql: "EXISTS(SELECT 1 FROM app_users WHERE id=? AND status='active' AND revision=?)",
      conditionParams: [user.id, user.revision],
      writes: (reservationId) => [
        this.db
          .prepare(
            "UPDATE app_users SET revoked_before=?,revision=revision+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(cutoff, now, user.id, reservationId),
        this.db
          .prepare(
            "INSERT INTO auth_revocations(id,user_id,revoked_before,status,request_id,created_at,updated_at) SELECT ?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(id, user.id, cutoff, requestId, now, now, reservationId),
        this.db
          .prepare(
            "INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,from_revision,to_revision,request_id,created_at) SELECT ?,?,'session.revoke','app_user',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            crypto.randomUUID(),
            user.id,
            user.id,
            user.revision,
            user.revision + 1,
            requestId,
            now,
            reservationId,
          ),
      ],
    });
  }
  async claimRevocation(id: string, userId: string): Promise<boolean> {
    const now = new Date().toISOString(),
      attempt = crypto.randomUUID();
    try {
      await new D1OperationLedger(this.db).execute({
        actorId: userId,
        key: `revoke-claim:${id}:${attempt}`,
        requestHash: await operationHash("SYSTEM", "/session/revoke-claim", id, {}),
        resourceId: id,
        response: { claimed: true },
        conditionSql:
          "EXISTS(SELECT 1 FROM auth_revocations WHERE id=? AND user_id=? AND status='pending')",
        conditionParams: [id, userId],
        writes: (reservationId) => [
          this.db
            .prepare(
              "UPDATE auth_revocations SET status='processing',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
            )
            .bind(now, id, reservationId),
          this.db
            .prepare(
              "INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,request_id,created_at) SELECT ?,?,'session.revoke.provider_claim','auth_revocation',?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
            )
            .bind(crypto.randomUUID(), userId, id, attempt, now, reservationId),
        ],
      });
      return true;
    } catch (error) {
      if (error instanceof DomainError && error.code === "CONFLICT") return false;
      throw error;
    }
  }
  async recordRevocationResult(
    id: string,
    userId: string,
    succeeded: boolean,
    requestId: string,
  ): Promise<void> {
    const status = succeeded ? "succeeded" : "failed",
      now = new Date().toISOString();
    await new D1OperationLedger(this.db).execute({
      actorId: userId,
      key: `revoke-result:${id}`,
      requestHash: await operationHash("SYSTEM", "/session/revoke-result", id, { status }),
      resourceId: id,
      response: { status },
      conditionSql:
        "EXISTS(SELECT 1 FROM auth_revocations WHERE id=? AND user_id=? AND status='processing')",
      conditionParams: [id, userId],
      writes: (reservationId) => [
        this.db
          .prepare(
            "UPDATE auth_revocations SET status=?,error_code=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(status, succeeded ? null : "PROVIDER_FAILED", now, id, reservationId),
        this.db
          .prepare(
            "INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,request_id,created_at) SELECT ?,?,?,'auth_revocation',?,?,? WHERE EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
          )
          .bind(
            crypto.randomUUID(),
            userId,
            `session.revoke.provider_${status}`,
            id,
            requestId,
            now,
            reservationId,
          ),
      ],
    });
  }
}
