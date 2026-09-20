import type { AssessmentDocument } from "../../../../shared/contracts/assessment";
import type { TaskCommand } from "../../../../shared/contracts/improvement";
import { applyTaskChange } from "../../../../shared/taskChange";
import { digest } from "./assessment";

export async function changeTask(
  document: AssessmentDocument,
  command: TaskCommand,
  context: { actorId: string; now: () => string; newId: () => string },
): Promise<AssessmentDocument> {
  const task =
    command.kind === "review" ? document.tasks.find((item) => item.id === command.taskId) : null;
  const subjectHash = task
    ? await digest({
        taskId: task.id,
        criterionId: task.criterionId,
        completionCondition: task.completionCondition,
        result: task.result,
        evidence: document.evidence
          .filter((item) => task.evidenceIds.includes(item.id))
          .map((item) => ({
            ...item,
            criterionIds: [...item.criterionIds].sort(),
            reviews: { [task.criterionId]: item.reviews[task.criterionId] },
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      })
    : "";
  return applyTaskChange(document, command, {
    actorId: context.actorId,
    newTaskId: command.kind === "add" ? context.newId() : "",
    reviewedAt: command.kind === "review" ? context.now() : "",
    subjectHash,
  });
}
