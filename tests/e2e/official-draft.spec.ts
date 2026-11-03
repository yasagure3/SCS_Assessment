import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import sourceRows from "../../src/server/db/seed/scs-20260327-import.json" with { type: "json" };
import catalog from "../../src/shared/data/official-scs-v1.1.json" with { type: "json" };
import type { OfficialAnswers } from "../../src/shared/contracts/officialAssessment";

test("drafts imported O:R into empty official fields, protects existing edits, and saves after review", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  expect((await request.post("/__fixture/reset?role=admin")).ok()).toBe(true);
  let token = "";
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  async function login() {
    await page.getByLabel("メールアドレス").fill("fixture@example.invalid");
    await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await page.getByLabel("新しいパスワード").fill("NewPassword123!");
    await page.getByRole("button", { name: "パスワードを変更" }).click();
    await page.getByLabel("認証コード").fill("123456");
    await page.getByRole("button", { name: "認証する" }).click();
    await expect(page.getByRole("link", { name: "顧客・案件を開く" })).toBeVisible();
  }
  await page.goto("/customers");
  await login();
  const headers = { Authorization: token, "Idempotency-Key": crypto.randomUUID() };
  const customer = await request.post("/api/v1/customers", {
    headers,
    data: { name: "公式下書き検証株式会社" },
  });
  const { data: c } = await customer.json();
  const created = await request.post(`/api/v1/customers/${c.id}/cases`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "下書きの確認・修正", standardId: "scs-20261028-v1.1-star3" },
  });
  expect(created.status()).toBe(201);
  const { data: original } = await created.json();
  const rows = [...sourceRows].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const workbook = {
    fileName: "draft-fixture.xlsx",
    fileSha256: "a".repeat(64),
    sheet: "自己評価",
    headerRow: 4,
    masterRows: rows.map((r, i) => ({
      id: r.id,
      level: r.level,
      sourceRow: i + 5,
      publicCells: r.publicCells,
    })),
    answers: rows
      .filter((r) => r.level === "★3")
      .map((r, i) => ({
        criterionId: r.id,
        sheet: "自己評価",
        row: rows.indexOf(r) + 5,
        O: ["○", "△", "✖", "-"][i % 4],
        P: `理由 ${r.id}`,
        Q: `根拠 ${r.id}`,
        R: `補足 ${r.id}`,
      })),
  };
  const path = `/api/v1/assessments/${original.assessmentId}/master-imports`;
  const preview = await request.post(`${path}/preview`, {
    headers,
    data: { expectedRevision: 1, workbook },
  });
  expect(preview.status()).toBe(200);
  const imported = await request.post(path, {
    headers,
    data: {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      workbook,
      previewSha256: (await preview.json()).data.previewSha256,
    },
  });
  expect(imported.status()).toBe(201);
  const id = (await imported.json()).data.assessmentId;
  const base = `/assessments/${id}`;
  const existing: OfficialAnswers = {
    standardId: "scs-20261028-v1.1-star3",
    templateSha256: catalog.template.sha256,
    organization: { name: "", address: "", unit: "", scope: "" },
    scopeAnswers: Object.fromEntries(catalog.scopeQuestions.map((q) => [q.id, ""])),
    criteria: Object.fromEntries(
      catalog.standard.criteria.map((c) => [c.id, { excluded: false, exclusionReason: "" }]),
    ),
    rows: Object.fromEntries(catalog.rows.map((r) => [r.key, { result: "", answer: "" }])),
  };
  existing.organization.name = "保存済みの登録組織";
  existing.scopeAnswers["2."] = "保存済みの適用範囲";
  existing.rows["1-2-1-1:1"] = { result: "不適合", answer: "保存済みの公式回答\n原文を保持" };
  existing.criteria["1-2-1-3"] = { excluded: true, exclusionReason: "確認済みの対象外理由" };
  expect(
    (
      await request.patch(`/api/v1${base}/official-assessment`, {
        headers,
        data: { expectedRevision: 1, mutationId: crypto.randomUUID(), answers: existing },
      })
    ).status(),
  ).toBe(200);
  const before = (await (await request.get(`/api/v1${base}`, { headers })).json()).data;
  async function openOfficial() {
    await page.getByRole("link", { name: "顧客・案件を開く" }).click();
    await page.locator(`a[href="/customers/${c.id}"]`).click();
    await page.locator(`a[href="/cases/${original.case.id}"]`).click();
    await page.locator(`a[href="${base}"]`).click();
    await page.getByRole("link", { name: "公式シート回答・Excel出力", exact: true }).click();
  }
  await openOfficial();
  await page.getByLabel("入力する項目").selectOption("1-2-1-2");
  await page.getByLabel("質問への回答 1", { exact: true }).fill("画面で入力途中の回答");
  await page.getByRole("button", { name: "空欄に下書きを作成" }).click();
  await expect(page.getByRole("status")).toContainText("下書きを作成しました");
  await expect(page.getByRole("button", { name: "公式回答を保存", exact: true })).toBeDisabled();
  await expect(page.getByLabel("質問への回答 1", { exact: true })).toHaveValue(
    "画面で入力途中の回答",
  );
  await expect(page.getByRole("combobox", { name: "自己評価結果 1", exact: true })).toHaveValue("");
  await page.getByLabel("入力する項目").selectOption("1-2-1-1");
  await expect(page.getByLabel("質問への回答 1", { exact: true })).toHaveValue(
    existing.rows["1-2-1-1:1"].answer,
  );
  await expect(page.getByRole("combobox", { name: "自己評価結果 1", exact: true })).toHaveValue(
    "不適合",
  );
  await expect(page.getByRole("combobox", { name: "自己評価結果 2", exact: true })).toHaveValue(
    "適合",
  );
  await page.getByLabel("確認する下書き", { exact: true }).selectOption("4-4-4-1");
  const answer = page.getByLabel("質問への回答 1", { exact: true });
  await expect(answer).toHaveValue(/理由 4-4-4-1/);
  await expect(answer).toHaveValue(/根拠 4-4-4-1/);
  await expect(answer).toHaveValue(/補足 4-4-4-1/);
  const unchanged = (await (await request.get(`/api/v1${base}`, { headers })).json()).data;
  expect(unchanged.document.officialAnswers).toEqual(existing); // Generation has not saved anything.
  await answer.fill("端末管理台帳とサポート期限一覧（確認して修正した回答）");
  await mkdir(".local/official-draft-validation", { recursive: true });
  await page.evaluate("document.activeElement?.blur()");
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/official-draft-validation/desktop.png", fullPage: true });
  await page.getByLabel("作成した下書きを各質問・適合基準に照らして確認・修正しました").check();
  await page.getByRole("button", { name: "公式回答を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  const after = (await (await request.get(`/api/v1${base}`, { headers })).json()).data;
  expect(after.document.officialAnswers.rows["1-2-1-1:1"]).toEqual(existing.rows["1-2-1-1:1"]);
  expect(after.document.officialAnswers.organization).toEqual(existing.organization);
  expect(after.document.officialAnswers.scopeAnswers).toEqual(existing.scopeAnswers);
  expect(after.document.officialAnswers.criteria).toEqual(existing.criteria);
  expect(after.document.officialAnswers.rows["1-2-1-2:1"].answer).toBe("画面で入力途中の回答");
  expect(after.document.officialAnswers.rows["4-4-4-1:1"].answer).toBe(
    "端末管理台帳とサポート期限一覧（確認して修正した回答）",
  );
  // Official edits refresh advice hashes; the imported and edited source answers stay intact.
  for (const criterionId of Object.keys(before.document.responses)) {
    for (const field of [
      "original",
      "status",
      "reason",
      "basis",
      "supplement",
      "plannedWork",
      "manualEdited",
    ])
      expect(after.document.responses[criterionId][field]).toEqual(
        before.document.responses[criterionId][field],
      );
  }
  await page.reload();
  await login();
  await openOfficial();
  await expect(page.getByRole("button", { name: "空欄に下書きを作成" })).toBeDisabled();
  await page.getByLabel("入力する項目").selectOption("4-4-4-1");
  await expect(page.getByLabel("質問への回答 1", { exact: true })).toHaveValue(
    "端末管理台帳とサポート期限一覧（確認して修正した回答）",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/official-draft-validation/mobile.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
});
