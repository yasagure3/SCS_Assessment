import type { AssessmentDocument, Review } from "./contracts/assessment";
import type { EvidenceCommand } from "./contracts/evidence";
import { DomainError } from "./errors";

export const emptyEvidenceReview = (): Review => ({
  state: "unreviewed",
  note: "",
  by: null,
  at: null,
  subjectHash: null,
});
export type EvidenceChangeContext = {
  actorId: string;
  newEvidenceId: string;
  reviewedAt: string;
  subjectHash: string;
};
// UUIDs, server ISO timestamps and SHA-256 values have fixed serialized lengths.
// This context is only used for client byte sizing; it is never sent to the API.
export const evidenceSizeContext: EvidenceChangeContext = {
  actorId: "00000000-0000-4000-8000-000000000000",
  newEvidenceId: "00000000-0000-4000-8000-000000000000",
  reviewedAt: "2000-01-01T00:00:00.000Z",
  subjectHash: "0".repeat(64),
};

/** Shared aggregate transition. The server replaces fixed-length basis hashes on persistence. */
export function applyEvidenceChange(
  document: AssessmentDocument,
  command: EvidenceCommand,
  context: EvidenceChangeContext,
): AssessmentDocument {
  const next = structuredClone(document);
  if (
    (command.kind === "add" || command.kind === "edit") &&
    command.input.criterionIds.some((id) => !Object.hasOwn(document.responses, id))
  )
    throw new DomainError("VALIDATION_ERROR");
  let affected: string[];
  if (command.kind === "add") {
    if (next.evidence.length >= 100) throw new DomainError("VALIDATION_ERROR");
    const { name, url, location, fileId, criterionIds } = command.input;
    next.evidence.push({
      id: context.newEvidenceId,
      name,
      url,
      location,
      fileId,
      criterionIds: [...criterionIds].sort(),
      reviews: Object.fromEntries(criterionIds.map((id) => [id, emptyEvidenceReview()])),
    });
    affected = criterionIds;
  } else {
    const item = next.evidence.find((item) => item.id === command.evidenceId);
    if (!item) throw new DomainError("NOT_FOUND");
    affected = [...item.criterionIds];
    if (command.kind === "review") {
      if (!item.criterionIds.includes(command.criterionId)) throw new DomainError("NOT_FOUND");
      const previous = item.reviews[command.criterionId];
      if (previous.state === command.input.state && previous.note === command.input.note)
        return next;
      affected = [command.criterionId];
      const unreviewed = command.input.state === "unreviewed";
      item.reviews[command.criterionId] = {
        state: command.input.state,
        note: command.input.note,
        by: unreviewed ? null : context.actorId,
        at: unreviewed ? null : context.reviewedAt,
        subjectHash: unreviewed ? null : context.subjectHash,
      };
    } else if (command.kind === "delete")
      next.evidence = next.evidence.filter((value) => value.id !== item.id);
    else {
      const values = {
        name: command.input.name,
        url: command.input.url,
        location: command.input.location,
        criterionIds: [...command.input.criterionIds].sort(),
      };
      const previous = {
        name: item.name,
        url: item.url,
        location: item.location,
        criterionIds: [...item.criterionIds].sort(),
      };
      if (JSON.stringify(values) === JSON.stringify(previous)) return next;
      affected = [...new Set([...affected, ...values.criterionIds])];
      Object.assign(item, values, {
        reviews: Object.fromEntries(values.criterionIds.map((id) => [id, emptyEvidenceReview()])),
      });
    }
    for (const task of next.tasks) {
      if (!affected.includes(task.criterionId) || !task.evidenceIds.includes(item.id)) continue;
      if (command.kind === "delete" || !item.criterionIds.includes(task.criterionId))
        task.evidenceIds = task.evidenceIds.filter((id) => id !== item.id);
      task.review = emptyEvidenceReview();
      if (task.state === "done" || task.state === "awaiting_review") task.state = "doing";
    }
  }
  for (const id of affected) next.responses[id].adviceBasisVersion++;
  return next;
}
