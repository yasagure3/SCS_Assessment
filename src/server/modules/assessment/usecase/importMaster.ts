import type { AssessmentRepository } from "../domain/assessment";
import { DomainError, operationHash } from "../domain/assessment";
import type { StandardRepository } from "../domain/standard";
import { inspectMaster, masterDocument, type MasterImportRepository } from "../domain/masterImport";
import type {
  MasterPreviewInput,
  MasterCommitInput,
} from "../../../../shared/contracts/masterImport";

export async function previewMaster(
  assessments: AssessmentRepository,
  standards: StandardRepository,
  id: string,
  actorId: string,
  input: MasterPreviewInput,
) {
  const source = await assessments.get(id, actorId);
  if (source.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
  const preview = await inspectMaster(
    input.workbook,
    await standards.get(source.standardId),
    source.revision,
  );
  if (preview.canCommit)
    await masterDocument(
      input.workbook,
      preview,
      actorId,
      "2000-01-01T00:00:00.000Z",
      source.document.scope,
    );
  return preview;
}
export async function commitMaster(
  assessments: AssessmentRepository,
  standards: StandardRepository,
  imports: MasterImportRepository,
  id: string,
  actorId: string,
  requestId: string,
  input: MasterCommitInput,
) {
  const source = await assessments.get(id, actorId);
  const requestHash = await operationHash(
    "POST",
    `/api/v1/assessments/${id}/master-imports`,
    id,
    input,
  );
  const replay = await imports.replay(actorId, input.mutationId, requestHash);
  if (replay) return replay;
  if (source.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
  const preview = await inspectMaster(
    input.workbook,
    await standards.get(source.standardId),
    source.revision,
  );
  if (!preview.canCommit || preview.previewSha256 !== input.previewSha256)
    throw new DomainError("VALIDATION_ERROR");
  const now = new Date().toISOString();
  const document = await masterDocument(
    input.workbook,
    preview,
    actorId,
    now,
    source.document.scope,
  );
  return imports.save({
    source,
    command: input,
    preview,
    document,
    actorId,
    requestId,
    requestHash,
    now,
  });
}
