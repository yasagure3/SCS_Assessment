import type { AssessmentDocument, AssessmentRecord, Review } from "./contracts/assessment";
import type { ReassessmentInput } from "./contracts/improvement";
import { DomainError } from "./errors";

// Pure copy plan shared with the form so its UTF-8 limit includes all reset metadata.
export function reassessmentCopy(
  previous: AssessmentRecord,
  input: ReassessmentInput,
  newId: () => string,
): AssessmentDocument {
  if (
    previous.standardId !== input.standardId ||
    input.copyTaskIds.some((id) => !previous.document.tasks.some((task) => task.id === id))
  )
    throw new DomainError("VALIDATION_ERROR");
  const review = (): Review => ({
    state: "unreviewed",
    note: "",
    by: null,
    at: null,
    subjectHash: null,
  });
  const evidenceIds = new Map<string, string>();
  const evidence = input.copyResponses
    ? previous.document.evidence.map((item) => {
        const id = newId();
        evidenceIds.set(item.id, id);
        return {
          ...structuredClone(item),
          id,
          reviews: Object.fromEntries(item.criterionIds.map((criterion) => [criterion, review()])),
        };
      })
    : [];
  return {
    schemaVersion: 1,
    diagnosisDate: input.diagnosisDate,
    scope: structuredClone(input.scope),
    copiedFrom: { assessmentId: previous.id, revision: previous.revision },
    importInfo: null,
    responses: Object.fromEntries(
      Object.entries(previous.document.responses).map(([id, response]) => [
        id,
        {
          original: null,
          status: input.copyResponses ? response.status : "unanswered",
          reason: input.copyResponses ? response.reason : "",
          basis: input.copyResponses ? response.basis : "",
          plannedWork: input.copyResponses ? response.plannedWork : "",
          supplement: input.copyResponses ? response.supplement : "",
          manualEdited: input.copyResponses,
          adviceBasisVersion: 1,
          basisHash: "0".repeat(64),
          adviceDraft: input.copyResponses
            ? structuredClone(response.adviceDraft ?? response.confirmedAdvice?.content ?? null)
            : null,
          confirmedAdvice: null,
        },
      ]),
    ),
    evidence,
    tasks: previous.document.tasks
      .filter((task) => input.copyTaskIds.includes(task.id))
      .map((task) => ({
        ...structuredClone(task),
        id: newId(),
        sourceTaskId: task.id,
        sourceAssessmentId: previous.id,
        state: "todo",
        result: "",
        review: review(),
        evidenceIds: input.copyResponses ? task.evidenceIds.map((id) => evidenceIds.get(id)!) : [],
      })),
  };
}
