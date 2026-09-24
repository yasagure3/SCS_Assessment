import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import type { SavedReport } from "../../src/shared/contracts/reports";
import { longReportAdvice } from "../fixtures/reportSnapshot";

test("downloads Excel and PDF for the same fixed report and re-exports the original workbook after later edits", async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(240_000);
  const boundaryText = "_x0041_ / _x000A_\r\n二行目";
  const errors: string[] = [],
    fontUrls: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (r) => {
    if (r.url().endsWith("/fonts/NotoSansCJKjp-Regular.otf")) fontUrls.push(r.url());
  });
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
  const headers = () => ({ Authorization: token, "Idempotency-Key": crypto.randomUUID() });
  const customerResult = await request.post("/api/v1/customers", {
    headers: headers(),
    data: { name: "匿名Excel_x0041_検証社" },
  });
  expect(customerResult.status()).toBe(201);
  const customer = (await customerResult.json()).data;
  const caseResult = await request.post(`/api/v1/customers/${customer.id}/cases`, {
    headers: headers(),
    data: {
      name: "作業ブック検証",
      standardId: "scs-20260327-star3",
      diagnosisDate: "2026-09-24",
      scope: {
        companies: "匿名Excel検証社",
        sites: `本社 ${boundaryText}`,
        departments: "全社",
        systems: "業務システム",
      },
    },
  });
  expect(caseResult.status()).toBe(201);
  const created = (await caseResult.json()).data,
    assessmentId = created.assessmentId;
  expect((await request.post(`/__fixture/assessment/${assessmentId}`)).status()).toBe(200);
  const getAssessment = async (): Promise<AssessmentDto> =>
    (
      await (
        await request.get(`/api/v1/assessments/${assessmentId}`, { headers: headers() })
      ).json()
    ).data;
  const first = "1-2-1-1",
    second = "1-2-1-2";
  let assessment = await getAssessment();
  for (const [criterionId, fields] of [
    [
      first,
      {
        status: "no",
        reason: `=SUM(A1:A2)\r\n${boundaryText}`,
        basis: "+根拠",
        plannedWork: "-作業",
        supplement: "@補足\n末尾 ",
      },
    ],
    [
      second,
      { status: "unanswered", reason: "\tタブ始まり", basis: "", plannedWork: "", supplement: "" },
    ],
  ] as const) {
    const changed = await request.patch(
      `/api/v1/assessments/${assessmentId}/responses/${criterionId}`,
      {
        headers: headers(),
        data: { expectedRevision: assessment.revision, mutationId: crypto.randomUUID(), ...fields },
      },
    );
    expect(changed.status()).toBe(200);
    assessment = (await changed.json()).data;
  }
  const fileBytes = Buffer.from("匿名の証跡本文", "utf8");
  const uploaded = await request.post(`/api/v1/cases/${created.case.id}/files`, {
    headers: {
      ...headers(),
      "X-File-Name": encodeURIComponent("固定時の証跡.txt"),
      "X-Content-SHA256": createHash("sha256").update(fileBytes).digest("hex"),
      "Content-Type": "text/plain",
    },
    data: fileBytes,
  });
  expect(uploaded.status()).toBe(201);
  const file = (await uploaded.json()).data;
  const evidenceResult = await request.post(`/api/v1/assessments/${assessmentId}/evidence`, {
    headers: headers(),
    data: {
      expectedRevision: assessment.revision,
      mutationId: crypto.randomUUID(),
      criterionIds: [first, second],
      name: "匿名運用記録",
      url: "https://example.invalid/manual?id=42#page=3",
      location: `第３章 ${boundaryText}`,
      fileId: file.fileId,
    },
  });
  expect(evidenceResult.status()).toBe(200);
  assessment = (await evidenceResult.json()).data;
  const evidenceId = assessment.document.evidence[0].id;
  const reviewed = await request.post(
    `/api/v1/assessments/${assessmentId}/evidence/${evidenceId}/reviews/${first}`,
    {
      headers: headers(),
      data: {
        expectedRevision: assessment.revision,
        mutationId: crypto.randomUUID(),
        state: "confirmed",
        note: "原本を照合済み",
      },
    },
  );
  expect(reviewed.status()).toBe(200);
  assessment = (await reviewed.json()).data;
  const credentialEvidence = await request.post(`/api/v1/assessments/${assessmentId}/evidence`, {
    headers: headers(),
    data: {
      expectedRevision: assessment.revision,
      mutationId: crypto.randomUUID(),
      criterionIds: [first],
      name: "認証URLの匿名検証",
      url: "https://example.invalid/manual?apiKey=ANONYMOUS_SECRET#authCode=ANONYMOUS_SECRET",
      location: "",
    },
  });
  expect(credentialEvidence.status()).toBe(200);
  assessment = (await credentialEvidence.json()).data;
  for (const title of ["月次点検", "+記録整備"]) {
    const added = await request.post(`/api/v1/assessments/${assessmentId}/tasks`, {
      headers: headers(),
      data: {
        expectedRevision: assessment.revision,
        mutationId: crypto.randomUUID(),
        criterionId: first,
        title,
        ownerName: "固定担当者",
        dueDate: "2026-10-31",
        priority: "high",
        completionCondition: `責任者が記録を確認する ${boundaryText}`,
      },
    });
    expect(added.status()).toBe(200);
    assessment = (await added.json()).data;
  }
  const content = {
    origin: "manual",
    templateId: null,
    gap: longReportAdvice,
    steps: ["担当者を定める", "月次点検を記録する"],
    evidenceExamples: ["点検記録", "運用規程"],
    completionCheck: "直近３か月分を照合する",
    notes: `匿名確定助言 ${boundaryText}`,
  };
  const confirmed = await request.post(
    `/api/v1/assessments/${assessmentId}/advice/${first}/confirm`,
    {
      headers: headers(),
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
  const draft = await request.put(`/api/v1/assessments/${assessmentId}/advice/${first}/draft`, {
    headers: headers(),
    data: {
      expectedRevision: assessment.revision,
      mutationId: crypto.randomUUID(),
      content: { ...content, gap: "UNCONFIRMED_DRAFT" },
    },
  });
  expect(draft.status()).toBe(200);
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${customer.id}"]`).click();
  await page.locator(`a[href="/cases/${created.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${assessmentId}"]`).click();
  await page.getByRole("link", { name: "レポート", exact: true }).click();
  await page.getByRole("button", { name: "出力内容を事前確認" }).click();
  await expect(page.getByText("未回答: 80件", { exact: true })).toBeVisible();
  await page.getByLabel("留意事項と出力内容を確認しました").check();
  await page.getByRole("button", { name: "この内容で版を確定" }).click();
  await expect(page.getByText("レポート版を確定しました。")).toBeVisible();
  const list = (
    await (
      await request.get(`/api/v1/assessments/${assessmentId}/reports`, { headers: headers() })
    ).json()
  ).data;
  const reportId = list.items[0].id;
  const saved: SavedReport = (
    await (await request.get(`/api/v1/reports/${reportId}`, { headers: headers() })).json()
  ).data;
  expect(saved.snapshot.counts).toEqual({ yes: 0, uncertain: 0, no: 1, unanswered: 80, total: 81 });
  expect(saved.snapshot.responses[first].confirmedAdvice!.content).toEqual(content);
  expect(saved.snapshot.responses[first].reason).toBe(`=SUM(A1:A2)\r\n${boundaryText}`);
  expect(saved.snapshot.evidence.length).toBe(2);
  expect(saved.snapshot.evidence[0].file!.originalName).toBe("固定時の証跡.txt");
  await mkdir(".local/excel-qa", { recursive: true });
  await writeFile(".local/excel-qa/snapshot.json", JSON.stringify(saved.snapshot, null, 2));
  const excel = page.getByRole("region", { name: "作業用Excelの保存" });
  await expect(
    excel.getByText("作業用Excelは再取込対象外です。PDFと同じ報告版から5シートを生成します。", {
      exact: true,
    }),
  ).toBeVisible();
  await excel.getByRole("button", { name: "Excelを生成", exact: true }).click();
  await expect(excel.getByRole("button", { name: "Excelを保存" })).toBeVisible({
    timeout: 120_000,
  });
  expect(fontUrls).toEqual([]);
  const excelDownload = page.waitForEvent("download");
  await excel.getByRole("button", { name: "Excelを保存" }).click();
  const downloadedExcel = await excelDownload;
  expect(downloadedExcel.suggestedFilename()).toBe(`SCS-${reportId}.xlsx`);
  await downloadedExcel.saveAs(".local/excel-qa/report.xlsx");
  const pdf = page.getByRole("region", { name: "PDFの保存" });
  await pdf.getByRole("button", { name: "PDFを生成", exact: true }).click();
  await expect(pdf.getByRole("button", { name: "PDFを保存", exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const pdfDownload = page.waitForEvent("download");
  await pdf.getByRole("button", { name: "PDFを保存", exact: true }).click();
  const downloadedPdf = await pdfDownload;
  expect(downloadedPdf.suggestedFilename()).toBe(`SCS-${reportId}.pdf`);
  await downloadedPdf.saveAs(".local/excel-qa/report.pdf");
  const verifyExcel = (filename: string) => {
    const qa = spawnSync(
      process.env.EXCEL_QA_PYTHON ?? process.env.PDF_QA_PYTHON ?? "python",
      ["-X", "utf8", "tests/excel/verify_report.py", ".local/excel-qa", filename],
      { encoding: "utf8", timeout: 120_000 },
    );
    expect({ status: qa.status, stderr: qa.stderr, error: qa.error?.message }).toEqual({
      status: 0,
      stderr: "",
      error: undefined,
    });
    expect(JSON.parse(qa.stdout)).toEqual({
      reportId,
      sheets: ["サマリー", "評価基準", "証跡", "改善課題", "未回答・未確認"],
      criteria: 81,
      counts: saved.snapshot.counts,
      allRowsMatch: true,
      pdfMatches: true,
    });
    return JSON.parse(qa.stdout);
  };
  const verification = verifyExcel("report.xlsx");
  for (const width of [1440, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await excel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/excel-qa/export-${width}.png`, fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
      true,
    );
  }
  expect(
    (
      await request.patch(`/api/v1/customers/${customer.id}`, {
        headers: headers(),
        data: { expectedRevision: 1, mutationId: crypto.randomUUID(), name: "変更後の会社名" },
      })
    ).status(),
  ).toBe(200);
  assessment = await getAssessment();
  expect(
    (
      await request.patch(`/api/v1/assessments/${assessmentId}/responses/${first}`, {
        headers: headers(),
        data: {
          expectedRevision: assessment.revision,
          mutationId: crypto.randomUUID(),
          status: "yes",
          reason: "変更後の回答",
          basis: "",
          plannedWork: "",
          supplement: "",
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("link", { name: "評価基準一覧", exact: true }).click();
  await page.getByRole("link", { name: "レポート", exact: true }).click();
  await page.getByRole("button", { name: "この版を開く" }).click();
  await excel.getByRole("button", { name: "Excelを生成", exact: true }).click();
  await expect(excel.getByRole("button", { name: "Excelを保存" })).toBeVisible({
    timeout: 120_000,
  });
  const retryDownload = page.waitForEvent("download");
  await excel.getByRole("button", { name: "Excelを保存" }).click();
  const retry = await retryDownload;
  expect(retry.suggestedFilename()).toBe(`SCS-${reportId}.xlsx`);
  await retry.saveAs(".local/excel-qa/report-retry.xlsx");
  expect(verifyExcel("report-retry.xlsx")).toEqual(verification);
  await writeFile(
    ".local/excel-qa/verification.json",
    JSON.stringify(
      {
        ...verification,
        sameSnapshotAfterEdit: true,
        stringCells: true,
        noFormulasOrExternalLinks: true,
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
