import type { AssessmentDto, StandardDto } from "../../../shared/contracts/assessments";
export function assessmentFixture(): { record: AssessmentDto; standard: StandardDto } {
  const criteria = Array.from({ length: 81 }, (_, i) => ({
    id: `C-${i + 1}`,
    requirementId: "R-1",
    category: i < 40 ? "組織" : "技術",
    officialText: `公式の基準 ${i + 1}`,
    requirementText: "公式要求",
    orderNo: i + 1,
    sourceRow: i + 6,
  }));
  const record: AssessmentDto = {
    id: "assessment",
    caseId: "case",
    customerId: "customer",
    standardId: "standard",
    previousAssessmentId: null,
    revision: 1,
    createdAt: "2026-09-19T00:00:00Z",
    updatedAt: "2026-09-19T00:00:00Z",
    document: {
      schemaVersion: 1,
      diagnosisDate: null,
      copiedFrom: null,
      scope: { companies: "", sites: "", departments: "", systems: "" },
      importInfo: null,
      responses: Object.fromEntries(
        criteria.map((c, i) => [
          c.id,
          {
            original:
              i === 0
                ? { sheet: "匿名", row: 6, O: "✖", P: "元の理由", Q: "元の根拠", R: "元の補足" }
                : null,
            status: i === 0 ? "no" : "unanswered",
            reason: i === 0 ? "固有の編集文" : "",
            basis: "",
            plannedWork: "",
            supplement: "",
            manualEdited: false,
            adviceBasisVersion: 1,
            basisHash: "a".repeat(64),
            adviceDraft: null,
            confirmedAdvice: null,
          },
        ]),
      ),
      evidence: [],
      tasks: [],
    },
    counts: { yes: 0, uncertain: 0, no: 1, unanswered: 80, total: 81 },
    categoryCounts: [
      { category: "組織", yes: 0, uncertain: 0, no: 1, unanswered: 39, total: 40 },
      { category: "技術", yes: 0, uncertain: 0, no: 0, unanswered: 41, total: 41 },
    ],
    evidenceSummary: {
      notRegistered: { count: 81, criterionIds: criteria.map((c) => c.id) },
      unreviewed: { count: 0, criterionIds: [] },
      rejected: { count: 0, criterionIds: [] },
      allConfirmed: { count: 0, criterionIds: [] },
      unconfirmedYes: { count: 0, criterionIds: [] },
    },
    adviceSummary: { currentConfirmed: 0, draftOnly: 0, stale: 0, none: 81, draftPending: 0 },
  };
  return {
    record,
    standard: {
      id: "standard",
      publicationDate: "2026-03-27",
      level: 3,
      sourceUrl: "https://example.invalid/official",
      sourceSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
      expectedCount: 81,
      criteria,
    },
  };
}
