import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test("saves official answers, reloads them, and downloads the filled original template", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  expect((await request.post("/__fixture/reset")).ok()).toBe(true);
  let token = "";
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  await page.goto("/customers");
  await page.getByLabel("メールアドレス").fill("fixture@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("link", { name: "顧客・案件を開く" })).toBeVisible();
  const headers = { Authorization: token, "Idempotency-Key": crypto.randomUUID() };
  const customer = await request.post("/api/v1/customers", {
    headers,
    data: { name: "公式Excel検証株式会社" },
  });
  const { data: c } = await customer.json();
  const created = await request.post(`/api/v1/customers/${c.id}/cases`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "公式シート検証", standardId: "scs-20261028-v1.1-star3" },
  });
  expect(created.status()).toBe(201);
  const { data } = await created.json();
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${c.id}"]`).click();
  await page.locator(`a[href="/cases/${data.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${data.assessmentId}"]`).click();
  await page.getByRole("link", { name: "公式シート回答・Excel出力", exact: true }).click();
  await page.getByLabel("登録組織の名称", { exact: true }).fill("公式Excel検証株式会社");
  await page.getByLabel("登録組織の住所", { exact: true }).fill("東京都千代田区（検証用）");
  await page.getByLabel("取得単位", { exact: true }).fill("法人全体");
  await page.getByLabel("適用範囲", { exact: true }).fill("本社のIT基盤");
  await page.getByRole("combobox").nth(1).selectOption("a.法人全体");
  await page.getByLabel("入力する項目").selectOption("1-2-1-1");
  await page.getByRole("combobox", { name: "自己評価結果 1", exact: true }).selectOption("適合");
  await page.getByRole("combobox", { name: "自己評価結果 2", exact: true }).selectOption("不適合");
  await page
    .getByLabel("質問への回答 1", { exact: true })
    .fill("情報セキュリティ規程 第2章\n組織図2026 & <確認済み>");
  await expect(page.getByRole("button", { name: "公式Excelを出力" })).toBeDisabled();
  await page.getByRole("button", { name: "公式回答を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByRole("link", { name: "公式シート回答・Excel出力", exact: true }).click();
  await page.getByLabel("入力する項目").selectOption("1-2-1-1");
  await expect(page.getByRole("combobox", { name: "自己評価結果 2", exact: true })).toHaveValue(
    "不適合",
  );
  await expect(page.getByLabel("質問への回答 1", { exact: true })).toHaveValue(
    "情報セキュリティ規程 第2章\n組織図2026 & <確認済み>",
  );
  await mkdir(".local/official-validation", { recursive: true });
  await page.screenshot({ path: ".local/official-validation/answers.png", fullPage: true });
  await page.getByLabel("入力する項目").selectOption("3-1-3-1");
  await page.getByLabel("評価基準全体を対象外とする").check();
  await page
    .getByLabel("対象外とする理由", { exact: true })
    .fill("外部情報サービスを使用していない");
  await page.getByLabel("入力する項目").selectOption("7-1-1-1");
  await page.getByRole("combobox", { name: "自己評価結果 2", exact: true }).selectOption("適合");
  await page
    .getByLabel("質問への回答 2", { exact: true })
    .fill('=HYPERLINK("https://example.invalid")\n復旧手順 第8章');
  await page.getByRole("button", { name: "公式回答を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "公式Excelを出力" }).click();
  const download = await downloadPromise;
  await download.saveAs(".local/official-validation/representative.xlsx");
  expect(await download.failure()).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate("document.activeElement?.blur()");
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/official-validation/mobile.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
});
