// @vitest-environment node
import { expect, it } from "vitest";
import { deployedAiAcceptance } from "../live/deployedAi";
import { hashAiInput } from "../../src/shared/contracts/aiAdvice";

const input = {
  standardId: "scs-20260327-star3",
  criterionId: "1-2-1-1",
  officialRequirement: "匿名基準",
  anonymousAnswer: "匿名回答",
  anonymousGap: "匿名不足",
};
const draft = {
  origin: "ai",
  templateId: null,
  gap: "不足",
  steps: ["実施"],
  evidenceExamples: ["記録"],
  completionCheck: "確認",
  notes: "",
};
async function fixture(status = 200) {
  const calls: string[] = [],
    hash = await hashAiInput(input),
    runId = crypto.randomUUID(),
    basisHash = "a".repeat(64);
  const run = {
    runId,
    criterionId: input.criterionId,
    status: "succeeded",
    draft,
    inputHash: hash,
    basisHash,
    errorCode: null,
  };
  const api = async (path: string, body?: unknown) => {
    calls.push(`${body ? "POST" : "GET"} ${path}`);
    if (path.endsWith("/ai-runs") && status !== 200)
      return Response.json({ error: { code: "AI_NOT_CONFIGURED" } }, { status });
    if (path.endsWith("/ai-runs") || path.includes(`/ai-runs/${runId}`))
      return Response.json({ data: run });
    const adopted = path.endsWith("/adopt-ai");
    return Response.json({
      data: {
        revision: adopted ? 2 : 1,
        document: {
          responses: { [input.criterionId]: { basisHash, adviceDraft: adopted ? draft : null } },
        },
      },
    });
  };
  const query = async (sql: string) => [
    {
      results: sql.includes("ai_budget_reservations")
        ? [{ mode: "trial", reservedCents: 10, model: "gpt-6-sol" }]
        : [{ status: "succeeded", inputHash: hash, draftJson: JSON.stringify(draft) }],
    },
  ];
  return { api, query, calls, runId };
}
it.each([503, 502, 504, 429])(
  "fails deployed acceptance on Worker HTTP %s without bypassing through a local provider",
  async (status) => {
    const f = await fixture(status);
    await expect(deployedAiAcceptance("assessment", input, f.api, f.query)).rejects.toThrow(
      `Deployed AI HTTP ${status}`,
    );
    expect(f.calls).toEqual([
      "GET /assessments/assessment",
      "POST /assessments/assessment/advice/1-2-1-1/ai-runs",
    ]);
  },
);
it("requires product generation, GET status, persisted budget and adoption of its validated draft", async () => {
  const f = await fixture();
  expect(await deployedAiAcceptance("assessment", input, f.api, f.query)).toEqual({
    runId: f.runId,
    inputHash: await hashAiInput(input),
    reservedCents: 10,
    adoptedRevision: 2,
  });
  expect(f.calls).toEqual([
    "GET /assessments/assessment",
    "POST /assessments/assessment/advice/1-2-1-1/ai-runs",
    `GET /assessments/assessment/ai-runs/${f.runId}`,
    "POST /assessments/assessment/advice/1-2-1-1/adopt-ai",
  ]);
});
