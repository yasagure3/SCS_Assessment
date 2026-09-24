import { beforeAll, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { digest } from "../../src/server/modules/assessment/domain/assessment";
import { STANDARD_ID } from "../../src/shared/contracts/assessment";
import master from "../../src/server/db/seed/scs-20260327-star3.json";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

it("invites an operator, imports 81 originals and preserves confirmed reports across evidence, tasks, reassessment and access revocation", async () => {
  const admin = crypto.randomUUID(),
    stamp = new Date().toISOString(),
    time = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'admin','active',?,?)",
  )
    .bind(admin, admin, `${admin}@example.invalid`, stamp, stamp)
    .run();
  const deliveries: { id: string; email: string; sub: string }[] = [];
  const app = createBusinessApp({
    verify: async (token) => ({
      sub: token.replace(/:refreshed$/, ""),
      client_id: "test",
      token_use: "access",
      iat: time + (token.endsWith(":refreshed") ? 60 : 0),
      auth_time: time,
      exp: time + 3600,
    }),
    access: (b) => new D1AccessRepository(b.DB),
    sessions: () => ({ revoke: async () => {} }),
    administration: () => ({
      provision: async (user) => `invited-${user.id}`,
      sendInvitation: async (user) => {
        deliveries.push({ id: user.id, email: user.email, sub: user.sub });
      },
    }),
  });
  let token = admin;
  async function request(path: string, method = "GET", body?: unknown, status = 200) {
    const response = await app.request(
      `/api/v1${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    const result = await response.json<{ data: any; error: { code: string } }>();
    expect({ status: response.status, error: result.error }).toEqual({
      status,
      error:
        status < 400 ? undefined : { code: "UNAUTHORIZED", message: "ログインし直してください。" },
    });
    return result;
  }
  const customer = (await request("/customers", "POST", { name: "匿名結合検証社" }, 201)).data;
  const email = `${crypto.randomUUID()}@example.invalid`;
  await request(
    "/users/invitations",
    "POST",
    { email, role: "staff", customerIds: [customer.id] },
    201,
  );
  expect(deliveries).toEqual([
    { id: expect.any(String), email, sub: expect.stringMatching(/^invited-/) },
  ]);
  token = deliveries[0].sub;
  const me = (await request("/me")).data;
  expect(me).toEqual({
    id: deliveries[0].id,
    email,
    role: "staff",
    status: "active",
    customerIds: [customer.id],
  });
  const created = (
    await request(
      `/customers/${customer.id}/cases`,
      "POST",
      { name: "全機能の初回診断", standardId: STANDARD_ID },
      201,
    )
  ).data;
  const id = created.assessmentId,
    base = `/assessments/${id}`,
    first = master.criteria[0].id;
  const initial = (await request(base)).data;
  expect(initial.counts).toEqual({ yes: 0, uncertain: 0, no: 0, unanswered: 81, total: 81 });
  const incomplete = (
    await request(`${base}/report-preview`, "POST", { expectedRevision: initial.revision })
  ).data;
  expect(incomplete.blockingErrors).toEqual([
    ...["companies", "sites", "departments", "systems"].map((field) => ({
      path: `scope.${field}`,
      reason: "対象範囲を入力してください。",
    })),
    { path: "diagnosisDate", reason: "診断日を入力してください。" },
  ]);
  const reference = (await request(`/standards/${STANDARD_ID}/import-master`)).data;
  const normalized = {
    standardId: STANDARD_ID,
    fileName: "anonymous.xlsx",
    clientFileSha256: "c".repeat(64),
    masterContentSha256: reference.masterContentSha256,
    star4Excluded: 72,
    rows: master.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      sheet: "匿名",
      row: index + 3,
      O: index < 24 ? "○" : index < 48 ? "△" : index < 76 ? "✖" : "",
      P: `元理由-${criterion.id}`,
      Q: `元根拠-${criterion.id}`,
      R: `元補足-${criterion.id}`,
    })),
  };
  const preview = (
    await request(`${base}/imports/preview`, "POST", {
      expectedRevision: initial.revision,
      normalized,
    })
  ).data;
  let record = (
    await request(`${base}/imports`, "POST", {
      expectedRevision: initial.revision,
      mutationId: crypto.randomUUID(),
      normalized,
      normalizedSha256: preview.normalizedSha256,
      acknowledgedMissingIds: [],
    })
  ).data.assessment;
  expect(record.counts).toEqual({ yes: 24, uncertain: 24, no: 28, unanswered: 5, total: 81 });
  const originals = Object.fromEntries(
    normalized.rows.map(({ criterionId, ...original }) => [criterionId, original]),
  );
  expect(
    Object.fromEntries(
      Object.entries(record.document.responses).map(([key, value]: [string, any]) => [
        key,
        value.original,
      ]),
    ),
  ).toEqual(originals);
  async function change(suffix: string, method: string, fields: Record<string, unknown>) {
    record = (
      await request(`${base}${suffix}`, method, {
        expectedRevision: record.revision,
        mutationId: crypto.randomUUID(),
        ...fields,
      })
    ).data;
  }
  const scope = { companies: "匿名社", sites: "本社", departments: "全社", systems: "基幹" };
  await change("/scope", "PATCH", { scope, diagnosisDate: "2026-09-25" });
  await change("/evidence", "POST", {
    criterionIds: [first],
    name: "匿名規程",
    url: null,
    location: "第2章",
    fileId: null,
  });
  const evidenceId = record.document.evidence[0].id;
  await change(`/evidence/${evidenceId}/reviews/${first}`, "POST", {
    state: "confirmed",
    note: "原本と照合",
  });
  expect(record.document.evidence[0].reviews[first]).toEqual({
    state: "confirmed",
    note: "原本と照合",
    by: me.id,
    at: expect.any(String),
    subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(record.counts).toEqual(preview.counts);
  const content = {
    origin: "manual",
    templateId: null,
    gap: "役割分担を明確化",
    steps: ["規程を更新", "承認を記録"],
    evidenceExamples: ["承認済み規程"],
    completionCheck: "責任者を照合",
    notes: "担当者が確認した助言",
  };
  await change(`/advice/${first}/draft`, "PUT", { content });
  await change(`/advice/${first}/confirm`, "POST", { content, reviewed: true });
  const confirmed = record.document.responses[first].confirmedAdvice;
  expect(confirmed).toEqual({
    content,
    basisHash: record.document.responses[first].basisHash,
    by: me.id,
    at: expect.any(String),
    version: 1,
  });
  const taskFields = {
    criterionId: first,
    title: "規程更新",
    ownerName: "匿名担当",
    dueDate: "2026-10-01",
    priority: "normal",
    completionCondition: "責任者の承認",
  };
  await change("/tasks", "POST", taskFields);
  const taskId = record.document.tasks[0].id;
  const { criterionId: _criterionId, ...editableTask } = taskFields;
  await change(`/tasks/${taskId}`, "PATCH", {
    ...editableTask,
    state: "awaiting_review",
    result: "承認済み",
    evidenceIds: [evidenceId],
  });
  await change(`/tasks/${taskId}/review`, "POST", { state: "confirmed", note: "完了条件と照合" });
  expect({
    state: record.document.tasks[0].state,
    response: record.document.responses[first].status,
    advice: record.document.responses[first].confirmedAdvice,
  }).toEqual({ state: "done", response: "yes", advice: confirmed });
  async function finalize(assessmentId: string, revision: number) {
    const p = (
      await request(`/assessments/${assessmentId}/report-preview`, "POST", {
        expectedRevision: revision,
      })
    ).data;
    const saved = (
      await request(
        `/assessments/${assessmentId}/reports`,
        "POST",
        {
          expectedRevision: revision,
          previewHash: p.previewHash,
          majorIssueCriterionIds: p.content.majorIssues,
          acknowledgedLimitationHash: await digest(p.limitations),
        },
        201,
      )
    ).data;
    expect(saved.snapshot).toEqual({
      ...p.content,
      reportId: saved.reportId,
      createdAt: expect.any(String),
      createdBy: me.id,
    });
    return saved;
  }
  const oldReport = await finalize(id, record.revision),
    previous = structuredClone(record);
  const next = (
    await request(
      `/cases/${created.case.id}/reassessments`,
      "POST",
      {
        previousAssessmentId: id,
        expectedPreviousRevision: record.revision,
        standardId: STANDARD_ID,
        scope,
        diagnosisDate: "2026-10-01",
        copyResponses: true,
        copyTaskIds: [taskId],
      },
      201,
    )
  ).data;
  expect({
    previous: next.document.copiedFrom,
    advice: next.document.responses[first].confirmedAdvice,
    original: next.document.responses[first].original,
    evidence: next.document.evidence[0].reviews[first],
    task: next.document.tasks[0].state,
  }).toEqual({
    previous: { assessmentId: id, revision: previous.revision },
    advice: null,
    original: null,
    evidence: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
    task: "todo",
  });
  const edited = (
    await request(`/assessments/${next.id}/responses/${first}`, "PATCH", {
      expectedRevision: next.revision,
      mutationId: crypto.randomUUID(),
      status: "uncertain",
      reason: "再診断で再確認",
      basis: "今回の根拠",
      plannedWork: "再確認",
      supplement: "",
    })
  ).data;
  const currentReport = await finalize(next.id, edited.revision);
  expect(currentReport.snapshot.counts).toEqual({
    yes: 23,
    uncertain: 25,
    no: 28,
    unanswered: 5,
    total: 81,
  });
  expect((await request(base)).data).toEqual(previous);
  expect((await request(`/reports/${oldReport.reportId}`)).data).toEqual(oldReport);
  expect((await request(`/assessments/${next.id}/comparison?previous=${id}`)).data.rows[0]).toEqual(
    {
      criterionId: first,
      beforeStatus: "yes",
      afterStatus: "uncertain",
      changed: true,
      responseChanges: [
        {
          field: "reason",
          before: previous.document.responses[first].reason,
          after: "再診断で再確認",
        },
        { field: "basis", before: previous.document.responses[first].basis, after: "今回の根拠" },
        {
          field: "plannedWork",
          before: previous.document.responses[first].plannedWork,
          after: "再確認",
        },
        { field: "supplement", before: previous.document.responses[first].supplement, after: "" },
      ],
      tasks: {
        mode: "matched",
        matched: [
          { before: previous.document.tasks[0], after: edited.document.tasks[0], changed: true },
        ],
        notCarried: [],
        added: [],
        previous: [],
        current: [],
      },
    },
  );
  await request("/session/revoke", "POST", {});
  token = `${deliveries[0].sub}:refreshed`;
  expect((await request(`/reports/${oldReport.reportId}`, "GET", undefined, 401)).error.code).toBe(
    "UNAUTHORIZED",
  );
  token = admin;
  expect((await request(`/reports/${oldReport.reportId}`)).data).toEqual(oldReport);
});
