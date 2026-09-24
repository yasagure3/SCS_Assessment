import { test, expect } from "@playwright/test";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { longReportAdvice } from "../fixtures/reportSnapshot";
import { measurePdfWorkerMemory } from "./reportHeap";

test("exports the full fixed Japanese report and retries after font failure, cancellation and 120-second timeout", async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(240_000);
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
    data: { name: "匿名PDF検証社" },
  });
  expect(customerResult.status()).toBe(201);
  const customer = (await customerResult.json()).data;
  const caseResult = await request.post(`/api/v1/customers/${customer.id}/cases`, {
    headers: headers(),
    data: {
      name: "長文レポート",
      standardId: "scs-20260327-star3",
      diagnosisDate: "2026-09-24",
      scope: {
        companies: "匿名PDF検証社",
        sites: "東京本社",
        departments: "全社",
        systems: "業務システム",
      },
    },
  });
  expect(caseResult.status()).toBe(201);
  const created = (await caseResult.json()).data;
  const assessmentId = created.assessmentId,
    criterionId = "1-2-1-1";
  expect((await request.post(`/__fixture/assessment/${assessmentId}`)).status()).toBe(200);
  const getAssessment = async () =>
    (
      await (
        await request.get(`/api/v1/assessments/${assessmentId}`, { headers: headers() })
      ).json()
    ).data;
  let assessment = await getAssessment();
  const content = {
    origin: "manual",
    templateId: null,
    gap: longReportAdvice,
    steps: ["担当者を定める", "月次点検を記録する"],
    evidenceExamples: ["点検記録", "運用規程"],
    completionCheck: "直近３か月分を照合する",
    notes: "匿名の確定助言",
  };
  expect(Array.from(longReportAdvice).length).toBeGreaterThanOrEqual(6443);
  const confirmed = await request.post(
    `/api/v1/assessments/${assessmentId}/advice/${criterionId}/confirm`,
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
  const draft = await request.put(
    `/api/v1/assessments/${assessmentId}/advice/${criterionId}/draft`,
    {
      headers: headers(),
      data: {
        expectedRevision: assessment.revision,
        mutationId: crypto.randomUUID(),
        content: { ...content, gap: "UNCONFIRMED_DRAFT" },
      },
    },
  );
  expect(draft.status()).toBe(200);
  // Navigate through the actual router without reloading the in-memory login session.
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
  const saved = (
    await (await request.get(`/api/v1/reports/${reportId}`, { headers: headers() })).json()
  ).data;
  expect(saved.snapshot.responses[criterionId].confirmedAdvice.content).toEqual(content);
  expect(saved.snapshot.counts).toEqual({ yes: 0, uncertain: 0, no: 1, unanswered: 80, total: 81 });
  await mkdir(".local/pdf-qa", { recursive: true });
  await writeFile(".local/pdf-qa/snapshot.json", JSON.stringify(saved.snapshot, null, 2));
  const panel = page.getByRole("region", { name: "PDFの保存" });
  let fontMode: "fail" | "hold" | "real" = "fail",
    release = () => {},
    heldRequests = 0;
  await context.route("**/fonts/NotoSansCJKjp-Regular.otf", async (route) => {
    if (fontMode === "fail") return route.fulfill({ status: 503, body: "unavailable" });
    if (fontMode === "hold")
      await new Promise<void>((resolve) => {
        heldRequests++;
        release = resolve;
      });
    await route.continue().catch(() => {}); // A cancelled worker can close its request.
  });
  await panel.getByRole("button", { name: "PDFを生成" }).click();
  await expect(panel.getByRole("alert")).toHaveText(
    "フォントを読み込めませんでした。同じ報告版で再試行してください。",
  );
  expect(await panel.getByRole("button", { name: "PDFを保存", exact: true }).count()).toBe(0);
  fontMode = "hold";
  let requests = fontUrls.length;
  await panel.getByRole("button", { name: "PDFを生成" }).click();
  await expect.poll(() => fontUrls.length).toBe(requests + 1);
  await expect.poll(() => heldRequests).toBe(1);
  await panel.getByRole("button", { name: "生成を取り消す" }).click();
  await expect(panel.getByRole("alert")).toHaveText(
    "生成を取り消しました。同じ報告版で再試行できます。",
  );
  release();
  // install() alone keeps time flowing. Pause BEFORE creating the timeout so
  // actionability checks and waiting for the font request cannot consume its budget.
  const timeoutClockStart = Date.now();
  await page.clock.install({ time: timeoutClockStart });
  await page.clock.pauseAt(timeoutClockStart + 60_000);
  const timeoutOrigin = await page.evaluate<number>("Date.now()");
  requests = fontUrls.length;
  await panel.getByRole("button", { name: "PDFを生成" }).click();
  await expect.poll(() => fontUrls.length).toBe(requests + 1);
  await expect.poll(() => heldRequests).toBe(2);
  expect(await page.evaluate("Date.now()")).toBe(timeoutOrigin);
  await page.clock.runFor(119999);
  expect(await page.evaluate("Date.now()")).toBe(timeoutOrigin + 119999);
  await expect(panel.getByRole("button", { name: "生成を取り消す" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "生成しています…" })).toBeDisabled();
  await page.clock.runFor(1);
  expect(await page.evaluate("Date.now()")).toBe(timeoutOrigin + 120000);
  await expect(panel.getByRole("alert")).toHaveText(
    "120秒以内に生成できませんでした。同じ報告版で再試行してください。",
  );
  release();
  await page.clock.resume();
  fontMode = "real";
  const heap = await measurePdfWorkerMemory(context, page);
  await panel.getByRole("button", { name: "PDFを生成" }).click();
  await expect(panel.getByRole("button", { name: "PDFを保存", exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const metrics = await panel.getByRole("status").innerText();
  const memory = await heap.finish();
  await writeFile(".local/pdf-qa/worker-memory.json", JSON.stringify(memory, null, 2));
  expect(memory.errors).toEqual([]);
  expect(memory.targets.length).toBe(1);
  expect(memory.sampleCount).toBeGreaterThanOrEqual(2);
  expect(memory.peaks.usedSize).toBeGreaterThan(0);
  expect(memory.peaks.backingStorageSize).toBeGreaterThanOrEqual(16_467_736);
  for (const width of [1440, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/pdf-qa/export-${width}.png`, fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
      true,
    );
  }
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "PDFを保存", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`SCS-${reportId}.pdf`);
  await download.saveAs(".local/pdf-qa/report.pdf");
  expect((await stat(".local/pdf-qa/report.pdf")).size).toBeGreaterThan(10_000_000);
  const qa = spawnSync(
    process.env.PDF_QA_PYTHON ?? "python",
    ["-X", "utf8", "tests/pdf/verify_report.py", ".local/pdf-qa"],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect({ status: qa.status, stderr: qa.stderr, error: qa.error?.message }).toEqual({
    status: 0,
    stderr: "",
    error: undefined,
  });
  expect(JSON.parse(qa.stdout).all81OfficialTexts).toBe(true);
  // Current customer/assessment changes must not become the old report's export source.
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
      await request.patch(`/api/v1/assessments/${assessmentId}/responses/${criterionId}`, {
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
  await panel.getByRole("button", { name: "PDFを生成" }).click();
  await expect(panel.getByRole("button", { name: "PDFを保存", exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const secondDownload = page.waitForEvent("download");
  await panel.getByRole("button", { name: "PDFを保存", exact: true }).click();
  await (await secondDownload).saveAs(".local/pdf-qa/report-retry.pdf");
  const retryQa = spawnSync(
    process.env.PDF_QA_PYTHON ?? "python",
    [
      "-X",
      "utf8",
      "tests/pdf/verify_report.py",
      ".local/pdf-qa",
      "report-retry.pdf",
      "--no-render",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect({ status: retryQa.status, stderr: retryQa.stderr }).toEqual({ status: 0, stderr: "" });
  expect(fontUrls.length).toBeGreaterThanOrEqual(5);
  expect(fontUrls.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  // A real font/render attempt must reject a missing glyph rather than silently substituting it.
  const missing = await page.evaluate(async (snapshot) => {
    const modulePath = "/src/front/workers/reportClient.ts";
    const module = await import(modulePath);
    const altered = structuredClone(snapshot);
    altered.customer.name = "欠字\u{1FAE8}";
    try {
      await module.startReportPdf(altered, () => {}).promise;
      return "unexpected success";
    } catch (error) {
      return error instanceof Error ? error.message : "unexpected error";
    }
  }, saved.snapshot);
  expect(missing).toBe("PDF_GLYPH_MISSING:U+1FAE8");
  await writeFile(
    ".local/pdf-qa/browser-metrics.json",
    JSON.stringify(
      {
        reportId,
        metrics,
        bytes: (await stat(".local/pdf-qa/report.pdf")).size,
        fontRequests: fontUrls.length,
        memory: {
          method: memory.method,
          sampleCount: memory.sampleCount,
          peaks: memory.peaks,
          limitations: memory.limitations,
        },
        timeout: "120000ms real browser timer tested with Playwright clock; font network held",
        cancelled: true,
        sameSnapshotAfterEdit: true,
        missingGlyphRejected: missing,
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
