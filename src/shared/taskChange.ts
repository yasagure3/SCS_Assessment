import type { AssessmentDocument, Task } from "./contracts/assessment";
import type { TaskCommand } from "./contracts/improvement";
import { emptyEvidenceReview } from "./evidenceChange";
import { DomainError } from "./errors";

export type TaskChangeContext = {
  actorId: string;
  newTaskId: string;
  reviewedAt: string;
  subjectHash: string;
};
export const taskSizeContext: TaskChangeContext = {
  actorId: "00000000-0000-4000-8000-000000000000",
  newTaskId: "00000000-0000-4000-8000-000000000000",
  reviewedAt: "2000-01-01T00:00:00.000Z",
  subjectHash: "0".repeat(64),
};
export function taskIsOverdue(task: Pick<Task, "state" | "dueDate">, now: string): boolean {
  const today = new Date(new Date(now).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return task.state !== "done" && Boolean(task.dueDate) && task.dueDate < today;
}
export function applyTaskChange(
  document: AssessmentDocument,
  command: TaskCommand,
  context: TaskChangeContext,
): AssessmentDocument {
  const next = structuredClone(document);
  if (command.kind === "add") {
    if (next.tasks.length >= 100 || !Object.hasOwn(next.responses, command.input.criterionId))
      throw new DomainError("VALIDATION_ERROR");
    const { title, ownerName, dueDate, priority, completionCondition, criterionId } = command.input;
    next.tasks.push({
      id: context.newTaskId,
      sourceTaskId: null,
      sourceAssessmentId: null,
      criterionId,
      title,
      ownerName,
      dueDate,
      priority,
      completionCondition,
      state: "todo",
      result: "",
      evidenceIds: [],
      review: emptyEvidenceReview(),
    });
    return next;
  }
  const task = next.tasks.find((item) => item.id === command.taskId);
  if (!task) throw new DomainError("NOT_FOUND");
  if (command.kind === "review") {
    if (task.state !== "awaiting_review" || !task.result.trim() || !task.evidenceIds.length)
      throw new DomainError("VALIDATION_ERROR");
    task.state = command.input.state === "confirmed" ? "done" : "doing";
    task.review = {
      state: command.input.state,
      note: command.input.note,
      by: context.actorId,
      at: context.reviewedAt,
      subjectHash: context.subjectHash,
    };
    return next;
  }
  const { title, ownerName, dueDate, priority, completionCondition, state, result } = command.input;
  const evidenceIds = [...command.input.evidenceIds].sort();
  if (
    evidenceIds.some(
      (id) =>
        !next.evidence.some(
          (item) => item.id === id && item.criterionIds.includes(task.criterionId),
        ),
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  if (state === "done" && task.state !== "done") throw new DomainError("VALIDATION_ERROR");
  const changed =
    task.result !== result ||
    task.completionCondition !== completionCondition ||
    JSON.stringify([...task.evidenceIds].sort()) !== JSON.stringify(evidenceIds);
  const previouslySubmitted = task.state === "done" || task.state === "awaiting_review";
  const nextState = changed && previouslySubmitted ? "doing" : state;
  if (nextState === "awaiting_review" && (!result.trim() || !evidenceIds.length))
    throw new DomainError("VALIDATION_ERROR");
  if (changed || nextState !== task.state) task.review = emptyEvidenceReview();
  Object.assign(task, {
    title,
    ownerName,
    dueDate,
    priority,
    completionCondition,
    state: nextState,
    result,
    evidenceIds,
  });
  return next;
}
