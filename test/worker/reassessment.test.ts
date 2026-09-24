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
import type { ReassessmentInput } from "../../src/shared/contracts/improvement";
import {
  compareAssessments,
  copyAssessment,
} from "../../src/server/modules/assessment/domain/reassessment";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const ids = master.criteria.map((c) => c.id);
const unreviewed = {
  state: "unreviewed",
  note: "",
  by: null,
  at: null,
  subjectHash: null,
} as const;
const advice = (gap: string): Advice => ({
  origin: "manual",
  templateId: null,
  gap,
  steps: [],
  evidenceExamples: [],
  completionCheck: "確認",
  notes: "",
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
  async function request(path: string, method = "GET", body?: unknown, key = crypto.randomUUID()) {
    const response = await app.request(
      `/api/v1${path}`,
      {
        method,
        headers: {
          Authorization: "Bearer fixture",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    return {
      status: response.status,
      body: await response.json<{ data: any; error: { code: string } }>(),
    };
  }
  const customer = await request("/customers", "POST", { name: "匿名再診断社" });
  const created = await request(`/customers/${customer.body.data.id}/cases`, "POST", {
    name: "比較案件",
    standardId: STANDARD_ID,
  });
  expect(created.status).toBe(201);
  const repository = new D1AssessmentRepository(env.DB);
  let record = await repository.get(created.body.data.assessmentId, actorId);
  const review = {
    state: "confirmed",
    note: "前回確認",
    by: actorId,
    at: now,
    subjectHash: "a".repeat(64),
  } as const;
  const evidenceId = crypto.randomUUID();
  record.document.evidence = [
    {
      id: evidenceId,
      criterionIds: [ids[0]],
      name: "前回証跡",
      url: null,
      location: "2章",
      fileId: null,
      reviews: { [ids[0]]: review },
    },
  ];
  record.document.responses[ids[0]] = {
    ...record.document.responses[ids[0]],
    original: { sheet: "匿名", row: 6, O: "✖", P: "元回答", Q: "", R: "" },
    status: "no",
    reason: "前回の回答",
    adviceDraft: advice("優先する下書き"),
    confirmedAdvice: {
      content: advice("古い確定"),
      basisHash: "b".repeat(64),
      by: actorId,
      at: now,
      version: 1,
    },
  };
  record.document.responses[ids[1]].confirmedAdvice = {
    content: advice("確定のみ"),
    basisHash: "b".repeat(64),
    by: actorId,
    at: now,
    version: 1,
  };
  record.document.tasks = [0, 1].map((i) => ({
    id: crypto.randomUUID(),
    sourceTaskId: null,
    sourceAssessmentId: null,
    criterionId: ids[0],
    title: `課題${i}`,
    ownerName: "匿名担当",
    dueDate: "2026-10-20",
    priority: "normal",
    state: "done",
    completionCondition: "実施記録照合",
    result: "完了した",
    evidenceIds: [evidenceId],
    review,
  }));
  async function seed(value: AssessmentRecord) {
    return repository.save({
      record: value,
      actorId,
      expectedRevision: value.revision,
      mutationId: crypto.randomUUID(),
      requestHash: "f".repeat(64),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
  }
  record = await seed(record);
  const input: ReassessmentInput = {
    previousAssessmentId: record.id,
    expectedPreviousRevision: record.revision,
    standardId: STANDARD_ID,
    diagnosisDate: "2026-10-01",
    scope: { ...record.document.scope, sites: "新拠点" },
    copyResponses: true,
    copyTaskIds: [record.document.tasks[0].id],
  };
  return {
    request,
    record,
    repository,
    actorId,
    seed,
    input,
    path: `/cases/${record.caseId}/reassessments`,
  };
}
describe("reassessment copy and pinned comparison", () => {
  it("does not label task progress as changed merely because copied evidence received new IDs", async () => {
    const f = await fixture();
    f.record.document.evidence[0].reviews[ids[0]] = unreviewed;
    f.record.document.tasks = f.record.document.tasks.map((task) => ({
      ...task,
      state: "todo",
      result: "",
      review: unreviewed,
    }));
    const source = await f.seed(f.record);
    const created = await f.request(f.path, "POST", {
      ...f.input,
      expectedPreviousRevision: source.revision,
      copyTaskIds: source.document.tasks.map((task) => task.id),
    });
    expect(created.status).toBe(201);
    const result = await f.request(
      `/assessments/${created.body.data.id}/comparison?previous=${source.id}`,
    );
    expect({
      changed: result.body.data.rows[0].changed,
      tasks: result.body.data.rows[0].tasks.matched.map(
        (pair: { changed: boolean }) => pair.changed,
      ),
    }).toEqual({ changed: false, tasks: [false, false] });
  });
  it("rejects a prepared copy if the source changed before the atomic insert", async () => {
    const f = await fixture(),
      id = crypto.randomUUID(),
      key = crypto.randomUUID();
    const document = await copyAssessment(f.record, f.input, ids, () => crypto.randomUUID());
    f.record.document.scope.companies = "並行変更";
    const source = await f.seed(f.record);
    const result = await f.repository
      .createReassessment({
        record: { ...f.record, id, previousAssessmentId: f.record.id, revision: 1, document },
        expectedPreviousRevision: f.input.expectedPreviousRevision,
        actorId: f.actorId,
        key,
        requestHash: "a".repeat(64),
        requestId: "cas",
      })
      .catch((error: { code: string }) => error.code);
    expect(result).toBe("CONFLICT");
    expect(await f.repository.get(f.record.id, f.actorId)).toEqual(source);
    expect(
      await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM assessments WHERE id=?) AS assessment,(SELECT COUNT(*) FROM operation_receipts WHERE operation_key=?) AS receipt",
      )
        .bind(id, key)
        .first(),
    ).toEqual({ assessment: 0, receipt: 0 });
  });
  it("rolls back the new assessment, immutable history and receipt when its audit insert fails", async () => {
    const f = await fixture(),
      key = crypto.randomUUID(),
      id = crypto.randomUUID();
    const document = await copyAssessment(f.record, f.input, ids, () => crypto.randomUUID());
    await env.DB.exec(
      "CREATE TRIGGER reassessment_audit_failure BEFORE INSERT ON audit_events WHEN NEW.request_id='reassessment-fail' BEGIN SELECT RAISE(ABORT,'copy_failure'); END;",
    );
    try {
      await expect(
        f.repository.createReassessment({
          record: { ...f.record, id, previousAssessmentId: f.record.id, revision: 1, document },
          expectedPreviousRevision: f.record.revision,
          actorId: f.actorId,
          key,
          requestHash: "a".repeat(64),
          requestId: "reassessment-fail",
        }),
      ).rejects.toThrow();
    } finally {
      await env.DB.exec("DROP TRIGGER reassessment_audit_failure;");
    }
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM assessments WHERE id=?) AS assessments,(SELECT COUNT(*) FROM assessment_revisions WHERE assessment_id=?) AS history,(SELECT COUNT(*) FROM operation_receipts WHERE operation_key=?) AS receipts",
    )
      .bind(id, id, key)
      .first();
    expect(counts).toEqual({ assessments: 0, history: 0, receipts: 0 });
    expect(await f.repository.get(f.record.id, f.actorId)).toEqual(f.record);
  });
  it("creates exactly one copy and history when the same request arrives concurrently", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const results = await Promise.all([
      f.request(f.path, "POST", f.input, key),
      f.request(f.path, "POST", f.input, key),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.data).toEqual(results[1].body.data);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM assessments WHERE case_id=?")
        .bind(f.record.caseId)
        .first(),
    ).toEqual({ count: 2 });
    const conflict = await f.request(f.path, "POST", { ...f.input, copyResponses: false }, key);
    expect({ status: conflict.status, code: conflict.body.error.code }).toEqual({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
  it("shows changed editions and unmatched criteria without inventing status order", async () => {
    const f = await fixture(),
      previous = structuredClone(f.record),
      current = structuredClone(f.record);
    previous.standardId = "old-edition";
    previous.document.responses[ids[0]].status = "uncertain";
    current.document.responses[ids[0]].status = "no";
    current.document.responses[ids[0]].reason = "今回の理由";
    current.document.responses["new-id"] = current.document.responses[ids[1]];
    delete current.document.responses[ids[1]];
    const result = compareAssessments(current, previous);
    expect({
      standardChanged: result.standardChanged,
      unmatchedIds: result.unmatchedIds,
      row: result.rows[0],
    }).toEqual({
      standardChanged: true,
      unmatchedIds: { previous: [ids[1]], current: ["new-id"] },
      row: {
        criterionId: ids[0],
        beforeStatus: "uncertain",
        afterStatus: "no",
        changed: true,
        responseChanges: [{ field: "reason", before: "前回の回答", after: "今回の理由" }],
        tasks: {
          mode: "unmatched",
          matched: [],
          notCarried: [],
          added: [],
          previous: previous.document.tasks,
          current: current.document.tasks,
        },
      },
    });
  });
  it("copies edited answers and evidence with fresh IDs, resets confirmations and retains the source unchanged", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const created = await f.request(f.path, "POST", f.input, key);
    expect(created.status).toBe(201);
    const next = created.body.data;
    const evidence = next.document.evidence[0];
    expect({ ...evidence, id: "new" }).toEqual({
      ...f.record.document.evidence[0],
      id: "new",
      reviews: { [ids[0]]: unreviewed },
    });
    expect(evidence.id === f.record.document.evidence[0].id).toBe(false);
    expect(next.document.tasks).toEqual([
      {
        ...f.record.document.tasks[0],
        id: expect.any(String),
        sourceTaskId: f.record.document.tasks[0].id,
        sourceAssessmentId: f.record.id,
        state: "todo",
        result: "",
        evidenceIds: [evidence.id],
        review: unreviewed,
      },
    ]);
    expect(next.document.tasks[0].id === f.record.document.tasks[0].id).toBe(false);
    expect(next.document.responses[ids[0]]).toEqual({
      ...f.record.document.responses[ids[0]],
      original: null,
      manualEdited: true,
      adviceBasisVersion: 1,
      basisHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      adviceDraft: advice("優先する下書き"),
      confirmedAdvice: null,
    });
    expect(next.document.responses[ids[1]].adviceDraft).toEqual(advice("確定のみ"));
    expect(next.document.responses[ids[2]].adviceDraft).toBeNull();
    expect({
      importInfo: next.document.importInfo,
      copiedFrom: next.document.copiedFrom,
      revision: next.revision,
      previous: next.previousAssessmentId,
    }).toEqual({
      importInfo: null,
      copiedFrom: { assessmentId: f.record.id, revision: f.record.revision },
      revision: 1,
      previous: f.record.id,
    });
    expect(await f.repository.get(f.record.id, f.actorId)).toEqual(f.record);
    expect((await f.request(f.path, "POST", f.input, key)).body.data).toEqual(next);
    const history = await env.DB.prepare(
      "SELECT revision,document_json FROM assessment_revisions WHERE assessment_id=?",
    )
      .bind(next.id)
      .all<{ revision: number; document_json: string }>();
    expect(
      history.results.map((r) => ({ revision: r.revision, document: JSON.parse(r.document_json) })),
    ).toEqual([{ revision: 1, document: next.document }]);
  });
  it("starts with 81 unanswered responses and no evidence or advice when answer copying is disabled", async () => {
    const f = await fixture();
    const created = await f.request(f.path, "POST", { ...f.input, copyResponses: false });
    expect(created.status).toBe(201);
    expect(created.body.data.counts).toEqual({
      yes: 0,
      uncertain: 0,
      no: 0,
      unanswered: 81,
      total: 81,
    });
    expect(created.body.data.document.evidence).toEqual([]);
    expect(created.body.data.document.tasks).toEqual([
      {
        ...f.record.document.tasks[0],
        id: expect.any(String),
        sourceTaskId: f.record.document.tasks[0].id,
        sourceAssessmentId: f.record.id,
        state: "todo",
        result: "",
        evidenceIds: [],
        review: unreviewed,
      },
    ]);
    expect(
      Object.values(created.body.data.document.responses).map((r: any) => [
        r.original,
        r.manualEdited,
        r.adviceDraft,
        r.confirmedAdvice,
        r.adviceBasisVersion,
      ]),
    ).toEqual(ids.map(() => [null, false, null, null, 1]));
  });
  it("rejects stale source revisions without creating a copy, receipt or audit", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    f.record.document.responses[ids[0]].reason = "コピー元を更新";
    await f.seed(f.record);
    const result = await f.request(f.path, "POST", f.input, key);
    expect({ status: result.status, code: result.body.error.code }).toEqual({
      status: 409,
      code: "CONFLICT",
    });
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM assessments WHERE case_id=?) AS assessments,(SELECT COUNT(*) FROM operation_receipts WHERE operation_key=?) AS receipts,(SELECT COUNT(*) FROM audit_events WHERE action='assessment.reassess' AND customer_id=?) AS audits",
    )
      .bind(f.record.caseId, key, f.record.customerId)
      .first();
    expect(counts).toEqual({ assessments: 1, receipts: 0, audits: 0 });
  });
  it("pins the copied revision, shows literal status transitions and maps only direct source tasks", async () => {
    const f = await fixture();
    const copy = await f.request(f.path, "POST", f.input);
    expect(copy.status).toBe(201);
    let next: AssessmentRecord = copy.body.data;
    next.document.responses[ids[0]].status = "uncertain";
    next = await f.seed(next);
    f.record.document.responses[ids[0]].status = "yes";
    const later = await f.seed(f.record);
    const comparison = await f.request(
      `/assessments/${next.id}/comparison?previous=${f.record.id}`,
    );
    expect(comparison.status).toBe(200);
    const data = comparison.body.data;
    expect({
      current: data.current.revision,
      previous: data.previous.revision,
      scopeChanges: data.scopeChanges,
      standardChanged: data.standardChanged,
      unmatchedIds: data.unmatchedIds,
    }).toEqual({
      current: next.revision,
      previous: f.input.expectedPreviousRevision,
      scopeChanges: [{ field: "sites", before: "", after: "新拠点" }],
      standardChanged: false,
      unmatchedIds: { previous: [], current: [] },
    });
    expect(data.rows[0]).toEqual({
      criterionId: ids[0],
      beforeStatus: "no",
      afterStatus: "uncertain",
      changed: true,
      responseChanges: [],
      tasks: {
        mode: "matched",
        matched: [
          { before: f.record.document.tasks[0], after: next.document.tasks[0], changed: true },
        ],
        notCarried: [f.record.document.tasks[1]],
        added: [],
        previous: [],
        current: [],
      },
    });
    const explicit = await f.request(
      `/assessments/${next.id}/comparison?previous=${f.record.id}&previousRevision=${later.revision}`,
    );
    expect({
      status: explicit.status,
      revision: explicit.body.data.previous.revision,
      before: explicit.body.data.rows[0].beforeStatus,
    }).toEqual({ status: 200, revision: later.revision, before: "yes" });
    const sibling = await f.request(f.path, "POST", {
      ...f.input,
      expectedPreviousRevision: later.revision,
    });
    const nonDirect = await f.request(
      `/assessments/${next.id}/comparison?previous=${sibling.body.data.id}`,
    );
    expect(nonDirect.body.data.rows[0].tasks).toEqual({
      mode: "unmatched",
      matched: [],
      notCarried: [],
      added: [],
      previous: sibling.body.data.document.tasks,
      current: next.document.tasks,
    });
  });
  it.each([
    { standardId: "scs-star4" },
    { copyTaskIds: ["11111111-1111-4111-8111-111111111111"] },
    { diagnosisDate: "2026-02-30" },
  ])("rejects invalid copy input %j", async (override) => {
    const f = await fixture();
    const result = await f.request(f.path, "POST", { ...f.input, ...override });
    expect({ status: result.status, code: result.body.error.code }).toEqual({
      status: 422,
      code: "VALIDATION_ERROR",
    });
  });
  it("rejects cross-case copies and comparisons and rechecks membership on retry", async () => {
    const f = await fixture();
    const other = await f.request(`/customers/${f.record.customerId}/cases`, "POST", {
      name: "別案件",
      standardId: STANDARD_ID,
    });
    const rejected = await f.request(
      `/cases/${other.body.data.case.id}/reassessments`,
      "POST",
      f.input,
    );
    expect({ status: rejected.status, code: rejected.body.error.code }).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    const compared = await f.request(
      `/assessments/${f.record.id}/comparison?previous=${other.body.data.assessmentId}`,
    );
    expect({ status: compared.status, code: compared.body.error.code }).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    const key = crypto.randomUUID(),
      copy = await f.request(f.path, "POST", f.input, key);
    expect(copy.status).toBe(201);
    await env.DB.prepare("DELETE FROM customer_memberships WHERE user_id=?").bind(f.actorId).run();
    const retry = await f.request(f.path, "POST", f.input, key);
    expect({ status: retry.status, code: retry.body.error.code }).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
