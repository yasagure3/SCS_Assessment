import type { ReassessmentInput } from "../../../../shared/contracts/improvement";
import { DomainError, operationHash } from "../domain/assessment";
import {
  copyAssessment,
  compareAssessments,
  type ReassessmentRepository,
} from "../domain/reassessment";
import type { StandardRepository } from "../domain/standard";
import { summarize } from "../domain/summarize";

export async function reassess(
  repository: ReassessmentRepository,
  standards: StandardRepository,
  caseId: string,
  input: ReassessmentInput,
  context: {
    actorId: string;
    key: string;
    requestId: string;
    now: () => string;
    newId: () => string;
  },
) {
  const previous = await repository.get(input.previousAssessmentId, context.actorId);
  if (previous.caseId !== caseId) throw new DomainError("NOT_FOUND");
  const requestHash = await operationHash(
    "POST",
    `/api/v1/cases/${caseId}/reassessments`,
    caseId,
    input,
  );
  const replay = await repository.replay(previous.id, context.actorId, context.key, requestHash);
  const standard = await standards.get(input.standardId);
  if (replay) return { ...replay, ...summarize(replay.document, standard.criteria) };
  if (previous.revision !== input.expectedPreviousRevision) throw new DomainError("CONFLICT");
  const now = context.now();
  const record = await repository.createReassessment({
    record: {
      id: context.newId(),
      customerId: previous.customerId,
      caseId,
      standardId: input.standardId,
      previousAssessmentId: previous.id,
      revision: 1,
      document: await copyAssessment(
        previous,
        input,
        standard.criteria.map((c) => c.id),
        context.newId,
      ),
      createdAt: now,
      updatedAt: now,
    },
    expectedPreviousRevision: input.expectedPreviousRevision,
    actorId: context.actorId,
    key: context.key,
    requestHash,
    requestId: context.requestId,
  });
  return { ...record, ...summarize(record.document, standard.criteria) };
}
export async function comparison(
  repository: ReassessmentRepository,
  id: string,
  previousId: string,
  previousRevision: number | undefined,
  actorId: string,
) {
  const current = await repository.get(id, actorId);
  let previous = await repository.get(previousId, actorId);
  if (current.caseId !== previous.caseId || current.customerId !== previous.customerId)
    throw new DomainError("NOT_FOUND");
  const revision =
    previousRevision ??
    (current.document.copiedFrom?.assessmentId === previousId
      ? current.document.copiedFrom.revision
      : previous.revision);
  previous = await repository.revision(previousId, revision, actorId);
  return compareAssessments(current, previous);
}
