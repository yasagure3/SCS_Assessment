import type { ReportSnapshot } from "../../src/shared/contracts/reports";
import master from "../../src/server/db/seed/scs-20260327-star3.json" with { type: "json" };

export const longReportAdvice = Array.from(
  { length: 80 },
  (_, index) =>
    `長文検証${String(index + 1).padStart(3, "0")}：対象範囲を確認し、担当者が業務手順と実施記録を照合する。例外の判断理由を記録し、責任者が結果を確認する。運用状況の点検を継続し、未解決事項を次回の改善計画へ反映する。`,
).join("\n");

export function reportSnapshotFixture(): ReportSnapshot {
  const ids = master.criteria.map((c) => c.id);
  return {
    schemaVersion: 1,
    rendererVersion: "scs-report-1",
    reportId: "anonymous-report-001",
    createdAt: "2026-09-24T00:00:00.000Z",
    createdBy: "reviewer",
    customer: { id: "customer", name: "匿名検証株式会社" },
    case: { id: "case", name: "初回診断" },
    assessment: {
      id: "assessment",
      revision: 3,
      standardId: master.id,
      diagnosisDate: "2026-09-24",
      copiedFrom: null,
      scope: {
        companies: "匿名検証株式会社",
        sites: "本社",
        departments: "全社",
        systems: "業務システム",
      },
    },
    standard: master,
    counts: { yes: 1, uncertain: 0, no: 0, unanswered: 80, total: 81 },
    categoryCounts: [...new Set(master.criteria.map((c) => c.category))].map((category) => {
      const total = master.criteria.filter((c) => c.category === category).length;
      const yes = master.criteria[0].category === category ? 1 : 0;
      return { category, total, yes, uncertain: 0, no: 0, unanswered: total - yes };
    }),
    limitations: {
      unanswered: ids.slice(1),
      notRegistered: ids,
      unreviewed: [],
      rejected: [],
      unconfirmedAdvice: ids.slice(1),
      staleAdvice: [],
      draftPendingIds: [ids[0]],
    },
    majorIssues: [ids[0]],
    responses: Object.fromEntries(
      ids.map((id, index) => [
        id,
        {
          original: null,
          status: index === 0 ? "yes" : "unanswered",
          reason: `理由 ${id}`,
          basis: `根拠 ${id}`,
          plannedWork: `今後の作業 ${id}`,
          supplement: `補足 ${id}`,
          manualEdited: false,
          adviceBasisVersion: 1,
          basisHash: "a".repeat(64),
          adviceState: index === 0 ? "current" : "none",
          confirmedAdvice:
            index === 0
              ? {
                  content: {
                    origin: "manual",
                    templateId: null,
                    gap: longReportAdvice,
                    steps: ["責任者を設定する", "月次点検を記録する"],
                    evidenceExamples: ["点検記録", "運用規程"],
                    completionCheck: "直近３か月分を照合する",
                    notes: "匿名確認済み助言",
                  },
                  basisHash: "a".repeat(64),
                  by: "reviewer",
                  at: "2026-09-24T00:00:00.000Z",
                  version: 1,
                  reviewer: { id: "reviewer", email: "reviewer@example.invalid" },
                }
              : null,
        },
      ]),
    ),
    evidence: [],
    tasks: [],
  };
}
