import type { AdviceTemplateRepository } from "../domain/templates";
import {
  DomainError,
  operationHash,
  type AssessmentRepository,
} from "../../assessment/domain/assessment";
import { saveAdviceDraft, confirmAdvice } from "../../assessment/domain/advice";
import type { StandardRepository } from "../../assessment/domain/standard";
import { summarize } from "../../assessment/domain/summarize";
import type { DraftAdviceInput } from "../../../../shared/contracts/advice";

export async function updateAdvice(
  assessments: AssessmentRepository,
  standards: StandardRepository,
  templates: AdviceTemplateRepository,
  id: string,
  criterionId: string,
  input: DraftAdviceInput,
  action: "draft" | "confirm",
  actorId: string,
  requestId: string,
  now: () => number,
) {
  const record = await assessments.get(id, actorId);
  if (!Object.hasOwn(record.document.responses, criterionId)) throw new DomainError("NOT_FOUND");
  const requestHash = await operationHash(
    action === "draft" ? "PUT" : "POST",
    `/api/v1/assessments/${id}/advice/${criterionId}/${action}`,
    id,
    input,
  );
  const replay = await assessments.replay(id, actorId, input.mutationId, requestHash);
  if (replay)
    return {
      ...replay,
      ...summarize(replay.document, (await standards.get(replay.standardId)).criteria),
    };
  const { content } = input;
  const previous = record.document.responses[criterionId];
  if (
    (content.origin !== "template" && content.templateId !== null) ||
    (content.origin === "ai" &&
      previous.adviceDraft?.origin !== "ai" &&
      previous.confirmedAdvice?.content.origin !== "ai")
  )
    throw new DomainError("VALIDATION_ERROR");
  if (content.origin === "template") {
    const published = await templates.list(record.standardId);
    if (!published.some((t) => t.id === content.templateId && t.criterionId === criterionId))
      throw new DomainError("VALIDATION_ERROR");
  }
  record.document =
    action === "draft"
      ? saveAdviceDraft(record.document, criterionId, content)
      : confirmAdvice(
          record.document,
          criterionId,
          content,
          actorId,
          new Date(now()).toISOString(),
        );
  const saved = await assessments.save({
    record,
    actorId,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
    requestHash,
    action: `advice.${action}`,
    requestId,
  });
  const standard = await standards.get(saved.standardId);
  return { ...saved, ...summarize(saved.document, standard.criteria) };
}
