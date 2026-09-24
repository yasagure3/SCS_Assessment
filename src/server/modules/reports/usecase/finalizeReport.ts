import { digest, DomainError, operationHash } from "../../assessment/domain/assessment";
import { fixedReport, reportPreview, type ReportRepository } from "../domain/reportSnapshot";
import type { FinalizeReportInput } from "../../../../shared/contracts/reports";

export async function finalizeReport(
  repository: ReportRepository,
  id: string,
  input: FinalizeReportInput,
  context: { actorId: string; key: string; requestId: string },
  now: () => string,
  newId: () => string,
) {
  const requestHash = await operationHash("POST", `/api/v1/assessments/${id}/reports`, id, input);
  const replay = await repository.replay(id, context.actorId, context.key, requestHash);
  if (replay) return replay;
  const source = await repository.source(id, context.actorId);
  if (source.customer.archivedAt || source.case.archivedAt) throw new DomainError("ARCHIVED");
  const preview = await reportPreview(source, input);
  if (
    preview.previewHash !== input.previewHash ||
    (await digest(preview.limitations)) !== input.acknowledgedLimitationHash
  )
    throw new DomainError("CONFLICT");
  if (preview.blockingErrors.length) throw new DomainError("VALIDATION_ERROR");
  return repository.save(
    source,
    await fixedReport(preview.content, newId(), context.actorId, now()),
    { ...context, requestHash },
  );
}
