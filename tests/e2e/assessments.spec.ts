import { test, expect } from "@playwright/test";
test("filters insufficiencies, edits against immutable original answers, resolves conflict and updates the 81-count dashboard", async ({
  page,
  request,
}) => {
  expect((await request.post("/__fixture/reset")).ok()).toBe(true);
  let token = "";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  // Prepare the anonymous case before its first browser read; no live SWR cache is mutated.
  const customer = await request.post("/api/v1/customers", {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "匿名評価テスト社" },
  });
  expect(customer.status()).toBe(201);
  const { data: customerData } = await customer.json();
  const created = await request.post(`/api/v1/customers/${customerData.id}/cases`, {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "初回評価", standardId: "scs-20260327-star3" },
  });
  expect(created.status()).toBe(201);
  const { data: caseData } = await created.json();
  const assessmentId = caseData.assessmentId;
  expect((await request.post(`/__fixture/assessment/${assessmentId}`)).status()).toBe(200);
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${customerData.id}"]`).click();
  await page.locator(`a[href="/cases/${caseData.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${assessmentId}"]`).click();
  await expect(page.getByTestId("no-count")).toHaveText("1");
  await expect(page.getByTestId("unanswered-count")).toHaveText("80");
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByLabel("自己評価で絞り込み").selectOption("no");
  await expect(page.getByText("1 / 81件", { exact: true })).toBeVisible();
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/e2e-assessments-list.png", fullPage: true });
  await page.getByRole("link", { name: "1-2-1-1 詳細", exact: true }).click();
  for (const [key, value] of Object.entries({
    O: "✖",
    P: "匿名の元理由",
    Q: "匿名の元根拠と作業",
    R: "匿名の元補足",
  }))
    await expect(page.getByTestId(`original-${key}`)).toHaveText(value);
  await page.getByLabel("現在の自己評価").selectOption("yes");
  await page.getByLabel("判定理由・確認メモ").fill("規程と運用記録を照合した");
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/e2e-assessments-detail.png", fullPage: true });
  const saved = await request.get(`/api/v1/assessments/${assessmentId}`, {
    headers: { Authorization: token },
  });
  expect(saved.status()).toBe(200);
  const { data } = await saved.json();
  const response = data.document.responses["1-2-1-1"];
  expect(response.original).toEqual({
    sheet: "匿名fixture",
    row: 6,
    O: "✖",
    P: "匿名の元理由",
    Q: "匿名の元根拠と作業",
    R: "匿名の元補足",
  });
  expect(data.counts).toEqual({ yes: 1, uncertain: 0, no: 0, unanswered: 80, total: 81 });
  const concurrent = await request.patch(`/api/v1/assessments/${assessmentId}/responses/1-2-1-1`, {
    headers: { Authorization: token },
    data: {
      expectedRevision: data.revision,
      mutationId: crypto.randomUUID(),
      status: "uncertain",
      reason: "別担当者の保存文",
      basis: "",
      plannedWork: "",
      supplement: "",
    },
  });
  expect(concurrent.status()).toBe(200);
  await page.getByLabel("判定理由・確認メモ").fill("自分の未保存文");
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "入力を保って再編集する", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("判定理由・確認メモ")).toHaveValue("自分の未保存文");
  await expect(page.getByRole("cell", { name: "別担当者の保存文", exact: true })).toBeVisible();
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/e2e-assessments-conflict.png", fullPage: true });
  await page.getByRole("button", { name: "入力を保って再編集する", exact: true }).click();
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  await page.getByRole("link", { name: "現状ダッシュボード", exact: true }).click();
  await expect(page.getByTestId("yes-count")).toHaveText("1");
  await expect(page.getByTestId("no-count")).toHaveText("0");
  await expect(page.getByTestId("unanswered-count")).toHaveText("80");
  await expect(page.getByRole("link", { name: "未確認の○ 1件", exact: true })).toBeVisible();
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/e2e-assessments-dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.getByRole("link", { name: "1-2-1-1 ○ 満たしている", exact: true }).click();
  await expect(page.getByTestId("original-P")).toHaveText("匿名の元理由");
  await expect(page.getByLabel("判定理由・確認メモ")).toHaveValue("自分の未保存文");
  await page.evaluate("window.scrollTo(0, 0)");
  await page.screenshot({ path: ".local/e2e-assessments-detail-narrow.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
