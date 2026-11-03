import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import ExcelJS from "exceljs";
import sourceRows from "../../src/server/db/seed/scs-20260327-import.json" with { type: "json" };
import { parseMasterWorkbook } from "../../src/front/workers/parseMasterWorkbook";

test("imports a master and O:R through the UI, preserves old answers, and saves/reloads the new assessment", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const source = process.env.SCS_MASTER_XLSX;
  const outputDir = source ? ".local/master-import-actual" : ".local/master-import-regression";
  const book = new ExcelJS.Workbook();
  if (source) await book.xlsx.load(new Uint8Array(await readFile(source)).buffer);
  else {
    const sheet = book.addWorksheet("匿名検証");
    const rows = [...sourceRows].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    let index = 0;
    rows.forEach((row, i) => {
      for (const [col, value] of Object.entries(row.publicCells))
        sheet.getCell(i + 3, Number(col)).value = value;
      if (row.level === "★3") {
        sheet.getCell(`O${i + 3}`).value =
          index < 24 ? "○" : index < 48 ? "△" : index < 76 ? "✖" : "-";
        sheet.getCell(`P${i + 3}`).value = `匿名理由 ${row.id}`;
        sheet.getCell(`Q${i + 3}`).value = `匿名根拠 ${row.id}`;
        sheet.getCell(`R${i + 3}`).value = `匿名補足 ${row.id}`;
        index++;
      }
    });
    for (const [col, label] of Object.entries({
      K: "★3/★4",
      L: "評価基準No.",
      M: "評価基準",
      O: "自己評価",
      P: "理由",
      Q: "根拠および実施する事",
      R: "補足情報",
    }))
      sheet.getCell(`${col}2`).value = label;
    for (const [col, label] of Object.entries({
      B: "大分類No.",
      C: "大分類",
      D: "中分類No.",
      E: "中分類",
      F: "要求事項No.",
      G: "★3",
      H: "★4",
      I: "要求事項名",
      J: "要求事項",
      N: "NIST CSFにおける機能",
    }))
      sheet.getCell(`${col}2`).value = label;
    for (let r = 3; r <= sheet.rowCount; r++) {
      if (sheet.getCell(`L${r}`).text === "4-4-4-1" || sheet.getCell(`L${r}`).text === "4-4-4-2")
        sheet.getCell(`M${r}`).value = "改訂された評価基準の検証文";
      if (sheet.getCell(`K${r}`).text === "★3" && !sheet.getCell(`O${r}`).text)
        sheet.getCell(`O${r}`).value = "-";
    }
  }
  const expected = parseMasterWorkbook(book);
  expect(expected.errors).toEqual([]);
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
  const headers = { Authorization: token };
  const customer = await request.post("/api/v1/customers", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { name: source ? "自己評価Excel取込・開発検証" : "匿名マスタ検証" },
  });
  const { data: c } = await customer.json();
  const created = await request.post(`/api/v1/customers/${c.id}/cases`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "SCS Ver.1.1 取込確認", standardId: "scs-20261028-v1.1-star3" },
  });
  expect(created.status()).toBe(201);
  const { data: old } = await created.json();
  const first = expected.answers[0].criterionId;
  const edit = await request.patch(`/api/v1/assessments/${old.assessmentId}/responses/${first}`, {
    headers,
    data: {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      status: "yes",
      reason: "保護対象の既存回答",
      basis: "既存根拠",
      plannedWork: "",
      supplement: "既存補足",
    },
  });
  expect(edit.status()).toBe(200);
  const before = await (
    await request.get(`/api/v1/assessments/${old.assessmentId}`, { headers })
  ).json();
  async function openAssessment(id: string) {
    await page.getByRole("link", { name: "顧客・案件を開く" }).click();
    await page.locator(`a[href="/customers/${c.id}"]`).click();
    await page.locator(`a[href="/cases/${old.case.id}"]`).click();
    await page.locator(`a[href="/assessments/${id}"]`).click();
  }
  await openAssessment(old.assessmentId);
  await page.getByRole("link", { name: "自己評価Excel取込", exact: true }).click();
  if (source) await page.getByLabel("評価項目マスタのExcel").setInputFiles(source);
  else
    await page.getByLabel("評価項目マスタのExcel").setInputFiles({
      name: "anonymous.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await book.xlsx.writeBuffer()),
    });
  await expect(page.getByRole("heading", { name: "取込内容とマスタ差分" })).toBeVisible();
  await expect(page.getByText("追加 0件・変更 2件・削除候補 0件・変更なし 79件")).toBeVisible();
  await page.getByLabel("差分を確認し、新しいマスタ版と診断を作成します").check();
  const savedResponse = page.waitForResponse(
    (r) => r.url().endsWith("/master-imports") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "マスタと自己評価を取り込む" }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(201);
  const { data: result } = await saved.json();
  await page.getByRole("link", { name: "取り込んだ診断のダッシュボードを開く" }).click();
  await expect(page.getByRole("heading", { name: "診断の現状" })).toBeVisible();
  const snapshot = await (
    await request.get(`/api/v1/assessments/${result.assessmentId}`, { headers })
  ).json();
  expect(snapshot.data.counts).toEqual({
    yes: 24,
    uncertain: 24,
    no: 28,
    unanswered: 5,
    total: 81,
  });
  for (const row of expected.answers) {
    const response = snapshot.data.document.responses[row.criterionId];
    expect(response.original).toEqual({
      sheet: row.sheet,
      row: row.row,
      O: row.O,
      P: row.P,
      Q: row.Q,
      R: row.R,
    });
    expect([response.reason, response.basis, response.supplement]).toEqual([row.P, row.Q, row.R]);
  }
  const master = await (
    await request.get(`/api/v1/standards/${result.standardId}`, { headers })
  ).json();
  for (const row of expected.masterRows.filter((r) => r.level === "★3"))
    expect(master.data.criteria.find((c: { id: string }) => c.id === row.id).officialText).toBe(
      row.publicCells["13"],
    );
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await expect(page.getByRole("heading", { name: "評価基準一覧", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "4-4-4-1 詳細", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "取込評価基準 · 4-4-4-1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(expected.masterRows.find((r) => r.id === "4-4-4-1")!.publicCells["13"], {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByRole("link", { name: `${first} 詳細`, exact: true }).click();
  await expect(page.getByLabel("判定理由・確認メモ", { exact: true })).toHaveValue(
    expected.answers[0].P,
  );
  const temporary = expected.answers[0].P + "\n保存・再表示の検証";
  await page.getByLabel("判定理由・確認メモ", { exact: true }).fill(temporary);
  const changed = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/responses/${first}`),
  );
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  expect((await changed).status()).toBe(200);
  await page.reload();
  await login();
  await openAssessment(result.assessmentId);
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByRole("link", { name: `${first} 詳細`, exact: true }).click();
  await expect(page.getByLabel("判定理由・確認メモ", { exact: true })).toHaveValue(temporary);
  // Restore the exact imported text through the same save control.
  await page.getByLabel("判定理由・確認メモ", { exact: true }).fill(expected.answers[0].P);
  const restore = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/responses/${first}`),
  );
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  expect((await restore).status()).toBe(200);
  await page.getByRole("link", { name: "公式シート回答・Excel出力", exact: true }).click();
  await page.getByLabel("入力する項目").selectOption(first);
  await expect(page.getByText("清書用の自己評価・理由・根拠・補足", { exact: true })).toBeVisible();
  expect(
    (await (await request.get(`/api/v1/assessments/${old.assessmentId}`, { headers })).json()).data,
  ).toEqual(before.data);
  await mkdir(outputDir, { recursive: true });
  await page.getByRole("link", { name: "現状ダッシュボード", exact: true }).click();
  await expect(page.getByRole("heading", { name: "診断の現状" })).toBeVisible();
  await page.screenshot({ path: `${outputDir}/dashboard.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "自己評価Excel取込", exact: true }).click();
  await expect(page.getByRole("heading", { name: "自己評価Excelを選択" })).toBeVisible();
  await page.screenshot({ path: `${outputDir}/mobile.png`, fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await writeFile(
    `${outputDir}/result.json`,
    JSON.stringify(
      {
        source: source ? basename(source) : "synthetic",
        ...result,
        oldAssessmentId: old.assessmentId,
        caseId: old.case.id,
        customerId: c.id,
        originalCellsCompared: expected.answers.length * 4,
        masterRowsCompared: 81,
        oldAssessmentUnchanged: true,
        saveReloadVerified: true,
        restoredImportedText: true,
      },
      null,
      2,
    ),
  );
});
