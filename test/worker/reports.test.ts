import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import { STANDARD_ID, type AssessmentRecord } from "../../src/shared/contracts/assessment";
import master from "../../src/server/db/seed/scs-20260327-star3.json";
import { digest } from "../../src/server/modules/assessment/domain/assessment";
import { D1ReportRepository } from "../../src/server/modules/reports/adapter/d1ReportRepository";
import { reportPreview, fixedReport } from "../../src/server/modules/reports/domain/reportSnapshot";
import type { ReportPreview } from "../../src/shared/contracts/reports";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const scope = { companies: "匿名社", sites: "本社", departments: "全社", systems: "業務システム" };
const ids = master.criteria.map((c) => c.id);
const review = { state: "unreviewed", note: "", by: null, at: null, subjectHash: null } as const;
const advice = {
  origin: "manual",
  templateId: null,
  gap: "確定版の課題",
  steps: ["実施手順"],
  evidenceExamples: ["実施記録"],
  completionCheck: "照合する",
  notes: "",
} as const;
async function finalInput(p: ReportPreview) {
  return {
    expectedRevision: p.revision,
    previewHash: p.previewHash,
    majorIssueCriterionIds: p.content.majorIssues,
    acknowledgedLimitationHash: await digest(p.limitations),
  };
}
async function fixture(complete = true) {
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
    const res = await app.request(
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
      status: res.status,
      body: await res.json<{ data: any; error?: { code: string; message: string } }>(),
    };
  }
  const customer = (await request("/customers", "POST", { name: "匿名レポート社" })).body.data;
  const created = await request(`/customers/${customer.id}/cases`, "POST", {
    name: "固定版案件",
    standardId: STANDARD_ID,
    ...(complete ? { diagnosisDate: "2026-09-22", scope } : {}),
  });
  expect(created.status).toBe(201);
  const repository = new D1AssessmentRepository(env.DB);
  const record = await repository.get(created.body.data.assessmentId, actorId);
  const base = `/assessments/${record.id}`;
  const preview = (revision = record.revision, majorIssueCriterionIds?: string[]) =>
    request(`${base}/report-preview`, "POST", {
      expectedRevision: revision,
      ...(majorIssueCriterionIds ? { majorIssueCriterionIds } : {}),
    });
  async function seed(value: AssessmentRecord) {
    return repository.save({
      record: value,
      actorId,
      expectedRevision: value.revision,
      mutationId: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      action: "fixture",
      requestId: crypto.randomUUID(),
    });
  }
  return { actorId, record, customer, request, base, preview, seed };
}
describe("fixed report snapshots", () => {
  it("freezes originals, only current confirmed advice, pending draft IDs, evidence metadata and reviewer display names", async () => {
    const f = await fixture(),
      fileId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO files(id,customer_id,case_id,object_key,original_name,mime,size_bytes,sha256,status,created_by,created_at) VALUES(?,?,?,?,?,'text/plain',7,?,'ready',?,?)",
    )
      .bind(
        fileId,
        f.record.customerId,
        f.record.caseId,
        `private/${fileId}`,
        "登録時の文書.txt",
        "b".repeat(64),
        f.actorId,
        "2026-09-22T00:00:00.000Z",
      )
      .run();
    f.record.document.responses[ids[0]].status = "yes";
    f.record.document.responses[ids[0]].original = {
      sheet: "匿名",
      row: 6,
      O: "○",
      P: "原理由",
      Q: "原根拠",
      R: "原補足",
    };
    f.record.document.responses[ids[1]].status = "uncertain";
    f.record.document.responses[ids[2]].status = "no";
    f.record.document.evidence = [
      {
        id: crypto.randomUUID(),
        criterionIds: ids.slice(0, 2),
        name: "照合記録",
        url: "https://example.invalid/document",
        location: "第2章",
        fileId,
        reviews: {
          [ids[0]]: {
            ...review,
            state: "confirmed",
            by: f.actorId,
            at: "2026-09-22T00:00:00.000Z",
            subjectHash: "c".repeat(64),
          },
          [ids[1]]: {
            ...review,
            state: "rejected",
            by: f.actorId,
            at: "2026-09-22T00:00:00.000Z",
            subjectHash: "d".repeat(64),
          },
        },
      },
      {
        id: crypto.randomUUID(),
        criterionIds: [ids[2]],
        name: "未確認の文書",
        url: null,
        location: "",
        fileId: null,
        reviews: { [ids[2]]: review },
      },
    ];
    const prepared = await f.seed(f.record);
    for (const id of ids.slice(0, 2))
      prepared.document.responses[id].confirmedAdvice = {
        content: {
          ...advice,
          steps: [...advice.steps],
          evidenceExamples: [...advice.evidenceExamples],
        },
        by: f.actorId,
        at: "2026-09-22T00:00:00.000Z",
        basisHash: id === ids[0] ? prepared.document.responses[id].basisHash : "0".repeat(64),
        version: 1,
      };
    for (const id of [ids[0], ids[2]])
      prepared.document.responses[id].adviceDraft = {
        ...advice,
        gap: "未確定本文は出力しない",
        steps: [...advice.steps],
        evidenceExamples: [...advice.evidenceExamples],
      };
    const seeded = await f.seed(prepared);
    const preview = await f.preview(seeded.revision);
    expect(preview.status).toBe(200);
    const p: ReportPreview = preview.body.data;
    expect(p.content.counts).toEqual({ yes: 1, uncertain: 1, no: 1, unanswered: 78, total: 81 });
    const summed = p.content.categoryCounts.reduce(
      (a, c) => ({
        yes: a.yes + c.yes,
        uncertain: a.uncertain + c.uncertain,
        no: a.no + c.no,
        unanswered: a.unanswered + c.unanswered,
        total: a.total + c.total,
      }),
      { yes: 0, uncertain: 0, no: 0, unanswered: 0, total: 0 },
    );
    expect(summed).toEqual(p.content.counts);
    expect(p.limitations).toEqual({
      unanswered: ids.slice(3),
      notRegistered: ids.slice(3),
      unreviewed: [ids[2]],
      rejected: [ids[1]],
      unconfirmedAdvice: ids.slice(2),
      staleAdvice: [ids[1]],
      draftPendingIds: [ids[0], ids[2]],
    });
    expect(
      ids.slice(0, 4).map((id) => ({
        id,
        state: p.content.responses[id].adviceState,
        confirmed: p.content.responses[id].confirmedAdvice,
      })),
    ).toEqual([
      {
        id: ids[0],
        state: "current",
        confirmed: {
          ...seeded.document.responses[ids[0]].confirmedAdvice,
          reviewer: { id: f.actorId, email: `${f.actorId}@example.invalid` },
        },
      },
      { id: ids[1], state: "stale", confirmed: null },
      { id: ids[2], state: "unconfirmed", confirmed: null },
      { id: ids[3], state: "none", confirmed: null },
    ]);
    expect(p.content.evidence).toEqual(
      seeded.document.evidence.map((e, index) => ({
        ...e,
        file:
          index === 0
            ? {
                id: fileId,
                originalName: "登録時の文書.txt",
                mime: "text/plain",
                sizeBytes: 7,
                sha256: "b".repeat(64),
              }
            : null,
        reviewers: index === 0 ? [{ id: f.actorId, email: `${f.actorId}@example.invalid` }] : [],
      })),
    );
    expect(p.content.responses[ids[0]].original).toEqual(
      seeded.document.responses[ids[0]].original,
    );
    const finalized = await f.request(`${f.base}/reports`, "POST", await finalInput(p));
    expect(finalized.status).toBe(201);
    expect(JSON.stringify(finalized.body.data).includes("未確定本文は出力しない")).toBe(false);
    expect(JSON.stringify(finalized.body.data).includes(`private/${fileId}`)).toBe(false);
    await env.DB.prepare("UPDATE files SET original_name='変更後の文書.txt' WHERE id=?")
      .bind(fileId)
      .run();
    await env.DB.prepare("UPDATE app_users SET email_normalized=? WHERE id=?")
      .bind(`changed-${f.actorId}@example.invalid`, f.actorId)
      .run();
    await f.request(`/customers/${f.customer.id}`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      name: "変更後の顧客",
    });
    await f.request(`/cases/${f.record.caseId}`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      name: "変更後の案件",
    });
    seeded.document.responses[ids[0]].reason = "後から編集した理由";
    await f.seed(seeded);
    expect((await f.request(`/reports/${finalized.body.data.reportId}`)).body.data).toEqual(
      finalized.body.data,
    );
  });
  it.each(["customer", "case", "assessment"] as const)(
    "rejects a stale preview after a %s change and saves no receipt or report",
    async (target) => {
      const f = await fixture(),
        p = (await f.preview()).body.data;
      if (target === "assessment") {
        f.record.document.diagnosisDate = "2026-09-23";
        await f.seed(f.record);
      } else
        await f.request(
          target === "customer" ? `/customers/${f.record.customerId}` : `/cases/${f.record.caseId}`,
          "PATCH",
          { expectedRevision: 1, mutationId: crypto.randomUUID(), name: "プレビュー後の変更" },
        );
      const key = crypto.randomUUID(),
        result = await f.request(`${f.base}/reports`, "POST", await finalInput(p), key);
      expect(result.status).toBe(409);
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS n FROM operation_receipts WHERE actor_id=? AND operation_key=?",
        )
          .bind(f.actorId, key)
          .first(),
      ).toEqual({ n: 0 });
      expect((await f.request(`${f.base}/reports`)).body.data).toEqual({
        items: [],
        nextCursor: null,
      });
    },
  );
  it.each(["customer", "case", "assessment"] as const)(
    "atomically rejects a %s change between source read and INSERT SELECT",
    async (target) => {
      const f = await fixture(),
        repository = new D1ReportRepository(env.DB),
        source = await repository.source(f.record.id, f.actorId);
      const p = await reportPreview(source, { expectedRevision: 1 });
      if (target === "assessment") {
        f.record.document.diagnosisDate = "2026-09-23";
        await f.seed(f.record);
      } else
        await f.request(
          target === "customer" ? `/customers/${f.record.customerId}` : `/cases/${f.record.caseId}`,
          "PATCH",
          { expectedRevision: 1, mutationId: crypto.randomUUID(), name: "確定直前の変更" },
        );
      const report = await fixedReport(
          p.content,
          crypto.randomUUID(),
          f.actorId,
          "2026-09-22T00:00:00.000Z",
        ),
        key = crypto.randomUUID();
      await expect(
        repository.save(source, report, {
          actorId: f.actorId,
          key,
          requestHash: "e".repeat(64),
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS n FROM operation_receipts WHERE actor_id=? AND operation_key=?",
        )
          .bind(f.actorId, key)
          .first(),
      ).toEqual({ n: 0 });
      expect((await f.request(`${f.base}/reports`)).body.data).toEqual({
        items: [],
        nextCursor: null,
      });
    },
  );
  it("rolls back the report and receipt when the last audit statement fails", async () => {
    const f = await fixture(),
      p = (await f.preview()).body.data,
      key = crypto.randomUUID();
    await env.DB.exec(
      "CREATE TRIGGER reports_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='report.finalize' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;",
    );
    try {
      const result = await f.request(`${f.base}/reports`, "POST", await finalInput(p), key);
      expect(result.status).toBe(500);
      expect(
        await env.DB.prepare(
          "SELECT count(*) AS n FROM operation_receipts WHERE actor_id=? AND operation_key=?",
        )
          .bind(f.actorId, key)
          .first(),
      ).toEqual({ n: 0 });
      expect((await f.request(`${f.base}/reports`)).body.data).toEqual({
        items: [],
        nextCursor: null,
      });
    } finally {
      await env.DB.exec("DROP TRIGGER reports_test_audit_failure;");
    }
    expect((await f.request(`${f.base}/reports`, "POST", await finalInput(p), key)).status).toBe(
      201,
    );
  });
  it("deduplicates simultaneous finalization and rechecks current permission for reads, lists and receipt replay", async () => {
    const f = await fixture(),
      other = await fixture(),
      p = (await f.preview()).body.data,
      input = await finalInput(p),
      key = crypto.randomUUID();
    const results = await Promise.all([
      f.request(`${f.base}/reports`, "POST", input, key),
      f.request(`${f.base}/reports`, "POST", input, key),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.data).toEqual(results[1].body.data);
    const saved = results[0].body.data;
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='report.finalize' AND resource_id=?",
      )
        .bind(saved.reportId)
        .first(),
    ).toEqual({ n: 1 });
    expect((await other.request(`/reports/${saved.reportId}`)).status).toBe(404);
    expect((await other.request(`${f.base}/reports`)).status).toBe(404);
    await env.DB.prepare("DELETE FROM customer_memberships WHERE user_id=? AND customer_id=?")
      .bind(f.actorId, f.record.customerId)
      .run();
    expect((await f.request(`/reports/${saved.reportId}`)).status).toBe(404);
    expect((await f.request(`${f.base}/reports`, "POST", input, key)).status).toBe(404);
    expect((await f.request(`${f.base}/reports`)).status).toBe(404);
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM reports WHERE id=?")
        .bind(saved.reportId)
        .first(),
    ).toEqual({ n: 1 });
  });
  it("requires the exact acknowledged limitations, validates major issues and paginates equal timestamps without gaps", async () => {
    const f = await fixture(),
      p = (await f.preview()).body.data,
      input = await finalInput(p);
    for (const invalid of [
      { acknowledgedLimitationHash: "0".repeat(64) },
      { previewHash: "0".repeat(64) },
      { majorIssueCriterionIds: [ids[0]] },
    ])
      expect((await f.request(`${f.base}/reports`, "POST", { ...input, ...invalid })).status).toBe(
        409,
      );
    for (const invalid of [["unknown"], [ids[0], ids[0]], ids.slice(0, 6)])
      expect((await f.preview(1, invalid)).status).toBe(422);
    expect(
      (
        await f.request(`${f.base}/reports`, "POST", {
          ...input,
          acknowledgedLimitationHash: undefined,
        })
      ).status,
    ).toBe(422);
    const repository = new D1ReportRepository(env.DB),
      source = await repository.source(f.record.id, f.actorId),
      created: string[] = [];
    for (let n = 0; n < 3; n++) {
      const saved = await repository.save(
        source,
        await fixedReport(p.content, crypto.randomUUID(), f.actorId, "2026-09-22T00:00:00.000Z"),
        {
          actorId: f.actorId,
          key: crypto.randomUUID(),
          requestHash: "f".repeat(64),
          requestId: crypto.randomUUID(),
        },
      );
      created.push(saved.reportId);
    }
    const first = (await f.request(`${f.base}/reports?limit=2`)).body.data;
    const next = (
      await f.request(`${f.base}/reports?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)
    ).body.data;
    expect([...first.items, ...next.items].map((item: { id: string }) => item.id)).toEqual(
      created.sort().reverse(),
    );
    expect(next.nextCursor).toBeNull();
    const other = await fixture();
    expect(
      (await f.request(`${other.base}/reports?cursor=${encodeURIComponent(first.nextCursor)}`))
        .status,
    ).toBe(404);
    expect((await f.request(`${f.base}/reports?cursor=invalid`)).status).toBe(422);
  });
  it("suggests at most five open task criteria by priority, due date and criterion order and accepts a selected replacement", async () => {
    const f = await fixture();
    f.record.document.tasks = [6, 2, 1, 0, 5, 4, 3].map((index) => ({
      id: crypto.randomUUID(),
      sourceTaskId: null,
      sourceAssessmentId: null,
      criterionId: ids[index],
      title: "対策",
      ownerName: "担当",
      dueDate: index === 6 ? "2026-09-01" : "2026-09-22",
      priority: index === 6 ? "normal" : "high",
      state: "todo",
      completionCondition: "照合",
      result: "",
      evidenceIds: [],
      review,
    }));
    const seeded = await f.seed(f.record);
    expect((await f.preview(seeded.revision)).body.data.content.majorIssues).toEqual(
      ids.slice(0, 5),
    );
    const chosen = await f.preview(seeded.revision, [ids[6], ids[0]]);
    expect(chosen.body.data.content.majorIssues).toEqual([ids[6], ids[0]]);
    const saved = await f.request(`${f.base}/reports`, "POST", await finalInput(chosen.body.data));
    expect(saved.status).toBe(201);
    expect(saved.body.data.snapshot.majorIssues).toEqual([ids[6], ids[0]]);
  });
  it("previews all 81 unanswered criteria and finalizes an immutable historical report after acknowledgement", async () => {
    const f = await fixture();
    const preview = await f.preview();
    expect(preview.status).toBe(200);
    const p = preview.body.data;
    expect(p.content.counts).toEqual({ yes: 0, uncertain: 0, no: 0, unanswered: 81, total: 81 });
    expect(p.limitations.unanswered).toEqual(master.criteria.map((c) => c.id));
    expect(p.blockingErrors).toEqual([]);
    const input = {
      expectedRevision: 1,
      previewHash: p.previewHash,
      majorIssueCriterionIds: p.content.majorIssues,
      acknowledgedLimitationHash: await digest(p.limitations),
    };
    const key = crypto.randomUUID();
    const result = await f.request(`${f.base}/reports`, "POST", input, key);
    expect(result.status).toBe(201);
    const saved = result.body.data;
    expect(saved.snapshot).toEqual({
      ...p.content,
      reportId: saved.reportId,
      createdAt: expect.any(String),
      createdBy: f.actorId,
    });
    expect((await f.request(`/reports/${saved.reportId}`)).body.data).toEqual(saved);
    expect((await f.request(`${f.base}/reports`)).body.data).toEqual({
      items: [
        {
          id: saved.reportId,
          assessmentRevision: 1,
          createdAt: saved.snapshot.createdAt,
          createdBy: f.actorId,
        },
      ],
      nextCursor: null,
    });
    expect((await f.request(`${f.base}/reports`, "POST", input, key)).body.data).toEqual(saved);
    expect(
      (
        await f.request(
          `${f.base}/reports`,
          "POST",
          { ...input, acknowledgedLimitationHash: "0".repeat(64) },
          key,
        )
      ).status,
    ).toBe(409);
    await expect(
      env.DB.prepare("UPDATE reports SET snapshot_sha256=? WHERE id=?")
        .bind("0".repeat(64), saved.reportId)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("DELETE FROM reports WHERE id=?").bind(saved.reportId).run(),
    ).rejects.toThrow();
    expect((await f.request(`/reports/${saved.reportId}`)).body.data).toEqual(saved);
  });
  it("lists all missing scope fields and diagnosis date and refuses finalization", async () => {
    const f = await fixture(false),
      preview = await f.preview();
    expect(preview.status).toBe(200);
    const p = preview.body.data;
    expect(p.blockingErrors.map((e: { path: string }) => e.path)).toEqual([
      "scope.companies",
      "scope.sites",
      "scope.departments",
      "scope.systems",
      "diagnosisDate",
    ]);
    expect(
      (
        await f.request(`${f.base}/reports`, "POST", {
          expectedRevision: 1,
          previewHash: p.previewHash,
          majorIssueCriterionIds: [],
          acknowledgedLimitationHash: await digest(p.limitations),
        })
      ).status,
    ).toBe(422);
    expect((await f.request(`${f.base}/reports`)).body.data).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
