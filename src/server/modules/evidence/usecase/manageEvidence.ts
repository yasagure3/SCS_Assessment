import type { EvidenceCommand } from "../../../../shared/contracts/evidence";
import { operationHash } from "../../assessment/domain/assessment";
import { changeEvidence, type EvidenceRepository } from "../../assessment/domain/evidence";
import type { StandardRepository } from "../../assessment/domain/standard";
import { summarize } from "../../assessment/domain/summarize";

export async function manageEvidence(
  repository: EvidenceRepository,
  standards: StandardRepository,
  id: string,
  command: EvidenceCommand,
  context: { actorId: string; requestId: string; now: () => string; newId: () => string },
) {
  const method = command.kind === "edit" ? "PATCH" : command.kind === "delete" ? "DELETE" : "POST";
  const path = `/api/v1/assessments/${id}/evidence${command.kind === "add" ? "" : `/${command.evidenceId}`}${command.kind === "review" ? `/reviews/${command.criterionId}` : ""}`;
  const requestHash = await operationHash(method, path, id, command.input);
  const replay = await repository.replay(
    id,
    context.actorId,
    command.input.mutationId,
    requestHash,
  );
  let saved = replay;
  if (!saved) {
    const record = await repository.get(id, context.actorId);
    record.document = await changeEvidence(record.document, command, context);
    saved = await repository.save({
      record,
      actorId: context.actorId,
      expectedRevision: command.input.expectedRevision,
      mutationId: command.input.mutationId,
      requestHash,
      action: `assessment.evidence.${command.kind}`,
      requestId: context.requestId,
    });
  }
  const standard = await standards.get(saved.standardId);
  return { ...saved, ...summarize(saved.document, standard.criteria) };
}
