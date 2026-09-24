import { test, expect, type Page, type TestInfo } from "@playwright/test";

async function expectTaskFormFits(page: Page, testInfo: TestInfo, phase: string) {
  const layout = await page.locator(".task-editor").evaluate((editor) => {
    const browserWindow = editor.ownerDocument.defaultView!;
    const measure = (element: typeof editor) => {
      const box = element.getBoundingClientRect(),
        style = browserWindow.getComputedStyle(element);
      return {
        element: element.tagName.toLowerCase(),
        className: element.className,
        left: box.left,
        right: box.right,
        width: box.width,
        scrollWidth: element.scrollWidth,
        minWidth: style.minWidth,
        gridColumns: style.gridTemplateColumns,
      };
    };
    return {
      viewport: browserWindow.innerWidth,
      documentWidth: editor.ownerDocument.documentElement.scrollWidth,
      editor: measure(editor),
      descendants: Array.from(
        editor.querySelectorAll("form,fieldset,label,input,select,textarea,button"),
      ).map(measure),
    };
  });
  await testInfo.attach(`task-form-layout-${phase}`, {
    body: JSON.stringify(layout, null, 2),
    contentType: "application/json",
  });
  expect(layout.documentWidth, `${phase}: page width`).toBeLessThanOrEqual(layout.viewport);
  expect(layout.editor.right, `${phase}: editor right edge`).toBeLessThanOrEqual(layout.viewport);
  for (const control of layout.descendants) {
    expect(control.left, `${phase}: ${control.element} left edge`).toBeGreaterThanOrEqual(
      layout.editor.left,
    );
    expect(control.right, `${phase}: ${control.element} right edge`).toBeLessThanOrEqual(
      layout.editor.right,
    );
  }
}

