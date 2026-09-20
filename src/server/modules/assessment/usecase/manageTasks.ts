import type { TaskCommand } from "../../../../shared/contracts/improvement";
import { DomainError, operationHash, type AssessmentRepository } from "../domain/assessment";
import { changeTask } from "../domain/tasks";
import type { StandardRepository } from "../domain/standard";
import { summarize } from "../domain/summarize";

export async function manageTasks(
  repository: AssessmentRepository,
  standards: StandardRepository,
  id: string,
  command: TaskCommand,
  context: { actorId: string; requestId: string; now: () => string; newId: () => string },
) {
  const method = command.kind === "edit" ? "PATCH" : "POST";
  const path = `/api/v1/assessments/${id}/tasks${command.kind === "add" ? "" : `/${command.taskId}`}${command.kind === "review" ? "/review" : ""}`;
  const requestHash = await operationHash(method, path, id, command.input);
  let saved = await repository.replay(id, context.actorId, command.input.mutationId, requestHash);
  if (!saved) {
    const record = await repository.get(id, context.actorId);
    if (record.revision !== command.input.expectedRevision) throw new DomainError("CONFLICT");
    record.document = await changeTask(record.document, command, context);
    saved = await repository.save({
      record,
      actorId: context.actorId,
      expectedRevision: command.input.expectedRevision,
      mutationId: command.input.mutationId,
      requestHash,
      action: `assessment.task.${command.kind}`,
      requestId: context.requestId,
    });
  }
  const standard = await standards.get(saved.standardId);
  return { ...saved, ...summarize(saved.document, standard.criteria) };
}
