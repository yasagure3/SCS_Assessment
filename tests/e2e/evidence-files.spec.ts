import { test, expect } from "@playwright/test";
import { anonymousPdf } from "../fixtures/evidenceFiles";
test("attaches anonymous PDF, downloads with authorization and reviews without changing self-assessment", async ({
  page,
  request,
}) => {
  expect((await request.post("/__fixture/reset")).status()).toBe(200);
  let token = "";
  const errors: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  page.on("pageerror", (error) => errors.push(error.message));
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
    data: { name: "匿名添付検証社" },
  });
  expect(customer.status()).toBe(201);
  const customerData = (await customer.json()).data;
  const created = await request.post(`/api/v1/customers/${customerData.id}/cases`, {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "匿名文書確認", standardId: "scs-20260327-star3" },
  });
  expect(created.status()).toBe(201);
  const data = (await created.json()).data,
    id = data.assessmentId;
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${customerData.id}"]`).click();
  await page.locator(`a[href="/cases/${data.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${id}"]`).click();
  await page.getByRole("link", { name: "証跡", exact: true }).click();
  await page.getByRole("button", { name: "証跡を追加", exact: true }).click();
  await page.getByLabel("文書名").fill("匿名確認文書");
  await page.getByLabel("該当箇所").fill("1ページ");
  await page.getByRole("checkbox", { name: "1-2-1-1", exact: true }).check();
  const pdf = Buffer.from(anonymousPdf());
  await page
    .getByLabel("添付ファイル（任意）")
    .setInputFiles({ name: "anonymous.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByRole("button", { name: "証跡を保存", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "添付ファイルを登録" }).click();
  await expect(page.getByText("添付の登録が完了しました。内容は未確認です。")).toBeVisible();
  await page.screenshot({ path: ".local/e2e-evidence-files-uploaded.png", fullPage: true });
  await page.getByRole("button", { name: "証跡を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("証跡を保存しました。");
  const getRecord = async () =>
    (
      await (
        await request.get(`/api/v1/assessments/${id}`, { headers: { Authorization: token } })
      ).json()
    ).data;
  const before = await getRecord(),
    fileId = before.document.evidence[0].fileId;
  expect(before.document.evidence[0].reviews["1-2-1-1"]).toEqual({
    state: "unreviewed",
    note: "",
    by: null,
    at: null,
    subjectHash: null,
  });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "匿名確認文書の添付をダウンロード" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("anonymous.pdf");
  const content = await request.get(`/api/v1/files/${fileId}/content`, {
    headers: { Authorization: token },
  });
  expect(content.status()).toBe(200);
  expect(await content.body()).toEqual(pdf);
  expect(content.headers()["content-disposition"]).toBe(
    "attachment; filename=\"download.pdf\"; filename*=UTF-8''anonymous.pdf",
  );
  expect(content.headers()["cache-control"]).toBe("no-store");
  expect(content.headers()["x-content-type-options"]).toBe("nosniff");
  await page.getByRole("button", { name: "匿名確認文書 1-2-1-1 の確認を記録" }).click();
  await page.getByLabel("確認結果").selectOption("confirmed");
  await page.getByLabel("確認メモ").fill("匿名文書の1ページを照合した");
  await page.getByRole("button", { name: "確認を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("確認を保存しました。");
  const after = await getRecord();
  expect(after.counts).toEqual(before.counts);
  expect(after.document.responses["1-2-1-1"].status).toBe("unanswered");
  expect(after.document.evidence[0].reviews["1-2-1-1"]).toEqual({
    state: "confirmed",
    note: "匿名文書の1ページを照合した",
    by: expect.any(String),
    at: expect.any(String),
    subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await page.screenshot({ path: ".local/e2e-evidence-files-reviewed.png", fullPage: true });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.getByRole("button", { name: "証跡を追加", exact: true }).click();
  await page.getByLabel("添付ファイル（任意）").setInputFiles({
    name: "invalid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("anonymous text"),
  });
  await page.getByRole("button", { name: "添付ファイルを登録" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "ファイルの形式を確認してください。暗号化・マクロ・外部参照を含む文書は登録できません。",
  );
  await page.screenshot({ path: ".local/e2e-evidence-files-narrow-error.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  expect((await request.post("/__fixture/suspend")).status()).toBe(200);
  expect(
    (
      await request.get(`/api/v1/files/${fileId}/content`, { headers: { Authorization: token } })
    ).status(),
  ).toBe(403);
  expect(errors).toEqual([]);
});
