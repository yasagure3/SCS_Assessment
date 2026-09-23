import { z } from "zod";
import type {
  AssessmentDocument,
  AssessmentResponse,
  Evidence,
  Criterion,
  Task,
} from "./assessment";
import type { AssessmentSummary } from "./assessments";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const majorIds = z
  .array(z.string().min(1).max(100))
  .max(5)
  .refine((ids) => new Set(ids).size === ids.length);
export const previewReportSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  majorIssueCriterionIds: majorIds.optional(),
});
export const finalizeReportSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  previewHash: hash,
  majorIssueCriterionIds: majorIds,
  acknowledgedLimitationHash: hash,
});
export const reportListSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(400).optional(),
});
export type PreviewReportInput = z.infer<typeof previewReportSchema>;
export type FinalizeReportInput = z.infer<typeof finalizeReportSchema>;
export type ReportListQuery = z.infer<typeof reportListSchema>;
export type ReportLimitations = Record<
  | "unanswered"
  | "notRegistered"
  | "unreviewed"
  | "rejected"
  | "unconfirmedAdvice"
  | "staleAdvice"
  | "draftPendingIds",
  string[]
>;
export type ReportReviewer = { id: string; email: string };
export type ReportFile = {
  id: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
};
export type ReportEvidence = Evidence & { file: ReportFile | null; reviewers: ReportReviewer[] };
export type ReportResponse = Omit<AssessmentResponse, "adviceDraft" | "confirmedAdvice"> & {
  confirmedAdvice:
    | (NonNullable<AssessmentResponse["confirmedAdvice"]> & { reviewer: ReportReviewer })
    | null;
  adviceState: "current" | "none" | "unconfirmed" | "stale";
};
export type ReportContent = {
  schemaVersion: 1;
  rendererVersion: string;
  customer: { id: string; name: string };
  case: { id: string; name: string };
  assessment: {
    id: string;
    revision: number;
    standardId: string;
    diagnosisDate: string | null;
    scope: AssessmentDocument["scope"];
    copiedFrom: AssessmentDocument["copiedFrom"];
  };
  standard: {
    publicationDate: string;
    sourceUrl: string;
    contentSha256: string;
    criteria: Criterion[];
  };
  counts: AssessmentSummary["counts"];
  categoryCounts: AssessmentSummary["categoryCounts"];
  limitations: ReportLimitations;
  majorIssues: string[];
  responses: Record<string, ReportResponse>;
  evidence: ReportEvidence[];
  tasks: (Task & { reviewer: ReportReviewer | null })[];
};
export type ReportSnapshot = ReportContent & {
  reportId: string;
  createdAt: string;
  createdBy: string;
};
export type ReportPreview = {
  previewHash: string;
  revision: number;
  content: ReportContent;
  limitations: ReportLimitations;
  blockingErrors: { path: string; reason: string }[];
};
export type SavedReport = { reportId: string; snapshotSha256: string; snapshot: ReportSnapshot };
export type ReportListItem = {
  id: string;
  assessmentRevision: number;
  createdAt: string;
  createdBy: string;
};