test("creates and completes a task, copies a reassessment and compares a neutral status change", async ({
  page,
  request,
}, testInfo) => {
  const desktopViewport = page.viewportSize()!;
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
  await page.getByRole("link", { name: "改善課題", exact: true }).click();
  await expect(page.getByRole("heading", { name: "改善課題" })).toBeVisible();
  await expect(page.getByText("改善課題はまだ登録されていません。")).toBeVisible();
  await page.getByRole("button", { name: "課題を追加", exact: true }).click();
  await page.getByLabel("課題名").fill("運用記録の整備");
  await page.getByLabel("関連する評価基準").selectOption("1-2-1-1");
  await page.getByLabel("担当者名").fill("匿名の顧客担当者");
  await page.getByLabel("期日（日本時間）").fill("2026-10-20");
  await page.getByLabel("完了条件").fill("規程に沿った実施記録を照合できること");
  await page.screenshot({ path: ".local/e2e-reassessment-task-create.png", fullPage: true });
  await expectTaskFormFits(page, testInfo, "create-desktop");
  await page.setViewportSize({ width: 640, height: 900 });
  await page.screenshot({ path: ".local/e2e-reassessment-task-create-narrow.png", fullPage: true });
  await expectTaskFormFits(page, testInfo, "create-640px");
  await page.setViewportSize(desktopViewport);
  await page.getByRole("button", { name: "課題を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("課題を保存しました。");
  await page.getByRole("link", { name: "証跡", exact: true }).click();
  await page.getByRole("button", { name: "証跡を追加", exact: true }).click();
  await page.getByLabel("文書名").fill("匿名の運用記録");
  await page.getByLabel("該当箇所").fill("2026年9月の実施記録 / 第2章");
  await page.getByRole("checkbox", { name: "1-2-1-1", exact: true }).check();
  await page.getByRole("button", { name: "証跡を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("証跡を保存しました。");
  const beforeTaskCompletion = await getRecord();
  await page.getByRole("link", { name: "改善課題", exact: true }).click();
  await page.getByRole("button", { name: "運用記録の整備を編集" }).click();
  await page.getByLabel("進捗").selectOption("doing");
  await page.getByRole("button", { name: "課題を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("課題を保存しました。");
  await page.getByRole("button", { name: "運用記録の整備を編集" }).click();
  await page.getByLabel("進捗").selectOption("awaiting_review");
  await expect(page.getByRole("button", { name: "課題を保存", exact: true })).toBeDisabled();
  await page.getByLabel("結果", { exact: true }).fill("実施記録を整備し、内容を照合しました。");
  await page.getByRole("checkbox", { name: "匿名の運用記録", exact: true }).check();
  await page.getByRole("button", { name: "課題を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("課題を保存しました。");
  await page.getByRole("button", { name: "運用記録の整備の完了を確認" }).click();
  await page.getByLabel("確認メモ").fill("完了条件と運用記録を原本で照合しました。");
  await page.screenshot({ path: ".local/e2e-reassessment-task-review.png", fullPage: true });
  await page.getByRole("button", { name: "完了確認を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("完了確認を保存しました。");
  await expect(page.getByText("完了（確認済み）", { exact: true })).toBeVisible();
  const completed = await getRecord();
  expect(completed.document.responses).toEqual(beforeTaskCompletion.document.responses);
  expect(completed.counts).toEqual(before.counts);
  expect(completed.document.tasks[0]).toEqual({
    id: expect.any(String),
    sourceTaskId: null,
    sourceAssessmentId: null,
    criterionId: "1-2-1-1",
    title: "運用記録の整備",
    ownerName: "匿名の顧客担当者",
    dueDate: "2026-10-20",
    priority: "normal",
    state: "done",
    completionCondition: "規程に沿った実施記録を照合できること",
    result: "実施記録を整備し、内容を照合しました。",
    evidenceIds: [beforeTaskCompletion.document.evidence[0].id],
    review: {
      state: "confirmed",
      note: "完了条件と運用記録を原本で照合しました。",
      by: expect.any(String),
      at: expect.any(String),
      subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });
  await page.getByRole("link", { name: "再診断比較", exact: true }).click();
  await expect(page.getByRole("heading", { name: "再診断比較" })).toBeVisible();
  await page.getByLabel("再診断日").fill("2026-10-01");
  await page.getByLabel("対象拠点", { exact: true }).fill("本社と追加拠点");
  await page.getByRole("checkbox", { name: "運用記録の整備", exact: true }).check();
  await page.screenshot({ path: ".local/e2e-reassessment-create.png", fullPage: true });
  await page.setViewportSize({ width: 640, height: 900 });
  await expectTaskFormFits(page, testInfo, "reassessment-640px");
  await page.screenshot({ path: ".local/e2e-reassessment-create-narrow.png", fullPage: true });
  await page.setViewportSize(desktopViewport);
  await page.getByRole("button", { name: "再診断を作成", exact: true }).click();
  await expect(page.getByText("診断の差分", { exact: true })).toBeVisible();
  await expect(
    page.getByText("今回 revision 1 / 前回 revision " + completed.revision, { exact: true }),
  ).toBeVisible();
  const newId = /\/assessments\/([^/]+)\/comparison/.exec(page.url())![1];
  expect(newId === assessmentId).toBe(false);
  const copied = (
    await (
      await request.get(`/api/v1/assessments/${newId}`, { headers: { Authorization: token } })
    ).json()
  ).data;
  expect(copied.document.copiedFrom).toEqual({ assessmentId, revision: completed.revision });
  expect(copied.document.responses["1-2-1-1"].original).toBeNull();
  expect(copied.document.tasks[0]).toEqual({
    ...completed.document.tasks[0],
    id: expect.any(String),
    sourceTaskId: completed.document.tasks[0].id,
    sourceAssessmentId: assessmentId,
    state: "todo",
    result: "",
    evidenceIds: [copied.document.evidence[0].id],
    review: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
  });
  await page.getByRole("link", { name: "1-2-1-1", exact: true }).click();
  await page.getByLabel("現在の自己評価").selectOption("uncertain");
  await page.getByLabel("判定理由・確認メモ").fill("再確認が必要な事項を整理した");
  await page.getByRole("button", { name: "判定を保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  await page.getByRole("link", { name: "再診断比較", exact: true }).click();
  await expect(page.getByText("✖ 不足 → △ 判断微妙", { exact: true })).toBeVisible();
  await expect(page.getByText("前回の課題", { exact: true })).toBeVisible();
  await expect(page.getByText("引き継いだ課題", { exact: true })).toBeVisible();
  await expect(
    page.getByText("今回 revision 2 / 前回 revision " + completed.revision, { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/e2e-reassessment-comparison.png", fullPage: true });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.screenshot({ path: ".local/e2e-reassessment-comparison-narrow.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  expect(await getRecord()).toEqual(completed);
  expect(errors).toEqual([]);
  expect(evidenceFetches).toEqual([]);
});
