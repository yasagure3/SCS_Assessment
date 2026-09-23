import { test, expect } from "@playwright/test";

test("confirms a report with limitations and retrieves the same historical version after editing", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await request.post("/__fixture/reset")).status()).toBe(200);
  let token = "";
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
  const customer = await request.post("/api/v1/customers", {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "匿名レポート検証社" },
  });
  expect(customer.status()).toBe(201);
  const customerData = (await customer.json()).data;
  const created = await request.post(`/api/v1/customers/${customerData.id}/cases`, {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: {
      name: "2026年9月 診断報告",
      standardId: "scs-20260327-star3",
      diagnosisDate: "2026-09-22",
      scope: {
        companies: "匿名レポート検証社",
        sites: "東京本社",
        departments: "全社",
        systems: "受発注・管理システム",
      },
    },
  });
  expect(created.status()).toBe(201);
  const caseData = (await created.json()).data,
    assessmentId = caseData.assessmentId,
    criterionId = "1-2-1-1";
  expect((await request.post(`/__fixture/assessment/${assessmentId}`)).status()).toBe(200);
  const readAssessment = async () =>
    (
      await (
        await request.get(`/api/v1/assessments/${assessmentId}`, {
          headers: { Authorization: token },
        })
      ).json()
    ).data;
  let assessment = await readAssessment();
  const content = {
    origin: "manual",
    templateId: null,
    gap: "運用記録の整備が必要",
    steps: ["責任者を定め、月次の記録を残す"],
    evidenceExamples: ["運用点検記録"],
    completionCheck: "直近3か月の記録を照合する",
    notes: "匿名fixture",
  };
  const confirmed = await request.post(
    `/api/v1/assessments/${assessmentId}/advice/${criterionId}/confirm`,
    {
      headers: { Authorization: token },
      data: {
        expectedRevision: assessment.revision,
        mutationId: crypto.randomUUID(),
        content,
        reviewed: true,
      },
    },
  );
  expect(confirmed.status()).toBe(200);
  assessment = (await confirmed.json()).data;
  const draft = await request.put(
    `/api/v1/assessments/${assessmentId}/advice/${criterionId}/draft`,
    {
      headers: { Authorization: token },
      data: {
        expectedRevision: assessment.revision,
        mutationId: crypto.randomUUID(),
        content: { ...content, gap: "未確定の新しい案" },
      },
    },
  );
  expect(draft.status()).toBe(200);
  const before = await readAssessment();
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${customerData.id}"]`).click();
  await page.locator(`a[href="/cases/${caseData.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${assessmentId}"]`).click();
  await page.getByRole("link", { name: "レポート", exact: true }).click();
  await expect(page.getByRole("heading", { name: "レポート", exact: true })).toBeVisible();
  await expect(page.getByText("確定したレポートはまだありません。")).toBeVisible();
  await page.getByRole("button", { name: "出力内容を事前確認" }).click();
  await expect(page.getByText("確定済み版を出力。新しい下書きは含めない")).toBeVisible();
  await expect(page.getByText("未回答: 80件", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "この内容で版を確定" })).toBeDisabled();
  for (const width of [1440, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: `.local/e2e-reports-preview-${width}.png`, fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("留意事項と出力内容を確認しました").check();
  await page.getByRole("button", { name: "この内容で版を確定" }).click();
  await expect(page.getByText("レポート版を確定しました。")).toBeVisible();
  const list = await request.get(`/api/v1/assessments/${assessmentId}/reports`, {
    headers: { Authorization: token },
  });
  const reports = (await list.json()).data;
  expect(reports.items.length).toBe(1);
  const reportId = reports.items[0].id;
  const getReport = async () =>
    (
      await (
        await request.get(`/api/v1/reports/${reportId}`, { headers: { Authorization: token } })
      ).json()
    ).data;
  const fixed = await getReport();
  expect(fixed.snapshot.counts).toEqual(before.counts);
  expect(Object.keys(fixed.snapshot.responses).length).toBe(81);
  expect(fixed.snapshot.responses[criterionId].confirmedAdvice.content).toEqual(content);
  expect(fixed.snapshot.limitations.draftPendingIds).toEqual([criterionId]);
  expect(await page.getByText(reportId, { exact: true }).count()).toBe(1);
  await page.screenshot({ path: ".local/e2e-reports-saved-1440.png", fullPage: true });
  const rename = await request.patch(`/api/v1/customers/${customerData.id}`, {
    headers: { Authorization: token },
    data: { expectedRevision: 1, mutationId: crypto.randomUUID(), name: "匿名・変更後の会社名" },
  });
  expect(rename.status()).toBe(200);
  const edited = await request.patch(
    `/api/v1/assessments/${assessmentId}/responses/${criterionId}`,
    {
      headers: { Authorization: token },
      data: {
        expectedRevision: before.revision,
        mutationId: crypto.randomUUID(),
        status: "yes",
        reason: "報告後の編集",
        basis: "新しい記録",
        plannedWork: "",
        supplement: "",
      },
    },
  );
  expect(edited.status()).toBe(200);
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByRole("link", { name: "レポート", exact: true }).click();
  await page.getByRole("button", { name: "この版を開く" }).click();
  await expect(page.getByText(reportId, { exact: true })).toBeVisible();
  const historical = page.getByRole("region", { name: "保存済みの報告内容" });
  await expect(
    historical.getByRole("heading", { name: "匿名レポート検証社 ／ 2026年9月 診断報告" }),
  ).toBeVisible();
  expect(await getReport()).toEqual(fixed);
  await page.setViewportSize({ width: 640, height: 1000 });
  await page.screenshot({ path: ".local/e2e-reports-history-640.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
