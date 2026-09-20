import {
  aiDraftSchema,
  hashAiInput,
  canonicalAiInput,
  type GenerateAiInput,
  type AdoptAiInput,
} from "../../../../shared/contracts/aiAdvice";
import {
  DomainError,
  operationHash,
  type AssessmentRepository,
} from "../../assessment/domain/assessment";
import { saveAdviceDraft } from "../../assessment/domain/advice";
import { summarize } from "../../assessment/domain/summarize";
import type { StandardRepository } from "../../assessment/domain/standard";
import type { AiPort, AiRunRepository } from "../domain/aiPort";

export async function generateAdvice(
  assessments: AssessmentRepository,
  standards: StandardRepository,
  runs: AiRunRepository,
  provider: AiPort,
  id: string,
  criterionId: string,
  input: GenerateAiInput,
  actorId: string,
  key: string,
  requestId: string,
  timeoutMs = 30000,
) {
  const record = await assessments.get(id, actorId);
  const context = {
    actorId,
    key,
    requestId,
    requestHash: await operationHash(
      "POST",
      `/api/v1/assessments/${id}/advice/${criterionId}/ai-runs`,
      id,
      input,
    ),
  };
  const replay = await runs.replay(context, id);
  if (replay) return replay;
  const criterion = (await standards.get(record.standardId)).criteria.find(
    (item) => item.id === criterionId,
  );
  if (!criterion || !Object.hasOwn(record.document.responses, criterionId))
    throw new DomainError("NOT_FOUND");
  if (record.revision !== input.expectedRevision) throw new DomainError("CONFLICT");
  if (record.document.responses[criterionId].basisHash !== input.basisHash)
    throw new DomainError("AI_STALE");
  const payload = {
    standardId: record.standardId,
    criterionId,
    officialRequirement: criterion.officialText,
    anonymousAnswer: input.anonymousAnswer,
    anonymousGap: input.anonymousGap,
  };
  if (new TextEncoder().encode(canonicalAiInput(payload)).byteLength > 8000)
    throw new DomainError("PAYLOAD_TOO_LARGE");
  const inputHash = await hashAiInput(payload);
  if (inputHash !== input.reviewedInputHash) throw new DomainError("AI_INPUT_CHANGED");
  const reservation = await runs.reserve(record, criterionId, inputHash, context);
  if (!reservation.execute) return reservation.run;
  if (reservation.run.status !== "running")
    return runs.finish(id, reservation.run.runId, actorId, null, null);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draft = null,
    errorCode: string | null = null;
  try {
    const output = await Promise.race([
      provider.generate(payload, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            // Settle the deadline before abort listeners can resolve or reject the provider.
            reject(new DomainError("AI_TIMEOUT"));
            controller.abort();
          },
          Math.min(30000, timeoutMs),
        );
      }),
    ]);
    // The adapter returns data, never a tool call. Strict schema rejects extra commands/keys.
    const parsed = aiDraftSchema.safeParse(output);
    if (!parsed.success) throw new DomainError("AI_INVALID_OUTPUT");
    draft = parsed.data;
  } catch (error) {
    errorCode =
      error instanceof DomainError &&
      ["AI_NOT_CONFIGURED", "AI_TIMEOUT", "AI_INVALID_OUTPUT"].includes(error.code)
        ? error.code
        : "AI_PROVIDER_FAILED";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return runs.finish(id, reservation.run.runId, actorId, draft, errorCode);
}

export async function adoptAiAdvice(
  assessments: AssessmentRepository,
  standards: StandardRepository,
  runs: AiRunRepository,
  id: string,
  criterionId: string,
  input: AdoptAiInput,
  actorId: string,
  requestId: string,
) {
  const record = await assessments.get(id, actorId);
  const requestHash = await operationHash(
    "POST",
    `/api/v1/assessments/${id}/advice/${criterionId}/adopt-ai`,
    id,
    input,
  );
  // Authorization remains current; a completed adoption replays its saved result even if
  // the basis has since changed. Only a new operation needs to validate the current run.
  const replay = await assessments.replay(id, actorId, input.mutationId, requestHash);
  if (replay)
    return {
      ...replay,
      ...summarize(replay.document, (await standards.get(replay.standardId)).criteria),
    };
  const run = await runs.get(id, input.runId, actorId);
  if (run.criterionId !== criterionId || !Object.hasOwn(record.document.responses, criterionId))
    throw new DomainError("NOT_FOUND");
  if (run.status === "stale" || run.basisHash !== record.document.responses[criterionId].basisHash)
    throw new DomainError("AI_STALE");
  if (run.status !== "succeeded" || !run.draft) throw new DomainError("AI_NOT_READY");
  record.document = saveAdviceDraft(record.document, criterionId, run.draft);
  const saved = await assessments.save({
    record,
    actorId,
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId,
    requestHash,
    action: "advice.adopt-ai",
    requestId,
  });
  return {
    ...saved,
    ...summarize(saved.document, (await standards.get(saved.standardId)).criteria),
  };
}
