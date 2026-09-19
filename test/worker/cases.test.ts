import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { STANDARD_ID } from "../../src/shared/contracts/assessment";
import type { AssessmentListItem, CaseRecord, Customer } from "../../src/shared/contracts/cases";
import { emptyDocument } from "../../src/server/modules/assessment/domain/assessment";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
async function fixture() {
  const id = crypto.randomUUID(),
    sub = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'staff','active',?,?)",
  )
    .bind(id, sub, `${id}@example.invalid`, now, now)
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
  async function rawRequest(
    path: string,
    method = "GET",
    body?: string,
    key = crypto.randomUUID(),
  ) {
    const response = await app.request(
      `/api/v1${path}`,
      {
        method,
        headers: {
          Authorization: "Bearer fixture",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body,
      },
      env,
    );
    return {
      status: response.status,
      body: await response.json<{ data: any; error?: { code: string } }>(),
    };
  }
  async function request(path: string, method = "GET", body?: unknown, key = crypto.randomUUID()) {
    return rawRequest(path, method, body === undefined ? undefined : JSON.stringify(body), key);
  }
  async function customer(name = "匿名会社", key = crypto.randomUUID()) {
    const result = await request("/customers", "POST", { name }, key);
    expect(result.status).toBe(201);
    return result.body.data;
  }
  return { id, sub, request, rawRequest, customer };
}

async function paginatedFixture(kind: "customers" | "cases" | "assessments") {
  const f = await fixture(),
    customerId = crypto.randomUUID(),
    caseId = crypto.randomUUID(),
    timestamp = "2026-09-19T00:00:00.000Z";
  const statements: D1PreparedStatement[] = [];
  const items: (Customer | CaseRecord | AssessmentListItem)[] = [];
  if (kind !== "customers") {
    statements.push(
      env.DB.prepare("INSERT INTO customers VALUES(?,?,NULL,1,?,?,?)").bind(
        customerId,
        "一覧用顧客",
        f.id,
        timestamp,
        timestamp,
      ),
      env.DB.prepare("INSERT INTO customer_memberships VALUES(?,?,?,?)").bind(
        customerId,
        f.id,
        f.id,
        timestamp,
      ),
    );
  }
  let document = "";
  if (kind === "assessments") {
    statements.push(
      env.DB.prepare("INSERT INTO cases VALUES(?,?,?,NULL,1,?,?,?)").bind(
        caseId,
        customerId,
        "一覧用案件",
        f.id,
        timestamp,
        timestamp,
      ),
    );
    const criteria = await env.DB.prepare(
      "SELECT criterion_id AS id FROM criteria WHERE standard_id=? ORDER BY order_no",
    )
      .bind(STANDARD_ID)
      .all<{ id: string }>();
    document = JSON.stringify(await emptyDocument(criteria.results.map((row) => row.id)));
  }
  for (let index = 0; index < 101; index++) {
    const id = crypto.randomUUID(),
      name = `一覧項目${index}`,
      common = { id, revision: 1, createdAt: timestamp, updatedAt: timestamp };
    if (kind === "customers") {
      items.push({ ...common, name, archivedAt: null });
      statements.push(
        env.DB.prepare("INSERT INTO customers VALUES(?,?,NULL,1,?,?,?)").bind(
          id,
          name,
          f.id,
          timestamp,
          timestamp,
        ),
        env.DB.prepare("INSERT INTO customer_memberships VALUES(?,?,?,?)").bind(
          id,
          f.id,
          f.id,
          timestamp,
        ),
      );
    } else if (kind === "cases") {
      items.push({ ...common, name, archivedAt: null, customerId });
      statements.push(
        env.DB.prepare("INSERT INTO cases VALUES(?,?,?,NULL,1,?,?,?)").bind(
          id,
          customerId,
          name,
          f.id,
          timestamp,
          timestamp,
        ),
      );
    } else {
      items.push({
        ...common,
        standardId: STANDARD_ID,
        diagnosisDate: null,
        previousAssessmentId: null,
      });
      statements.push(
        env.DB.prepare("INSERT INTO assessments VALUES(?,?,?,?,NULL,1,?,?,?,?,?,?)").bind(
          id,
          caseId,
          customerId,
          STANDARD_ID,
          document,
          crypto.randomUUID(),
          "0".repeat(64),
          f.id,
          timestamp,
          timestamp,
        ),
      );
    }
  }
  await env.DB.batch(statements);
  const path =
    kind === "customers"
      ? "/customers"
      : kind === "cases"
        ? `/customers/${customerId}/cases`
        : `/cases/${caseId}/assessments`;
  return { ...f, path, items: items.sort((a, b) => b.id.localeCompare(a.id)) };
}

