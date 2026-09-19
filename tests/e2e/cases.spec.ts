import { test, expect } from "@playwright/test";
test("creates an assigned customer, a case and an 81-answer draft, then saves scope", async ({
  page,
  request,
}) => {
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
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await expect(page.getByRole("heading", { name: "顧客・案件", exact: true })).toBeVisible();
  await page.getByLabel("顧客名", { exact: true }).fill("匿名テスト社");
  await page.getByRole("button", { name: "顧客を追加", exact: true }).click();
  await expect(page.getByRole("heading", { name: "匿名テスト社", exact: true })).toBeVisible();
  await page.getByLabel("案件名", { exact: true }).fill("初回スクリーニング");
  await page.getByRole("button", { name: "案件を作成", exact: true }).click();
  await expect(page.getByTestId("unanswered-count")).toHaveText("81");
  await page.getByLabel("対象会社").fill("匿名テスト社 全社");
  await page.getByLabel("対象拠点").fill("本社・大阪支店");
  await page.getByRole("button", { name: "対象範囲を保存" }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  const assessmentId = new URL(page.url()).pathname.split("/").at(-1);
  const response = await request.get(`/api/v1/assessments/${assessmentId}`, {
    headers: { Authorization: token },
  });
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  expect(data.revision).toBe(2);
  expect(Object.keys(data.document.responses)).toHaveLength(81);
  expect(data.document.scope.sites).toBe("本社・大阪支店");
  expect(data.document.diagnosisDate).toBeNull();
  await page.screenshot({ path: ".local/e2e-case-dashboard.png", fullPage: true });
});
