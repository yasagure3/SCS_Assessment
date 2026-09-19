import type { AssessmentDocument, AssessmentRecord } from "../../../../shared/contracts/assessment";
import type { EvidenceCommand } from "../../../../shared/contracts/evidence";
import { applyEvidenceChange } from "../../../../shared/evidenceChange";
import { digest, type AssessmentRepository } from "./assessment";
export { emptyEvidenceReview as emptyReview } from "../../../../shared/evidenceChange";

export interface EvidenceRepository extends AssessmentRepository {
  replay(
    id: string,
    actorId: string,
    mutationId: string,
    requestHash: string,
  ): Promise<AssessmentRecord | null>;
}
export async function changeEvidence(
  document: AssessmentDocument,
  command: EvidenceCommand,
  context: { actorId: string; now: () => string; newId: () => string },
): Promise<AssessmentDocument> {
  let subjectHash = "";
  if (command.kind === "review") {
    const item = document.evidence.find((item) => item.id === command.evidenceId);
    if (item)
      subjectHash = await digest({
        id: item.id,
        criterionId: command.criterionId,
        criterionIds: [...item.criterionIds].sort(),
        name: item.name,
        url: item.url,
        location: item.location,
        fileId: item.fileId,
      });
  }
  return applyEvidenceChange(document, command, {
    actorId: context.actorId,
    newEvidenceId: command.kind === "add" ? context.newId() : "",
    reviewedAt: command.kind === "review" ? context.now() : "",
    subjectHash,
  });
}
