import {
  editResponse,
  operationHash,
  DomainError,
  type AssessmentRepository,
} from "../domain/assessment";
import type { StandardRepository } from "../domain/standard";
import { summarize } from "../domain/summarize";
import type { EditResponse } from "../../../../shared/contracts/assessment";
export async function reviewAssessment(
  repository: AssessmentRepository,
  standards: StandardRepository,
  id: string,
  actorId: string,
) {
  const record = await repository.get(id, actorId);
  const standard = await standards.get(record.standardId);
  return { ...record, ...summarize(record.document, standard.criteria) };
}
export async function updateResponse(
  repository: AssessmentRepository,
  standards: StandardRepository,
  id: string,
  criterionId: string,
  input: EditResponse,
  actorId: string,
  requestId: string,
) {
  const record = await repository.get(id, actorId);
  if (!Object.hasOwn(record.document.responses, criterionId)) throw new DomainError("NOT_FOUND");
  record.document = await editResponse(record.document, criterionId, input);
  const saved = await repository.save({
    record,
    actorId,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
    requestHash: await operationHash(
      "PATCH",
      `/api/v1/assessments/${id}/responses/${criterionId}`,
      id,
      input,
    ),
    action: "assessment.response",
    requestId,
  });
  const standard = await standards.get(saved.standardId);
  return { ...saved, ...summarize(saved.document, standard.criteria) };
}
