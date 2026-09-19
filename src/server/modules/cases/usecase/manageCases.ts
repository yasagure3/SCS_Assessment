import type { CaseRepository, CreateCase, EditScope, WriteContext } from "../domain/case";
import {
  emptyDocument,
  basisHash,
  editScope,
  operationHash,
  type AssessmentRepository,
} from "../../assessment/domain/assessment";
export async function createCase(
  repository: CaseRepository,
  customerId: string,
  input: CreateCase,
  context: WriteContext,
) {
  await repository.customer(customerId, context.actorId);
  const document = await emptyDocument(await repository.criterionIds(input.standardId));
  document.scope = input.scope ?? document.scope;
  document.diagnosisDate = input.diagnosisDate ?? null;
  for (const id of Object.keys(document.responses))
    document.responses[id].basisHash = await basisHash(document, id);
  return repository.createCase(customerId, input, document, context);
}
export async function updateScope(
  repository: AssessmentRepository,
  id: string,
  input: EditScope,
  actorId: string,
  requestId: string,
) {
  const record = await repository.get(id, actorId);
  record.document = await editScope(record.document, input.scope, input.diagnosisDate);
  return repository.save({
    record,
    actorId,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
    requestHash: await operationHash("PATCH", `/api/v1/assessments/${id}/scope`, id, input),
    action: "assessment.scope",
    requestId,
  });
}