describe("case API request contracts", () => {
  it.each([
    ["POST", "/customers"],
    ["PATCH", "/customers/:customerId"],
    ["POST", "/customers/:customerId/cases"],
    ["PATCH", "/cases/:caseId"],
    ["PATCH", "/assessments/:assessmentId/scope"],
  ])(
    "%s %s returns 400 for malformed JSON and 422 for schema violations",
    async (method, route) => {
      const f = await fixture(),
        customer = await f.customer();
      const created = await f.request(`/customers/${customer.id}/cases`, "POST", {
        name: "入力検証用",
        standardId: STANDARD_ID,
      });
      expect(created.status).toBe(201);
      const path = route
        .replace(":customerId", customer.id)
        .replace(":caseId", created.body.data.case.id)
        .replace(":assessmentId", created.body.data.assessmentId);
      expect(await f.rawRequest(path, method, "{}")).toEqual({
        status: 422,
        body: {
          error: { code: "VALIDATION_ERROR", message: "入力内容を確認してください。" },
          requestId: expect.any(String),
        },
      });
      expect(await f.rawRequest(path, method, '{"name":')).toEqual({
        status: 400,
        body: {
          error: { code: "MALFORMED_JSON", message: "JSONの形式を確認してください。" },
          requestId: expect.any(String),
        },
      });
    },
  );

  it.each(["customers", "cases", "assessments"] as const)(
    "%s returns 50 items by default, supports 100, and rechecks cursor permissions",
    async (kind) => {
      const f = await paginatedFixture(kind);
      let firstCursor = "";
      for (const requestedLimit of [undefined, 100]) {
        const pageSize = requestedLimit ?? 50;
        let cursor: string | null = null;
        for (let offset = 0; offset < f.items.length; offset += pageSize) {
          const query = new URLSearchParams();
          if (requestedLimit !== undefined) query.set("limit", String(requestedLimit));
          if (cursor !== null) query.set("cursor", cursor);
          const response = await f.request(`${f.path}?${query.toString()}`);
          expect(response).toEqual({
            status: 200,
            body: {
              data: {
                items: f.items.slice(offset, offset + pageSize),
                nextCursor: offset + pageSize < f.items.length ? expect.any(String) : null,
              },
              requestId: expect.any(String),
            },
          });
          cursor = response.body.data.nextCursor;
          if (requestedLimit === undefined && offset === 0) firstCursor = cursor!;
        }
      }
      expect(await f.request(`${f.path}?limit=101`)).toEqual({
        status: 422,
        body: {
          error: { code: "VALIDATION_ERROR", message: "入力内容を確認してください。" },
          requestId: expect.any(String),
        },
      });
      await env.DB.prepare("DELETE FROM customer_memberships WHERE user_id=?").bind(f.id).run();
      const afterRemoval = await f.request(`${f.path}?cursor=${encodeURIComponent(firstCursor)}`);
      expect(afterRemoval).toEqual(
        kind === "customers"
          ? {
              status: 200,
              body: { data: { items: [], nextCursor: null }, requestId: expect.any(String) },
            }
          : {
              status: 404,
              body: {
                error: {
                  code: "NOT_FOUND",
                  message: "対象が見つからないか、閲覧権限がありません。",
                },
                requestId: expect.any(String),
              },
            },
      );
    },
  );
});
describe("customer and case lifecycle", () => {
  it("creates one customer and creator membership under concurrent retries", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const [one, two] = await Promise.all([
      f.customer("  匿名会社  ", key),
      f.customer("  匿名会社  ", key),
    ]);
    expect(one).toEqual(two);
    expect(one.name).toBe("匿名会社");
    expect((await f.request("/customers")).body.data.items).toEqual([one]);
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) AS n FROM customer_memberships WHERE user_id=? AND customer_id=?",
        )
          .bind(f.id, one.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect((await f.request("/customers", "POST", { name: "別名" }, key)).status).toBe(409);
  });
  it("creates a case and an 81-answer draft atomically, preserving missing scope and date", async () => {
    const f = await fixture(),
      customer = await f.customer(),
      key = crypto.randomUUID();
    const one = await f.request(
      `/customers/${customer.id}/cases`,
      "POST",
      { name: "初回診断", standardId: STANDARD_ID },
      key,
    );
    expect(one.status).toBe(201);
    expect(
      (
        await f.request(
          `/customers/${customer.id}/cases`,
          "POST",
          { name: "初回診断", standardId: STANDARD_ID },
          key,
        )
      ).body,
    ).toMatchObject({ data: one.body.data });
    const diagnosis = await f.request(`/assessments/${one.body.data.assessmentId}`);
    expect(diagnosis.status).toBe(200);
    const document = diagnosis.body.data.document;
    expect(Object.keys(document.responses)).toHaveLength(81);
    expect(
      Object.values(document.responses).every(
        (value: any) => value.status === "unanswered" && value.original === null,
      ),
    ).toBe(true);
    expect(document.scope).toEqual({ companies: "", sites: "", departments: "", systems: "" });
    expect(document.diagnosisDate).toBeNull();
  });
  it("rejects cross-customer reads and writes after membership removal", async () => {
    const f = await fixture(),
      other = await fixture(),
      customer = await f.customer();
    expect((await other.request(`/customers/${customer.id}`)).status).toBe(404);
    expect(
      (
        await other.request(`/customers/${customer.id}/cases`, "POST", {
          name: "不正",
          standardId: STANDARD_ID,
        })
      ).status,
    ).toBe(404);
    await env.DB.prepare("DELETE FROM customer_memberships WHERE customer_id=? AND user_id=?")
      .bind(customer.id, f.id)
      .run();
    expect((await f.request(`/customers/${customer.id}`)).status).toBe(404);
  });
  it("preserves read access to archived data and rejects new writes until restored", async () => {
    const f = await fixture(),
      customer = await f.customer();
    const created = await f.request(`/customers/${customer.id}/cases`, "POST", {
      name: "初回",
      standardId: STANDARD_ID,
    });
    expect(created.status).toBe(201);
    expect(
      (
        await f.request(`/customers/${customer.id}`, "PATCH", {
          expectedRevision: 1,
          mutationId: crypto.randomUUID(),
          archived: true,
        })
      ).status,
    ).toBe(200);
    expect((await f.request(`/assessments/${created.body.data.assessmentId}`)).status).toBe(200);
    expect(
      (
        await f.request(`/customers/${customer.id}/cases`, "POST", {
          name: "追加",
          standardId: STANDARD_ID,
        })
      ).body.error?.code,
    ).toBe("ARCHIVED");
    expect(
      (
        await f.request(`/customers/${customer.id}`, "PATCH", {
          expectedRevision: 1,
          mutationId: crypto.randomUUID(),
          name: "古い更新",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(`/customers/${customer.id}`, "PATCH", {
          expectedRevision: 2,
          mutationId: crypto.randomUUID(),
          archived: false,
        })
      ).status,
    ).toBe(200);
  });
  it("rolls back creation when the audit cannot be saved", async () => {
    const f = await fixture();
    await env.DB.exec(
      "CREATE TRIGGER fail_customer_audit BEFORE INSERT ON audit_events WHEN NEW.action='customer.create' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
    );
    try {
      expect((await f.request("/customers", "POST", { name: "保存失敗" })).status).toBe(500);
      expect((await f.request("/customers")).body.data.items).toEqual([]);
      expect(
        (
          await env.DB.prepare("SELECT count(*) AS n FROM operation_receipts WHERE actor_id=?")
            .bind(f.id)
            .first<{ n: number }>()
        )?.n,
      ).toBe(0);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_customer_audit;");
    }
  });
  it("rolls back the case, initial assessment, history and receipt together", async () => {
    const f = await fixture(),
      customer = await f.customer(),
      key = crypto.randomUUID();
    await env.DB.exec(
      "CREATE TRIGGER fail_case_audit BEFORE INSERT ON audit_events WHEN NEW.action='assessment.create' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
    );
    try {
      expect(
        (
          await f.request(
            `/customers/${customer.id}/cases`,
            "POST",
            { name: "保存失敗", standardId: STANDARD_ID },
            key,
          )
        ).status,
      ).toBe(500);
      for (const table of ["cases", "assessments"]) {
        expect(
          (
            await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE customer_id=?`)
              .bind(customer.id)
              .first<{ n: number }>()
          )?.n,
        ).toBe(0);
      }
      expect(
        (
          await env.DB.prepare("SELECT count(*) AS n FROM assessment_revisions WHERE actor_id=?")
            .bind(f.id)
            .first<{ n: number }>()
        )?.n,
      ).toBe(0);
      expect(
        (
          await env.DB.prepare(
            "SELECT count(*) AS n FROM operation_receipts WHERE actor_id=? AND operation_key=?",
          )
            .bind(f.id, key)
            .first<{ n: number }>()
        )?.n,
      ).toBe(0);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_case_audit;");
    }
  });
  it("paginates equal timestamps without duplicates and searches literal names", async () => {
    const f = await fixture(),
      names = ["会社100%", "会社_", "会社A", "会社B", "会社C"];
    const records = [];
    for (const name of names) records.push(await f.customer(name));
    await env.DB.prepare(
      "UPDATE customers SET updated_at='2026-09-19T00:00:00.000Z' WHERE created_by=?",
    )
      .bind(f.id)
      .run();
    const ids: string[] = [];
    let next: string | null = null;
    do {
      const result = await f.request(
        `/customers?limit=2${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
      );
      expect(result.status).toBe(200);
      ids.push(...result.body.data.items.map((row: { id: string }) => row.id));
      next = result.body.data.nextCursor;
    } while (next);
    expect(ids).toEqual(
      records
        .map((row) => row.id)
        .sort((a, b) => a.localeCompare(b))
        .reverse(),
    );
    expect((await f.request("/customers?q=%25")).body.data.items).toHaveLength(1);
    expect((await f.request("/customers?cursor=invalid")).status).toBe(422);
    expect((await f.request("/customers?limit=101")).status).toBe(422);
  });
  it("validates names, unsupported editions, calendar dates and scope limits", async () => {
    const f = await fixture();
    for (const name of ["   ", "あ".repeat(201)])
      expect((await f.request("/customers", "POST", { name })).status).toBe(422);
    const customer = await f.customer("😀".repeat(200));
    for (const input of [
      { name: "診断", standardId: "star4" },
      { name: "診断", standardId: STANDARD_ID, diagnosisDate: "2026-02-30" },
      { name: "診断", standardId: STANDARD_ID, customerId: crypto.randomUUID() },
      {
        name: "診断",
        standardId: STANDARD_ID,
        scope: { companies: "あ".repeat(2001), sites: "", departments: "", systems: "" },
      },
    ])
      expect((await f.request(`/customers/${customer.id}/cases`, "POST", input)).status).toBe(422);
    expect(
      (
        await f.request(`/customers/${customer.id}/cases`, "POST", {
          name: "予定診断",
          standardId: STANDARD_ID,
          diagnosisDate: "2099-12-31",
        })
      ).status,
    ).toBe(201);
  });
  it("blocks scope edits under an archived case and preserves no-op revisions", async () => {
    const f = await fixture(),
      customer = await f.customer();
    const created = (
      await f.request(`/customers/${customer.id}/cases`, "POST", {
        name: "診断",
        standardId: STANDARD_ID,
      })
    ).body.data;
    const input = {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      scope: { companies: "", sites: "", departments: "", systems: "" },
      diagnosisDate: null,
    };
    expect(
      (await f.request(`/assessments/${created.assessmentId}/scope`, "PATCH", input)).body.data
        .revision,
    ).toBe(1);
    await f.request(`/cases/${created.case.id}`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      archived: true,
    });
    expect(
      (
        await f.request(`/assessments/${created.assessmentId}/scope`, "PATCH", {
          ...input,
          mutationId: crypto.randomUUID(),
          diagnosisDate: "2026-09-19",
        })
      ).body.error?.code,
    ).toBe("ARCHIVED");
    expect((await f.request(`/assessments/${created.assessmentId}`)).body.data.revision).toBe(1);
    // Retrying a completed operation returns its prior result, even after archiving.
    expect(
      (await f.request(`/assessments/${created.assessmentId}/scope`, "PATCH", input)).body.data
        .revision,
    ).toBe(1);
  });
  it("updates all basis hashes for scope changes and rejects a stale revision without losing data", async () => {
    const f = await fixture(),
      customer = await f.customer();
    const created = await f.request(`/customers/${customer.id}/cases`, "POST", {
      name: "診断",
      standardId: STANDARD_ID,
    });
    const id = created.body.data.assessmentId,
      original = (await f.request(`/assessments/${id}`)).body.data;
    const input = {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      scope: { companies: "対象会社", sites: "本社", departments: "", systems: "" },
      diagnosisDate: "2026-09-19",
    };
    const changed = await f.request(`/assessments/${id}/scope`, "PATCH", input);
    expect(changed.status).toBe(200);
    expect(changed.body.data.revision).toBe(2);
    expect(
      Object.entries(changed.body.data.document.responses).every(
        ([key, value]: [string, any]) =>
          value.basisHash !== original.document.responses[key].basisHash,
      ),
    ).toBe(true);
    expect(
      (
        await f.request(`/assessments/${id}/scope`, "PATCH", {
          ...input,
          mutationId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
  });
});
