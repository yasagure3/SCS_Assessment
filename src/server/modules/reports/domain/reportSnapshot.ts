import type { AssessmentRecord } from "../../../../shared/contracts/assessment";
import { MAX_REPORT_BYTES } from "../../../../shared/contracts/assessment";
import type { StandardDto } from "../../../../shared/contracts/assessments";
import type { ApiPage } from "../../../../shared/contracts/api";
import type {
  ReportContent,
  ReportFile,
  ReportReviewer,
  ReportLimitations,
  ReportPreview,
  ReportListItem,
  ReportListQuery,
  SavedReport,
  ReportSnapshot,
  PreviewReportInput,
} from "../../../../shared/contracts/reports";
import { digest, DomainError, validateDocument } from "../../assessment/domain/assessment";
import { summarize } from "../../assessment/domain/summarize";

export const REPORT_RENDERER_VERSION = "scs-report-1";
export type ReportSource = {
  record: AssessmentRecord;
  standard: StandardDto;
  customer: { id: string; name: string; revision: number; archivedAt: string | null };
  case: { id: string; name: string; revision: number; archivedAt: string | null };
  files: ReportFile[];
  reviewers: ReportReviewer[];
};
export interface ReportRepository {
  source(id: string, actorId: string): Promise<ReportSource>;
  replay(id: string, actorId: string, key: string, hash: string): Promise<SavedReport | null>;
  save(
    source: ReportSource,
    report: SavedReport,
    context: { actorId: string; key: string; requestHash: string; requestId: string },
  ): Promise<SavedReport>;
  list(id: string, actorId: string, query: ReportListQuery): Promise<ApiPage<ReportListItem>>;
  get(id: string, actorId: string): Promise<SavedReport>;
}
export async function reportPreview(
  source: ReportSource,
  input: PreviewReportInput,
): Promise<ReportPreview> {
  const { record, standard } = source,
    document = record.document;
  if (record.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
  validateDocument(
    document,
    standard.criteria.map((c) => c.id),
  );
  const summary = summarize(document, standard.criteria);
  const limitations: ReportLimitations = {
    unanswered: [],
    notRegistered: summary.evidenceSummary.notRegistered.criterionIds,
    unreviewed: summary.evidenceSummary.unreviewed.criterionIds,
    rejected: summary.evidenceSummary.rejected.criterionIds,
    unconfirmedAdvice: [],
    staleAdvice: [],
    draftPendingIds: [],
  };
  const reviewer = (id: string): ReportReviewer => {
    const found = source.reviewers.find((r) => r.id === id);
    if (!found) throw new DomainError("CONFLICT");
    return found;
  };
  const responses: ReportContent["responses"] = {};
  for (const criterion of standard.criteria) {
    const { adviceDraft, confirmedAdvice, ...response } = document.responses[criterion.id];
    const adviceState = confirmedAdvice
      ? confirmedAdvice.basisHash === response.basisHash
        ? "current"
        : "stale"
      : adviceDraft
        ? "unconfirmed"
        : "none";
    responses[criterion.id] = {
      ...response,
      confirmedAdvice:
        adviceState === "current" && confirmedAdvice
          ? { ...confirmedAdvice, reviewer: reviewer(confirmedAdvice.by) }
          : null,
      adviceState,
    };
    if (response.status === "unanswered") limitations.unanswered.push(criterion.id);
    if (adviceState === "none" || adviceState === "unconfirmed")
      limitations.unconfirmedAdvice.push(criterion.id);
    if (adviceState === "stale") limitations.staleAdvice.push(criterion.id);
    if (adviceDraft) limitations.draftPendingIds.push(criterion.id);
  }
  const priority = { high: 0, normal: 1, low: 2 };
  const order = new Map(standard.criteria.map((c) => [c.id, c.orderNo]));
  const suggested = [...document.tasks]
    .filter((t) => t.state !== "done")
    .sort(
      (a, b) =>
        priority[a.priority] - priority[b.priority] ||
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        order.get(a.criterionId)! - order.get(b.criterionId)!,
    );
  const majorIssues =
    input.majorIssueCriterionIds ?? [...new Set(suggested.map((t) => t.criterionId))].slice(0, 5);
  if (majorIssues.some((id) => !order.has(id))) throw new DomainError("VALIDATION_ERROR");
  const content: ReportContent = {
    schemaVersion: 1,
    rendererVersion: REPORT_RENDERER_VERSION,
    customer: { id: source.customer.id, name: source.customer.name },
    case: { id: source.case.id, name: source.case.name },
    assessment: {
      id: record.id,
      revision: record.revision,
      standardId: record.standardId,
      diagnosisDate: document.diagnosisDate,
      scope: document.scope,
      copiedFrom: document.copiedFrom,
    },
    standard: {
      publicationDate: standard.publicationDate,
      sourceUrl: standard.sourceUrl,
      contentSha256: standard.contentSha256,
      criteria: standard.criteria,
    },
    counts: summary.counts,
    categoryCounts: summary.categoryCounts,
    limitations,
    majorIssues,
    responses,
    evidence: document.evidence.map((evidence) => {
      const file = evidence.fileId ? source.files.find((f) => f.id === evidence.fileId) : null;
      if (file === undefined) throw new DomainError("CONFLICT");
      return {
        ...evidence,
        file,
        reviewers: [
          ...new Set(Object.values(evidence.reviews).flatMap((r) => (r.by ? [r.by] : []))),
        ]
          .sort()
          .map(reviewer),
      };
    }),
    tasks: document.tasks.map((task) => ({
      ...task,
      reviewer: task.review.by ? reviewer(task.review.by) : null,
    })),
  };
  const blockingErrors = Object.entries(document.scope)
    .filter(([, value]) => !value.trim())
    .map(([key]) => ({ path: `scope.${key}`, reason: "対象範囲を入力してください。" }));
  if (!document.diagnosisDate)
    blockingErrors.push({ path: "diagnosisDate", reason: "診断日を入力してください。" });
  return {
    content,
    limitations,
    blockingErrors,
    revision: record.revision,
    previewHash: await digest({
      content,
      customerRevision: source.customer.revision,
      caseRevision: source.case.revision,
    }),
  };
}
export async function fixedReport(
  content: ReportContent,
  reportId: string,
  actorId: string,
  createdAt: string,
): Promise<SavedReport> {
  const snapshot: ReportSnapshot = { ...content, reportId, createdAt, createdBy: actorId };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_REPORT_BYTES)
    throw new DomainError("PAYLOAD_TOO_LARGE");
  return { reportId, snapshotSha256: await digest(snapshot), snapshot };
}
