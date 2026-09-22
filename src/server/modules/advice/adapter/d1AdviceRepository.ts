import type { AdviceTemplate } from "../../../../shared/contracts/advice";
import type { AdviceTemplateRepository } from "../domain/templates";

type Row = Omit<AdviceTemplate, "content" | "kind" | "sourceUrls"> & {
  gap: string;
  steps: string;
  evidenceExamples: string;
  completionCheck: string;
  sourceUrls: string;
};
export class D1AdviceRepository implements AdviceTemplateRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async list(standardId: string): Promise<AdviceTemplate[]> {
    const rows = await this.db
      .prepare(
        "SELECT t.id,t.standard_id AS standardId,t.criterion_id AS criterionId,t.version,t.content_sha256 AS contentSha256,t.gap,t.steps,t.evidence_examples AS evidenceExamples,t.completion_check AS completionCheck,t.source_urls AS sourceUrls,c.official_text AS officialRequirement FROM advice_templates t JOIN criteria c ON c.standard_id=t.standard_id AND c.criterion_id=t.criterion_id WHERE t.standard_id=? AND t.sealed_at IS NOT NULL AND t.version=(SELECT MAX(p.version) FROM advice_templates p WHERE p.standard_id=t.standard_id AND p.criterion_id=t.criterion_id AND p.sealed_at IS NOT NULL) ORDER BY c.order_no",
      )
      .bind(standardId)
      .all<Row>();
    return rows.results.map(
      ({ gap, steps, evidenceExamples, completionCheck, sourceUrls, ...row }) => ({
        ...row,
        sourceUrls: JSON.parse(sourceUrls),
        kind: "companyProposal",
        content: {
          origin: "template",
          templateId: row.id,
          gap,
          steps: JSON.parse(steps),
          evidenceExamples: JSON.parse(evidenceExamples),
          completionCheck,
          notes: "",
        },
      }),
    );
  }
}
