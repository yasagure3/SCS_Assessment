import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { STANDARD_ID } from "../../src/shared/contracts/assessment";
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
  const customer = await request("/customers", "POST", { name: "匿名取込社" });
  const created = await request(`/customers/${customer.body.data.id}/cases`, "POST", {
    name: "初回",
    standardId: STANDARD_ID,
  });
  const id = created.body.data.assessmentId as string;
  const reference = await request(`/standards/${STANDARD_ID}/import-master`);
  const normalized = {
    standardId: STANDARD_ID,
    fileName: "C:\\fakepath\\anonymous.xlsx",
    clientFileSha256: "c".repeat(64),
    masterContentSha256: reference.body.data?.masterContentSha256 ?? "0".repeat(64),
    star4Excluded: 72,
    rows: master.criteria.map((c, i) => ({
      criterionId: c.id,
      sheet: "匿名検証",
      row: i + 3,
      O: i < 24 ? "○" : i < 48 ? "△" : i < 76 ? "✖" : "",
      P: ` 匿名理由-${c.id}\n2行目 `,
      Q: `匿名根拠と作業-${c.id}`,
      R: `匿名補足-${c.id}`,
    })),
  };
  return { actorId, request, id, path: `/assessments/${id}/imports`, normalized };
}
describe("Excel import API", () => {
  it("returns 413 before previewing a payload whose originals plus editable copy exceed 1MiB", async () => {
    const f = await fixture();
    for (const row of f.normalized.rows) row.P = "a".repeat(7000);
    expect(
      (
        await f.request(`${f.path}/preview`, "POST", {
          expectedRevision: 1,
          normalized: f.normalized,
        })
      ).status,
    ).toBe(413);
    expect((await f.request(`/assessments/${f.id}`)).body.data.revision).toBe(1);
  });
  it("rolls back the document, history, receipt and audit on a failing batch and allows a clean retry", async () => {
    const f = await fixture(),
      before = (await f.request(`/assessments/${f.id}`)).body.data;
    const p = await f.request(`${f.path}/preview`, "POST", {
      expectedRevision: 1,
      normalized: f.normalized,
    });
    const body = {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      normalized: f.normalized,
      normalizedSha256: p.body.data.normalizedSha256,
      acknowledgedMissingIds: [],
    };
    const trigger = `fail_import_${f.id.replaceAll("-", "")}`;
    await env.DB.exec(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events WHEN NEW.action='assessment.import' AND NEW.resource_id='${f.id}' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;`,
    );
    expect((await f.request(f.path, "POST", body)).status).toBe(500);
    expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(before);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM operation_receipts WHERE actor_id=? AND operation_key=?",
      )
        .bind(f.actorId, body.mutationId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM assessment_revisions WHERE assessment_id=?",
      )
        .bind(f.id)
        .first(),
    ).toEqual({ count: 1 });
    await env.DB.exec(`DROP TRIGGER ${trigger}`);
    expect((await f.request(f.path, "POST", body)).status).toBe(200);
  });
  it("shows ×/✕ normalization explicitly while keeping raw whitespace and symbols", async () => {
    const f = await fixture();
    f.normalized.rows[0].O = " × ";
    f.normalized.rows[1].O = "✕";
    const p = await f.request(`${f.path}/preview`, "POST", {
      expectedRevision: 1,
      normalized: f.normalized,
    });
    expect(p.status).toBe(200);
    expect(p.body.data.warnings).toEqual(
      f.normalized.rows
        .slice(0, 2)
        .map((r) => ({ code: "STATUS_NORMALIZED_TO_NO", sheet: r.sheet, row: r.row, column: "O" })),
    );
    expect(p.body.data.counts).toEqual({
      yes: 22,
      uncertain: 24,
      no: 30,
      unanswered: 5,
      total: 81,
    });
    const saved = await f.request(f.path, "POST", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      normalized: f.normalized,
      normalizedSha256: p.body.data.normalizedSha256,
      acknowledgedMissingIds: [],
    });
    expect(saved.status).toBe(200);
    expect(
      saved.body.data.assessment.document.responses[f.normalized.rows[0].criterionId].original.O,
    ).toBe(" × ");
  });
  it("gives only one concurrent distinct-key import a revision and rejects oversized normalized payloads", async () => {
    const f = await fixture();
    const p = await f.request(`${f.path}/preview`, "POST", {
      expectedRevision: 1,
      normalized: f.normalized,
    });
    const body = {
      expectedRevision: 1,
      normalized: f.normalized,
      normalizedSha256: p.body.data.normalizedSha256,
      acknowledgedMissingIds: [],
    };
    expect(
      (
        await Promise.all([
          f.request(f.path, "POST", { ...body, mutationId: crypto.randomUUID() }),
          f.request(f.path, "POST", { ...body, mutationId: crypto.randomUUID() }),
        ])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b),
    ).toEqual([200, 409]);
    const huge = await fixture();
    for (const row of huge.normalized.rows) {
      row.P = "文".repeat(8000);
      row.Q = "書".repeat(8000);
    }
    expect(
      (
        await huge.request(`${huge.path}/preview`, "POST", {
          expectedRevision: 1,
          normalized: huge.normalized,
        })
      ).status,
    ).toBe(413);
    expect((await huge.request(`/assessments/${huge.id}`)).body.data.revision).toBe(1);
  });
  it("previews without writing then imports 81 originals atomically and replays the same receipt", async () => {
    const f = await fixture();
    const before = (await f.request(`/assessments/${f.id}`)).body.data;
    const preview = await f.request(`${f.path}/preview`, "POST", {
      expectedRevision: 1,
      normalized: f.normalized,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toEqual({
      revision: 1,
      normalizedSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      counts: { yes: 24, uncertain: 24, no: 28, unanswered: 5, total: 81 },
      missingIds: [],
      warnings: [],
      errors: [],
      canCommit: true,
    });
    expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(before);
    const body = {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      normalized: f.normalized,
      normalizedSha256: preview.body.data.normalizedSha256,
      acknowledgedMissingIds: [],
    };
    const [a, b] = await Promise.all([
      f.request(f.path, "POST", body),
      f.request(f.path, "POST", body),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data).toEqual(b.body.data);
    const saved = a.body.data.assessment;
    expect(saved.revision).toBe(2);
    expect(a.body.data.counts).toEqual(preview.body.data.counts);
    for (const row of f.normalized.rows) {
      const { criterionId, ...original } = row;
      expect(saved.document.responses[criterionId]).toEqual({
        ...before.document.responses[criterionId],
        original,
        status:
          row.O === "○" ? "yes" : row.O === "△" ? "uncertain" : row.O === "✖" ? "no" : "unanswered",
        reason: row.P,
        basis: row.Q,
        supplement: row.R,
        adviceBasisVersion: 2,
        basisHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    }
    expect(saved.document.importInfo).toEqual({
      fileName: "anonymous.xlsx",
      clientFileSha256: "c".repeat(64),
      normalizedSha256: preview.body.data.normalizedSha256,
      importedBy: f.actorId,
      importedAt: expect.any(String),
      star4Excluded: 72,
      missingIds: [],
    });
    expect(
      (
        await f.request(f.path, "POST", {
          ...body,
          mutationId: crypto.randomUUID(),
          expectedRevision: 2,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(f.path, "POST", {
          ...body,
          normalized: { ...f.normalized, fileName: "different.xlsx" },
        })
      ).status,
    ).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM assessment_revisions WHERE assessment_id=?",
      )
        .bind(f.id)
        .first(),
    ).toEqual({ count: 2 });
  });
  it("requires exact missing-ID acknowledgement and preserves missing originals as null", async () => {
    const f = await fixture(),
      removed = f.normalized.rows.shift()!;
    const preview = await f.request(`${f.path}/preview`, "POST", {
      expectedRevision: 1,
      normalized: f.normalized,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.missingIds).toEqual([removed.criterionId]);
    const body = {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      normalized: f.normalized,
      normalizedSha256: preview.body.data.normalizedSha256,
      acknowledgedMissingIds: [],
    };
    expect((await f.request(f.path, "POST", body)).status).toBe(422);
    const committed = await f.request(f.path, "POST", {
      ...body,
      acknowledgedMissingIds: [removed.criterionId],
    });
    expect(committed.status).toBe(200);
    expect(committed.body.data.assessment.document.responses[removed.criterionId].original).toBe(
      null,
    );
    expect(committed.body.data.counts).toEqual({
      yes: 23,
      uncertain: 24,
      no: 28,
      unanswered: 6,
      total: 81,
    });
  });
  it.each([
    "unknown",
    "duplicate",
    "type",
    "formula",
    "row",
    "version",
    "hash",
    "status",
    "prototype-status",
  ])(
    "rejects forged %s JSON on preview and direct commit with no partial changes",
    async (kind) => {
      const f = await fixture(),
        original = structuredClone(f.normalized);
      const good = await f.request(`${f.path}/preview`, "POST", {
        expectedRevision: 1,
        normalized: original,
      });
      const row = f.normalized.rows[0];
      if (kind === "unknown") row.criterionId = "99-99-99-99";
      if (kind === "duplicate") f.normalized.rows[1].criterionId = row.criterionId;
      if (kind === "type") Object.assign(row, { Q: 42 });
      if (kind === "formula") Object.assign(row, { P: { formula: "1+1", result: "cached" } });
      if (kind === "row") row.row = 2001;
      if (kind === "version") f.normalized.standardId = "other";
      if (kind === "hash") f.normalized.masterContentSha256 = "a".repeat(64);
      if (kind === "status") row.O = "OK";
      if (kind === "prototype-status") row.O = "toString";
      const before = (await f.request(`/assessments/${f.id}`)).body.data;
      expect(
        (
          await f.request(`${f.path}/preview`, "POST", {
            expectedRevision: 1,
            normalized: f.normalized,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await f.request(f.path, "POST", {
            expectedRevision: 1,
            mutationId: crypto.randomUUID(),
            normalized: f.normalized,
            normalizedSha256: good.body.data?.normalizedSha256 ?? "a".repeat(64),
            acknowledgedMissingIds: [],
          })
        ).status,
      ).toBe(422);
      expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(before);
    },
  );
  it("rejects concurrent manual edits, stale revisions, another customer's access and mismatching preview hashes", async () => {
    const f = await fixture(),
      other = await fixture();
    const preview = await f.request(`${f.path}/preview`, "POST", {
      expectedRevision: 1,
      normalized: f.normalized,
    });
    const body = {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      normalized: f.normalized,
      normalizedSha256: preview.body.data?.normalizedSha256 ?? "0".repeat(64),
      acknowledgedMissingIds: [],
    };
    expect((await other.request(f.path, "POST", body)).status).toBe(404);
    expect(
      (await f.request(f.path, "POST", { ...body, normalizedSha256: "0".repeat(64) })).status,
    ).toBe(422);
    expect(
      (
        await f.request(`/assessments/${f.id}/responses/${master.criteria[0].id}`, "PATCH", {
          expectedRevision: 1,
          mutationId: crypto.randomUUID(),
          status: "unanswered",
          reason: "",
          basis: "",
          plannedWork: "",
          supplement: "",
        })
      ).status,
    ).toBe(200);
    const before = (await f.request(`/assessments/${f.id}`)).body.data;
    expect((await f.request(f.path, "POST", body)).status).toBe(409);
    expect((await f.request(f.path, "POST", { ...body, expectedRevision: 2 })).status).toBe(409);
    expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(before);
  });
});
