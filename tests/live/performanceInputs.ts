import type { AssessmentResponse } from "../../src/shared/contracts/assessment";
import { longReportAdvice } from "../fixtures/reportSnapshot";

export function performanceInputs(
  criterionId: string,
  index: number,
  reasonLength: number,
  status: AssessmentResponse["status"],
) {
  return {
    evidence: {
      criterionIds: [criterionId],
      name: `匿名上限証跡${index}`,
      location: "記録",
      url: "https://example.invalid/anonymous",
    },
    task: {
      criterionId,
      title: `匿名上限課題${index}`,
      ownerName: "匿名担当",
      dueDate: "2026-10-31",
      priority: "normal" as const,
      completionCondition: "記録確認",
    },
    response: {
      status,
      reason: "記".repeat(reasonLength),
      basis: "匿名根拠",
      plannedWork: "匿名計画",
      supplement: "匿名補足",
    },
    advice: {
      reviewed: true,
      content: {
        origin: "manual",
        templateId: null,
        gap: longReportAdvice,
        steps: ["担当を決める"],
        evidenceExamples: ["運用記録"],
        completionCheck: "記録を照合",
        notes: "匿名上限確認",
      },
    },
  };
}
