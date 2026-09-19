import type { AssessmentRepository } from "../domain/assessment";
import { canonical, DomainError, operationHash } from "../domain/assessment";
import {
  assertImportable,
  importedDocument,
  inspectImport,
  type ImportMasterRepository,
} from "../domain/importAssessment";
import type { StandardRepository } from "../domain/standard";
import { summarize } from "../domain/summarize";
import type { PreviewImport, CommitImport } from "../../../../shared/contracts/imports";
export async function previewImport(
  repository: AssessmentRepository,
  masters: ImportMasterRepository,
  id: string,
  actorId: string,
  input: PreviewImport,
) {
  const record = await repository.get(id, actorId);
  if (record.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
  assertImportable(record.document);
  const inspected = await inspectImport(
    input.normalized,
    await masters.getImportMaster(record.standardId),
    record.revision,
  );
  // Include both the immutable originals and the initial editable values in the size check.
  importedDocument(
    record.document,
    inspected.normalized,
    inspected.preview,
    actorId,
    "2000-01-01T00:00:00.000Z",
  );
  return inspected.preview;
}
export async function commitImport(
  repository: AssessmentRepository,
  masters: ImportMasterRepository,
  standards: StandardRepository,
  id: string,
  actorId: string,
  requestId: string,
  input: CommitImport,
  now: () => string,
) {
  const record = await repository.get(id, actorId);
  const requestHash = await operationHash("POST", `/api/v1/assessments/${id}/imports`, id, input);
  const replay = await repository.replay(actorId, input.mutationId, requestHash);
  if (replay) {
    const standard = await standards.get(replay.standardId);
    const assessment = { ...replay, ...summarize(replay.document, standard.criteria) };
    return { assessment, counts: assessment.counts };
  }
  if (record.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
  assertImportable(record.document);
  const { normalized, preview } = await inspectImport(
    input.normalized,
    await masters.getImportMaster(record.standardId),
    record.revision,
  );
  if (
    preview.normalizedSha256 !== input.normalizedSha256 ||
    canonical([...input.acknowledgedMissingIds].sort()) !==
      canonical([...preview.missingIds].sort())
  )
    throw new DomainError("VALIDATION_ERROR");
  record.document = importedDocument(record.document, normalized, preview, actorId, now());
  const saved = await repository.save({
    record,
    actorId,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
    requestHash,
    action: "assessment.import",
    requestId,
  });
  const standard = await standards.get(saved.standardId),
    assessment = { ...saved, ...summarize(saved.document, standard.criteria) };
  return { assessment, counts: assessment.counts };
}
