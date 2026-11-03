import type { AssessmentRepository } from "../domain/assessment";
import { operationHash, DomainError } from "../domain/assessment";
import type { StandardRepository } from "../domain/standard";
import { summarize } from "../domain/summarize";
import type { OfficialAnswers } from "../../../../shared/contracts/officialAssessment";

export async function updateOfficialAssessment(
  repository: AssessmentRepository,
  standards: StandardRepository,
  id: string,
  input: { expectedRevision: number; mutationId: string; answers: OfficialAnswers },
  actorId: string,
  requestId: string,
) {
  const record = await repository.get(id, actorId);
  const ids = Object.keys(record.document.responses);
  if (
    ids.length !== Object.keys(input.answers.criteria).length ||
    ids.some((key) => !Object.hasOwn(input.answers.criteria, key))
  )
    throw new DomainError("VALIDATION_ERROR");
  record.document = { ...record.document, officialAnswers: input.answers };
  const saved = await repository.save({
    record,
    actorId,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
    requestHash: await operationHash(
      "PATCH",
      `/api/v1/assessments/${id}/official-assessment`,
      id,
      input,
    ),
    action: "assessment.official",
    requestId,
  });
  const standard = await standards.get(saved.standardId);
  return { ...saved, ...summarize(saved.document, standard.criteria) };
}
