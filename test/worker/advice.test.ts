import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import { STANDARD_ID, type Advice } from "../../src/shared/contracts/assessment";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import master from "../../src/server/db/seed/scs-20260327-star3.json";
import templates from "../../src/server/db/seed/advice-templates-scs-20260327-star3.json";
import { digest } from "../../src/server/modules/assessment/domain/assessment";
import { completeAdviceSchema } from "../../src/shared/contracts/advice";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const firstId = master.criteria[0].id;
const content: Advice = {
  origin: "manual",
  templateId: null,
  gap: "役割分担が未確定",
  steps: ["責任者と担当部署の分担を規程に記載する"],
  evidenceExamples: ["承認済み役割分担表"],
  completionCheck: "役員と担当部署が分担を確認する",
  notes: "担当者による提案",
};
async function fixture() {
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
    now: () => Date.parse("2026-09-20T00:00:00.000Z"),
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
  const customer = await request("/customers", "POST", { name: "匿名助言社" });
  const created = await request(`/customers/${customer.body.data.id}/cases`, "POST", {
    name: "助言検証",
    standardId: STANDARD_ID,
  });
  expect(created.status).toBe(201);
  const record: AssessmentDto = (await request(`/assessments/${created.body.data.assessmentId}`))
    .body.data;
  const path = `/assessments/${record.id}/advice/${firstId}`;
  return { actorId, record, request, path };
}
const mutation = (expectedRevision: number, value: Advice = content) => ({
  expectedRevision,
  mutationId: crypto.randomUUID(),
  content: value,
});
describe("manual advice", () => {
  it("publishes a sealed source-linked proposal for every official criterion", async () => {
    const f = await fixture();
    const result = await f.request(`/standards/${STANDARD_ID}/advice-templates`);
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      items: templates.map(({ gap, steps, evidenceExamples, completionCheck, ...metadata }, i) => ({
        ...metadata,
        officialRequirement: master.criteria[i].officialText,
        kind: "companyProposal",
        content: {
          origin: "template",
          templateId: metadata.id,
          gap,
          steps,
          evidenceExamples,
          completionCheck,
          notes: "",
        },
      })),
    });
    for (const template of templates) {
      const { gap, steps, evidenceExamples, completionCheck } = template;
      expect(await digest({ gap, steps, evidenceExamples, completionCheck })).toBe(
        template.contentSha256,
      );
      expect(
        completeAdviceSchema.safeParse({
          origin: "template",
          templateId: template.id,
          gap,
          steps,
          evidenceExamples,
          completionCheck,
          notes: "",
        }).success,
      ).toBe(true);
    }
    expect(
      result.body.data.items.map((item: any) => ({
        criterionId: item.criterionId,
        officialRequirement: item.officialRequirement,
        sourceUrls: item.sourceUrls,
        kind: item.kind,
        version: item.version,
      })),
    ).toEqual(
      master.criteria.map((c) => ({
        criterionId: c.id,
        officialRequirement: c.officialText,
        sourceUrls: [master.sourceUrl],
        kind: "companyProposal",
        version: 1,
      })),
    );
    expect(new Set(result.body.data.items.map((item: any) => item.content.gap)).size).toBe(81);
    for (const item of result.body.data.items) {
      expect(
        [
          item.content.gap,
          item.content.completionCheck,
          ...item.content.steps,
          ...item.content.evidenceExamples,
        ].every((s: string) => s.trim().length > 0),
      ).toBe(true);
      expect(item.content.steps.length >= 2 && item.content.evidenceExamples.length >= 1).toBe(
        true,
      );
    }
    expect((await f.request("/standards/unknown/advice-templates")).status).toBe(404);
  });
  it("saves partial drafts and confirms complete advice while keeping both versions and original answers", async () => {
    const f = await fixture();
    const partial = { ...content, steps: [], completionCheck: "" };
    const draft = await f.request(`${f.path}/draft`, "PUT", mutation(1, partial));
    expect(draft.status).toBe(200);
    expect(draft.body.data.document.responses[firstId]).toEqual({
      ...f.record.document.responses[firstId],
      adviceDraft: partial,
    });
    const confirmed = await f.request(`${f.path}/confirm`, "POST", {
      ...mutation(2),
      reviewed: true,
    });
    expect(confirmed.status).toBe(200);
    const expected = {
      content,
      basisHash: f.record.document.responses[firstId].basisHash,
      by: f.actorId,
      at: "2026-09-20T00:00:00.000Z",
      version: 1,
    };
    expect(confirmed.body.data.document.responses[firstId]).toEqual({
      ...f.record.document.responses[firstId],
      adviceDraft: partial,
      confirmedAdvice: expected,
    });
    const changed = await f.request(
      `${f.path}/draft`,
      "PUT",
      mutation(3, { ...content, gap: "次の下書き" }),
    );
    expect(changed.status).toBe(200);
    expect(changed.body.data.document.responses[firstId]).toEqual({
      ...f.record.document.responses[firstId],
      adviceDraft: { ...content, gap: "次の下書き" },
      confirmedAdvice: expected,
    });
    expect(changed.body.data.adviceSummary).toEqual({
      currentConfirmed: 1,
      draftOnly: 0,
      stale: 0,
      none: 80,
      draftPending: 1,
    });
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(changed.body.data);
  });
  it.each([
    { gap: " " },
    { steps: [] },
    { steps: [" "] },
    { evidenceExamples: [] },
    { evidenceExamples: [" "] },
    { completionCheck: " " },
  ])("rejects incomplete confirmation %j without persisting", async (patch) => {
    const f = await fixture();
    const result = await f.request(`${f.path}/confirm`, "POST", {
      ...mutation(1, { ...content, ...patch }),
      reviewed: true,
    });
    expect(result.status).toBe(422);
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(f.record);
  });
  it("requires explicit review, rejects unknown keys and invalid template provenance", async () => {
    const f = await fixture();
    for (const body of [
      { ...mutation(1), reviewed: false },
      { ...mutation(1), reviewed: true, by: f.actorId },
      { ...mutation(1, { ...content, origin: "template", templateId: "wrong" }), reviewed: true },
      { ...mutation(1, { ...content, gap: "😀".repeat(12001) }), reviewed: true },
    ])
      expect((await f.request(`${f.path}/confirm`, "POST", body)).status).toBe(422);
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(f.record);
  });
  it("replays the exact original result after later changes and rejects stale and reused mutations without duplicate history", async () => {
    const f = await fixture(),
      body = { ...mutation(1), reviewed: true };
    const first = await f.request(`${f.path}/confirm`, "POST", body);
    expect(first.status).toBe(200);
    const later = await f.request(`${f.path}/draft`, "PUT", mutation(2));
    expect(later.status).toBe(200);
    expect((await f.request(`${f.path}/confirm`, "POST", body)).body.data).toEqual(first.body.data);
    expect(
      (
        await f.request(`${f.path}/confirm`, "POST", {
          ...body,
          content: { ...content, gap: "別内容" },
        })
      ).status,
    ).toBe(409);
    expect((await f.request(`${f.path}/draft`, "PUT", mutation(1))).status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM assessment_revisions WHERE assessment_id=?",
      )
        .bind(f.record.id)
        .first(),
    ).toEqual({ count: 3 });
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(later.body.data);
  });
  it("requires reconfirmation after answer reversal, scope and evidence changes but preserves confirmation on task progress", async () => {
    const f = await fixture();
    let saved: AssessmentDto = (
      await f.request(`${f.path}/confirm`, "POST", { ...mutation(1), reviewed: true })
    ).body.data;
    expect(saved.document.responses[firstId].confirmedAdvice?.version).toBe(1);
    const answer = { status: "no", reason: "確認理由", basis: "", plannedWork: "", supplement: "" };
    for (const fields of [answer, { ...answer, status: "unanswered", reason: "" }]) {
      const result = await f.request(`/assessments/${f.record.id}/responses/${firstId}`, "PATCH", {
        expectedRevision: saved.revision,
        mutationId: crypto.randomUUID(),
        ...fields,
      });
      expect(result.status).toBe(200);
      saved = result.body.data;
      expect(saved.adviceSummary).toEqual({
        currentConfirmed: 0,
        stale: 1,
        draftOnly: 0,
        none: 80,
        draftPending: 0,
      });
    }
    expect(saved.document.responses[firstId].adviceBasisVersion).toBe(3);
    saved = (
      await f.request(`${f.path}/confirm`, "POST", { ...mutation(saved.revision), reviewed: true })
    ).body.data;
    expect(saved.document.responses[firstId].confirmedAdvice).toEqual({
      content,
      basisHash: saved.document.responses[firstId].basisHash,
      by: f.actorId,
      at: "2026-09-20T00:00:00.000Z",
      version: 2,
    });
    const scoped = await f.request(`/assessments/${f.record.id}/scope`, "PATCH", {
      expectedRevision: saved.revision,
      mutationId: crypto.randomUUID(),
      scope: { companies: "匿名対象", sites: "", departments: "", systems: "" },
      diagnosisDate: null,
    });
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.adviceSummary.stale).toBe(1);
    saved = (
      await f.request(`${f.path}/confirm`, "POST", {
        ...mutation(scoped.body.data.revision),
        reviewed: true,
      })
    ).body.data;
    const evidence = await f.request(`/assessments/${f.record.id}/evidence`, "POST", {
      expectedRevision: saved.revision,
      mutationId: crypto.randomUUID(),
      name: "分担規程",
      location: "2章",
      url: null,
      criterionIds: [firstId],
    });
    expect(evidence.status).toBe(200);
    expect(evidence.body.data.adviceSummary.stale).toBe(1);
    saved = (
      await f.request(`${f.path}/confirm`, "POST", {
        ...mutation(evidence.body.data.revision),
        reviewed: true,
      })
    ).body.data;
    const reviewedEvidence = await f.request(
      `/assessments/${f.record.id}/evidence/${evidence.body.data.document.evidence[0].id}/reviews/${firstId}`,
      "POST",
      {
        expectedRevision: saved.revision,
        mutationId: crypto.randomUUID(),
        state: "confirmed",
        note: "規程で役割分担を照合",
      },
    );
    expect(reviewedEvidence.status).toBe(200);
    expect(reviewedEvidence.body.data.adviceSummary).toEqual({
      currentConfirmed: 0,
      stale: 1,
      draftOnly: 0,
      none: 80,
      draftPending: 0,
    });
    saved = (
      await f.request(`${f.path}/confirm`, "POST", {
        ...mutation(reviewedEvidence.body.data.revision),
        reviewed: true,
      })
    ).body.data;
    const repository = new D1AssessmentRepository(env.DB),
      record = await repository.get(f.record.id, f.actorId);
    record.document.tasks.push({
      id: crypto.randomUUID(),
      sourceTaskId: null,
      sourceAssessmentId: null,
      criterionId: firstId,
      title: "規程を整備",
      ownerName: "担当",
      dueDate: "",
      priority: "normal",
      state: "doing",
      completionCondition: "承認",
      result: "",
      evidenceIds: [],
      review: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
    });
    await repository.save({
      record,
      actorId: f.actorId,
      expectedRevision: record.revision,
      mutationId: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      action: "fixture.task",
      requestId: crypto.randomUUID(),
    });
    const after = (await f.request(`/assessments/${record.id}`)).body.data;
    expect(after.document.responses[firstId]).toEqual(saved.document.responses[firstId]);
    expect(after.adviceSummary).toEqual({
      currentConfirmed: 1,
      stale: 0,
      draftOnly: 0,
      none: 80,
      draftPending: 0,
    });
  });
  it("hides foreign customer advice and rejects unknown criteria", async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await other.request(`${f.path}/draft`, "PUT", mutation(1))).status).toBe(404);
    expect(
      (
        await f.request(`/assessments/${f.record.id}/advice/unknown/confirm`, "POST", {
          ...mutation(1),
          reviewed: true,
        })
      ).status,
    ).toBe(404);
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(f.record);
  });
});
