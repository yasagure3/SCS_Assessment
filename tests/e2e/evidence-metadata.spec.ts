import { test, expect } from "@playwright/test";

test("registers a document, reviews each criterion, edits and unlinks while preserving assessment answers", async ({
  page,
  request,
}) => {
  expect((await request.post("/__fixture/reset")).ok()).toBe(true);
  let token = "";
  const errors: string[] = [],
    evidenceFetches: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
    if (req.url().startsWith("https://example.invalid/")) evidenceFetches.push(req.url());
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
  const customer = await request.post("/api/v1/customers", {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "匿名証跡テスト社" },
  });
  expect(customer.status()).toBe(201);
  const customerData = (await customer.json()).data;
  const created = await request.post(`/api/v1/customers/${customerData.id}/cases`, {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "証跡確認案件", standardId: "scs-20260327-star3" },
  });
  expect(created.status()).toBe(201);
  const caseData = (await created.json()).data,
    assessmentId = caseData.assessmentId;
  expect((await request.post(`/__fixture/assessment/${assessmentId}`)).status()).toBe(200);
  const getRecord = async () =>
    (
      await (
        await request.get(`/api/v1/assessments/${assessmentId}`, {
          headers: { Authorization: token },
        })
      ).json()
    ).data;
  const before = await getRecord();
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${customerData.id}"]`).click();
  await page.locator(`a[href="/cases/${caseData.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${assessmentId}"]`).click();
  await page.getByRole("link", { name: "証跡", exact: true }).click();
  await expect(page.getByRole("heading", { name: "証跡管理" })).toBeVisible();
  await page.getByRole("button", { name: "証跡を追加", exact: true }).click();
  await page.getByLabel("文書名").fill("匿名セキュリティ規程");
  await page.getByLabel("該当箇所").fill("第2章 / 3ページ");
  await page.getByLabel("参照URL（任意）").fill("https://example.invalid/document");
  await page.getByRole("checkbox", { name: "1-2-1-1", exact: true }).check();
  await page.getByRole("checkbox", { name: "1-2-1-2", exact: true }).check();
  await page.screenshot({ path: ".local/e2e-evidence-form.png", fullPage: true });
  await page.getByRole("button", { name: "証跡を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("証跡を保存しました。");
  await page.getByRole("button", { name: "匿名セキュリティ規程 1-2-1-1 の確認を記録" }).click();
  await page.getByLabel("確認結果").selectOption("confirmed");
  await expect(page.getByRole("button", { name: "確認を保存" })).toBeDisabled();
  await page.getByLabel("確認メモ").fill("責任と権限を原本で照合した");
  await page.getByRole("button", { name: "確認を保存" }).click();
  await expect(page.getByRole("status")).toHaveText("確認を保存しました。");
  let saved = await getRecord();
  expect(saved.document.evidence[0].reviews["1-2-1-1"]).toEqual({
    state: "confirmed",
    note: "責任と権限を原本で照合した",
    by: expect.any(String),
    at: expect.any(String),
    subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(saved.document.evidence[0].reviews["1-2-1-2"]).toEqual({
    state: "unreviewed",
    note: "",
    by: null,
    at: null,
    subjectHash: null,
  });
  expect(saved.counts).toEqual(before.counts);
  await page.screenshot({ path: ".local/e2e-evidence-reviewed.png", fullPage: true });
  await page.getByRole("link", { name: "1-2-1-1", exact: true }).click();
  await expect(page.getByTestId("original-P")).toHaveText("匿名の元理由");
  await expect(page.getByLabel("現在の自己評価")).toHaveValue("no");
  await page.getByRole("link", { name: "証跡を登録・確認する" }).click();
  await page.getByRole("button", { name: "匿名セキュリティ規程を編集" }).click();
  await page.getByLabel("文書名").fill("改訂セキュリティ規程");
  const changed = await request.patch(
    `/api/v1/assessments/${assessmentId}/evidence/${saved.document.evidence[0].id}`,
    {
      headers: { Authorization: token },
      data: {
        expectedRevision: saved.revision,
        mutationId: crypto.randomUUID(),
        name: "別担当者の保存文",
        criterionIds: ["1-2-1-1", "1-2-1-2"],
        url: "https://example.invalid/document",
        location: "第3章",
      },
    },
  );
  expect(changed.status()).toBe(200);
  await page.getByRole("button", { name: "証跡を保存", exact: true }).click();
  await expect(page.getByRole("cell", { name: "別担当者の保存文", exact: true })).toBeVisible();
  await expect(page.getByLabel("文書名")).toHaveValue("改訂セキュリティ規程");
  await page.screenshot({ path: ".local/e2e-evidence-conflict.png", fullPage: true });
  await page.getByRole("button", { name: "入力を保って再編集する" }).click();
  await page.getByRole("button", { name: "証跡を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("証跡を保存しました。");
  saved = await getRecord();
  expect(saved.document.evidence[0].reviews).toEqual(
    Object.fromEntries(
      ["1-2-1-1", "1-2-1-2"].map((id) => [
        id,
        { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
      ]),
    ),
  );
  await page.setViewportSize({ width: 640, height: 900 });
  await page.getByRole("button", { name: "改訂セキュリティ規程を編集" }).click();
  await page.screenshot({ path: ".local/e2e-evidence-narrow.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.getByRole("button", { name: "証跡の関連をすべて解除" }).click();
  await expect(page.getByRole("status")).toHaveText("証跡の関連を解除しました。");
  const after = await getRecord();
  expect(after.document.evidence).toEqual([]);
  expect(after.counts).toEqual(before.counts);
  expect(after.document.responses["1-2-1-1"]).toEqual({
    ...before.document.responses["1-2-1-1"],
    adviceBasisVersion: expect.any(Number),
    basisHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(errors).toEqual([]);
  expect(evidenceFetches).toEqual([]);
});
