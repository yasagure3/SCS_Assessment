import { describe, it, expect, beforeAll } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  emptyDocument,
  editResponse,
  editScope,
  canonical,
  digest,
  operationHash,
  finalizeChange,
} from "../../src/server/modules/assessment/domain/assessment";
import {
  assessmentDocumentSchema,
  editResponseSchema,
  STANDARD_ID,
  type AssessmentRecord,
} from "../../src/shared/contracts/assessment";
import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import { D1OperationLedger } from "../../src/server/modules/assessment/adapter/d1OperationLedger";

const ids = Array.from({ length: 81 }, (_, index) => `criterion-${index + 1}`);
const mutation = { expectedRevision: 1, mutationId: "10000000-0000-4000-8000-000000000001" };
const edit = {
  ...mutation,
  status: "no" as const,
  reason: "未整備",
  basis: "",
  plannedWork: "規程を作成",
  supplement: "",
};
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("public standard migration", () => {
  it("seeds exactly 81 sealed criteria from the fixed official source", async () => {
    const row = await env.DB.prepare("SELECT count(*) AS count FROM criteria WHERE standard_id=?")
      .bind(STANDARD_ID)
      .first<{ count: number }>();
    expect(row?.count).toBe(81);
    const standard = await env.DB.prepare(
      "SELECT source_sha256, sealed_at FROM standards WHERE id=?",
    )
      .bind(STANDARD_ID)
      .first<{ source_sha256: string; sealed_at: string }>();
    expect(standard?.source_sha256).toBe(
      "d4c27aa4bfed5521a98ff9ce8c042743e4204e4b8310ceb3df0c54eabfdc8dd1",
    );
    expect(standard?.sealed_at).toBeTruthy();
  });
  it("is idempotent and the sealed source cannot be changed", async () => {
    const migration = env.TEST_MIGRATIONS.find((item) => item.name.startsWith("0002"));
    expect(migration).toBeDefined();
    await env.DB.batch(migration!.queries.map((query) => env.DB.prepare(query)));
    expect(
      (await env.DB.prepare("SELECT count(*) AS n FROM criteria").first<{ n: number }>())?.n,
    ).toBe(81);
    await expect(
      env.DB.prepare("UPDATE criteria SET official_text='modified'").run(),
    ).rejects.toThrow("immutable_criteria");
    await expect(env.DB.prepare("DELETE FROM standards").run()).rejects.toThrow(
      "immutable_standard",
    );
  });
  it("matches the public content hash and 26 requirements", async () => {
    const rows = await env.DB.prepare(
      "SELECT criterion_id AS id,requirement_id AS requirementId,category,requirement_text AS requirementText,official_text AS officialText,order_no AS orderNo,source_row AS sourceRow FROM criteria WHERE standard_id=? ORDER BY order_no",
    )
      .bind(STANDARD_ID)
      .all<{
        id: string;
        requirementId: string;
        category: string;
        requirementText: string;
        officialText: string;
        orderNo: number;
        sourceRow: number;
      }>();
    const standard = await env.DB.prepare("SELECT content_sha256 FROM standards WHERE id=?")
      .bind(STANDARD_ID)
      .first<{ content_sha256: string }>();
    expect(await digest(rows.results)).toBe(standard?.content_sha256);
    expect(new Set(rows.results.map((row) => row.requirementId)).size).toBe(26);
  });
});

async function fixture() {
  const actorId = crypto.randomUUID(),
    customerId = crypto.randomUUID(),
    caseId = crypto.randomUUID(),
    id = crypto.randomUUID();
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    "SELECT criterion_id AS id FROM criteria ORDER BY order_no",
  ).all<{ id: string }>();
  const document = await emptyDocument(rows.results.map((row) => row.id));
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_users(id,email_normalized,role,status,created_at,updated_at) VALUES(?,?,'admin','active',?,?)",
    ).bind(actorId, `${actorId}@example.invalid`, now, now),
    env.DB.prepare("INSERT INTO customers VALUES(?,?,NULL,1,?,?,?)").bind(
      customerId,
      "匿名会社",
      actorId,
      now,
      now,
    ),
    env.DB.prepare("INSERT INTO cases VALUES(?,?,?,NULL,1,?,?,?)").bind(
      caseId,
      customerId,
      "初回診断",
      actorId,
      now,
      now,
    ),
    env.DB.prepare("INSERT INTO assessments VALUES(?,?,?,?,NULL,1,?,?,?,?,?,?)").bind(
      id,
      caseId,
      customerId,
      STANDARD_ID,
      JSON.stringify(document),
      crypto.randomUUID(),
      "0".repeat(64),
      actorId,
      now,
      now,
    ),
  ]);
  const repo = new D1AssessmentRepository(env.DB);
  const record = await repo.get(id, actorId);
  return { actorId, customerId, caseId, id, repo, record };
}
async function save(
  f: Awaited<ReturnType<typeof fixture>>,
  record: AssessmentRecord,
  mutationId = crypto.randomUUID(),
  requestId = crypto.randomUUID(),
) {
  return f.repo.save({
    record,
    actorId: f.actorId,
    expectedRevision: record.revision,
    mutationId,
    requestHash: await digest({
      method: "PATCH",
      path: `/api/v1/assessments/${record.id}`,
      body: { expectedRevision: record.revision, document: record.document },
    }),
    action: "assessment.edit",
    requestId,
  });
}
async function counts(id: string) {
  const row = await env.DB.prepare(
    "SELECT (SELECT count(*) FROM assessment_revisions WHERE assessment_id=?) AS history,(SELECT count(*) FROM operation_receipts WHERE resource_id=?) AS receipts,(SELECT count(*) FROM audit_events WHERE resource_id=?) AS audit",
  )
    .bind(id, id, id)
    .first();
  return row;
}

