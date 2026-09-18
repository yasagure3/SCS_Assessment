import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  expect((await request.post("/__fixture/reset")).ok()).toBe(true);
});
test("initial password, TOTP enrollment, API authorization, suspension and cache clearing", async ({
  page,
  request,
}) => {
  let token = "";
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("fixture@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: "初回パスワードの変更" })).toBeVisible();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(page.getByLabel("セットアップキー")).toHaveText("E2E_ONLY_SETUP_KEY");
  await page.screenshot({ path: ".local/e2e-auth-enrollment.png", fullPage: true });
  expect(token).toBe("");
  await page.getByLabel("認証コード").fill("000000");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("alert")).toContainText("認証コード");
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("heading", { name: "担当者アカウント" })).toBeVisible();
  await expect(page.getByTestId("my-role")).toHaveText("担当者");
  await page.screenshot({ path: ".local/e2e-auth-account.png", fullPage: true });
  expect(token).toMatch(/^Bearer E2E_ONLY_TOKEN_/);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  expect((await request.post("/__fixture/suspend")).ok()).toBe(true);
  expect((await request.get("/api/v1/me", { headers: { Authorization: token } })).status()).toBe(
    403,
  );
  // SWR can observe suspension on focus before the local logout is clicked.
  await page.getByRole("button", { name: /^(ログアウト|ログイン画面へ戻る)$/ }).click();
  await expect(page.getByRole("heading", { name: "担当者ログイン" })).toBeVisible();
  await page.goto("/mypage");
  await expect(page).toHaveURL(/\/login$/);
});

test("all-device logout revokes the token through the real application API", async ({
  page,
  request,
}) => {
  let token = "";
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("fixture@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByTestId("my-role")).toHaveText("担当者");
  await page.getByRole("button", { name: "全端末からログアウト" }).click();
  await expect(page.getByRole("heading", { name: "担当者ログイン" })).toBeVisible();
  expect((await request.get("/api/v1/me", { headers: { Authorization: token } })).status()).toBe(
    401,
  );
});
