import { DomainError } from "../domain/assessment";

type Receipt = { request_hash: string; response_json: string };
export type OperationPlan<T> = {
  actorId: string;
  key: string;
  requestHash: string;
  resourceId: string;
  response: T;
  conditionSql: string;
  conditionParams: (string | number | null)[];
  writes: (reservationId: string) => D1PreparedStatement[];
};

// Shared by all write adapters, including successful no-ops. A fresh reservation
// identity prevents an old matching receipt from enabling another batch's writes.
export class D1OperationLedger {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async replay<T>(actorId: string, key: string, requestHash: string): Promise<T | null> {
    const row = await this.db
      .prepare(
        "SELECT request_hash,response_json FROM operation_receipts WHERE actor_id=? AND operation_key=?",
      )
      .bind(actorId, key)
      .first<Receipt>();
    if (!row) return null;
    if (row.request_hash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT");
    return JSON.parse(row.response_json) as T;
  }
  async execute<T>(plan: OperationPlan<T>): Promise<T> {
    const replay = await this.replay<T>(plan.actorId, plan.key, plan.requestHash);
    if (replay !== null) return replay;
    const reservationId = crypto.randomUUID();
    const reserve = this.db
      .prepare(
        `INSERT INTO operation_receipts(actor_id,operation_key,request_hash,resource_id,reservation_id,response_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ${plan.conditionSql}`,
      )
      .bind(
        plan.actorId,
        plan.key,
        plan.requestHash,
        plan.resourceId,
        reservationId,
        JSON.stringify(plan.response),
        new Date().toISOString(),
        ...plan.conditionParams,
      );
    try {
      const results = await this.db.batch([reserve, ...plan.writes(reservationId)]);
      if (results[0].meta.changes === 1) return plan.response;
    } catch (error) {
      const saved = await this.replay<T>(plan.actorId, plan.key, plan.requestHash);
      if (saved !== null) return saved;
      throw error;
    }
    const saved = await this.replay<T>(plan.actorId, plan.key, plan.requestHash);
    if (saved !== null) return saved;
    throw new DomainError("CONFLICT");
  }
}
