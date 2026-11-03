import { beforeAll, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import {
  emptyOfficialAnswers,
  OFFICIAL_STANDARD_ID,
} from "../../src/shared/contracts/officialAssessment";

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
async function fixture(standardId: string) {
  const actorId = crypto.randomUUID(),
    sub = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'staff','active',?,?)",
  )
    .bind(actorId, sub, `${actorId}@example.invalid`, now, now)
    .run();
  const time = Math.floor(Date.now() / 1000);
  const app = createBusinessApp({
    verify: async () => ({
      sub,
      client_id: "test",
      token_use: "access",
      iat: time,
      exp: time + 600,
      auth_time: time,
    }),
    access: (b) => new D1AccessRepository(b.DB),
    sessions: () => ({ revoke: async () => {} }),
  });
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await app.request(
      `/api/v1${path}`,
      {
        method,
        headers: {
          Authorization: "Bearer fixture",
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    return {
      status: response.status,
      body: await response.json<{ data: any; error?: { code: string } }>(),
    };
  }
  const customer = await request("/customers", "POST", { name: "公式検証社" });
  const created = await request(`/customers/${customer.body.data.id}/cases`, "POST", {
    name: "公式回答検証",
    standardId,
  });
  expect(created.status).toBe(201);
  return { request, id: created.body.data.assessmentId as string, actorId };
}
it.each(["scs-20260327-star3", OFFICIAL_STANDARD_ID])(
  "persists official answers for %s without rewriting legacy responses; supports replay and rejects conflicts",
  async (standardId) => {
    const f = await fixture(standardId);
    const before = await f.request(`/assessments/${f.id}`);
    const answers = emptyOfficialAnswers();
    answers.rows["1-2-1-1:1"] = {
      result: "適合",
      answer: "情報セキュリティ規程 第2章\n組織図2026",
    };
    const edit = {
      expectedRevision: before.body.data.revision,
      mutationId: crypto.randomUUID(),
      answers,
    };
    const path = `/assessments/${f.id}/official-assessment`;
    const saved = await f.request(path, "PATCH", edit);
    expect(saved.status).toBe(200);
    expect(saved.body.data.standardId).toBe(standardId);
    expect(saved.body.data.document.officialAnswers).toEqual(answers);
    const reloaded = await f.request(`/assessments/${f.id}`);
    expect(reloaded.body.data.document.officialAnswers).toEqual(answers);
    for (const id of Object.keys(before.body.data.document.responses)) {
      for (const key of ["original", "status", "reason", "basis", "plannedWork", "supplement"])
        expect(reloaded.body.data.document.responses[id][key]).toEqual(
          before.body.data.document.responses[id][key],
        );
    }
    expect((await f.request(path, "PATCH", edit)).body.data.revision).toBe(
      saved.body.data.revision,
    );
    expect(
      (await f.request(path, "PATCH", { ...edit, mutationId: crypto.randomUUID() })).status,
    ).toBe(409);
    const invalid = structuredClone(answers);
    invalid.rows.unknown = { result: "", answer: "" };
    expect(
      (
        await f.request(path, "PATCH", {
          ...edit,
          answers: invalid,
          expectedRevision: saved.body.data.revision,
          mutationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(422);
    const other = await fixture(OFFICIAL_STANDARD_ID);
    expect((await other.request(path, "PATCH", edit)).status).toBe(404);
  },
);
it("adds an immutable latest standard and preserves the old criterion text", async () => {
  const old = await env.DB.prepare(
    "SELECT official_text FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-4-1'",
  ).first<{ official_text: string }>();
  const latest = await env.DB.prepare(
    "SELECT official_text FROM criteria WHERE standard_id=? AND criterion_id='4-4-4-1'",
  )
    .bind(OFFICIAL_STANDARD_ID)
    .first<{ official_text: string }>();
  expect(old?.official_text).not.toBe(latest?.official_text);
  expect(latest?.official_text).toContain("脆弱性悪用のリスクを低減");
  await expect(
    env.DB.prepare("UPDATE criteria SET official_text='overwrite' WHERE standard_id=?")
      .bind(OFFICIAL_STANDARD_ID)
      .run(),
  ).rejects.toThrow();
});
