import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import {
  OFFICIAL_STANDARD_ID,
  emptyOfficialAnswers,
} from "../../src/shared/contracts/officialAssessment";
import sourceRows from "../../src/server/db/seed/scs-20260327-import.json";
const rows = [...sourceRows].sort((a, b) => {
  const x = a.id.split("-").map(Number),
    y = b.id.split("-").map(Number);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
});
import type { MasterWorkbook } from "../../src/shared/contracts/masterImport";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
async function fixture(role = "admin") {
  const actorId = crypto.randomUUID(),
    sub = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)",
  )
    .bind(actorId, sub, `${actorId}@example.invalid`, role, now, now)
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
  const customer = await request("/customers", "POST", { name: "マスタ検証" });
  const created = await request(`/customers/${customer.body.data.id}/cases`, "POST", {
    name: "検証案件",
    standardId: OFFICIAL_STANDARD_ID,
  });
  const id = created.body.data.assessmentId as string;
  const workbook: MasterWorkbook = {
    fileName: "anonymous.xlsx",
    fileSha256: "a".repeat(64),
    sheet: "自己評価",
    headerRow: 4,
    masterRows: rows.map((r, i) => ({
      ...r,
      publicCells: { ...r.publicCells },
      level: r.level as "★3" | "★4",
      sourceRow: i + 5,
    })),
    answers: rows
      .filter((r) => r.level === "★3")
      .map((r, i) => ({
        criterionId: r.id,
        sheet: "自己評価",
        row: rows.indexOf(r) + 5,
        O: i < 24 ? "○" : i < 48 ? "△" : i < 76 ? "✖" : "-",
        P: `理由 ${r.id}\n `,
        Q: `根拠 ${r.id}`,
        R: `補足 ${r.id}`,
      })),
  };
  workbook.masterRows.find((r) => r.id === "4-4-4-1")!.publicCells["13"] = "変更後の評価基準1";
  workbook.masterRows.find((r) => r.id === "4-4-4-2")!.publicCells["13"] = "変更後の評価基準2";
  const path = `/assessments/${id}/master-imports`;
  return { actorId, request, id, path, workbook, caseId: created.body.data.case.id };
}
describe("master import", () => {
  it("previews diffs and atomically creates an immutable master plus new answers, preserving existing answers/history", async () => {
    const f = await fixture();
    const edited = await f.request(`/assessments/${f.id}/responses/1-2-1-1`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      status: "yes",
      reason: "保持する既存理由",
      basis: "既存根拠",
      plannedWork: "",
      supplement: "既存補足",
    });
    expect(edited.status).toBe(200);
    const before = (await f.request(`/assessments/${f.id}`)).body.data;
    const input = { expectedRevision: before.revision, workbook: f.workbook };
    const p = await f.request(`${f.path}/preview`, "POST", input);
    expect(p.status).toBe(200);
    expect(p.body.data.diff).toMatchObject({ added: [], removed: [], unchanged: 79 });
    expect(p.body.data.diff.changed.map((r: { id: string }) => r.id)).toEqual([
      "4-4-4-1",
      "4-4-4-2",
    ]);
    expect(p.body.data.counts).toEqual({
      yes: 24,
      uncertain: 24,
      no: 28,
      unanswered: 5,
      total: 81,
    });
    expect(p.body.data.dashCount).toBe(5);
    const command = {
      ...input,
      mutationId: crypto.randomUUID(),
      previewSha256: p.body.data.previewSha256,
    };
    const saved = await f.request(f.path, "POST", command);
    expect(saved.status).toBe(201);
    const imported = (await f.request(`/assessments/${saved.body.data.assessmentId}`)).body.data;
    expect(imported.revision).toBe(1);
    expect(imported.document.officialAnswers).toBeUndefined();
    for (const row of f.workbook.answers)
      expect(imported.document.responses[row.criterionId]).toMatchObject({
        original: { sheet: row.sheet, row: row.row, O: row.O, P: row.P, Q: row.Q, R: row.R },
        reason: row.P,
        basis: row.Q,
        supplement: row.R,
      });
    expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(before);
    expect((await f.request(f.path, "POST", command)).body.data).toEqual(saved.body.data);
    const master = (await f.request(`/standards/${saved.body.data.standardId}`)).body.data;
    expect(master.criteria.find((c: { id: string }) => c.id === "4-4-4-1").officialText).toBe(
      "変更後の評価基準1",
    );
    await expect(
      env.DB.prepare("UPDATE criteria SET official_text='overwrite' WHERE standard_id=?")
        .bind(saved.body.data.standardId)
        .run(),
    ).rejects.toThrow();
    const answer = imported.document.responses["1-2-1-1"];
    const update = await f.request(`/assessments/${imported.id}/responses/1-2-1-1`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      status: "uncertain",
      reason: "保存確認",
      basis: answer.basis,
      plannedWork: "",
      supplement: answer.supplement,
    });
    expect(update.status).toBe(200);
    const reloaded = (await f.request(`/assessments/${imported.id}`)).body.data;
    expect(reloaded.document.responses["1-2-1-1"].reason).toBe("保存確認");
    expect(reloaded.document.responses["1-2-1-1"].original).toEqual(answer.original);
    const official = emptyOfficialAnswers();
    official.organization.name = "公式清書の保存検証";
    const clean = await f.request(`/assessments/${imported.id}/official-assessment`, "PATCH", {
      expectedRevision: reloaded.revision,
      mutationId: crypto.randomUUID(),
      answers: official,
    });
    expect(clean.status).toBe(200);
    expect(clean.body.data.document.responses["1-2-1-1"].original).toEqual(answer.original);
    expect(clean.body.data.document.responses["1-2-1-1"].reason).toBe("保存確認");
    expect((await f.request(`/assessments/${f.id}`)).body.data).toEqual(before);
  });
  it("rejects staff, stale previews and changed preview payloads", async () => {
    const staff = await fixture("staff");
    expect(
      (
        await staff.request(`${staff.path}/preview`, "POST", {
          expectedRevision: 1,
          workbook: staff.workbook,
        })
      ).status,
    ).toBe(403);
    expect((await staff.request(staff.path, "POST", {})).status).toBe(403);
    const f = await fixture();
    expect(
      (await f.request(`${f.path}/preview`, "POST", { expectedRevision: 2, workbook: f.workbook }))
        .status,
    ).toBe(409);
    const p = await f.request(`${f.path}/preview`, "POST", {
      expectedRevision: 1,
      workbook: f.workbook,
    });
    f.workbook.answers[0].P = "tampered";
    expect(
      (
        await f.request(f.path, "POST", {
          expectedRevision: 1,
          workbook: f.workbook,
          mutationId: crypto.randomUUID(),
          previewSha256: p.body.data.previewSha256,
        })
      ).status,
    ).toBe(422);
  });
  it("rejects duplicate rows, mismatched answers and incomplete masters", async () => {
    const f = await fixture();
    const call = (workbook: MasterWorkbook) =>
      f.request(`${f.path}/preview`, "POST", { expectedRevision: 1, workbook });
    const duplicate = structuredClone(f.workbook);
    duplicate.masterRows.push(duplicate.masterRows[0]);
    expect((await call(duplicate)).status).toBe(422);
    const mismatch = structuredClone(f.workbook);
    mismatch.answers[0].row = 1999;
    expect((await call(mismatch)).status).toBe(422);
    const missing = structuredClone(f.workbook);
    missing.masterRows = missing.masterRows.filter((r) => r.id !== missing.answers[0].criterionId);
    missing.answers.shift();
    expect((await call(missing)).body.data).toMatchObject({
      canCommit: false,
      diff: { removed: expect.arrayContaining([expect.objectContaining({ id: "1-2-1-1" })]) },
    });
  });
  it("rolls back every write if the audit fails and rejects archived cases", async () => {
    const f = await fixture();
    const input = { expectedRevision: 1, workbook: f.workbook };
    const preview = (await f.request(`${f.path}/preview`, "POST", input)).body.data;
    const command = {
      ...input,
      mutationId: crypto.randomUUID(),
      previewSha256: preview.previewSha256,
    };
    const count = () => env.DB.prepare("SELECT count(*) AS n FROM standards").first();
    const before = await count();
    const trigger = `fail_master_${f.id.replaceAll("-", "")}`;
    await env.DB.exec(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events WHEN NEW.action='standard.import' AND NEW.actor_id='${f.actorId}' BEGIN SELECT RAISE(ABORT,'rollback'); END;`,
    );
    expect((await f.request(f.path, "POST", command)).status).toBe(500);
    expect(await count()).toEqual(before);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM operation_receipts WHERE actor_id=? AND operation_key=?",
      )
        .bind(f.actorId, command.mutationId)
        .first(),
    ).toEqual({ n: 0 });
    await env.DB.exec(`DROP TRIGGER ${trigger}`);
    expect((await f.request(f.path, "POST", command)).status).toBe(201);
    await env.DB.prepare("UPDATE cases SET archived_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.caseId)
      .run();
    expect(
      (await f.request(f.path, "POST", { ...command, mutationId: crypto.randomUUID() })).status,
    ).toBe(409);
  });
});
