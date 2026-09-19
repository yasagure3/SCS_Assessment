import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("heading", { name: "担当者アカウント" })).toBeVisible();
}
test("administrator invitation, MFA, assigned customer access and suspension apply to an existing session", async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const reset = await request.post("/__fixture/access-reset");
  expect(reset.status()).toBe(200);
  const { assigned, unassigned } = await reset.json();
  const email = `access-invite-${crypto.randomUUID()}@example.invalid`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "access-admin@example.invalid");
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.getByRole("link", { name: "管理・利用設定" }).click();
  await expect(page.getByRole("heading", { name: "管理・利用設定" })).toBeVisible();
  await page.getByLabel("社内メールアドレス").fill(email);
  await page.getByLabel(`割当会社-${assigned}`, { exact: true }).check();
  await page.getByRole("button", { name: "招待メールを送信" }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  const deliveries = await (await request.get("/__fixture/invitation-deliveries")).json();
  expect(deliveries).toEqual([{ email, sub: expect.stringMatching(/^fixture-invited-/) }]);
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/e2e-access-settings.png", fullPage: true });
  const staffContext = await browser.newContext({ baseURL }),
    staff = await staffContext.newPage();
  let staffToken = "";
  staff.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) staffToken = req.headers().authorization ?? "";
  });
  await login(staff, email);
  await staff.getByRole("link", { name: "顧客・案件を開く" }).click();
  await expect(staff.getByRole("link", { name: new RegExp(`割当会社-${assigned}`) })).toBeVisible();
  const allowed = await staff.request.get("/api/v1/customers", {
    headers: { Authorization: staffToken },
  });
  expect(allowed.status()).toBe(200);
  expect((await allowed.json()).data.items.map((row: { id: string }) => row.id)).toEqual([
    assigned,
  ]);
  expect(
    (
      await staff.request.get(`/api/v1/customers/${unassigned}`, {
        headers: { Authorization: staffToken },
      })
    ).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "招待状態を再読み込み" }).click();
  await page.getByRole("button", { name: "利用者一覧を再読み込み" }).click();
  const user = page.locator("details").filter({ has: page.locator("summary", { hasText: email }) });
  await expect(user.locator("summary span")).toHaveText("担当者 / 有効");
  await user.locator("summary").click();
  await user.getByLabel("利用状態").selectOption("suspended");
  await user.getByRole("button", { name: "利用者の変更を保存" }).click();
  await expect(user.getByRole("status")).toHaveText("保存しました。");
  expect(
    (
      await staff.request.get(`/api/v1/customers/${assigned}`, {
        headers: { Authorization: staffToken },
      })
    ).status(),
  ).toBe(403);
  expect(await (await request.get("/__fixture/invitation-deliveries")).json()).toEqual(deliveries);
  await page.evaluate("document.body.style.zoom = '2'");
  await page.evaluate("window.scrollTo(0, 0)");
  expect(
    await page
      .getByLabel("社内メールアドレス")
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(320);
  await page.screenshot({ path: ".local/e2e-access-settings-200.png", fullPage: true });
  expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(errors).toEqual([]);
  await staffContext.close();
});
