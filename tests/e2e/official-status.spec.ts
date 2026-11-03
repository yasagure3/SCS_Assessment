import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

async function login(page: Page) {
  await page.getByLabel("メールアドレス").fill("fixture@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("link", { name: "顧客・案件を開く" })).toBeVisible();
}

test("official progress reflects saved answers, links to missing fields, and survives a reload", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  expect((await request.post("/__fixture/reset")).ok()).toBe(true);
  let token = "";
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  await page.goto("/customers");
  await login(page);
  const headers = { Authorization: token, "Idempotency-Key": crypto.randomUUID() };
  const customer = await request.post("/api/v1/customers", {
    headers,
    data: { name: "回答状況検証株式会社" },
  });
  const { data: c } = await customer.json();
  const created = await request.post(`/api/v1/customers/${c.id}/cases`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "記載漏れ確認", standardId: "scs-20261028-v1.1-star3" },
  });
  expect(created.status()).toBe(201);
  const { data } = await created.json();
  const base = `/assessments/${data.assessmentId}`;
  const before = (await (await request.get(`/api/v1${base}`, { headers })).json()).data;
  async function openAssessment() {
    await page.getByRole("link", { name: "顧客・案件を開く" }).click();
    await page.locator(`a[href="/customers/${c.id}"]`).click();
    await page.locator(`a[href="/cases/${data.case.id}"]`).click();
    await page.locator(`a[href="${base}"]`).click();
  }
  await openAssessment();
  await page.getByRole("link", { name: "公式回答の状況を確認", exact: true }).click();
  await expect(page.getByRole("heading", { name: "公式回答状況", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(81);
  await expect(page.getByRole("progressbar", { name: "判定の入力" })).toHaveAttribute("value", "0");
  await page.getByRole("link", { name: "1-2-1-1 の公式回答を開く", exact: true }).click();
  await expect(page.getByLabel("入力する項目")).toHaveValue("1-2-1-1");
  await page.getByRole("combobox", { name: "自己評価結果 1", exact: true }).selectOption("適合");
  await page.getByRole("combobox", { name: "自己評価結果 2", exact: true }).selectOption("不適合");
  await page.getByLabel("質問への回答 1", { exact: true }).fill("役割規程 第2章（検証）");
  await page.getByRole("button", { name: "公式回答を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  await page.getByRole("link", { name: "保存済みの公式回答状況・記載漏れを確認" }).click();
  await expect(page.getByRole("progressbar", { name: "判定の入力" })).toHaveAttribute("value", "2");
  await expect(page.getByRole("progressbar", { name: "質問への回答" })).toHaveAttribute(
    "value",
    "1",
  );
  await page.getByLabel("表示する状況").selectOption("nonconforming");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByText("基準・質問・回答を確認", { exact: true }).click();
  await expect(page.getByText("役割規程 第2章（検証）", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "適合基準 2 の回答欄へ" }).click();
  await expect(page.locator('[id="official-row-1-2-1-1:2"]')).toBeFocused();
  await page.getByRole("combobox", { name: "自己評価結果 2", exact: true }).selectOption("適合");
  await page.getByLabel("入力する項目").selectOption("3-1-3-1");
  await page.getByLabel("評価基準全体を対象外とする").check();
  await page
    .getByLabel("対象外とする理由", { exact: true })
    .fill("対象となる外部情報サービスを利用していない（検証）");
  await page.getByLabel("入力する項目").selectOption("organization");
  await page.getByLabel("登録組織の名称", { exact: true }).fill("回答状況検証株式会社");
  await page.getByRole("combobox").nth(1).selectOption("b.法人のうち一部(事業部等)");
  await page.getByRole("button", { name: "公式回答を保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  await page.getByRole("link", { name: "公式回答状況", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "適用範囲の質問" })).toHaveAttribute(
    "max",
    "9",
  );
  await page.getByLabel("表示する状況").selectOption("nonconforming");
  await expect(page.getByText("条件に一致する評価基準はありません。")).toBeVisible();
  await page.getByLabel("表示する状況").selectOption("excluded");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("対象外理由：記入済み");
  await page.getByLabel("表示する状況").selectOption("missing");
  await expect(page.getByRole("article")).toHaveCount(79);
  await page.getByLabel("評価基準ID・内容で検索").fill("4-4-4");
  await expect(page.getByRole("article")).toHaveCount(2);
  await mkdir(".local/official-status-validation", { recursive: true });
  await page.evaluate("document.activeElement?.blur()");
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/official-status-validation/desktop.png", fullPage: true });
  await page.getByText("登録組織・適用範囲の記入欄").click();
  await expect(page.getByText("回答不要", { exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/official-status-validation/mobile.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.reload();
  await login(page);
  await openAssessment();
  await page.getByRole("link", { name: "公式回答の状況を確認", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "判定の入力" })).toHaveAttribute("value", "2");
  await expect(page.getByRole("progressbar", { name: "登録組織" })).toHaveAttribute("value", "1");
  const after = (await (await request.get(`/api/v1${base}`, { headers })).json()).data;
  expect(after.document.responses["1-2-1-1"].reason).toBe(
    before.document.responses["1-2-1-1"].reason,
  );
  expect(after.document.responses["1-2-1-1"].status).toBe(
    before.document.responses["1-2-1-1"].status,
  );
  expect(after.document.evidence).toEqual(before.document.evidence);
});
