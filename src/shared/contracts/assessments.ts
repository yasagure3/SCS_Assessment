import type { AssessmentRecord, AssessmentResponse, Criterion } from "./assessment";
export { editResponseSchema } from "./assessment";
export type Status = AssessmentResponse["status"];
export type StatusCounts = Record<Status, number> & { total: number };
export type CriterionSet = { count: number; criterionIds: string[] };
export type EvidenceState = "notRegistered" | "unreviewed" | "rejected" | "allConfirmed";
export type AssessmentSummary = {
  counts: StatusCounts & { total: 81 };
  categoryCounts: (StatusCounts & { category: string })[];
  evidenceSummary: Record<EvidenceState | "unconfirmedYes", CriterionSet>;
  adviceSummary: {
    currentConfirmed: number;
    draftOnly: number;
    stale: number;
    none: number;
    draftPending: number;
  };
};
export type AssessmentDto = AssessmentRecord & AssessmentSummary;
export type StandardDto = {
  id: string;
  publicationDate: string;
  level: number;
  sourceUrl: string;
  sourceSha256: string;
  contentSha256: string;
  expectedCount: number;
  criteria: Criterion[];
};
