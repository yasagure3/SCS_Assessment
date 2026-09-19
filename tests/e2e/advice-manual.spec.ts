import { test, expect } from "@playwright/test";

test("edits a sourced template, confirms explicitly, preserves both versions and reconfirms changed answers", async ({
  page,
  request,
}) => {
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
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("link", { name: "顧客・案件を開く" })).toBeVisible();
  const customerResponse = await request.post("/api/v1/customers", {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "匿名助言検証社" },
  });
  expect(customerResponse.status()).toBe(201);
  const customer = (await customerResponse.json()).data;
  const caseResponse = await request.post(`/api/v1/customers/${customer.id}/cases`, {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "定型助言の確認", standardId: "scs-20260327-star3" },
  });
  expect(caseResponse.status()).toBe(201);
  const created = (await caseResponse.json()).data,
    id = created.assessmentId,
    criterionId = "1-2-1-1";
  expect((await request.post(`/__fixture/assessment/${id}`)).status()).toBe(200);
  const read = async () =>
    (
      await (
        await request.get(`/api/v1/assessments/${id}`, { headers: { Authorization: token } })
      ).json()
    ).data;
  const before = await read();
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${customer.id}"]`).click();
  await page.locator(`a[href="/cases/${created.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${id}"]`).click();
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByRole("link", { name: `${criterionId} 詳細`, exact: true }).click();
  await page.getByRole("link", { name: "助言の確認へ" }).click();
  await expect(page.getByRole("heading", { name: "公式評価基準 · 1-2-1-1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当社の実施例・助言案" })).toBeVisible();
  await expect(page.getByRole("link", { name: "定型助言が参照する公式出典" })).toHaveAttribute(
    "href",
    "https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/20260327001-c.xlsx",
  );
  const confirm = page.getByRole("button", { name: "助言を確定", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole("button", { name: "定型助言を下書きへコピー" }).click();
  const gapInput = page.getByRole("textbox", { name: "不足点", exact: true });
  await gapInput.fill("統括役員と担当部署の役割分担を規程へ追記する必要がある。");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("下書きを保存しました。");
  const draft = (await read()).document.responses[criterionId].adviceDraft;
  expect(draft).toEqual({
    origin: "template",
    templateId: "scs-20260327-star3:1-2-1-1:v1",
    gap: "統括役員と担当部署の役割分担を規程へ追記する必要がある。",
    steps: [
      "平時の推進体制として、役割分担と連絡先の管理者を決め、点検予定をまとめる。",
      "経営判断、対策実施、承認の担当を統括役員と担当部署に割り当て、職務分掌に記載する。",
    ],
    evidenceExamples: ["承認済み職務分掌", "組織図"],
    completionCheck: "統括役員と担当部署双方の役割・責任を規程の該当箇所で説明できる。",
    notes: "",
  });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("現在の回答・範囲・証跡と助言内容を確認しました").check();
  await confirm.click();
  await expect(page.getByRole("status")).toHaveText("助言を確定しました。");
  let saved = await read();
  const confirmed = saved.document.responses[criterionId].confirmedAdvice;
  expect(confirmed).toEqual({
    content: draft,
    basisHash: saved.document.responses[criterionId].basisHash,
    by: expect.any(String),
    at: expect.any(String),
    version: 1,
  });
  await page.locator("#criterion-advice").screenshot({ path: ".local/e2e-advice-confirmed.png" });
  await gapInput.fill("次回の改善案は下書きで検討中。");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("下書きを保存しました。");
  saved = await read();
  expect(saved.document.responses[criterionId].confirmedAdvice).toEqual(confirmed);
  expect(saved.document.responses[criterionId].adviceDraft).toEqual({
    ...draft,
    gap: "次回の改善案は下書きで検討中。",
  });
  await page.getByLabel("判定理由・確認メモ").fill("新たな根拠を確認したため再評価");
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  // The response form had an older revision while advice was saved. Resolve its explicit CAS conflict.
  await page.getByRole("button", { name: "入力を保って再編集する", exact: true }).click();
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  await expect(
    page.getByText("回答・根拠が変更されたため、助言の再確認が必要です。"),
  ).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.getByRole("button", { name: "助言の入力を保って再編集する", exact: true }).click();
  await expect(confirm).toBeDisabled();
  await page.getByLabel("現在の回答・範囲・証跡と助言内容を確認しました").check();
  await confirm.click();
  await expect(page.locator("#criterion-advice").getByRole("status")).toHaveText(
    "助言を確定しました。",
  );
  saved = await read();
  expect(saved.document.responses[criterionId].confirmedAdvice).toEqual({
    content: { ...draft, gap: "次回の改善案は下書きで検討中。" },
    basisHash: saved.document.responses[criterionId].basisHash,
    by: expect.any(String),
    at: expect.any(String),
    version: 2,
  });
  expect(saved.document.responses[criterionId].original).toEqual(
    before.document.responses[criterionId].original,
  );
  await page.setViewportSize({ width: 640, height: 900 });
  await page.locator("#criterion-advice").screenshot({ path: ".local/e2e-advice-narrow.png" });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate("document.documentElement.style.zoom='2'");
  await page.locator("#criterion-advice").screenshot({ path: ".local/e2e-advice-zoom200.png" });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
