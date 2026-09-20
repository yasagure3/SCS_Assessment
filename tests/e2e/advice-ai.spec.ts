import { test, expect } from "@playwright/test";

test("reviews anonymous input, recovers a lost response without regeneration, adopts and confirms, and keeps manual work when AI is unavailable", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  expect((await request.post("/__fixture/reset")).ok()).toBe(true);
  const errors: string[] = [];
  let token = "";
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  await page.goto("/customers");
  await page.getByLabel("メールアドレス").fill("fixture@example.invalid");
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更", exact: true }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する", exact: true }).click();
  await expect(page.getByRole("link", { name: "顧客・案件を開く", exact: true })).toBeVisible();
  const headers = { Authorization: token, "Idempotency-Key": crypto.randomUUID() };
  const customerResponse = await request.post("/api/v1/customers", {
    headers,
    data: { name: "送信しない匿名検証社" },
  });
  expect(customerResponse.status()).toBe(201);
  const customer = (await customerResponse.json()).data;
  const createdResponse = await request.post(`/api/v1/customers/${customer.id}/cases`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "AI下書き検証", standardId: "scs-20260327-star3" },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()).data,
    id = created.assessmentId,
    criterionId = "1-2-1-1";
  expect((await request.post(`/__fixture/assessment/${id}`)).status()).toBe(200);
  const read = async () =>
    (await (await request.get(`/api/v1/assessments/${id}`, { headers })).json()).data;
  const before = await read();
  await page.getByRole("link", { name: "顧客・案件を開く", exact: true }).click();
  await page.locator(`a[href="/customers/${customer.id}"]`).click();
  await page.locator(`a[href="/cases/${created.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${id}"]`).click();
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByRole("link", { name: `${criterionId} 詳細`, exact: true }).click();
  await page.getByRole("link", { name: "助言の確認へ", exact: true }).click();
  await page.getByRole("textbox", { name: "不足点", exact: true }).fill("保持する手入力の作業メモ");
  await page.getByRole("button", { name: "AI 下書きを作成", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    answer = dialog.getByRole("textbox", { name: "匿名化した状況", exact: true }),
    gap = dialog.getByRole("textbox", { name: "匿名化した不足点", exact: true }),
    inputReview = dialog.getByRole("checkbox", {
      name: "送信全文を確認し、匿名化しました",
      exact: true,
    });
  await expect(answer).toHaveValue("");
  await expect(gap).toHaveValue("");
  await answer.fill("担当部署と役員の役割を検討している。");
  await gap.fill("分担表の承認が未完了。");
  const standard = (
    await (await request.get("/api/v1/standards/scs-20260327-star3", { headers })).json()
  ).data;
  const payload = {
    standardId: "scs-20260327-star3",
    criterionId,
    officialRequirement: standard.criteria.find((item: { id: string }) => item.id === criterionId)
      .officialText,
    anonymousAnswer: "担当部署と役員の役割を検討している。",
    anonymousGap: "分担表の承認が未完了。",
  };
  await expect(dialog.getByLabel("送信全文", { exact: true })).toHaveText(
    JSON.stringify(payload, null, 2),
  );
  await inputReview.check();
  await gap.fill("役割分担表の承認が未完了。");
  await expect(inputReview).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "確認した内容で生成", exact: true }),
  ).toBeDisabled();
  await inputReview.check();
  await dialog.screenshot({ path: ".local/e2e-ai-review.png" });
  let dropped = false;
  const generatedRequests: { key: string; body: unknown }[] = [];
  await page.route("**/api/v1/assessments/*/advice/*/ai-runs", async (route) => {
    generatedRequests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "確認した内容で生成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "同じ送信の状態を確認", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "AI 下書き · 未確定", exact: true }),
  ).toBeVisible();
  expect(generatedRequests.length).toBe(2);
  expect(generatedRequests[1]).toEqual(generatedRequests[0]);
  expect(Object.keys(generatedRequests[0].body as object).sort()).toEqual(
    [
      "anonymousAnswer",
      "anonymousGap",
      "anonymizationReviewed",
      "basisHash",
      "expectedRevision",
      "reviewedInputHash",
    ].sort(),
  );
  expect(await (await request.get("/__fixture/ai-inputs")).json()).toEqual([
    { ...payload, anonymousGap: "役割分担表の承認が未完了。" },
  ]);
  expect(await read()).toEqual(before);
  await page.setViewportSize({ width: 640, height: 900 });
  await dialog.screenshot({ path: ".local/e2e-ai-narrow.png" });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate("document.documentElement.style.zoom='2'");
  await dialog.screenshot({ path: ".local/e2e-ai-zoom200.png" });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate("document.documentElement.style.zoom='1'");
  await dialog.getByRole("button", { name: "AI案を下書きへ採用", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const adopted = await read(),
    draft = adopted.document.responses[criterionId].adviceDraft;
  expect(adopted.document.responses[criterionId].confirmedAdvice).toBeNull();
  expect(adopted.revision).toBe(before.revision + 1);
  await expect(page.getByRole("textbox", { name: "不足点", exact: true })).toHaveValue(draft.gap);
  await expect(page.getByRole("button", { name: "助言を確定", exact: true })).toBeDisabled();
  await page.getByLabel("現在の回答・範囲・証跡と助言内容を確認しました").check();
  await page.getByRole("button", { name: "助言を確定", exact: true }).click();
  await expect(page.locator("#criterion-advice").getByRole("status")).toHaveText(
    "助言を確定しました。",
  );
  const confirmed = await read();
  expect(confirmed.document.responses[criterionId].confirmedAdvice).toEqual({
    content: draft,
    basisHash: before.document.responses[criterionId].basisHash,
    by: expect.any(String),
    at: expect.any(String),
    version: 1,
  });
  await page
    .getByRole("textbox", { name: "不足点", exact: true })
    .fill("失敗中も保持する新しい手入力");
  expect((await request.post("/__fixture/ai-unconfigured")).ok()).toBe(true);
  await page.getByRole("button", { name: "AI 下書きを作成", exact: true }).click();
  await expect(answer).toHaveValue("");
  await answer.fill("匿名状況");
  await gap.fill("匿名不足点");
  await inputReview.check();
  await dialog.getByRole("button", { name: "確認した内容で生成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "AIは未設定です。定型助言と手入力を利用できます。",
  );
  await dialog.screenshot({ path: ".local/e2e-ai-unconfigured.png" });
  await dialog.getByRole("button", { name: "閉じて手入力を続ける", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "不足点", exact: true })).toHaveValue(
    "失敗中も保持する新しい手入力",
  );
  expect(await read()).toEqual(confirmed);
  expect(errors).toEqual([]);
});
