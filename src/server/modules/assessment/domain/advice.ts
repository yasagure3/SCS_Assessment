import type { Advice, AssessmentDocument } from "../../../../shared/contracts/assessment";
import { completeAdviceSchema } from "../../../../shared/contracts/advice";
import { DomainError } from "./assessment";

export function saveAdviceDraft(document: AssessmentDocument, id: string, content: Advice) {
  if (!Object.hasOwn(document.responses, id)) throw new DomainError("NOT_FOUND");
  const next = structuredClone(document);
  next.responses[id].adviceDraft = structuredClone(content);
  return next;
}
export function confirmAdvice(
  document: AssessmentDocument,
  id: string,
  content: Advice,
  actorId: string,
  at: string,
) {
  if (!Object.hasOwn(document.responses, id)) throw new DomainError("NOT_FOUND");
  const next = structuredClone(document),
    response = next.responses[id];
  response.confirmedAdvice = {
    content: completeAdviceSchema.parse(content),
    basisHash: response.basisHash,
    by: actorId,
    at,
    version: (response.confirmedAdvice?.version ?? 0) + 1,
  };
  return next;
}
