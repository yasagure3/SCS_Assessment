import { beforeEach, describe, expect, it } from "vitest";
import { env, applyD1Migrations, reset } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { hashAiInput } from "../../src/shared/contracts/aiAdvice";
import { STANDARD_ID } from "../../src/shared/contracts/assessment";
import master from "../../src/server/db/seed/scs-20260327-star3.json";
import { openAiProvider } from "../../src/server/modules/advice/adapter/aiProvider";
import { D1AiBudget } from "../../src/server/modules/advice/adapter/d1AiBudget";

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const draft = {
  origin: "ai",
  templateId: null,
  gap: "役割が未確定",
  steps: ["役割を合意する"],
  evidenceExamples: ["分担表"],
  completionCheck: "承認を確認する",
  notes: "下書き",
};
const completed = (value: unknown = draft) => ({
  id: "resp_fake",
  object: "response",
  status: "completed",
  error: null,
  incomplete_details: null,
  output: [
    {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }],
    },
  ],
});
const configured = {
  OPENAI_API_KEY: "sk-LOCAL-TEST-ONLY-NOT-A-REAL-KEY",
  OPENAI_MODEL: "gpt-6-sol",
  OPENAI_MODE: "trial",
};
const payload = {
  standardId: STANDARD_ID,
  criterionId: master.criteria[0].id,
  officialRequirement: master.criteria[0].officialText,
  anonymousAnswer: "匿名状況",
  anonymousGap: "匿名不足点",
};
async function fixture(
  transport: typeof fetch,
  settings: Record<string, string> = configured,
  timeout = 30000,
) {
  const actor = crypto.randomUUID(),
    stamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'staff','active',?,?)",
  )
    .bind(actor, actor, `${actor}@example.invalid`, stamp, stamp)
    .run();
  let now = Date.parse("2026-09-25T00:00:00Z");
  const app = createBusinessApp({
    verify: async () => ({
      sub: actor,
      client_id: "test",
      token_use: "access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      auth_time: Math.floor(Date.now() / 1000),
    }),
    access: (b) => new D1AccessRepository(b.DB),
    sessions: () => ({ revoke: async () => {} }),
    aiFetch: transport,
    now: () => now,
    aiTimeoutMs: timeout,
  });
  async function request(path: string, body?: unknown, key = crypto.randomUUID()) {
    const response = await app.request(
      `/api/v1${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer fixture",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { ...env, ...settings },
    );
    return {
      status: response.status,
      body: await response.json<{
        data: any;
        error?: { code: string; message: string; runId: string };
        requestId: string;
      }>(),
    };
  }
  const customer = (await request("/customers", { name: "転送禁止の顧客" })).body.data;
  const created = await request(`/customers/${customer.id}/cases`, {
    name: "転送禁止の案件",
    standardId: STANDARD_ID,
  });
  expect(created.status).toBe(201);
  const id = created.body.data.assessmentId,
    record = (await request(`/assessments/${id}`)).body.data;
  const input = {
    expectedRevision: 1,
    basisHash: record.document.responses[payload.criterionId].basisHash,
    anonymousAnswer: payload.anonymousAnswer,
    anonymousGap: payload.anonymousGap,
    reviewedInputHash: await hashAiInput(payload),
    anonymizationReviewed: true,
  };
  const path = `/assessments/${id}/advice/${payload.criterionId}/ai-runs`;
  return {
    actor,
    id,
    record,
    input,
    path,
    request,
    settings,
    setTime: (value: string) => {
      now = Date.parse(value);
    },
    send: (key = crypto.randomUUID()) => request(path, input, key),
  };
}

describe("OpenAI Responses through the Worker", () => {
  it("constructs a real Workers Request and refuses a cross-origin redirect without forwarding the key", async () => {
    const urls: string[] = [];
    const f = await fixture(async (input, init) => {
      const request = new Request(input, init);
      urls.push(request.url);
      return new Response(null, {
        status: 302,
        headers: { Location: "https://elsewhere.invalid/steal" },
      });
    });
    const response = await f.send();
    expect(response.status).toBe(502);
    expect(urls).toEqual(["https://api.openai.com/v1/responses"]);
  });
  it("blocks real outbound networking in the local Workers test configuration", async () => {
    const response = await fetch("https://outbound-test.invalid/");
    expect([response.status, await response.text()]).toEqual([503, "TEST_OUTBOUND_BLOCKED"]);
  });
  it.each([
    {},
    { ...configured, OPENAI_MODE: "disabled" },
    { ...configured, OPENAI_MODE: "" },
    { ...configured, OPENAI_MODE: "automatic" },
    { ...configured, OPENAI_MODEL: "unapproved-model" },
    { ...configured, OPENAI_API_KEY: "" },
    { ...configured, OPENAI_API_KEY: "sk-bad\nheader" },
  ])(
    "keeps manual editing available without HTTP or a reservation for invalid configuration %j",
    async (settings) => {
      let calls = 0;
      const f = await fixture(async () => {
        calls++;
        throw new Error("must not send");
      }, settings);
      const result = await f.send();
      expect([result.status, result.body.error?.code, calls]).toEqual([
        503,
        "AI_NOT_CONFIGURED",
        0,
      ]);
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM ai_budget_reservations WHERE run_id=?")
          .bind(result.body.error!.runId)
          .first(),
      ).toEqual({ count: 0 });
      expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(f.record);
    },
  );
  it("reserves before HTTP, sends only reviewed data, and replays without a second charge", async () => {
    const received: { url: unknown; init: RequestInit | undefined; reservations: unknown }[] = [];
    const f = await fixture(async (url, init) => {
      received.push({
        url,
        init,
        reservations: await env.DB.prepare(
          "SELECT count(*) AS count,sum(reserved_cents) AS cents FROM ai_budget_reservations",
        ).first(),
      });
      return Response.json(completed());
    });
    const key = crypto.randomUUID(),
      first = await f.send(key),
      second = await f.send(key);
    expect([first.status, second.status, first.body.data?.draft, second.body.data]).toEqual([
      200,
      200,
      draft,
      first.body.data,
    ]);
    expect(received.length).toBe(1);
    expect(received[0].reservations).toEqual({ count: 1, cents: 10 });
    expect(received[0].url).toBe("https://api.openai.com/v1/responses");
    const sentBody = received[0].init?.body;
    if (typeof sentBody !== "string") throw new Error("Expected a JSON string request");
    const body = JSON.parse(sentBody);
    expect(body).toEqual({
      model: "gpt-6-sol",
      store: false,
      max_output_tokens: 2000,
      reasoning: { effort: "low" },
      service_tier: "default",
      instructions: expect.any(String),
      input: [{ role: "user", content: JSON.stringify(payload) }],
      text: {
        format: {
          type: "json_schema",
          name: "advice_draft",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              origin: { type: "string", enum: ["ai"] },
              templateId: { type: "null" },
              gap: { type: "string" },
              steps: { type: "array", items: { type: "string" }, maxItems: 30 },
              evidenceExamples: { type: "array", items: { type: "string" }, maxItems: 30 },
              completionCheck: { type: "string" },
              notes: { type: "string" },
            },
            required: [
              "origin",
              "templateId",
              "gap",
              "steps",
              "evidenceExamples",
              "completionCheck",
              "notes",
            ],
          },
        },
      },
    });
    expect({
      method: received[0].init?.method,
      redirect: received[0].init?.redirect,
      headers: received[0].init?.headers,
    }).toEqual({
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${configured.OPENAI_API_KEY}`,
      },
    });
    expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(f.record);
  });
  it.each([
    [
      "non-200",
      () => new Response("SECRET upstream detail", { status: 500 }),
      "AI_PROVIDER_FAILED",
      502,
    ],
    ["429", () => new Response("SECRET quota", { status: 429 }), "AI_PROVIDER_FAILED", 502],
    [
      "redirect",
      () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.invalid" } }),
      "AI_PROVIDER_FAILED",
      502,
    ],
    ["broken JSON", () => new Response("SECRET not-json"), "AI_INVALID_OUTPUT", 502],
    [
      "incomplete",
      () =>
        Response.json({
          ...completed(),
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "provider error",
      () => Response.json({ ...completed(), error: { message: "SECRET" } }),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "refusal",
      () =>
        Response.json({
          ...completed(),
          output: [{ ...completed().output[0], content: [{ type: "refusal", refusal: "SECRET" }] }],
        }),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "tool item",
      () =>
        Response.json({
          ...completed(),
          output: [...completed().output, { type: "function_call", name: "execute" }],
        }),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "multiple messages",
      () =>
        Response.json({ ...completed(), output: [...completed().output, ...completed().output] }),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "unfinished message",
      () =>
        Response.json({
          ...completed(),
          output: [{ ...completed().output[0], status: "in_progress" }],
        }),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "extra draft key",
      () => Response.json(completed({ ...draft, command: "execute" })),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "draft too large",
      () => Response.json(completed({ ...draft, gap: "あ".repeat(12001) })),
      "AI_INVALID_OUTPUT",
      502,
    ],
    ["oversize body", () => new Response("あ".repeat(45000)), "AI_INVALID_OUTPUT", 502],
    [
      "oversize declared body",
      () => new Response("{}", { headers: { "Content-Length": "131073" } }),
      "AI_INVALID_OUTPUT",
      502,
    ],
    [
      "network outcome unknown",
      () => {
        throw new Error("SECRET unknown send outcome");
      },
      "AI_PROVIDER_FAILED",
      502,
    ],
  ] as const)(
    "turns %s into a safe error and never refunds or retries",
    async (_name, response, code, status) => {
      let calls = 0;
      const f = await fixture(async () => {
        calls++;
        return response();
      });
      const key = crypto.randomUUID(),
        result = await f.send(key),
        replay = await f.send(key);
      expect([
        result.status,
        result.body.error?.code,
        replay.status,
        replay.body.error,
        calls,
      ]).toEqual([status, code, status, result.body.error, 1]);
      expect(
        await env.DB.prepare(
          "SELECT mode,reserved_cents AS cents FROM ai_budget_reservations WHERE run_id=?",
        )
          .bind(result.body.error!.runId)
          .first(),
      ).toEqual({ mode: "trial", cents: 10 });
      expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(f.record);
      expect(JSON.stringify(result.body).includes("SECRET")).toBe(false);
    },
  );

  it("aborts a stalled HTTP body and retains the charge and failure on same-key replay", async () => {
    let calls = 0,
      cancelled = false;
    const f = await fixture(
      async () => {
        calls++;
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
      configured,
      50,
    );
    const key = crypto.randomUUID(),
      result = await f.send(key);
    expect([result.status, result.body.error?.code, cancelled, calls]).toEqual([
      504,
      "AI_TIMEOUT",
      true,
      1,
    ]);
    expect([(await f.send(key)).status, calls]).toEqual([504, 1]);
    expect(
      await env.DB.prepare(
        "SELECT reserved_cents AS cents FROM ai_budget_reservations WHERE run_id=?",
      )
        .bind(result.body.error!.runId)
        .first(),
    ).toEqual({ cents: 10 });
  });

  it("claims concurrent identical requests once and does not charge an old receipt after configuration changes", async () => {
    let calls = 0;
    const settings = { ...configured, OPENAI_MODE: "disabled" };
    const f = await fixture(async () => {
      calls++;
      return Response.json(completed());
    }, settings);
    const oldKey = crypto.randomUUID(),
      old = await f.send(oldKey);
    expect(old.status).toBe(503);
    settings.OPENAI_MODE = "trial";
    expect([(await f.send(oldKey)).status, calls]).toEqual([503, 0]);
    const key = crypto.randomUUID(),
      results = await Promise.all([f.send(key), f.send(key)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect([results[0].body.data.runId, calls]).toEqual([results[1].body.data.runId, 1]);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count,sum(reserved_cents) AS cents FROM ai_budget_reservations b JOIN ai_runs r ON r.id=b.run_id WHERE r.assessment_id=?",
      )
        .bind(f.id)
        .first(),
    ).toEqual({ count: 1, cents: 10 });
  });

  it("refuses expired running and finished runs before making any fresh reservation", async () => {
    const f = await fixture(async () => Response.json(completed()));
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO ai_runs(id,assessment_id,criterion_id,input_hash,basis_hash,status,requested_by,created_at) VALUES(?,?,?,?,?,'running',?,?)",
    )
      .bind(
        id,
        f.id,
        payload.criterionId,
        f.input.reviewedInputHash,
        f.input.basisHash,
        f.actor,
        "2026-09-24T23:59:00.000Z",
      )
      .run();
    const budget = new D1AiBudget(env.DB, () => Date.parse("2026-09-25T00:00:00Z"));
    await expect(budget.reserve(id, "trial")).rejects.toThrow("AI_BUDGET_LIMIT");
    await env.DB.prepare("UPDATE ai_runs SET status='failed' WHERE id=?").bind(id).run();
    await expect(budget.reserve(id, "monthly")).rejects.toThrow("AI_BUDGET_LIMIT");
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM ai_budget_reservations WHERE run_id=?")
        .bind(id)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("rebuilds five keys, limits the whole UTF-8 request before reserving, and treats HTML as text", async () => {
    const reservations: string[] = [],
      requests: unknown[] = [];
    const value = { ...draft, notes: "<script>alert('untrusted')</script>" };
    const provider = openAiProvider(
      configured,
      {
        reserve: async (id) => {
          reservations.push(id);
        },
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON string request");
        requests.push(JSON.parse(init.body).input);
        return Response.json({
          ...completed(value),
          output: [
            { id: "rs_fake", type: "reasoning", summary: [], encrypted_content: "opaque" },
            ...completed(value).output,
          ],
        });
      },
    );
    const extra = {
      ...payload,
      evidence: "NEVER SEND",
      customerName: "NEVER SEND",
      tools: ["execute"],
    };
    expect(await provider.generate(extra, new AbortController().signal, "allowed")).toEqual(value);
    await expect(
      provider.generate(
        { ...payload, officialRequirement: "あ".repeat(7000) },
        new AbortController().signal,
        "too-big",
      ),
    ).rejects.toThrow("PAYLOAD_TOO_LARGE");
    const aborted = new AbortController();
    aborted.abort();
    await expect(provider.generate(payload, aborted.signal, "cancelled")).rejects.toThrow(
      "AI_TIMEOUT",
    );
    expect([reservations, requests]).toEqual([
      ["allowed"],
      [[{ role: "user", content: JSON.stringify(payload) }]],
    ]);
  });

  it("enforces global trial and UTC monthly caps atomically across users and preserves the trial on restart and a new month", async () => {
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      return Response.json(completed());
    };
    const actors = await Promise.all(
      Array.from({ length: 8 }, () => fixture(transport, { ...configured })),
    );
    // Workers isolates storage per test; fill the genuine local D1 to one slot left.
    for (let i = 0; i < 29; i++) {
      const f = actors[i % actors.length];
      f.setTime(`2026-09-25T01:${String(i).padStart(2, "0")}:00Z`);
      expect((await f.send()).status).toBe(200);
    }
    actors.forEach((f) => f.setTime("2026-09-25T02:00:00Z"));
    const beforeCalls = calls,
      results = await Promise.all(actors.map((f) => f.send()));
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 429, 429, 429, 429, 429, 429, 429,
    ]);
    expect(calls - beforeCalls).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count,sum(reserved_cents) AS cents FROM ai_budget_reservations WHERE mode='trial'",
      ).first(),
    ).toEqual({ count: 30, cents: 300 });
    const restart = await fixture(transport, { ...configured });
    restart.setTime("2026-10-01T00:00:00Z");
    expect([(await restart.send()).status, calls]).toEqual([429, beforeCalls + 1]);
    restart.settings.OPENAI_MODE = "monthly";
    expect((await restart.send()).status).toBe(200);
    // Use genuine D1 inserts tied to real runs to establish the month boundary without 199 HTTP calls.
    const budget = new D1AiBudget(env.DB, () => Date.parse("2026-10-01T00:00:00Z"));
    const seedStatements: D1PreparedStatement[] = [];
    for (let i = 1; i < 199; i++) {
      const id = crypto.randomUUID();
      seedStatements.push(
        env.DB.prepare(
          "INSERT INTO ai_runs(id,assessment_id,criterion_id,input_hash,basis_hash,status,requested_by,created_at) VALUES(?,?,?,?,?,'succeeded',?,?)",
        ).bind(
          id,
          restart.id,
          payload.criterionId,
          restart.input.reviewedInputHash,
          restart.input.basisHash,
          restart.actor,
          "2026-10-01T00:00:00Z",
        ),
      );
      seedStatements.push(
        env.DB.prepare(
          "INSERT INTO ai_budget_reservations VALUES(?,'2026-10','monthly',10,'gpt-6-sol','2026-10-01T00:00:00Z')",
        ).bind(id),
      );
    }
    await env.DB.batch(seedStatements);
    actors.forEach((f) => {
      f.settings.OPENAI_MODE = "monthly";
      f.setTime("2026-10-01T00:10:00Z");
    });
    const monthlyCalls = calls,
      monthResults = await Promise.all(actors.map((f) => f.send()));
    expect(monthResults.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 429, 429, 429, 429, 429, 429, 429,
    ]);
    expect(calls - monthlyCalls).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count,sum(reserved_cents) AS cents FROM ai_budget_reservations WHERE utc_month='2026-10'",
      ).first(),
    ).toEqual({ count: 200, cents: 2000 });
    const oldRun = results.find((r) => r.status === 200)!.body.data.runId;
    await expect(budget.reserve(oldRun, "monthly")).rejects.toThrow("AI_BUDGET_LIMIT");
    restart.setTime("2026-11-01T00:00:00Z");
    expect((await restart.send()).status).toBe(200);
    restart.settings.OPENAI_MODE = "trial";
    expect((await restart.send()).status).toBe(429);
  });
});
