import { test, expect } from "@playwright/test";

test("SPA and Worker start together and anonymous access is protected", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const me = await request.get("/api/v1/me");
  expect(me.status()).toBe(401);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /課題を整理し、\s*次の対策を明確に。/ }),
  ).toBeVisible();
  await expect(page.getByTestId("api-health-status")).toHaveAttribute("data-status", "ok");
  await page.getByRole("link", { name: "担当者ログイン →" }).click();
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await page.goto("/mypage");
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});
