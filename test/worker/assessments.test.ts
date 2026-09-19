import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import {
  STANDARD_ID,
  type AssessmentRecord,
  type Advice,
} from "../../src/shared/contracts/assessment";
import master from "../../src/server/db/seed/scs-20260327-star3.json";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
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
  const customer = await request("/customers", "POST", { name: "匿名社" });
  const created = await request(`/customers/${customer.body.data.id}/cases`, "POST", {
    name: "初回",
    standardId: STANDARD_ID,
  });
  expect(created.status).toBe(201);
  const record: AssessmentRecord = await new D1AssessmentRepository(env.DB).get(
    created.body.data.assessmentId,
    actorId,
  );
  return { actorId, request, record };
}
const edit = (revision: number, status = "no", reason = "確認した理由") => ({
  expectedRevision: revision,
  mutationId: crypto.randomUUID(),
  status,
  reason,
  basis: "規程 第2章",
  plannedWork: "運用記録を確認",
  supplement: "匿名の補足",
});
const firstId = master.criteria[0].id;
describe("assessment review API", () => {
  it("returns scope document and advice summary at the same saved revision without another assessment read", async () => {
    const f = await fixture(),
      repository = new D1AssessmentRepository(env.DB);
    const response = f.record.document.responses[firstId];
    response.confirmedAdvice = {
      content: {
        origin: "manual",
        templateId: null,
        gap: "不足",
        steps: [],
        evidenceExamples: [],
        completionCheck: "確認",
        notes: "",
      },
      basisHash: response.basisHash,
      by: f.actorId,
      at: "2026-09-19T00:00:00.000Z",
      version: 1,
    };
    const seeded = await repository.save({
      record: f.record,
      actorId: f.actorId,
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      requestHash: "f".repeat(64),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
    const before = (await f.request(`/assessments/${f.record.id}`)).body.data;
    expect(before.adviceSummary).toEqual({
      currentConfirmed: 1,
      stale: 0,
      draftOnly: 0,
      none: 80,
      draftPending: 0,
    });
    const result = await f.request(`/assessments/${f.record.id}/scope`, "PATCH", {
      expectedRevision: seeded.revision,
      mutationId: crypto.randomUUID(),
      scope: { companies: "新しい対象会社", sites: "", departments: "", systems: "" },
      diagnosisDate: null,
    });
    expect(result.status).toBe(200);
    expect(result.body.data.adviceSummary).toEqual({
      currentConfirmed: 0,
      stale: 1,
      draftOnly: 0,
      none: 80,
      draftPending: 0,
    });
    expect(result.body.data).toEqual((await f.request(`/assessments/${f.record.id}`)).body.data);
    expect(result.body.data.revision).toBe(seeded.revision + 1);
  });
  it("keeps an imported unchanged answer as a successful no-op without marking it manually edited", async () => {
    const f = await fixture(),
      repository = new D1AssessmentRepository(env.DB);
    f.record.document.importInfo = {
      fileName: "anonymous.xlsx",
      clientFileSha256: "c".repeat(64),
      normalizedSha256: "d".repeat(64),
      importedAt: "2026-09-19T00:00:00.000Z",
      importedBy: f.actorId,
      star4Excluded: 0,
      missingIds: [],
    };
    f.record.document.responses[firstId].original = {
      sheet: "匿名",
      row: 6,
      O: "",
      P: "",
      Q: "",
      R: "",
    };
    const seeded = await repository.save({
      record: f.record,
      actorId: f.actorId,
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      requestHash: "c".repeat(64),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
    const before = (await f.request(`/assessments/${f.record.id}`)).body.data;
    const result = await f.request(`/assessments/${f.record.id}/responses/${firstId}`, "PATCH", {
      ...edit(seeded.revision, "unanswered", ""),
      basis: "",
      plannedWork: "",
      supplement: "",
    });
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual(before);
  });
  it("counts confirmed advice ahead of pending drafts and stale advice separately from draft-only responses", async () => {
    const f = await fixture(),
      repository = new D1AssessmentRepository(env.DB),
      ids = master.criteria.map((c) => c.id);
    const draft: Advice = {
      origin: "manual",
      templateId: null,
      gap: "匿名の不足",
      steps: [],
      evidenceExamples: [],
      completionCheck: "照合",
      notes: "",
    };
    f.record.document.responses[ids[0]].adviceDraft = draft;
    f.record.document.responses[ids[0]].confirmedAdvice = {
      content: draft,
      basisHash: f.record.document.responses[ids[0]].basisHash,
      by: f.actorId,
      at: "2026-09-19T00:00:00.000Z",
      version: 1,
    };
    f.record.document.responses[ids[1]].adviceDraft = draft;
    f.record.document.responses[ids[1]].confirmedAdvice = {
      content: draft,
      basisHash: "0".repeat(64),
      by: f.actorId,
      at: "2026-09-19T00:00:00.000Z",
      version: 1,
    };
    f.record.document.responses[ids[2]].adviceDraft = draft;
    await repository.save({
      record: f.record,
      actorId: f.actorId,
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      requestHash: "d".repeat(64),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
    expect((await f.request(`/assessments/${f.record.id}`)).body.data.adviceSummary).toEqual({
      currentConfirmed: 1,
      stale: 1,
      draftOnly: 1,
      none: 78,
      draftPending: 3,
    });
  });
  it("returns the exact published standard and all 81 unanswered criteria for a new assessment", async () => {
    const f = await fixture();
    const standard = await f.request(`/standards/${STANDARD_ID}`);
    expect(standard.status).toBe(200);
    expect(standard.body.data).toEqual({ ...master, expectedCount: 81 });
    const result = await f.request(`/assessments/${f.record.id}`);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body.data.document.responses)).toEqual(
      master.criteria.map((c) => c.id),
    );
    expect(result.body.data.counts).toEqual({
      yes: 0,
      uncertain: 0,
      no: 0,
      unanswered: 81,
      total: 81,
    });
    expect(result.body.data.categoryCounts).toEqual(
      [...new Set(master.criteria.map((c) => c.category))].map((category) => ({
        category,
        yes: 0,
        uncertain: 0,
        no: 0,
        unanswered: master.criteria.filter((c) => c.category === category).length,
        total: master.criteria.filter((c) => c.category === category).length,
      })),
    );
    expect(result.body.data.evidenceSummary).toEqual({
      notRegistered: { count: 81, criterionIds: master.criteria.map((c) => c.id) },
      unreviewed: { count: 0, criterionIds: [] },
      rejected: { count: 0, criterionIds: [] },
      allConfirmed: { count: 0, criterionIds: [] },
      unconfirmedYes: { count: 0, criterionIds: [] },
    });
    expect(result.body.data.adviceSummary).toEqual({
      currentConfirmed: 0,
      draftOnly: 0,
      stale: 0,
      none: 81,
      draftPending: 0,
    });
  });
  it("saves a first manual blank answer once, stores a successful no-op receipt, and replays its original revision", async () => {
    const f = await fixture(),
      path = `/assessments/${f.record.id}/responses/${firstId}`;
    const blank = { ...edit(1, "unanswered", ""), basis: "", plannedWork: "", supplement: "" };
    const first = await f.request(path, "PATCH", blank);
    expect(first.status).toBe(200);
    expect(first.body.data.document.responses[firstId]).toEqual({
      ...f.record.document.responses[firstId],
      manualEdited: true,
    });
    expect(first.body.data.revision).toBe(2);
    const same = { ...blank, expectedRevision: 2, mutationId: crypto.randomUUID() };
    const noop = await f.request(path, "PATCH", same);
    expect(noop.body.data).toEqual(first.body.data);
    expect(
      await env.DB.prepare(
        "SELECT resource_id AS resourceId FROM operation_receipts WHERE actor_id=? AND operation_key=?",
      )
        .bind(f.actorId, same.mutationId)
        .first(),
    ).toEqual({ resourceId: f.record.id });
    expect((await f.request(path, "PATCH", edit(2))).status).toBe(200);
    expect((await f.request(path, "PATCH", same)).body.data).toEqual(noop.body.data);
    expect((await f.request(path, "PATCH", edit(2))).status).toBe(409);
  });
  it("preserves original O–R and 81 IDs and keeps old advice stale even after reverting an answer", async () => {
    const f = await fixture(),
      repository = new D1AssessmentRepository(env.DB);
    const original = {
      sheet: "匿名シート",
      row: 6,
      O: "✖",
      P: "元理由",
      Q: "元根拠・作業",
      R: "元補足",
    };
    const advice: Advice = {
      origin: "manual",
      templateId: null,
      gap: "不足",
      steps: ["確認する"],
      evidenceExamples: [],
      completionCheck: "確認済み",
      notes: "",
    };
    f.record.document.responses[firstId].original = original;
    f.record.document.responses[firstId].confirmedAdvice = {
      content: advice,
      basisHash: f.record.document.responses[firstId].basisHash,
      by: f.actorId,
      at: "2026-09-19T00:00:00.000Z",
      version: 1,
    };
    const seeded = await repository.save({
      record: f.record,
      actorId: f.actorId,
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
    const path = `/assessments/${f.record.id}/responses/${firstId}`;
    const changed = await f.request(path, "PATCH", edit(seeded.revision));
    expect(changed.status).toBe(200);
    const reverted = await f.request(path, "PATCH", {
      ...edit(changed.body.data.revision, "unanswered", ""),
      basis: "",
      plannedWork: "",
      supplement: "",
    });
    expect(reverted.status).toBe(200);
    expect(Object.keys(reverted.body.data.document.responses)).toEqual(
      master.criteria.map((c) => c.id),
    );
    expect(reverted.body.data.document.responses[firstId]).toEqual({
      ...seeded.document.responses[firstId],
      manualEdited: true,
      adviceBasisVersion: 3,
      basisHash: reverted.body.data.document.responses[firstId].basisHash,
    });
    expect(
      reverted.body.data.document.responses[firstId].basisHash ===
        seeded.document.responses[firstId].basisHash,
    ).toBe(false);
    expect(reverted.body.data.adviceSummary).toEqual({
      currentConfirmed: 0,
      draftOnly: 0,
      stale: 1,
      none: 80,
      draftPending: 0,
    });
    for (const extra of [{ original }, { confirmedAdvice: null }, { status: "notApplicable" }])
      expect(
        (await f.request(path, "PATCH", { ...edit(reverted.body.data.revision), ...extra })).status,
      ).toBe(422);
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(reverted.body.data);
  });
  it("counts four states and overlapping evidence independently without granting yes for confirmed documents", async () => {
    const f = await fixture(),
      repository = new D1AssessmentRepository(env.DB),
      ids = master.criteria.map((c) => c.id);
    ["yes", "yes", "yes", "yes", "uncertain", "no"].forEach((status, i) => {
      f.record.document.responses[ids[i]].status = status as "yes" | "uncertain" | "no";
    });
    f.record.document.evidence = [
      {
        id: crypto.randomUUID(),
        criterionIds: [ids[1], ids[2], ids[4]],
        name: "匿名規程",
        url: null,
        location: "第2章",
        fileId: null,
        reviews: Object.fromEntries(
          [1, 2, 4].map((i) => [
            ids[i],
            {
              state: i === 4 ? "confirmed" : "unreviewed",
              note: "",
              by: null,
              at: null,
              subjectHash: null,
            },
          ]),
        ),
      },
      {
        id: crypto.randomUUID(),
        criterionIds: [ids[1], ids[3]],
        name: "匿名記録",
        url: null,
        location: "",
        fileId: null,
        reviews: {
          [ids[1]]: { state: "rejected", note: "", by: null, at: null, subjectHash: null },
          [ids[3]]: { state: "confirmed", note: "", by: null, at: null, subjectHash: null },
        },
      },
    ];
    await repository.save({
      record: f.record,
      actorId: f.actorId,
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      requestHash: "b".repeat(64),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
    const result = (await f.request(`/assessments/${f.record.id}`)).body.data;
    expect(result.counts).toEqual({ yes: 4, uncertain: 1, no: 1, unanswered: 75, total: 81 });
    expect(result.evidenceSummary).toEqual({
      notRegistered: { count: 77, criterionIds: ids.filter((_, i) => ![1, 2, 3, 4].includes(i)) },
      unreviewed: { count: 2, criterionIds: [ids[1], ids[2]] },
      rejected: { count: 1, criterionIds: [ids[1]] },
      allConfirmed: { count: 2, criterionIds: [ids[3], ids[4]] },
      unconfirmedYes: { count: 3, criterionIds: [ids[0], ids[1], ids[2]] },
    });
    expect(
      result.categoryCounts.reduce(
        (sum: Record<string, number>, c: Record<string, number>) =>
          Object.fromEntries(Object.keys(sum).map((k) => [k, sum[k] + c[k]])),
        { yes: 0, uncertain: 0, no: 0, unanswered: 0, total: 0 },
      ),
    ).toEqual(result.counts);
  });
  it("hides other customers on read and write and rejects unknown criteria without changing the record", async () => {
    const f = await fixture(),
      other = await fixture(),
      before = (await f.request(`/assessments/${f.record.id}`)).body.data;
    expect((await other.request(`/assessments/${f.record.id}`)).status).toBe(404);
    expect(
      (await other.request(`/assessments/${f.record.id}/responses/${firstId}`, "PATCH", edit(1)))
        .status,
    ).toBe(404);
    expect(
      (await f.request(`/assessments/${f.record.id}/responses/unknown`, "PATCH", edit(1))).status,
    ).toBe(404);
    expect((await f.request(`/standards/unknown`)).status).toBe(404);
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(before);
  });
});
