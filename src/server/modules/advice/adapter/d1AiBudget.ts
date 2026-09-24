import { DomainError } from "../../../../shared/errors";

export class D1AiBudget {
  private readonly db: D1Database;
  private readonly now: () => number;
  constructor(db: D1Database, now: () => number) {
    this.db = db;
    this.now = now;
  }

  async reserve(runId: string, mode: "trial" | "monthly") {
    const stamp = new Date(this.now()).toISOString();
    // One conditional statement serializes the shared caps and claim across all actors.
    // A reservation is never refunded, including aborts and uncertain HTTP outcomes.
    const result = await this.db
      .prepare(`
      INSERT INTO ai_budget_reservations(run_id,utc_month,mode,reserved_cents,model,created_at)
      SELECT ?,?,?,10,'gpt-6-sol',?
      WHERE EXISTS(SELECT 1 FROM ai_runs WHERE id=? AND status='running' AND created_at>?)
        AND NOT EXISTS(SELECT 1 FROM ai_budget_reservations WHERE run_id=?)
        AND (SELECT COALESCE(SUM(reserved_cents),0) FROM ai_budget_reservations WHERE utc_month=?) + 10 <= 2000
        AND (?='monthly' OR (
          (SELECT COALESCE(SUM(reserved_cents),0) FROM ai_budget_reservations WHERE mode='trial') + 10 <= 500
          AND (SELECT count(*) FROM ai_budget_reservations WHERE mode='trial') < 30
        ))
      RETURNING run_id
    `)
      .bind(
        runId,
        stamp.slice(0, 7),
        mode,
        stamp,
        runId,
        new Date(this.now() - 60000).toISOString(),
        runId,
        stamp.slice(0, 7),
        mode,
      )
      .first();
    if (!result) throw new DomainError("AI_BUDGET_LIMIT");
  }
}
