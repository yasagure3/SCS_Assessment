import { test, expect, type Page } from "@playwright/test";
const c1 = "00000000-0000-4000-8000-000000000011";
const c2 = "00000000-0000-4000-8000-000000000012";
const u1 = "00000000-0000-4000-8000-000000000021";
const u2 = "00000000-0000-4000-8000-000000000022";
const inv = "00000000-0000-4000-8000-000000000031";
const user = (id: string) => ({
  id,
  email: `${id}@example.invalid`,
  role: "staff",
  status: "active",
  revision: 1,
  customerIds: [],
});
const customer = (id: string) => ({
  id,
  name: id === c1 ? "page-one-customer" : "page-two-customer",
  revision: 1,
  archivedAt: null,
});
const reply = (data: unknown) => JSON.stringify({ data, requestId: "review" });
async function openSettings(page: Page) {
  await page.request.post("/__fixture/access-reset");
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("access-admin@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("heading", { name: "担当者アカウント" })).toBeVisible();
  await page.route("**/api/v1/customers*", async (route) => {
    const second = new URL(route.request().url()).searchParams.has("cursor");
    await route.fulfill({
      contentType: "application/json",
      body: reply({ items: [customer(second ? c2 : c1)], nextCursor: second ? null : "second" }),
    });
  });
  await page.route("**/api/v1/customers/*/members", async (route) => {
    const customerId = new URL(route.request().url()).pathname.split("/").at(-2);
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        body: reply({ customerId, revision: 2, userIds: body.userIds }),
      });
    } else
      await route.fulfill({
        contentType: "application/json",
        body: reply({ customerId, revision: 1, userIds: [] }),
      });
  });
  await page.route("**/api/v1/users*", async (route) => {
    const second = new URL(route.request().url()).searchParams.has("cursor");
    await route.fulfill({
      contentType: "application/json",
      body: reply({ items: [user(second ? u2 : u1)], nextCursor: second ? null : "second" }),
    });
  });
  await page.route("**/api/v1/users/invitations*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: reply({
        items: [
          {
            invitationId: inv,
            userId: u1,
            email: "failed@example.invalid",
            role: "staff",
            userStatus: "invited",
            status: "failed",
            expiresAt: "2026-10-01T00:00:00Z",
            lastErrorCode: "PROVIDER_FAILED",
            retryAllowed: true,
          },
        ],
        nextCursor: "second",
      }),
    });
  });
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.getByRole("link", { name: "管理・利用設定" }).click();
  await expect(page.getByLabel("社内メールアドレス")).toBeVisible();
}
test("customer pagination retains the draft invitation recipient and previous page assignments", async ({
  page,
}) => {
  await openSettings(page);
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "社内利用者を招待" }) });
  await page.getByLabel("社内メールアドレス").fill("draft@example.invalid");
  await page.getByLabel("招待する役割").selectOption("admin");
  await page.getByLabel("page-one-customer", { exact: true }).check();
  await section.getByRole("button", { name: "次のページ" }).click();
  await expect(page.getByLabel("page-two-customer", { exact: true })).toBeVisible();
  await page.getByLabel("page-two-customer", { exact: true }).check();
  expect
    .soft(await page.getByLabel("社内メールアドレス").inputValue())
    .toBe("draft@example.invalid");
  await section.getByRole("button", { name: "先頭へ" }).click();
  await expect.soft(page.getByLabel("page-one-customer", { exact: true })).toBeChecked();
  await expect(page.getByLabel("招待する役割")).toHaveValue("admin");
  await page.route("**/api/v1/users/invitations", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 201,
          contentType: "application/json",
          body: reply({ invitationId: inv, status: "sent", expiresAt: "2026-10-01T00:00:00Z" }),
        })
      : route.fallback(),
  );
  const submitted = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/users/invitations"),
  );
  await page.getByRole("button", { name: "招待メールを送信", exact: true }).click();
  expect((await submitted).postDataJSON()).toEqual({
    email: "draft@example.invalid",
    role: "admin",
    customerIds: [c1, c2],
  });
});
test("user pagination retains unsaved membership choices on previous user pages", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByLabel("対象の顧客").selectOption(c1);
  await page.getByLabel(`${u1}@example.invalid`, { exact: true }).check();
  const usersSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "利用者とアクセス範囲" }) });
  await usersSection.getByRole("button", { name: "次のページ" }).click();
  await page.getByLabel(`${u2}@example.invalid`, { exact: true }).check();
  await usersSection.getByRole("button", { name: "先頭へ" }).click();
  await expect(page.getByLabel(`${u1}@example.invalid`, { exact: true })).toBeChecked();
  const request = page.waitForRequest(
    (req) => req.method() === "PUT" && req.url().endsWith("/members"),
  );
  await page.getByRole("button", { name: "顧客の割当を保存" }).click();
  expect((await request).postDataJSON().userIds).toEqual([u1, u2]);
});
test("customer switching preserves each customer's draft assignments and base revision", async ({
  page,
}) => {
  await openSettings(page);
  const inviteSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "社内利用者を招待" }) });
  const usersSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "利用者とアクセス範囲" }) });
  const assignments = page.getByRole("region", { name: "選択した顧客の割当" });
  await page.getByLabel("対象の顧客").selectOption(c1);
  await assignments.getByLabel(`${u1}@example.invalid`, { exact: true }).check();
  await inviteSection.getByRole("button", { name: "次のページ" }).click();
  await page.getByLabel("対象の顧客").selectOption(c2);
  await usersSection.getByRole("button", { name: "次のページ" }).click();
  await assignments.getByLabel(`${u2}@example.invalid`, { exact: true }).check();
  await inviteSection.getByRole("button", { name: "先頭へ" }).click();
  await page.getByLabel("対象の顧客").selectOption(c1);
  await usersSection.getByRole("button", { name: "先頭へ" }).click();
  await expect(assignments.getByLabel(`${u1}@example.invalid`, { exact: true })).toBeChecked();
  const first = page.waitForRequest(
    (req) => req.method() === "PUT" && req.url().endsWith(`${c1}/members`),
  );
  await assignments.getByRole("button", { name: "顧客の割当を保存" }).click();
  expect((await first).postDataJSON()).toEqual({
    expectedRevision: 1,
    userIds: [u1],
    mutationId: expect.any(String),
  });
  await inviteSection.getByRole("button", { name: "次のページ" }).click();
  await page.getByLabel("対象の顧客").selectOption(c2);
  await usersSection.getByRole("button", { name: "次のページ" }).click();
  await expect(assignments.getByLabel(`${u2}@example.invalid`, { exact: true })).toBeChecked();
  const second = page.waitForRequest(
    (req) => req.method() === "PUT" && req.url().endsWith(`${c2}/members`),
  );
  await assignments.getByRole("button", { name: "顧客の割当を保存" }).click();
  expect((await second).postDataJSON()).toEqual({
    expectedRevision: 1,
    userIds: [u2],
    mutationId: expect.any(String),
  });
});
test("user pagination preserves an edited role until its explicit save", async ({ page }) => {
  await openSettings(page);
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "利用者とアクセス範囲" }) });
  const edited = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: `${u1}@example.invalid` }) });
  await edited.locator("summary").click();
  await edited.getByRole("combobox", { name: "役割", exact: true }).selectOption("admin");
  await section.getByRole("button", { name: "次のページ" }).click();
  await expect(
    page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: `${u2}@example.invalid` }) }),
  ).toBeVisible();
  await section.getByRole("button", { name: "先頭へ" }).click();
  await expect(edited.getByRole("combobox", { name: "役割", exact: true })).toHaveValue("admin");
  await page.route(`**/api/v1/users/${u1}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: reply({ ...user(u1), role: "admin", revision: 2 }),
    }),
  );
  const write = page.waitForRequest((req) => req.method() === "PATCH" && req.url().endsWith(u1));
  await edited.getByRole("button", { name: "利用者の変更を保存" }).click();
  expect((await write).postDataJSON()).toEqual({
    expectedRevision: 1,
    role: "admin",
    status: "active",
    mutationId: expect.any(String),
  });
});
test("invitation pagination does not erase unrelated invitation form input (negative control)", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByLabel("社内メールアドレス").fill("draft@example.invalid");
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "招待一覧", exact: true }) });
  await section.getByRole("button", { name: "次のページ" }).click();
  await expect(section.getByRole("button", { name: "先頭へ" })).toBeVisible();
  await expect(page.getByLabel("社内メールアドレス")).toHaveValue("draft@example.invalid");
});
for (const [status, code] of [
  [502, "PROVIDER_FAILED"],
  [503, "SERVICE_UNAVAILABLE"],
  [504, "PROVIDER_TIMEOUT"],
] as const) {
  test(`a second explicit invitation retry after confirmed ${status} gets a fresh operation key`, async ({
    page,
  }) => {
    await openSettings(page);
    const keys: string[] = [];
    await page.route("**/api/v1/users/invitations/*/retry", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code, message: "review provider failed" },
          requestId: "review",
        }),
      });
    });
    await page.getByRole("button", { name: "招待を再発行", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("review provider failed");
    await page.getByRole("button", { name: "招待を再発行", exact: true }).click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[1]).not.toBe(keys[0]);
  });
}
test("an unknown retry network result reuses the same operation key even after a preceding confirmed failure", async ({
  page,
}) => {
  await openSettings(page);
  const keys: string[] = [];
  await page.route("**/api/v1/users/invitations/*/retry", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "PROVIDER_FAILED", message: "confirmed failure" },
          requestId: "test",
        }),
      });
      return;
    }
    if (keys.length === 2) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: reply({ invitationId: inv, status: "sent", expiresAt: "2026-10-01T00:00:00Z" }),
    });
  });
  const retry = page.getByRole("button", { name: "招待を再発行", exact: true });
  await retry.click();
  await expect(page.getByRole("alert")).toHaveText("confirmed failure");
  await retry.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[1]).not.toBe(keys[0]);
  expect(keys[2]).toBe(keys[1]);
});
test("repeating the initial invitation after a confirmed failure keeps its operation key", async ({
  page,
}) => {
  await openSettings(page);
  const keys: string[] = [];
  await page.route("**/api/v1/users/invitations", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"]);
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "PROVIDER_FAILED", message: "confirmed initial failure" },
        requestId: "test",
      }),
    });
  });
  await page.getByLabel("社内メールアドレス").fill("draft@example.invalid");
  const send = page.getByRole("button", { name: "招待メールを送信", exact: true });
  await send.click();
  await expect(page.getByRole("alert")).toHaveText("confirmed initial failure");
  await send.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys).toEqual([keys[0], keys[0]]);
});
