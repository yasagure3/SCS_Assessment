import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { D1AssessmentRepository } from "../../src/server/modules/assessment/adapter/d1AssessmentRepository";
import { digest } from "../../src/server/modules/assessment/domain/assessment";
import { STANDARD_ID, type Advice } from "../../src/shared/contracts/assessment";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import master from "../../src/server/db/seed/scs-20260327-star3.json";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const criterion = master.criteria[0];
const draft: Advice = {
  origin: "ai",
  templateId: null,
  gap: "分担が未確定",
  steps: ["役割を決める"],
  evidenceExamples: ["分担表"],
  completionCheck: "担当者が照合する",
  notes: "下書き",
};
const payload = {
  standardId: STANDARD_ID,
  criterionId: criterion.id,
  officialRequirement: criterion.officialText,
  anonymousAnswer: "担当の分担を検討中",
  anonymousGap: "承認された分担表がない",
};
type Provider = { generate: (input: typeof payload, signal: AbortSignal) => Promise<unknown> };
async function fixture(provider?: Provider, aiTimeoutMs?: number) {
  const actorId = crypto.randomUUID(),
    sub = crypto.randomUUID(),
    stamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'staff','active',?,?)",
  )
    .bind(actorId, sub, `${actorId}@example.invalid`, stamp, stamp)
    .run();
  let clock = Date.now();
  const app = createBusinessApp({
    verify: async () => ({
      sub,
      client_id: "test",
      token_use: "access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      auth_time: Math.floor(Date.now() / 1000),
    }),
    access: (b) => new D1AccessRepository(b.DB),
    sessions: () => ({ revoke: async () => {} }),
    ai: provider ? () => provider : undefined,
    now: () => clock,
    aiTimeoutMs,
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
      headers: response.headers,
      body: await response.json<{ data: any; error?: { code: string; runId?: string } }>(),
    };
  }
  const customer = (await request("/customers", "POST", { name: "送信禁止の顧客名" })).body.data;
  const created = await request(`/customers/${customer.id}/cases`, "POST", {
    name: "送信禁止の案件名",
    standardId: STANDARD_ID,
  });
  expect(created.status).toBe(201);
  const read = async (): Promise<AssessmentDto> =>
    (await request(`/assessments/${created.body.data.assessmentId}`)).body.data;
  const record = await read(),
    path = `/assessments/${record.id}/advice/${criterion.id}`;
  const input = {
    expectedRevision: record.revision,
    basisHash: record.document.responses[criterion.id].basisHash,
    anonymousAnswer: payload.anonymousAnswer,
    anonymousGap: payload.anonymousGap,
    reviewedInputHash: await digest(payload),
    anonymizationReviewed: true,
  };
  return {
    actorId,
    record,
    path,
    input,
    request,
    read,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
describe("anonymous AI advice", () => {
  it.each(["reject", "resolve", "ignore"] as const)(
    "keeps a timed-out run failed when the provider reacts to abort with %s",
    async (mode) => {
      let complete!: (value: unknown) => void,
        calls = 0,
        aborted = false;
      const f = await fixture(
        {
          generate: (_input, signal) => {
            calls++;
            return new Promise((resolve, reject) => {
              complete = resolve;
              signal.addEventListener("abort", () => {
                aborted = true;
                if (mode === "reject") reject(new Error("Aborted"));
                if (mode === "resolve") resolve(draft);
              });
            });
          },
        },
        5,
      );
      const key = crypto.randomUUID();
      const failed = await f.request(`${f.path}/ai-runs`, "POST", f.input, key);
      // A provider may ignore abort and complete after the HTTP response has already failed.
      complete(draft);
      expect([failed.status, failed.body.error?.code, aborted]).toEqual([504, "AI_TIMEOUT", true]);
      const run = await f.request(
        `/assessments/${f.record.id}/ai-runs/${failed.body.error?.runId}`,
      );
      expect([run.status, run.body.data]).toEqual([
        200,
        {
          runId: failed.body.error?.runId,
          criterionId: criterion.id,
          status: "failed",
          draft: null,
          inputHash: f.input.reviewedInputHash,
          basisHash: f.input.basisHash,
          errorCode: "AI_TIMEOUT",
        },
      ]);
      const replay = await f.request(`${f.path}/ai-runs`, "POST", f.input, key);
      expect([replay.status, replay.body.error?.code, replay.body.error?.runId, calls]).toEqual([
        504,
        "AI_TIMEOUT",
        failed.body.error?.runId,
        1,
      ]);
      expect(await f.read()).toEqual(f.record);
    },
  );
  it.each(["change", "no-op"] as const)(
    "replays an AI adoption %s receipt after a basis change without writing the current assessment",
    async (mode) => {
      const f = await fixture({ generate: async () => draft });
      const run = (await f.request(`${f.path}/ai-runs`, "POST", f.input)).body.data;
      let body = { expectedRevision: 1, mutationId: crypto.randomUUID(), runId: run.runId };
      const adopted = await f.request(`${f.path}/adopt-ai`, "POST", body);
      expect([adopted.status, adopted.body.data.revision]).toEqual([200, 2]);
      if (mode === "no-op") {
        body = { ...body, expectedRevision: 2, mutationId: crypto.randomUUID() };
        const unchanged = await f.request(`${f.path}/adopt-ai`, "POST", body);
        expect([unchanged.status, unchanged.body.data]).toEqual([200, adopted.body.data]);
      }
      const changed = await f.request(`/assessments/${f.record.id}/scope`, "PATCH", {
        expectedRevision: 2,
        mutationId: crypto.randomUUID(),
        scope: { companies: "新しい範囲", sites: "", departments: "", systems: "" },
        diagnosisDate: null,
      });
      expect([changed.status, changed.body.data.revision]).toEqual([200, 3]);
      const replay = await f.request(`${f.path}/adopt-ai`, "POST", body);
      expect([replay.status, replay.body.data]).toEqual([200, adopted.body.data]);
      for (const patch of [
        { expectedRevision: changed.body.data.revision },
        { runId: crypto.randomUUID() },
      ]) {
        const different = await f.request(`${f.path}/adopt-ai`, "POST", { ...body, ...patch });
        expect([different.status, different.body.error?.code]).toEqual([
          409,
          "IDEMPOTENCY_CONFLICT",
        ]);
      }
      const fresh = await f.request(`${f.path}/adopt-ai`, "POST", {
        ...body,
        expectedRevision: changed.body.data.revision,
        mutationId: crypto.randomUUID(),
      });
      expect([fresh.status, fresh.body.error?.code]).toEqual([409, "AI_STALE"]);
      expect(await f.read()).toEqual(changed.body.data);
      expect(
        await env.DB.prepare(
          "SELECT (SELECT count(*) FROM operation_receipts WHERE actor_id=? AND operation_key=?) AS receipts,(SELECT count(*) FROM assessment_revisions WHERE assessment_id=?) AS revisions,(SELECT count(*) FROM audit_events WHERE resource_id=? AND action='advice.adopt-ai') AS adoptions",
        )
          .bind(f.actorId, body.mutationId, f.record.id, f.record.id)
          .first(),
      ).toEqual({ receipts: 1, revisions: 3, adoptions: mode === "no-op" ? 2 : 1 });
    },
  );
  it.each([
    ["change", "suspend", 403],
    ["change", "unassign", 404],
    ["change", "revoke", 401],
    ["no-op", "suspend", 403],
    ["no-op", "unassign", 404],
    ["no-op", "revoke", 401],
  ] as const)(
    "checks current authorization before replaying an adoption %s receipt after %s",
    async (mode, change, deniedStatus) => {
      const f = await fixture({ generate: async () => draft });
      const run = (await f.request(`${f.path}/ai-runs`, "POST", f.input)).body.data;
      let body = { expectedRevision: 1, mutationId: crypto.randomUUID(), runId: run.runId };
      const adopted = await f.request(`${f.path}/adopt-ai`, "POST", body);
      expect(adopted.status).toBe(200);
      if (mode === "no-op") {
        body = { ...body, expectedRevision: 2, mutationId: crypto.randomUUID() };
        const unchanged = await f.request(`${f.path}/adopt-ai`, "POST", body);
        expect([unchanged.status, unchanged.body.data]).toEqual([200, adopted.body.data]);
      }
      if (change === "suspend")
        await env.DB.prepare("UPDATE app_users SET status='suspended' WHERE id=?")
          .bind(f.actorId)
          .run();
      if (change === "unassign")
        await env.DB.prepare("DELETE FROM customer_memberships WHERE user_id=?")
          .bind(f.actorId)
          .run();
      if (change === "revoke")
        await env.DB.prepare("UPDATE app_users SET revoked_before=? WHERE id=?")
          .bind(Math.floor(Date.now() / 1000) + 600, f.actorId)
          .run();
      const replay = await f.request(`${f.path}/adopt-ai`, "POST", body);
      const different = await f.request(`${f.path}/adopt-ai`, "POST", {
        ...body,
        runId: crypto.randomUUID(),
      });
      expect([replay.status, different.status]).toEqual([deniedStatus, deniedStatus]);
      const stored = await env.DB.prepare(
        "SELECT revision,document_json FROM assessments WHERE id=?",
      )
        .bind(f.record.id)
        .first<{ revision: number; document_json: string }>();
      expect([stored?.revision, JSON.parse(stored!.document_json)]).toEqual([
        adopted.body.data.revision,
        adopted.body.data.document,
      ]);
    },
  );
  it("rejects forged AI provenance but replays an adopted AI draft receipt after a later manual replacement", async () => {
    const f = await fixture({ generate: async () => draft });
    expect(
      (
        await f.request(`${f.path}/confirm`, "POST", {
          expectedRevision: 1,
          mutationId: crypto.randomUUID(),
          content: draft,
          reviewed: true,
        })
      ).status,
    ).toBe(422);
    const run = (await f.request(`${f.path}/ai-runs`, "POST", f.input)).body.data;
    expect(
      (
        await f.request(`${f.path}/adopt-ai`, "POST", {
          expectedRevision: 1,
          mutationId: crypto.randomUUID(),
          runId: run.runId,
        })
      ).status,
    ).toBe(200);
    const body = { expectedRevision: 2, mutationId: crypto.randomUUID(), content: draft };
    const saved = await f.request(`${f.path}/draft`, "PUT", body);
    expect(saved.status).toBe(200);
    const manual = await f.request(`${f.path}/draft`, "PUT", {
      expectedRevision: 2,
      mutationId: crypto.randomUUID(),
      content: { ...draft, origin: "manual", gap: "手動の最新版" },
    });
    expect(manual.status).toBe(200);
    const replay = await f.request(`${f.path}/draft`, "PUT", body);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(saved.body.data);
    expect(await f.read()).toEqual(manual.body.data);
  });
  it("keeps the concurrency slot while a stale provider is still running", async () => {
    let complete!: (value: unknown) => void, started!: () => void;
    let calls = 0;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const f = await fixture({
      generate: async () => {
        if (++calls > 1) return draft;
        started();
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    const key = crypto.randomUUID(),
      first = f.request(`${f.path}/ai-runs`, "POST", f.input, key);
    await running;
    const duplicate = await f.request(`${f.path}/ai-runs`, "POST", f.input, key);
    const updated = await f.request(`/assessments/${f.record.id}/scope`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      scope: { companies: "変更", sites: "", systems: "", departments: "" },
      diagnosisDate: null,
    });
    expect(updated.status).toBe(200);
    expect(
      (await f.request(`/assessments/${f.record.id}/ai-runs/${duplicate.body.data.runId}`)).status,
    ).toBe(409);
    const second = await f.request(`${f.path}/ai-runs`, "POST", {
      ...f.input,
      expectedRevision: 2,
      basisHash: updated.body.data.document.responses[criterion.id].basisHash,
    });
    // Resolve before assertions so a failed expectation does not leave a provider in flight.
    complete(draft);
    expect((await first).status).toBe(409);
    expect([second.status, second.body.error?.code]).toEqual([429, "AI_RATE_LIMIT"]);
  });
  it("creates one run and one audit under truly simultaneous identical requests", async () => {
    let calls = 0;
    const f = await fixture({
        generate: async () => {
          calls++;
          return draft;
        },
      }),
      key = crypto.randomUUID();
    const responses = await Promise.all([
      f.request(`${f.path}/ai-runs`, "POST", f.input, key),
      f.request(`${f.path}/ai-runs`, "POST", f.input, key),
    ]);
    expect(responses.map((result) => result.status)).toEqual([200, 200]);
    expect(responses[0].body.data.runId).toBe(responses[1].body.data.runId);
    expect(calls).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT (SELECT count(*) FROM ai_runs WHERE assessment_id=?) AS runs,(SELECT count(*) FROM audit_events WHERE resource_id=? AND action='advice.generate') AS audits",
      )
        .bind(f.record.id, responses[0].body.data.runId)
        .first(),
    ).toEqual({ runs: 1, audits: 1 });
  });
  it("reserves once under simultaneous same-key sends, blocks a second run, and expires interrupted runs without resending", async () => {
    let complete!: (value: unknown) => void,
      started!: () => void,
      calls = 0;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const f = await fixture({
      generate: async () => {
        calls++;
        started();
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    const key = crypto.randomUUID(),
      first = f.request(`${f.path}/ai-runs`, "POST", f.input, key);
    await running;
    const duplicate = await f.request(`${f.path}/ai-runs`, "POST", f.input, key);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data).toEqual({
      runId: expect.any(String),
      criterionId: criterion.id,
      status: "running",
      draft: null,
      errorCode: null,
      inputHash: f.input.reviewedInputHash,
      basisHash: f.input.basisHash,
    });
    const limited = await f.request(`${f.path}/ai-runs`, "POST", f.input);
    expect([limited.status, limited.body.error?.code, limited.headers.get("Retry-After")]).toEqual([
      429,
      "AI_RATE_LIMIT",
      "60",
    ]);
    f.advance(60000);
    const expired = await f.request(
      `/assessments/${f.record.id}/ai-runs/${duplicate.body.data.runId}`,
    );
    expect(expired.body.data).toEqual({
      ...duplicate.body.data,
      status: "failed",
      errorCode: "AI_TIMEOUT",
    });
    complete(draft);
    const finished = await first;
    expect([finished.status, finished.body.error?.code]).toEqual([504, "AI_TIMEOUT"]);
    expect([(await f.request(`${f.path}/ai-runs`, "POST", f.input, key)).status, calls]).toEqual([
      504, 1,
    ]);
    expect(await f.read()).toEqual(f.record);
  });
  it("replays terminal success and rejects a changed body and a key already used by another API", async () => {
    let calls = 0;
    const f = await fixture({
        generate: async () => {
          calls++;
          return draft;
        },
      }),
      key = crypto.randomUUID();
    const first = await f.request(`${f.path}/ai-runs`, "POST", f.input, key);
    const second = await f.request(`${f.path}/ai-runs`, "POST", f.input, key);
    expect([first.status, second.status, calls]).toEqual([200, 200, 1]);
    expect(second.body.data).toEqual(first.body.data);
    const conflict = await f.request(
      `${f.path}/ai-runs`,
      "POST",
      { ...f.input, anonymousGap: "変更" },
      key,
    );
    expect([conflict.status, conflict.body.error?.code]).toEqual([409, "IDEMPOTENCY_CONFLICT"]);
    const otherKey = crypto.randomUUID();
    expect((await f.request("/customers", "POST", { name: "別の操作" }, otherKey)).status).toBe(
      201,
    );
    expect((await f.request(`${f.path}/ai-runs`, "POST", f.input, otherKey)).status).toBe(409);
    expect(calls).toBe(1);
  });
  it("rejects extra fields, altered confirmation, codepoint and byte excess before calling the provider", async () => {
    let calls = 0;
    const f = await fixture({
      generate: async () => {
        calls++;
        return draft;
      },
    });
    for (const patch of [
      { rawAnswers: { O: "private" } },
      { evidence: "private" },
      { customerName: "private" },
      { internalUrl: "https://internal.invalid" },
      { mutationId: crypto.randomUUID() },
      { anonymizationReviewed: false },
      { anonymousAnswer: "😀".repeat(2001) },
    ]) {
      expect((await f.request(`${f.path}/ai-runs`, "POST", { ...f.input, ...patch })).status).toBe(
        422,
      );
    }
    const changed = await f.request(`${f.path}/ai-runs`, "POST", {
      ...f.input,
      anonymousGap: "確認後の変更",
    });
    expect([changed.status, changed.body.error?.code]).toEqual([422, "AI_INPUT_CHANGED"]);
    const large = {
      ...payload,
      anonymousAnswer: "あ".repeat(2000),
      anonymousGap: "い".repeat(2000),
    };
    expect(
      (
        await f.request(`${f.path}/ai-runs`, "POST", {
          ...f.input,
          anonymousAnswer: large.anonymousAnswer,
          anonymousGap: large.anonymousGap,
          reviewedInputHash: await digest(large),
        })
      ).status,
    ).toBe(413);
    expect([calls, await f.read()]).toEqual([0, f.record]);
  });
  it("returns unconfigured, provider failure, timeout, and malformed-output errors while preserving a hand-written draft", async () => {
    for (const [provider, code, status] of [
      [undefined, "AI_NOT_CONFIGURED", 503],
      [
        {
          generate: async () => {
            throw new Error("must not leak input");
          },
        },
        "AI_PROVIDER_FAILED",
        502,
      ],
      [{ generate: async () => new Promise(() => {}) }, "AI_TIMEOUT", 504],
      [{ generate: async () => ({ ...draft, tools: ["execute"] }) }, "AI_INVALID_OUTPUT", 502],
      [{ generate: async () => ({ ...draft, gap: "😀".repeat(12001) }) }, "AI_INVALID_OUTPUT", 502],
    ] as const) {
      const f = await fixture(provider, 5);
      const manual = { ...draft, origin: "manual" };
      expect(
        (
          await f.request(`${f.path}/draft`, "PUT", {
            expectedRevision: 1,
            mutationId: crypto.randomUUID(),
            content: manual,
          })
        ).status,
      ).toBe(200);
      const before = await f.read(),
        input = { ...f.input, expectedRevision: 2 },
        key = crypto.randomUUID();
      const failed = await f.request(`${f.path}/ai-runs`, "POST", input, key);
      expect([failed.status, failed.body.error?.code]).toEqual([status, code]);
      const run = await f.request(
        `/assessments/${f.record.id}/ai-runs/${failed.body.error?.runId}`,
      );
      expect(run.body.data).toEqual({
        runId: failed.body.error?.runId,
        criterionId: criterion.id,
        status: "failed",
        draft: null,
        inputHash: f.input.reviewedInputHash,
        basisHash: f.input.basisHash,
        errorCode: code,
      });
      expect((await f.request(`${f.path}/ai-runs`, "POST", input, key)).status).toBe(status);
      expect(await f.read()).toEqual(before);
    }
  });
  it("limits each user to five new attempts in a minute without counting retries twice", async () => {
    let calls = 0;
    const f = await fixture({
      generate: async () => {
        calls++;
        return draft;
      },
    });
    for (let i = 0; i < 5; i++)
      expect((await f.request(`${f.path}/ai-runs`, "POST", f.input)).status).toBe(200);
    const limited = await f.request(`${f.path}/ai-runs`, "POST", f.input);
    expect([limited.status, calls]).toEqual([429, 5]);
    f.advance(60000);
    expect((await f.request(`${f.path}/ai-runs`, "POST", f.input)).status).toBe(200);
    expect(calls).toBe(6);
  });
  it("rejects foreign, wrong-criterion and stale runs including basis changes while generation is running", async () => {
    const f = await fixture({ generate: async () => draft }),
      other = await fixture({ generate: async () => draft });
    const run = (await f.request(`${f.path}/ai-runs`, "POST", f.input)).body.data;
    const adopt = { expectedRevision: 1, mutationId: crypto.randomUUID(), runId: run.runId };
    expect((await other.request(`${other.path}/adopt-ai`, "POST", adopt)).status).toBe(404);
    expect((await other.request(`/assessments/${f.record.id}/ai-runs/${run.runId}`)).status).toBe(
      404,
    );
    expect(
      (
        await f.request(
          `/assessments/${f.record.id}/advice/${master.criteria[1].id}/adopt-ai`,
          "POST",
          adopt,
        )
      ).status,
    ).toBe(404);
    const changed = await f.request(
      `/assessments/${f.record.id}/responses/${criterion.id}`,
      "PATCH",
      {
        expectedRevision: 1,
        mutationId: crypto.randomUUID(),
        status: "no",
        reason: "変化",
        basis: "",
        plannedWork: "",
        supplement: "",
      },
    );
    expect(changed.status).toBe(200);
    expect((await f.request(`/assessments/${f.record.id}/ai-runs/${run.runId}`)).status).toBe(409);
    expect(
      (await f.request(`${f.path}/adopt-ai`, "POST", { ...adopt, expectedRevision: 2 })).status,
    ).toBe(409);
    expect((await f.read()).document.responses[criterion.id].adviceDraft).toBeNull();
    let active!: Awaited<ReturnType<typeof fixture>>;
    active = await fixture({
      generate: async () => {
        const repository = new D1AssessmentRepository(env.DB),
          record = await repository.get(active.record.id, active.actorId);
        record.document.scope.companies = "対象変更";
        await repository.save({
          record,
          actorId: active.actorId,
          expectedRevision: 1,
          mutationId: crypto.randomUUID(),
          requestHash: "a".repeat(64),
          action: "fixture.scope",
          requestId: crypto.randomUUID(),
        });
        return draft;
      },
    });
    const stale = await active.request(`${active.path}/ai-runs`, "POST", active.input);
    expect([stale.status, stale.body.error?.code]).toEqual([409, "AI_STALE"]);
    expect(
      await env.DB.prepare("SELECT status,draft_json FROM ai_runs WHERE id=?")
        .bind(stale.body.error?.runId)
        .first(),
    ).toEqual({ status: "stale", draft_json: JSON.stringify(draft) });
  });
  it("sends exactly five reviewed fields, preserves the assessment, adopts only a draft, and confirms separately", async () => {
    const received: unknown[] = [];
    const f = await fixture({
      generate: async (input) => {
        received.push(input);
        return draft;
      },
    });
    const repository = new D1AssessmentRepository(env.DB),
      privateRecord = await repository.get(f.record.id, f.actorId);
    privateRecord.document.responses[criterion.id].original = {
      sheet: "原資料",
      row: 6,
      O: "原O秘密",
      P: "原P秘密",
      Q: "原Q秘密",
      R: "原R秘密",
    };
    privateRecord.document.responses[criterion.id].reason = "送信しない内部回答";
    privateRecord.document.evidence.push({
      id: crypto.randomUUID(),
      criterionIds: [criterion.id],
      name: "送信しない証跡",
      url: "https://internal.example.invalid/private",
      location: "社内保管場所",
      fileId: null,
      reviews: {
        [criterion.id]: {
          state: "unreviewed",
          by: null,
          at: null,
          note: "内部メモ",
          subjectHash: null,
        },
      },
    });
    await repository.save({
      record: privateRecord,
      actorId: f.actorId,
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      requestHash: "d".repeat(64),
      action: "fixture.private-input",
      requestId: crypto.randomUUID(),
    });
    f.record = await f.read();
    f.input.expectedRevision = f.record.revision;
    f.input.basisHash = f.record.document.responses[criterion.id].basisHash;
    const run = await f.request(`${f.path}/ai-runs`, "POST", f.input);
    expect(run.status).toBe(200);
    expect(received).toEqual([payload]);
    expect(run.body.data).toEqual({
      runId: expect.any(String),
      status: "succeeded",
      draft,
      inputHash: f.input.reviewedInputHash,
      basisHash: f.input.basisHash,
      criterionId: criterion.id,
      errorCode: null,
    });
    expect(await f.read()).toEqual(f.record);
    const queried = await f.request(`/assessments/${f.record.id}/ai-runs/${run.body.data.runId}`);
    expect(queried.body.data).toEqual(run.body.data);
    const adopted = await f.request(`${f.path}/adopt-ai`, "POST", {
      expectedRevision: f.record.revision,
      mutationId: crypto.randomUUID(),
      runId: run.body.data.runId,
    });
    expect(adopted.status).toBe(200);
    expect(adopted.body.data.document.responses[criterion.id]).toEqual({
      ...f.record.document.responses[criterion.id],
      adviceDraft: draft,
    });
    expect(adopted.body.data.adviceSummary).toEqual({
      currentConfirmed: 0,
      draftOnly: 1,
      stale: 0,
      none: 80,
      draftPending: 1,
    });
    const confirmed = await f.request(`${f.path}/confirm`, "POST", {
      expectedRevision: adopted.body.data.revision,
      mutationId: crypto.randomUUID(),
      content: draft,
      reviewed: true,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.document.responses[criterion.id].confirmedAdvice).toEqual({
      content: draft,
      basisHash: f.input.basisHash,
      by: f.actorId,
      at: expect.any(String),
      version: 1,
    });
  });
});
