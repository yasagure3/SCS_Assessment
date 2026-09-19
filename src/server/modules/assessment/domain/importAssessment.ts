import {
  normalizedImportSchema,
  type NormalizedImport,
  type ImportMaster,
  type ImportPreview,
} from "../../../../shared/contracts/imports";
import type { AssessmentDocument } from "../../../../shared/contracts/assessment";
import type { Status } from "../../../../shared/contracts/assessments";
import { DomainError, digest } from "./assessment";
export interface ImportMasterRepository {
  getImportMaster(id: string): Promise<ImportMaster>;
}
export function importStatus(value: string): Status {
  const status: Record<string, Status> = {
    "": "unanswered",
    "○": "yes",
    "△": "uncertain",
    "✖": "no",
    "×": "no",
    "✕": "no",
  };
  const symbol = value.trim();
  if (!Object.hasOwn(status, symbol)) throw new DomainError("VALIDATION_ERROR");
  return status[symbol];
}
export function assertImportable(document: AssessmentDocument) {
  if (document.importInfo || Object.values(document.responses).some((r) => r.manualEdited))
    throw new DomainError("IMPORT_NOT_EMPTY");
}
export async function inspectImport(
  value: NormalizedImport,
  master: ImportMaster,
  revision: number,
): Promise<{ normalized: NormalizedImport; preview: ImportPreview }> {
  const normalized = normalizedImportSchema.parse(value);
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 1_048_576)
    throw new DomainError("PAYLOAD_TOO_LARGE");
  if (
    normalized.standardId !== master.standardId ||
    normalized.masterContentSha256 !== master.masterContentSha256
  )
    throw new DomainError("VALIDATION_ERROR");
  const ids = master.rows.filter((r) => r.level === "★3").map((r) => r.id),
    known = new Set(ids),
    seen = new Set<string>(),
    locations = new Set<string>();
  const counts = { yes: 0, uncertain: 0, no: 0, unanswered: 0, total: 81 },
    warnings: ImportPreview["warnings"] = [];
  for (const row of normalized.rows) {
    const location = JSON.stringify([row.sheet, row.row]);
    if (!known.has(row.criterionId) || seen.has(row.criterionId) || locations.has(location))
      throw new DomainError("VALIDATION_ERROR");
    seen.add(row.criterionId);
    locations.add(location);
    counts[importStatus(row.O)]++;
    if (["×", "✕"].includes(row.O.trim()))
      warnings.push({
        code: "STATUS_NORMALIZED_TO_NO",
        sheet: row.sheet,
        row: row.row,
        column: "O",
      });
  }
  const missingIds = ids.filter((id) => !seen.has(id));
  counts.unanswered += missingIds.length;
  // Canonical ID order makes the preview digest independent of JSON key/row order.
  normalized.rows.sort((a, b) => ids.indexOf(a.criterionId) - ids.indexOf(b.criterionId));
  return {
    normalized,
    preview: {
      revision,
      normalizedSha256: await digest(normalized),
      counts,
      missingIds,
      warnings,
      errors: [],
      canCommit: missingIds.length === 0,
    },
  };
}
export function importedDocument(
  document: AssessmentDocument,
  normalized: NormalizedImport,
  preview: ImportPreview,
  actorId: string,
  now: string,
): AssessmentDocument {
  const next = structuredClone(document);
  next.importInfo = {
    fileName: normalized.fileName,
    clientFileSha256: normalized.clientFileSha256,
    normalizedSha256: preview.normalizedSha256,
    importedAt: now,
    importedBy: actorId,
    star4Excluded: normalized.star4Excluded,
    missingIds: preview.missingIds,
  };
  for (const row of normalized.rows) {
    const { criterionId, ...original } = row;
    Object.assign(next.responses[criterionId], {
      original,
      status: importStatus(row.O),
      reason: row.P,
      basis: row.Q,
      plannedWork: "",
      supplement: row.R,
    });
  }
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 1_048_576)
    throw new DomainError("PAYLOAD_TOO_LARGE");
  return next;
}
