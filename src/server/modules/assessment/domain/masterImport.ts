import {
  masterWorkbookSchema,
  type MasterWorkbook,
  type MasterPreview,
  type MasterDiff,
} from "../../../../shared/contracts/masterImport";
import type { StandardDto } from "../../../../shared/contracts/assessments";
import type { Criterion, AssessmentDocument } from "../../../../shared/contracts/assessment";
import { basisHash, digest, DomainError, emptyDocument, validateDocument } from "./assessment";
import { importStatus } from "./importAssessment";
import type { AssessmentRecord } from "../../../../shared/contracts/assessment";
import type {
  MasterImportResult,
  MasterCommitInput,
} from "../../../../shared/contracts/masterImport";

export interface MasterImportRepository {
  replay(actorId: string, key: string, hash: string): Promise<MasterImportResult | null>;
  save(input: {
    source: AssessmentRecord;
    command: MasterCommitInput;
    preview: MasterPreview;
    document: AssessmentDocument;
    actorId: string;
    requestId: string;
    requestHash: string;
    now: string;
  }): Promise<MasterImportResult>;
}

export function masterCriteria(workbook: MasterWorkbook): Criterion[] {
  return workbook.masterRows
    .filter((r) => r.level === "★3")
    .map((r, i) => ({
      id: r.id,
      requirementId: r.publicCells["6"],
      category: r.publicCells["3"],
      requirementText: r.publicCells["10"],
      officialText: r.publicCells["13"],
      orderNo: i + 1,
      sourceRow: r.sourceRow,
    }));
}
export function masterStatus(value: string) {
  return value.trim() === "-" ? "unanswered" : importStatus(value);
}
export async function inspectMaster(
  value: MasterWorkbook,
  baseline: StandardDto,
  revision: number,
): Promise<MasterPreview> {
  const workbook = masterWorkbookSchema.parse(value);
  const ids = new Set<string>(),
    locations = new Set<number>();
  for (const row of workbook.masterRows) {
    if (
      ids.has(row.id) ||
      locations.has(row.sourceRow) ||
      row.sourceRow <= workbook.headerRow ||
      row.publicCells["12"] !== row.id ||
      row.publicCells["11"] !== row.level ||
      !/^\d+-\d+-\d+$/.test(row.publicCells["6"]) ||
      !row.id.startsWith(row.publicCells["6"] + "-") ||
      !["3", "10", "13"].every((col) => row.publicCells[col].trim())
    )
      throw new DomainError("VALIDATION_ERROR");
    ids.add(row.id);
    locations.add(row.sourceRow);
  }
  const criteria = masterCriteria(workbook),
    next = new Map(criteria.map((c) => [c.id, c])),
    before = new Map(baseline.criteria.map((c) => [c.id, c]));
  const diff: MasterDiff = {
    added: criteria.filter((c) => !before.has(c.id)),
    removed: baseline.criteria.filter((c) => !next.has(c.id)),
    changed: [],
    unchanged: 0,
  };
  for (const c of criteria) {
    const old = before.get(c.id);
    if (!old) continue;
    const fields = (
      ["requirementId", "category", "requirementText", "officialText", "orderNo"] as const
    )
      // SQL migrations checked out on Windows can contain CRLF inside literals.
      // Compare logical line breaks while preserving the original imported text.
      .filter(
        (key) =>
          String(old[key]).replace(/\r\n?/g, "\n") !== String(c[key]).replace(/\r\n?/g, "\n"),
      )
      .map((field) => ({ field, before: String(old[field]), after: String(c[field]) }));
    if (fields.length) diff.changed.push({ id: c.id, fields });
    else diff.unchanged++;
  }
  const answerIds = new Set<string>();
  const counts = { yes: 0, uncertain: 0, no: 0, unanswered: 0, total: criteria.length };
  for (const answer of workbook.answers) {
    const row = workbook.masterRows.find((r) => r.id === answer.criterionId && r.level === "★3");
    if (
      !row ||
      answerIds.has(answer.criterionId) ||
      answer.sheet !== workbook.sheet ||
      answer.row !== row.sourceRow
    )
      throw new DomainError("VALIDATION_ERROR");
    answerIds.add(answer.criterionId);
    counts[masterStatus(answer.O)]++;
  }
  if (answerIds.size !== criteria.length) throw new DomainError("VALIDATION_ERROR");
  const errors =
    criteria.length !== 81
      ? ["このシステムは★3の81評価基準に対応しています。件数を確認してください。"]
      : [];
  return {
    previewSha256: await digest({
      workbook,
      baselineId: baseline.id,
      baselineHash: baseline.contentSha256,
      revision,
    }),
    diff,
    counts,
    star4Excluded: workbook.masterRows.filter((r) => r.level === "★4").length,
    dashCount: workbook.answers.filter((a) => a.O.trim() === "-").length,
    canCommit: !errors.length,
    errors,
  };
}
export async function masterDocument(
  workbook: MasterWorkbook,
  preview: MasterPreview,
  actorId: string,
  now: string,
  scope: AssessmentDocument["scope"],
): Promise<AssessmentDocument> {
  const document = await emptyDocument(masterCriteria(workbook).map((c) => c.id));
  document.scope = structuredClone(scope);
  document.importInfo = {
    fileName: workbook.fileName,
    clientFileSha256: workbook.fileSha256,
    normalizedSha256: preview.previewSha256,
    importedAt: now,
    importedBy: actorId,
    star4Excluded: preview.star4Excluded,
    missingIds: [],
  };
  for (const { criterionId, ...original } of workbook.answers) {
    Object.assign(document.responses[criterionId], {
      original,
      status: masterStatus(original.O),
      reason: original.P,
      basis: original.Q,
      supplement: original.R,
    });
    document.responses[criterionId].basisHash = await basisHash(document, criterionId);
  }
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > 1_048_576)
    throw new DomainError("PAYLOAD_TOO_LARGE");
  return validateDocument(
    document,
    masterCriteria(workbook).map((c) => c.id),
  );
}
