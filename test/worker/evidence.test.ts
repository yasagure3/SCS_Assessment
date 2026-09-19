import { beforeAll, describe, expect, it, vi } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import { STANDARD_ID, type AssessmentRecord } from "../../src/shared/contracts/assessment";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import master from "../../src/server/db/seed/scs-20260327-star3.json";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const ids = master.criteria.slice(0, 3).map((c) => c.id);
const unreviewed = {
  state: "unreviewed",
  note: "",
  by: null,
  at: null,
  subjectHash: null,
} as const;
const mutation = (expectedRevision: number) => ({
  expectedRevision,
  mutationId: crypto.randomUUID(),
});
const fields = {
  criterionIds: ids.slice(0, 2),
  name: "匿名規程",
  url: "https://example.invalid/document",
  location: "第2章",
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
  });
  async function request(path: string, method = "GET", body?: unknown) {
    const res = await app.request(
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
    return { status: res.status, body: await res.json<{ data: any; error?: { code: string } }>() };
  }
  const customer = await request("/customers", "POST", { name: "匿名証跡社" });
  const created = await request(`/customers/${customer.body.data.id}/cases`, "POST", {
    name: "初回",
    standardId: STANDARD_ID,
  });
  expect(created.status).toBe(201);
  const repository = new D1AssessmentRepository(env.DB);
  const record = await repository.get(created.body.data.assessmentId, actorId);
  async function seed(record: AssessmentRecord) {
    return repository.save({
      record,
      actorId,
      expectedRevision: record.revision,
      mutationId: crypto.randomUUID(),
      requestHash: crypto.randomUUID().replaceAll("-", "").repeat(2),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
  }
  return { actorId, request, record, seed, path: `/assessments/${record.id}/evidence` };
}
describe("evidence metadata and criterion review", () => {
  it("accepts omitted optional references and Unicode codepoint limits, rejects evidence 101 without partial changes", async () => {
    const f = await fixture();
    const added = await f.request(f.path, "POST", {
      ...mutation(1),
      name: "😀".repeat(200),
      criterionIds: [ids[0]],
    });
    expect(added.status).toBe(200);
    const record: AssessmentDto = added.body.data,
      item = record.document.evidence[0];
    expect(item).toEqual({
      id: expect.any(String),
      name: "😀".repeat(200),
      criterionIds: [ids[0]],
      url: null,
      location: "",
      fileId: null,
      reviews: { [ids[0]]: unreviewed },
    });
    record.document.evidence = Array.from({ length: 100 }, () => ({
      ...structuredClone(item),
      id: crypto.randomUUID(),
    }));
    const seeded = await f.seed(record);
    expect(
      (await f.request(f.path, "POST", { ...mutation(seeded.revision), ...fields, fileId: null }))
        .status,
    ).toBe(422);
    expect((await f.request(`/assessments/${record.id}`)).body.data.document).toEqual(
      seeded.document,
    );
  });
  it("replays the exact reviewed revision after deleting its evidence and allows only one concurrent change", async () => {
    const f = await fixture();
    const add = await f.request(f.path, "POST", { ...mutation(1), ...fields, fileId: null });
    expect(add.status).toBe(200);
    const item = add.body.data.document.evidence[0],
      path = `${f.path}/${item.id}`;
    const input = { ...mutation(add.body.data.revision), state: "confirmed", note: "照合" };
    const reviewed = await f.request(`${path}/reviews/${ids[0]}`, "POST", input);
    expect(reviewed.status).toBe(200);
    const revision = reviewed.body.data.revision;
    const results = await Promise.all([
      f.request(path, "DELETE", mutation(revision)),
      f.request(path, "PATCH", { ...mutation(revision), ...fields, name: "並行編集" }),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const current = (await f.request(`/assessments/${f.record.id}`)).body.data;
    if (current.document.evidence.length)
      expect((await f.request(path, "DELETE", mutation(current.revision))).status).toBe(200);
    expect((await f.request(`${path}/reviews/${ids[0]}`, "POST", input)).body.data).toEqual(
      reviewed.body.data,
    );
    expect((await f.request(`/assessments/${f.record.id}`)).body.data.document.evidence).toEqual(
      [],
    );
  });
  it("rolls back document history receipt and audit together when the final audit write fails", async () => {
    const f = await fixture();
    const before = (await f.request(`/assessments/${f.record.id}`)).body.data;
    const input = { ...mutation(1), ...fields, fileId: null };
    await env.DB.prepare(
      "CREATE TRIGGER evidence_test_abort BEFORE INSERT ON audit_events WHEN NEW.action='assessment.evidence.add' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
    ).run();
    try {
      expect((await f.request(f.path, "POST", input)).status).toBe(500);
      expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(before);
      expect(
        await env.DB.prepare(
          "SELECT (SELECT count(*) FROM assessment_revisions WHERE assessment_id=?) AS revisions, (SELECT count(*) FROM operation_receipts WHERE actor_id=? AND operation_key=?) AS receipts, (SELECT count(*) FROM audit_events WHERE resource_id=? AND action='assessment.evidence.add') AS audits",
        )
          .bind(f.record.id, f.actorId, input.mutationId, f.record.id)
          .first(),
      ).toEqual({ revisions: 1, receipts: 0, audits: 0 });
    } finally {
      await env.DB.prepare("DROP TRIGGER evidence_test_abort").run();
    }
    expect((await f.request(f.path, "POST", input)).status).toBe(200);
  });
  it("registers without fetching URLs, records independent reviews and preserves current/original answers", async () => {
    const f = await fixture();
    f.record.document.responses[ids[0]].original = {
      sheet: "匿名",
      row: 6,
      O: "○",
      P: "原理由",
      Q: "原根拠",
      R: "原補足",
    };
    f.record.document.responses[ids[0]].status = "yes";
    const seeded = await f.seed(f.record);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("External URL fetch forbidden"));
    try {
      const input = { ...mutation(seeded.revision), ...fields, fileId: null };
      const added = await f.request(f.path, "POST", input);
      expect(added.status).toBe(200);
      const record: AssessmentDto = added.body.data,
        item = record.document.evidence[0];
      expect(item).toEqual({
        id: expect.any(String),
        ...fields,
        fileId: null,
        reviews: Object.fromEntries(ids.slice(0, 2).map((id) => [id, unreviewed])),
      });
      expect((await f.request(f.path, "POST", input)).body.data).toEqual(record);
      const review = await f.request(`${f.path}/${item.id}/reviews/${ids[0]}`, "POST", {
        ...mutation(record.revision),
        state: "confirmed",
        note: "原本と照合",
      });
      expect(review.status).toBe(200);
      expect(review.body.data.document.evidence[0].reviews).toEqual({
        [ids[0]]: {
          state: "confirmed",
          note: "原本と照合",
          by: f.actorId,
          at: expect.any(String),
          subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        [ids[1]]: unreviewed,
      });
      const response = review.body.data.document.responses[ids[0]];
      expect(response).toEqual({
        ...seeded.document.responses[ids[0]],
        adviceBasisVersion: seeded.document.responses[ids[0]].adviceBasisVersion + 2,
        basisHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(review.body.data).toEqual((await f.request(`/assessments/${f.record.id}`)).body.data);
      expect(review.body.data.evidenceSummary.allConfirmed).toEqual({
        count: 1,
        criterionIds: [ids[0]],
      });
      expect(
        (
          await f.request(`${f.path}/${item.id}/reviews/${ids[2]}`, "POST", {
            ...mutation(review.body.data.revision),
            state: "confirmed",
            note: "対象外",
          })
        ).status,
      ).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it.each(["edit", "review", "unlink", "delete"] as const)(
    "%s invalidates related advice and task completion atomically, keeping todo/doing and unrelated criteria",
    async (operation) => {
      const f = await fixture();
      const added = await f.request(f.path, "POST", { ...mutation(1), ...fields, fileId: null });
      expect(added.status).toBe(200);
      const record: AssessmentRecord = added.body.data,
        item = record.document.evidence[0];
      const reviewed = {
        state: "confirmed",
        note: "照合",
        by: f.actorId,
        at: "2026-09-19T00:00:00.000Z",
        subjectHash: "a".repeat(64),
      } as const;
      item.reviews = Object.fromEntries(item.criterionIds.map((id) => [id, reviewed]));
      record.document.tasks = (["done", "awaiting_review", "todo", "doing"] as const).map(
        (state) => ({
          id: crypto.randomUUID(),
          sourceTaskId: null,
          sourceAssessmentId: null,
          criterionId: ids[0],
          title: state,
          ownerName: "担当",
          dueDate: "",
          priority: "normal",
          state,
          completionCondition: "照合",
          result: "完了結果",
          evidenceIds: [item.id],
          review: reviewed,
        }),
      );
      let seeded = await f.seed(record);
      for (const id of ids.slice(0, 2))
        seeded.document.responses[id].confirmedAdvice = {
          content: {
            origin: "manual",
            templateId: null,
            gap: "不足",
            steps: [],
            evidenceExamples: [],
            completionCheck: "確認",
            notes: "",
          },
          basisHash: seeded.document.responses[id].basisHash,
          by: f.actorId,
          at: reviewed.at,
          version: 1,
        };
      seeded = await f.seed(seeded);
      const input =
        operation === "review"
          ? { ...mutation(seeded.revision), state: "rejected", note: "不足あり" }
          : operation === "delete"
            ? mutation(seeded.revision)
            : {
                ...mutation(seeded.revision),
                ...fields,
                name: operation === "edit" ? "改訂規程" : fields.name,
                criterionIds: operation === "unlink" ? [ids[1]] : fields.criterionIds,
              };
      const path = `${f.path}/${item.id}${operation === "review" ? `/reviews/${ids[0]}` : ""}`;
      const method = operation === "review" ? "POST" : operation === "delete" ? "DELETE" : "PATCH";
      const result = await f.request(path, method, input);
      expect(result.status).toBe(200);
      const next: AssessmentDto = result.body.data;
      expect(next.document.tasks).toEqual(
        seeded.document.tasks.map((task) => ({
          ...task,
          state: task.state === "todo" ? "todo" : "doing",
          evidenceIds: operation === "unlink" || operation === "delete" ? [] : [item.id],
          review: unreviewed,
        })),
      );
      expect(next.adviceSummary).toEqual({
        currentConfirmed: operation === "review" ? 1 : 0,
        stale: operation === "review" ? 1 : 2,
        draftOnly: 0,
        draftPending: 0,
        none: 79,
      });
      expect(next.document.responses[ids[2]]).toEqual(seeded.document.responses[ids[2]]);
      if (operation === "edit")
        expect(next.document.evidence[0].reviews).toEqual({
          [ids[0]]: unreviewed,
          [ids[1]]: unreviewed,
        });
      if (operation === "unlink")
        expect(next.document.evidence[0].reviews).toEqual({ [ids[1]]: unreviewed });
      if (operation === "delete") expect(next.document.evidence).toEqual([]);
      expect((await f.request(path, method, input)).body.data).toEqual(next);
      expect((await f.request(`/assessments/${record.id}`)).body.data).toEqual(next);
      expect(next.revision).toBe(seeded.revision + 1);
    },
  );
  it("rejects malformed or server-owned fields without saving and permits name-only evidence", async () => {
    const f = await fixture();
    for (const invalid of [
      { name: " " },
      { name: "a".repeat(201) },
      { url: "javascript:alert(1)" },
      { criterionIds: [] },
      { criterionIds: [ids[0], ids[0]] },
      { criterionIds: ["unknown"] },
      { reviews: {} },
      { id: crypto.randomUUID() },
    ]) {
      expect(
        (await f.request(f.path, "POST", { ...mutation(1), ...fields, fileId: null, ...invalid }))
          .status,
      ).toBe(422);
    }
    const added = await f.request(f.path, "POST", {
      ...mutation(1),
      ...fields,
      criterionIds: [ids[0]],
      location: "",
      url: null,
      fileId: null,
    });
    expect(added.status).toBe(200);
    const record: AssessmentDto = added.body.data,
      item = record.document.evidence[0];
    for (const invalid of [
      { state: "confirmed", note: " " },
      { state: "rejected", note: "" },
      { state: "confirmed", note: "確認", by: f.actorId },
      { state: "confirmed", note: "確認", subjectHash: "a".repeat(64) },
    ])
      expect(
        (
          await f.request(`${f.path}/${item.id}/reviews/${ids[0]}`, "POST", {
            ...mutation(record.revision),
            ...invalid,
          })
        ).status,
      ).toBe(422);
    expect(
      (
        await f.request(`${f.path}/${item.id}`, "PATCH", {
          ...mutation(record.revision),
          ...fields,
          fileId: null,
        })
      ).status,
    ).toBe(422);
    expect((await f.request(`/assessments/${record.id}`)).body.data).toEqual(record);
  });
  it("guards case/customer/file ownership, readiness and CAS, and retains the saved no-op result", async () => {
    const f = await fixture(),
      other = await fixture();
    const another = await f.request(`/customers/${f.record.customerId}/cases`, "POST", {
      name: "別案件",
      standardId: STANDARD_ID,
    });
    for (const source of [
      {
        customerId: f.record.customerId,
        caseId: another.body.data.case.id,
        actorId: f.actorId,
        status: "ready",
      },
      {
        customerId: other.record.customerId,
        caseId: other.record.caseId,
        actorId: other.actorId,
        status: "ready",
      },
      {
        customerId: f.record.customerId,
        caseId: f.record.caseId,
        actorId: f.actorId,
        status: "uploading",
      },
    ]) {
      const fileId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO files VALUES(?,?,?,?,?,?,1,?,?,?,?)")
        .bind(
          fileId,
          source.customerId,
          source.caseId,
          crypto.randomUUID(),
          "anonymous.txt",
          "text/plain",
          "0".repeat(64),
          source.status,
          source.actorId,
          new Date().toISOString(),
        )
        .run();
      expect((await f.request(f.path, "POST", { ...mutation(1), ...fields, fileId })).status).toBe(
        409,
      );
    }
    expect(
      (await other.request(f.path, "POST", { ...mutation(1), ...fields, fileId: null })).status,
    ).toBe(404);
    const added = await f.request(f.path, "POST", { ...mutation(1), ...fields, fileId: null });
    expect(added.status).toBe(200);
    const record: AssessmentDto = added.body.data,
      path = `${f.path}/${record.document.evidence[0].id}`;
    const noopBody = { ...mutation(record.revision), ...fields };
    const noop = await f.request(path, "PATCH", noopBody);
    expect(noop.body.data).toEqual(record);
    const changed = await f.request(path, "PATCH", {
      ...mutation(record.revision),
      ...fields,
      location: "3章",
    });
    expect(changed.status).toBe(200);
    expect((await f.request(path, "PATCH", noopBody)).body.data).toEqual(record);
    expect((await f.request(path, "PATCH", { ...noopBody, name: "異なる入力" })).status).toBe(409);
    expect((await f.request(path, "DELETE", mutation(record.revision))).status).toBe(409);
    expect(
      (await f.request(`${other.path}/${record.document.evidence[0].id}`, "DELETE", mutation(1)))
        .status,
    ).toBe(404);
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(changed.body.data);
  });
});
