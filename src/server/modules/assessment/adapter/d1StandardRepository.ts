import type { StandardDto } from "../../../../shared/contracts/assessments";
import type { Criterion } from "../../../../shared/contracts/assessment";
import type { StandardRepository } from "../domain/standard";
import { DomainError } from "../domain/assessment";
export class D1StandardRepository implements StandardRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async get(id: string): Promise<StandardDto> {
    const metadata = await this.db
      .prepare(
        "SELECT id,publication_date AS publicationDate,level,source_url AS sourceUrl,source_sha256 AS sourceSha256,content_sha256 AS contentSha256,expected_count AS expectedCount FROM standards WHERE id=? AND sealed_at IS NOT NULL",
      )
      .bind(id)
      .first<Omit<StandardDto, "criteria">>();
    if (!metadata) throw new DomainError("NOT_FOUND");
    const rows = await this.db
      .prepare(
        "SELECT criterion_id AS id,requirement_id AS requirementId,category,requirement_text AS requirementText,official_text AS officialText,order_no AS orderNo,source_row AS sourceRow FROM criteria WHERE standard_id=? ORDER BY order_no",
      )
      .bind(id)
      .all<Criterion>();
    return { ...metadata, criteria: rows.results };
  }
}
