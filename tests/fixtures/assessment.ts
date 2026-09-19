import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import type { Bindings } from "../../src/server/app";
export async function seedAssessment(db: Bindings["DB"], id: string, actorId: string) {
  const repository = new D1AssessmentRepository(db),
    record = await repository.get(id, actorId),
    criterionId = Object.keys(record.document.responses)[0];
  const response = record.document.responses[criterionId];
  record.document.importInfo = {
    fileName: "anonymous-fixture.xlsx",
    clientFileSha256: "a".repeat(64),
    normalizedSha256: "b".repeat(64),
    importedAt: new Date().toISOString(),
    importedBy: actorId,
    star4Excluded: 0,
    missingIds: Object.keys(record.document.responses).filter((id) => id !== criterionId),
  };
  response.original = {
    sheet: "匿名fixture",
    row: 6,
    O: "✖",
    P: "匿名の元理由",
    Q: "匿名の元根拠と作業",
    R: "匿名の元補足",
  };
  response.status = "no";
  response.reason = "運用記録の確認が必要";
  return repository.save({
    record,
    actorId,
    expectedRevision: record.revision,
    mutationId: crypto.randomUUID(),
    requestHash: "e".repeat(64),
    action: "fixture.assessment",
    requestId: crypto.randomUUID(),
  });
}
