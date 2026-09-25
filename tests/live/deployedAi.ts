import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  aiDraftSchema,
  generateAiSchema,
  adoptAiSchema,
  hashAiInput,
  type AiInput,
  type AiRunDto,
} from "../../src/shared/contracts/aiAdvice";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import type { cloudIo } from "../../scripts/cloud-io.mjs";

// All writes use the deployed product API. SQL below is read-only corroboration;
// this path never constructs a provider, overrides its mode or marks a run done.
export async function deployedAiAcceptance(
  assessmentId: string,
  input: AiInput,
  api: (path: string, body?: unknown) => Promise<Response>,
  query: ReturnType<typeof cloudIo>["query"],
) {
  const data = async <T>(response: Response): Promise<T> => {
    if (response.status !== 200) throw new Error(`Deployed AI HTTP ${response.status}`);
    return ((await response.json()) as { data: T }).data;
  };
  const before = await data<AssessmentDto>(await api(`/assessments/${assessmentId}`)),
    hash = await hashAiInput(input);
  const body = generateAiSchema.parse({
    expectedRevision: before.revision,
    basisHash: before.document.responses[input.criterionId].basisHash,
    anonymousAnswer: input.anonymousAnswer,
    anonymousGap: input.anonymousGap,
    reviewedInputHash: hash,
    anonymizationReviewed: true,
  });
  const run = await data<AiRunDto>(
    await api(`/assessments/${assessmentId}/advice/${input.criterionId}/ai-runs`, body),
  );
  assert.deepEqual(
    {
      status: run.status,
      inputHash: run.inputHash,
      basisHash: run.basisHash,
      errorCode: run.errorCode,
    },
    { status: "succeeded", inputHash: hash, basisHash: body.basisHash, errorCode: null },
  );
  const draft = aiDraftSchema.parse(run.draft);
  assert.deepEqual(await data(await api(`/assessments/${assessmentId}/ai-runs/${run.runId}`)), run);
  assert.deepEqual(
    (
      await query(
        "SELECT status,input_hash AS inputHash,draft_json AS draftJson FROM ai_runs WHERE id=? AND assessment_id=?",
        [run.runId, assessmentId],
      )
    )[0].results,
    [{ status: "succeeded", inputHash: hash, draftJson: JSON.stringify(draft) }],
  );
  assert.deepEqual(
    (
      await query(
        "SELECT mode,reserved_cents AS reservedCents,model FROM ai_budget_reservations WHERE run_id=?",
        [run.runId],
      )
    )[0].results,
    [{ mode: "trial", reservedCents: 10, model: "gpt-6-sol" }],
  );
  const adopted = await data<AssessmentDto>(
    await api(
      `/assessments/${assessmentId}/advice/${input.criterionId}/adopt-ai`,
      adoptAiSchema.parse({
        expectedRevision: before.revision,
        mutationId: randomUUID(),
        runId: run.runId,
      }),
    ),
  );
  assert.equal(adopted.revision, before.revision + 1);
  assert.deepEqual(adopted.document.responses[input.criterionId].adviceDraft, draft);
  return {
    runId: run.runId,
    inputHash: hash,
    reservedCents: 10,
    adoptedRevision: adopted.revision,
  };
}