describe("D1 atomic revision and idempotency", () => {
  it("allows one writer for the same revision and keeps history, receipt and audit aligned", async () => {
    const f = await fixture();
    const one = structuredClone(f.record),
      two = structuredClone(f.record);
    one.document.scope.companies = "A";
    two.document.scope.companies = "B";
    const results = await Promise.allSettled([save(f, one), save(f, two)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await f.repo.get(f.id, f.actorId)).revision).toBe(2);
    expect(await counts(f.id)).toEqual({ history: 2, receipts: 1, audit: 1 });
  });
  it("replays one successful write for concurrent identical keys without duplicate audit", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const next = structuredClone(f.record);
    next.document.scope.companies = "更新";
    const results = await Promise.all([save(f, next, key), save(f, next, key)]);
    expect(results[0]).toEqual(results[1]);
    expect(await counts(f.id)).toEqual({ history: 2, receipts: 1, audit: 1 });
    expect(await save(f, next, key)).toEqual(results[0]);
  });
  it("shares the same key ledger between no-op and ordinary changes", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const changed = structuredClone(f.record);
    changed.document.scope.sites = "本社";
    const results = await Promise.allSettled([save(f, f.record, key), save(f, changed, key)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await counts(f.id))?.receipts).toBe(1);
    expect((await counts(f.id))?.audit).toBe(1);
  });
  it("records and replays successful no-op without increasing the revision", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    expect(await save(f, f.record, key)).toEqual(f.record);
    expect(await save(f, f.record, key)).toEqual(f.record);
    expect(await counts(f.id)).toEqual({ history: 1, receipts: 1, audit: 1 });
    const changed = structuredClone(f.record);
    changed.document.scope.systems = "サービス";
    await expect(save(f, changed, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("rolls back body, history and reserved receipt when audit insertion fails", async () => {
    const f = await fixture();
    const next = structuredClone(f.record);
    next.document.scope.companies = "rollback";
    await env.DB.exec(
      "CREATE TRIGGER force_audit_failure BEFORE INSERT ON audit_events WHEN NEW.request_id='fixture-fail' BEGIN SELECT RAISE(ABORT,'test_failure'); END;",
    );
    try {
      await expect(save(f, next, crypto.randomUUID(), "fixture-fail")).rejects.toThrow(
        "test_failure",
      );
      expect(await f.repo.get(f.id, f.actorId)).toEqual(f.record);
      expect(await counts(f.id)).toEqual({ history: 1, receipts: 0, audit: 0 });
    } finally {
      await env.DB.exec("DROP TRIGGER force_audit_failure;");
    }
  });
  it("never uses an earlier receipt to enable writes when a later reservation matched zero rows", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    await save(f, f.record, key);
    const receipt = await env.DB.prepare(
      "SELECT request_hash FROM operation_receipts WHERE actor_id=? AND operation_key=?",
    )
      .bind(f.actorId, key)
      .first<{ request_hash: string }>();
    class StaleReadLedger extends D1OperationLedger {
      private missed = false;
      override async replay<T>(
        actorId: string,
        operationKey: string,
        requestHash: string,
      ): Promise<T | null> {
        if (!this.missed) {
          this.missed = true;
          return null;
        }
        return super.replay<T>(actorId, operationKey, requestHash);
      }
    }
    const ledger = new StaleReadLedger(env.DB);
    const result = await ledger.execute({
      actorId: f.actorId,
      key,
      requestHash: receipt!.request_hash,
      resourceId: f.id,
      response: f.record,
      conditionSql: "0",
      conditionParams: [],
      writes: (reservationId) => [
        env.DB.prepare(
          "UPDATE customers SET name='must not run' WHERE id=? AND EXISTS(SELECT 1 FROM operation_receipts WHERE reservation_id=?)",
        ).bind(f.customerId, reservationId),
      ],
    });
    expect(result).toEqual(f.record);
    expect(
      (
        await env.DB.prepare("SELECT name FROM customers WHERE id=?")
          .bind(f.customerId)
          .first<{ name: string }>()
      )?.name,
    ).toBe("匿名会社");
  });
  it("rejects unrelated customer access, removed membership and suspended users", async () => {
    const f = await fixture(),
      staff = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO app_users(id,email_normalized,role,status,created_at,updated_at) VALUES(?,?,'staff','active',?,?)",
    )
      .bind(staff, `${staff}@example.invalid`, now, now)
      .run();
    await expect(f.repo.get(f.id, staff)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await env.DB.prepare("INSERT INTO customer_memberships VALUES(?,?,?,?)")
      .bind(f.customerId, staff, f.actorId, now)
      .run();
    expect((await f.repo.get(f.id, staff)).id).toBe(f.id);
    await env.DB.prepare("DELETE FROM customer_memberships WHERE user_id=?").bind(staff).run();
    await expect(f.repo.get(f.id, staff)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await env.DB.prepare("UPDATE app_users SET status='suspended' WHERE id=?").bind(staff).run();
    await expect(f.repo.get(f.id, staff)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("protects originals, history and immutable report snapshots at DB level", async () => {
    const f = await fixture();
    const imported = structuredClone(f.record);
    const id = Object.keys(imported.document.responses)[0];
    imported.document.responses[id].original = {
      sheet: "匿名シート",
      row: 3,
      O: "○",
      P: "元の理由",
      Q: "元の根拠",
      R: "",
    };
    const saved = await save(f, imported);
    const invalid = structuredClone(saved.document);
    invalid.responses[id].original!.P = "書換";
    await expect(
      env.DB.prepare(
        "UPDATE assessments SET document_json=?,revision=revision+1,mutation_id=? WHERE id=?",
      )
        .bind(JSON.stringify(invalid), crypto.randomUUID(), f.id)
        .run(),
    ).rejects.toThrow("invalid_assessment_update");
    await expect(
      env.DB.prepare("UPDATE assessment_revisions SET document_json='{}' WHERE assessment_id=?")
        .bind(f.id)
        .run(),
    ).rejects.toThrow("immutable_history");
    await expect(
      env.DB.prepare("DELETE FROM assessment_revisions WHERE assessment_id=?").bind(f.id).run(),
    ).rejects.toThrow("immutable_history");
    const reportId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO reports VALUES(?,?,?,?,?,'hash',1,'v1',?,?)")
      .bind(
        reportId,
        f.id,
        f.customerId,
        saved.revision,
        '{"fixed":true}',
        f.actorId,
        new Date().toISOString(),
      )
      .run();
    await expect(
      env.DB.prepare("UPDATE reports SET snapshot_json='{}' WHERE id=?").bind(reportId).run(),
    ).rejects.toThrow("immutable_report");
    await expect(
      env.DB.prepare("DELETE FROM reports WHERE id=?").bind(reportId).run(),
    ).rejects.toThrow("immutable_report");
  });
  it("enforces DB byte caps and prevents evidence from another case", async () => {
    const f = await fixture(),
      other = await fixture(),
      fileId = crypto.randomUUID();
    const tooLarge = { ...f.record.document, extra: "a".repeat(1_048_576) };
    await expect(
      env.DB.prepare(
        "UPDATE assessments SET document_json=?,revision=revision+1,mutation_id=? WHERE id=?",
      )
        .bind(JSON.stringify(tooLarge), crypto.randomUUID(), f.id)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("INSERT INTO reports VALUES(?,?,?,?,?,'hash',1,'v1',?,?)")
        .bind(
          crypto.randomUUID(),
          f.id,
          f.customerId,
          1,
          JSON.stringify({ text: "a".repeat(1_572_864) }),
          f.actorId,
          new Date().toISOString(),
        )
        .run(),
    ).rejects.toThrow();
    await env.DB.prepare("INSERT INTO files VALUES(?,?,?,?,?,?,1,?,'ready',?,?)")
      .bind(
        fileId,
        other.customerId,
        other.caseId,
        crypto.randomUUID(),
        "evidence.txt",
        "text/plain",
        "0".repeat(64),
        other.actorId,
        new Date().toISOString(),
      )
      .run();
    const next = structuredClone(f.record),
      id = Object.keys(next.document.responses)[0];
    next.document.evidence.push({
      id: crypto.randomUUID(),
      criterionIds: [id],
      name: "他案件のファイル",
      url: null,
      location: "",
      fileId,
      reviews: { [id]: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null } },
    });
    await expect(save(f, next)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await counts(f.id)).toEqual({ history: 1, receipts: 0, audit: 0 });
  });
});

describe("assessment boundaries", () => {
  it("hashes method, resource, revision and body while excluding only the mutation key", async () => {
    const body = { expectedRevision: 1, mutationId: "first", reason: "回答" };
    const hash = await operationHash("patch", "/api/v1/a", "a", body);
    expect(await operationHash("PATCH", "/api/v1/a", "a", { ...body, mutationId: "second" })).toBe(
      hash,
    );
    expect(
      await operationHash("PATCH", "/api/v1/a", "a", { ...body, expectedRevision: 2 }),
    ).not.toBe(hash);
    expect(await operationHash("PATCH", "/api/v1/b", "b", body)).not.toBe(hash);
  });
  it("changes evidence basis monotonically and ignores task owner changes", async () => {
    const document = await emptyDocument(ids),
      id = ids[0],
      evidenceId = crypto.randomUUID();
    const withEvidence = structuredClone(document);
    withEvidence.evidence.push({
      id: evidenceId,
      criterionIds: [id],
      name: "匿名証跡",
      url: null,
      location: "1ページ",
      fileId: null,
      reviews: { [id]: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null } },
    });
    const first = await finalizeChange(document, withEvidence);
    const removed = await finalizeChange(first, document);
    expect(removed.responses[id].adviceBasisVersion).toBe(3);
    expect(removed.responses[id].basisHash).not.toBe(document.responses[id].basisHash);
    const withTask = structuredClone(first);
    withTask.tasks.push({
      id: crypto.randomUUID(),
      sourceTaskId: null,
      sourceAssessmentId: null,
      criterionId: id,
      title: "確認",
      ownerName: "担当者",
      dueDate: "",
      priority: "normal",
      state: "todo",
      completionCondition: "証跡確認",
      result: "",
      evidenceIds: [evidenceId],
      review: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
    });
    expect((await finalizeChange(first, withTask)).responses).toEqual(first.responses);
  });
  it("starts with 81 unanswered responses and no invented original values", async () => {
    const document = await emptyDocument(ids);
    expect(Object.keys(document.responses)).toEqual(ids);
    expect(
      Object.values(document.responses).every(
        (row) => row.status === "unanswered" && row.original === null,
      ),
    ).toBe(true);
  });
  it("cannot revive previously confirmed advice when text is reverted", async () => {
    const document = await emptyDocument(ids);
    const originalHash = document.responses[ids[0]].basisHash;
    const first = await editResponse(document, ids[0], edit);
    const reverted = await editResponse(first, ids[0], {
      ...edit,
      status: "unanswered",
      reason: "",
      plannedWork: "",
    });
    expect(reverted.responses[ids[0]].adviceBasisVersion).toBe(3);
    expect(reverted.responses[ids[0]].basisHash).not.toBe(originalHash);
    expect(document.responses[ids[0]].adviceBasisVersion).toBe(1);
  });
  it("invalidates all bases after scope change but not after diagnosis date change", async () => {
    const document = await emptyDocument(ids);
    const withDate = await editScope(document, document.scope, "2026-09-18");
    expect(withDate.responses).toEqual(document.responses);
    const changed = await editScope(
      withDate,
      { ...document.scope, companies: "匿名会社" },
      withDate.diagnosisDate,
    );
    expect(Object.values(changed.responses).every((row) => row.adviceBasisVersion === 2)).toBe(
      true,
    );
  });
  it("rejects server-owned input and respects Unicode codepoints and total byte size", async () => {
    expect(editResponseSchema.safeParse({ ...edit, original: null }).success).toBe(false);
    expect(editResponseSchema.safeParse({ ...edit, reason: "𠮷".repeat(8000) }).success).toBe(true);
    expect(editResponseSchema.safeParse({ ...edit, reason: "𠮷".repeat(8001) }).success).toBe(
      false,
    );
    const document = await emptyDocument(ids);
    for (const row of Object.values(document.responses)) row.reason = "あ".repeat(8000);
    expect(assessmentDocumentSchema.safeParse(document).success).toBe(false);
  });
  it("canonicalizes keys without changing arrays or text", () => {
    expect(canonical({ z: ["②", "①"], a: "𠮷" })).toBe(canonical({ a: "𠮷", z: ["②", "①"] }));
    expect(canonical(["②", "①"])).not.toBe(canonical(["①", "②"]));
  });
});
