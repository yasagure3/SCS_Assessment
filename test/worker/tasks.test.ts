import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import { STANDARD_ID, type AssessmentRecord } from "../../src/shared/contracts/assessment";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import master from "../../src/server/db/seed/scs-20260327-star3.json";
import { taskIsOverdue } from "../../src/shared/taskChange";
import type { Task } from "../../src/shared/contracts/assessment";

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
  return { actorId, request, record, seed, path: `/assessments/${record.id}/tasks` };
}
const fields = {
  criterionId: ids[0],
  title: "規程を整備",
  ownerName: "顧客の担当者",
  dueDate: "2026-09-20",
  priority: "normal",
  completionCondition: "規程と実施記録を照合",
};
const editFields = (task: Task) => ({
  title: task.title,
  ownerName: task.ownerName,
  dueDate: task.dueDate,
  priority: task.priority,
  completionCondition: task.completionCondition,
  state: task.state,
  result: task.result,
  evidenceIds: task.evidenceIds,
});
async function submittedFixture() {
  const f = await fixture();
  f.record.document.responses[ids[0]].original = {
    sheet: "匿名",
    row: 6,
    O: "✖",
    P: "元理由",
    Q: "根拠",
    R: "補足",
  };
  f.record.document.responses[ids[0]].status = "no";
  const evidenceId = crypto.randomUUID();
  f.record.document.evidence = [
    {
      id: evidenceId,
      criterionIds: [ids[0]],
      name: "実施記録",
      url: null,
      location: "",
      fileId: null,
      reviews: { [ids[0]]: unreviewed },
    },
  ];
  const seeded = await f.seed(f.record);
  const added = await f.request(f.path, "POST", { ...mutation(seeded.revision), ...fields });
  expect(added.status).toBe(200);
  const created: AssessmentDto = added.body.data;
  const task = created.document.tasks[0];
  const path = `${f.path}/${task.id}`;
  const result = await f.request(path, "PATCH", {
    ...mutation(created.revision),
    ...editFields(task),
    state: "awaiting_review",
    result: "記録を照合した",
    evidenceIds: [evidenceId],
  });
  expect(result.status).toBe(200);
  return { ...f, path, evidenceId, submitted: result.body.data as AssessmentDto };
}
describe("improvement tasks", () => {
  it("revokes task reads and replay when the staff membership is removed", async () => {
    const f = await fixture();
    const input = { ...mutation(1), ...fields };
    const created = await f.request(f.path, "POST", input);
    expect(created.status).toBe(200);
    await env.DB.prepare("DELETE FROM customer_memberships WHERE user_id=? AND customer_id=?")
      .bind(f.actorId, f.record.customerId)
      .run();
    expect((await f.request(f.path, "POST", input)).status).toBe(404);
    expect((await f.request(`/assessments/${f.record.id}`)).status).toBe(404);
    const stored = await env.DB.prepare("SELECT revision,document_json FROM assessments WHERE id=?")
      .bind(f.record.id)
      .first<{ revision: number; document_json: string }>();
    expect({ revision: stored!.revision, document: JSON.parse(stored!.document_json) }).toEqual({
      revision: created.body.data.revision,
      document: created.body.data.document,
    });
  });
  it.each(["todo", "doing", "awaiting_review"] as const)(
    "editing a submitted result returns awaiting_review to doing and preserves %s otherwise",
    async (state) => {
      const f = await submittedFixture();
      let record = f.submitted;
      if (state !== "awaiting_review") {
        const changed = await f.request(f.path, "PATCH", {
          ...mutation(record.revision),
          ...editFields(record.document.tasks[0]),
          state,
        });
        expect(changed.status).toBe(200);
        record = changed.body.data;
      }
      const result = await f.request(f.path, "PATCH", {
        ...mutation(record.revision),
        ...editFields(record.document.tasks[0]),
        result: "更新した作業結果",
      });
      expect(result.status).toBe(200);
      expect(result.body.data.document.tasks).toEqual([
        {
          ...record.document.tasks[0],
          result: "更新した作業結果",
          state: state === "awaiting_review" ? "doing" : state,
          review: unreviewed,
        },
      ]);
      expect(result.body.data.document.responses).toEqual(record.document.responses);
    },
  );
  it("reports a revision conflict when evidence changed after completion submission", async () => {
    const f = await submittedFixture();
    const evidence = f.submitted.document.evidence[0];
    const changed = await f.request(
      `/assessments/${f.record.id}/evidence/${evidence.id}`,
      "PATCH",
      {
        ...mutation(f.submitted.revision),
        name: "更新後の実施記録",
        url: evidence.url,
        location: evidence.location,
        criterionIds: evidence.criterionIds,
      },
    );
    expect(changed.status).toBe(200);
    expect(changed.body.data.document.tasks).toEqual([
      { ...f.submitted.document.tasks[0], state: "doing", review: unreviewed },
    ]);
    const result = await f.request(`${f.path}/review`, "POST", {
      ...mutation(f.submitted.revision),
      state: "confirmed",
      note: "古い完了報告の確認",
    });
    expect(result.status).toBe(409);
    expect(result.body.error).toEqual({
      code: "CONFLICT",
      message: "他の担当者が更新しました。再読み込みして内容を確認してください。",
    });
    expect((await f.request(`/assessments/${f.record.id}`)).body.data).toEqual(changed.body.data);
  });
  it("creates an assigned task without changing answers or creating accounts", async () => {
    const f = await fixture();
    const beforeUsers = await env.DB.prepare("SELECT count(*) AS n FROM app_users").first();
    const result = await f.request(f.path, "POST", { ...mutation(1), ...fields });
    expect(result.status).toBe(200);
    const saved: AssessmentDto = result.body.data;
    expect(saved.document.tasks).toEqual([
      {
        id: expect.any(String),
        sourceTaskId: null,
        sourceAssessmentId: null,
        ...fields,
        state: "todo",
        result: "",
        evidenceIds: [],
        review: unreviewed,
      },
    ]);
    expect(saved.document.responses).toEqual(f.record.document.responses);
    expect(saved.revision).toBe(2);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM app_users").first()).toEqual(
      beforeUsers,
    );
  });
  it.each(["confirmed", "rejected"] as const)(
    "records %s only for a submitted task and preserves all responses and originals",
    async (state) => {
      const f = await submittedFixture();
      const input = { ...mutation(f.submitted.revision), state, note: "条件と実施記録を確認" };
      const result = await f.request(`${f.path}/review`, "POST", input);
      expect(result.status).toBe(200);
      const saved: AssessmentDto = result.body.data;
      expect(saved.document.tasks).toEqual([
        {
          ...f.submitted.document.tasks[0],
          state: state === "confirmed" ? "done" : "doing",
          review: {
            state,
            note: input.note,
            by: f.actorId,
            at: expect.any(String),
            subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        },
      ]);
      expect(saved.document.responses).toEqual(f.submitted.document.responses);
      expect(saved.counts).toEqual(f.submitted.counts);
      expect((await f.request(`${f.path}/review`, "POST", input)).body.data).toEqual(saved);
      expect(
        (await f.request(`${f.path}/review`, "POST", { ...input, note: "別入力" })).status,
      ).toBe(409);
      expect(
        (
          await f.request(`${f.path}/review`, "POST", {
            ...mutation(saved.revision),
            state,
            note: "再確認",
          })
        ).status,
      ).toBe(422);
    },
  );
  it.each(["result", "completionCondition", "evidenceIds"] as const)(
    "clears confirmation when %s changes and requires an explicit resubmission",
    async (field) => {
      const f = await submittedFixture();
      const confirmed = await f.request(`${f.path}/review`, "POST", {
        ...mutation(f.submitted.revision),
        state: "confirmed",
        note: "照合済",
      });
      const record: AssessmentDto = confirmed.body.data;
      const changed = field === "evidenceIds" ? [] : "更新後の記録";
      const result = await f.request(f.path, "PATCH", {
        ...mutation(record.revision),
        ...editFields(record.document.tasks[0]),
        [field]: changed,
      });
      expect(result.status).toBe(200);
      const saved: AssessmentDto = result.body.data;
      expect(saved.document.tasks).toEqual([
        { ...record.document.tasks[0], [field]: changed, state: "doing", review: unreviewed },
      ]);
      expect(saved.document.responses).toEqual(record.document.responses);
      expect(
        (
          await f.request(`${f.path}/review`, "POST", {
            ...mutation(saved.revision),
            state: "confirmed",
            note: "確認",
          })
        ).status,
      ).toBe(422);
    },
  );
  it("keeps confirmation for owner, due date and priority edits and replays a no-op after a later update", async () => {
    const f = await submittedFixture();
    const confirmed = await f.request(`${f.path}/review`, "POST", {
      ...mutation(f.submitted.revision),
      state: "confirmed",
      note: "照合済",
    });
    const record: AssessmentDto = confirmed.body.data;
    const noop = { ...mutation(record.revision), ...editFields(record.document.tasks[0]) };
    expect((await f.request(f.path, "PATCH", noop)).body.data).toEqual(record);
    const input = {
      ...mutation(record.revision),
      ...editFields(record.document.tasks[0]),
      ownerName: "別担当",
      dueDate: "2026-10-01",
      priority: "high",
    };
    const changed = await f.request(f.path, "PATCH", input);
    expect(changed.status).toBe(200);
    expect(changed.body.data.document.tasks).toEqual([
      {
        ...record.document.tasks[0],
        ownerName: input.ownerName,
        dueDate: input.dueDate,
        priority: input.priority,
      },
    ]);
    expect((await f.request(f.path, "PATCH", noop)).body.data).toEqual(record);
    expect(
      (await f.request(f.path, "PATCH", { ...input, mutationId: crypto.randomUUID() })).status,
    ).toBe(409);
  });
  it("rejects empty names, invalid dates, server metadata, unrelated evidence and unreviewed done without partial saves", async () => {
    const f = await fixture();
    for (const invalid of [
      { title: " " },
      { ownerName: " " },
      { dueDate: "" },
      { dueDate: "2026-02-30" },
      { completionCondition: " " },
      { criterionId: "unknown" },
      { id: crypto.randomUUID() },
      { review: unreviewed },
      { title: "😀".repeat(201) },
    ])
      expect(
        (await f.request(f.path, "POST", { ...mutation(1), ...fields, ...invalid })).status,
      ).toBe(422);
    const added = await f.request(f.path, "POST", {
      ...mutation(1),
      ...fields,
      title: "😀".repeat(200),
    });
    expect(added.status).toBe(200);
    const record: AssessmentDto = added.body.data;
    const task = record.document.tasks[0],
      path = `${f.path}/${task.id}`;
    for (const invalid of [
      { state: "done" },
      { state: "awaiting_review", result: "" },
      { state: "awaiting_review", result: "記録" },
      { evidenceIds: [crypto.randomUUID()] },
      { criterionId: ids[1] },
      { result: "a".repeat(8001) },
    ])
      expect(
        (
          await f.request(path, "PATCH", {
            ...mutation(record.revision),
            ...editFields(task),
            ...invalid,
          })
        ).status,
      ).toBe(422);
    expect(
      (
        await f.request(`${path}/review`, "POST", {
          ...mutation(record.revision),
          state: "confirmed",
          note: "確認",
        })
      ).status,
    ).toBe(422);
    expect((await f.request(`/assessments/${record.id}`)).body.data).toEqual(record);
  });
  it("permits only one CAS winner, deduplicates creation, and rejects cross-customer and archived edits", async () => {
    const f = await fixture(),
      other = await fixture();
    const input = { ...mutation(1), ...fields };
    const results = await Promise.all([
      f.request(f.path, "POST", input),
      f.request(f.path, "POST", input),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0].body.data).toEqual(results[1].body.data);
    const record: AssessmentDto = results[0].body.data;
    const task = record.document.tasks[0],
      path = `${f.path}/${task.id}`;
    const race = await Promise.all(
      ["担当A", "担当B"].map((ownerName) =>
        f.request(path, "PATCH", { ...mutation(record.revision), ...editFields(task), ownerName }),
      ),
    );
    expect(race.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(
      (await other.request(path, "PATCH", { ...mutation(record.revision), ...editFields(task) }))
        .status,
    ).toBe(404);
    expect(
      (
        await f.request(`${other.path}/${task.id}/review`, "POST", {
          ...mutation(1),
          state: "confirmed",
          note: "確認",
        })
      ).status,
    ).toBe(404);
    const winner: AssessmentDto = race.find((r) => r.status === 200)!.body.data;
    await env.DB.prepare("UPDATE cases SET archived_at=? WHERE id=?")
      .bind("2026-09-20T00:00:00Z", record.caseId)
      .run();
    expect(
      (
        await f.request(path, "PATCH", {
          ...mutation(winner.revision),
          ...editFields(winner.document.tasks[0]),
          ownerName: "変更",
        })
      ).status,
    ).toBe(409);
    expect((await f.request(`/assessments/${record.id}`)).body.data).toEqual(winner);
  });
  it("rejects task 101 and document overflow without saving a revision", async () => {
    const f = await fixture();
    f.record.document.tasks = Array.from({ length: 100 }, () => ({
      ...fields,
      id: crypto.randomUUID(),
      sourceTaskId: null,
      sourceAssessmentId: null,
      state: "todo" as const,
      priority: "normal" as const,
      result: "",
      evidenceIds: [],
      review: unreviewed,
    }));
    let seeded = await f.seed(f.record);
    expect(
      (await f.request(f.path, "POST", { ...mutation(seeded.revision), ...fields })).status,
    ).toBe(422);
    let remaining = 1048576 - new TextEncoder().encode(JSON.stringify(seeded.document)).length;
    for (const response of Object.values(seeded.document.responses))
      for (const key of ["reason", "basis"] as const) {
        const n = Math.min(8000, remaining);
        response[key] = "x".repeat(n);
        remaining -= n;
      }
    expect(remaining).toBe(0);
    seeded = await f.seed(seeded);
    const result = await f.request(`${f.path}/${seeded.document.tasks[0].id}`, "PATCH", {
      ...mutation(seeded.revision),
      ...editFields(seeded.document.tasks[0]),
      result: "増分",
    });
    expect(result.status).toBe(422);
    expect((await f.request(`/assessments/${seeded.id}`)).body.data.document).toEqual(
      seeded.document,
    );
  });
  it.each([
    ["todo", "2026-09-20T14:59:59.999Z", false],
    ["todo", "2026-09-20T15:00:00.000Z", true],
    ["doing", "2026-09-20T15:00:00.000Z", true],
    ["awaiting_review", "2026-09-20T15:00:00.000Z", true],
    ["done", "2026-09-20T15:00:00.000Z", false],
  ] as const)("computes overdue for %s at %s as %s using JST date", (state, now, expected) => {
    expect(taskIsOverdue({ dueDate: "2026-09-20", state }, now)).toBe(expected);
  });
});
