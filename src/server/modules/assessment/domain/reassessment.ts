import type { AssessmentRecord, Task } from "../../../../shared/contracts/assessment";
import {
  responseTextFields,
  type ComparisonDto,
  type ReassessmentInput,
  type TaskComparison,
} from "../../../../shared/contracts/improvement";
import { reassessmentCopy } from "../../../../shared/reassessmentCopy";
import { basisHash, canonical, validateDocument, type AssessmentRepository } from "./assessment";

export interface ReassessmentRepository extends AssessmentRepository {
  revision(id: string, revision: number, actorId: string): Promise<AssessmentRecord>;
  createReassessment(input: {
    record: AssessmentRecord;
    expectedPreviousRevision: number;
    actorId: string;
    key: string;
    requestHash: string;
    requestId: string;
  }): Promise<AssessmentRecord>;
}
export async function copyAssessment(
  previous: AssessmentRecord,
  input: ReassessmentInput,
  ids: string[],
  newId: () => string,
) {
  const document = reassessmentCopy(previous, input, newId);
  for (const id of ids) document.responses[id].basisHash = await basisHash(document, id);
  return validateDocument(document, ids);
}
function taskContent(task: Task, record: AssessmentRecord) {
  const evidence = task.evidenceIds
    .map((id) => {
      const item = record.document.evidence.find((entry) => entry.id === id)!;
      return canonical({ ...item, id: null });
    })
    .sort();
  return canonical({
    ...task,
    id: null,
    sourceTaskId: null,
    sourceAssessmentId: null,
    evidenceIds: evidence,
  });
}
function taskChanges(
  current: AssessmentRecord,
  previous: AssessmentRecord,
  criterionId: string,
): TaskComparison {
  const before = previous.document.tasks.filter((task) => task.criterionId === criterionId);
  const after = current.document.tasks.filter((task) => task.criterionId === criterionId);
  if (current.document.copiedFrom?.assessmentId !== previous.id)
    return {
      mode: "unmatched",
      matched: [],
      notCarried: [],
      added: [],
      previous: before,
      current: after,
    };
  const matched = before.flatMap((old) =>
    after
      .filter((task) => task.sourceAssessmentId === previous.id && task.sourceTaskId === old.id)
      .map((task) => ({
        before: old,
        after: task,
        changed: taskContent(old, previous) !== taskContent(task, current),
      })),
  );
  return {
    mode: "matched",
    matched,
    notCarried: before.filter((task) => !matched.some((pair) => pair.before.id === task.id)),
    added: after.filter((task) => !matched.some((pair) => pair.after.id === task.id)),
    previous: [],
    current: [],
  };
}
export function compareAssessments(
  current: AssessmentRecord,
  previous: AssessmentRecord,
): ComparisonDto {
  const before = previous.document.responses,
    after = current.document.responses;
  return {
    current,
    previous,
    scopeChanges: (Object.keys(current.document.scope) as (keyof typeof current.document.scope)[])
      .filter((field) => current.document.scope[field] !== previous.document.scope[field])
      .map((field) => ({
        field,
        before: previous.document.scope[field],
        after: current.document.scope[field],
      })),
    standardChanged: current.standardId !== previous.standardId,
    rows: Object.keys(after)
      .filter((id) => Object.hasOwn(before, id))
      .map((id) => {
        const responseChanges = responseTextFields
          .filter((field) => before[id][field] !== after[id][field])
          .map((field) => ({ field, before: before[id][field], after: after[id][field] }));
        const tasks = taskChanges(current, previous, id);
        return {
          criterionId: id,
          beforeStatus: before[id].status,
          afterStatus: after[id].status,
          changed:
            before[id].status !== after[id].status ||
            responseChanges.length > 0 ||
            tasks.matched.some((pair) => pair.changed) ||
            tasks.notCarried.length > 0 ||
            tasks.added.length > 0,
          responseChanges,
          tasks,
        };
      }),
    unmatchedIds: {
      previous: Object.keys(before).filter((id) => !Object.hasOwn(after, id)),
      current: Object.keys(after).filter((id) => !Object.hasOwn(before, id)),
    },
  };
}
