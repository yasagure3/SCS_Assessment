import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { importExcel, oversizedZip } from "../fixtures/importExcel";
async function setup(page: Page, request: APIRequestContext) {
  expect((await request.post("/__fixture/reset")).ok()).toBe(true);
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
    data: { name: "匿名取込検証社" },
  });
  expect(customer.status()).toBe(201);
  const { data: c } = await customer.json();
  const created = await request.post(`/api/v1/customers/${c.id}/cases`, {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: { name: "初回Excel検査", standardId: "scs-20260327-star3" },
  });
  expect(created.status()).toBe(201);
  const { data: k } = await created.json();
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${c.id}"]`).click();
  await page.locator(`a[href="/cases/${k.case.id}"]`).click();
  await page.locator(`a[href="/assessments/${k.assessmentId}"]`).click();
  await page.getByRole("link", { name: "Excel取込", exact: true }).click();
  await expect(page.getByLabel("Excelファイルを選択")).toBeEnabled();
  return { token, id: k.assessmentId as string };
}
const upload = (page: Page, buffer: Buffer, name = "anonymous.xlsx") =>
  page.getByLabel("Excelファイルを選択").setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
test("imports an anonymous xlsx as 24/24/28/5 and preserves every source O–R string", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const f = await setup(page, request),
    buffer = await importExcel();
  const sent: Record<string, any>[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/imports")) sent.push(req.postDataJSON());
  });
  await page.screenshot({ path: ".local/e2e-import-select.png", fullPage: true });
  await upload(page, buffer);
  await expect(page.getByRole("heading", { name: "取込内容を確認" })).toBeVisible();
  for (const [state, count] of Object.entries({ yes: 24, uncertain: 24, no: 28, unanswered: 5 }))
    await expect(page.getByTestId(`import-${state}-count`)).toHaveText(String(count));
  await expect(
    page.getByText("anonymous.xlsx · ★3 81基準 / ★4 72基準を除外", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/e2e-import-preview.png", fullPage: true });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.screenshot({ path: ".local/e2e-import-preview-narrow.png", fullPage: true });
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.getByRole("button", { name: "81回答を取り込む" }).click();
  await expect(
    page.getByRole("heading", { name: "この診断は取込済み、または回答を手動保存済みです" }),
  ).toBeVisible();
  const response = await request.get(`/api/v1/assessments/${f.id}`, {
      headers: { Authorization: f.token },
    }),
    { data } = await response.json();
  expect(data.counts).toEqual({ yes: 24, uncertain: 24, no: 28, unanswered: 5, total: 81 });
  expect(sent).toHaveLength(2);
  for (const row of sent[1].normalized.rows) {
    const { criterionId, ...original } = row;
    expect(data.document.responses[criterionId].original).toEqual(original);
    expect({
      reason: data.document.responses[criterionId].reason,
      basis: data.document.responses[criterionId].basis,
      plannedWork: data.document.responses[criterionId].plannedWork,
      supplement: data.document.responses[criterionId].supplement,
    }).toEqual({ reason: row.P, basis: row.Q, plannedWork: "", supplement: row.R });
  }
  expect(Object.keys(sent[0]).sort()).toEqual(["expectedRevision", "normalized"]);
  expect(Object.keys(sent[1]).sort()).toEqual([
    "acknowledgedMissingIds",
    "expectedRevision",
    "mutationId",
    "normalized",
    "normalizedSha256",
  ]);
  expect(errors).toEqual([]);
});
test("blocks formulas, version changes and unknown IDs; missing criteria require explicit acknowledgement", async ({
  page,
  request,
}) => {
  const f = await setup(page, request);
  for (const kind of ["formula", "version", "unknown"]) {
    await upload(page, await importExcel(kind));
    await expect(page.getByRole("heading", { name: "取込できない箇所" })).toBeVisible();
    await expect(page.getByRole("button", { name: "81回答を取り込む" })).toHaveCount(0);
  }
  await upload(page, await importExcel("missing"));
  await expect(page.getByRole("heading", { name: "欠落した★3基準 1件" })).toBeVisible();
  await expect(page.getByRole("button", { name: "81回答を取り込む" })).toBeDisabled();
  await page.getByLabel("欠落した基準を未回答として取り込むことを確認しました").check();
  await page.getByRole("button", { name: "81回答を取り込む" }).click();
  await expect(
    page.getByRole("heading", { name: "この診断は取込済み、または回答を手動保存済みです" }),
  ).toBeVisible();
  const { data } = await (
    await request.get(`/api/v1/assessments/${f.id}`, { headers: { Authorization: f.token } })
  ).json();
  expect(data.counts).toEqual({ yes: 23, uncertain: 24, no: 28, unanswered: 6, total: 81 });
  expect(data.document.responses["1-2-1-1"].original).toBe(null);
});
test("rejects actual ZIP expansion and terminates real workers on cancellation and the 10-second deadline", async ({
  page,
  request,
  context,
}, testInfo) => {
  test.setTimeout(60000);
  const f = await setup(page, request),
    before = await (
      await request.get(`/api/v1/assessments/${f.id}`, { headers: { Authorization: f.token } })
    ).json();
  const timings: Record<string, number> = {};
  for (const kind of ["entry", "total"] as const) {
    const start = Date.now();
    await upload(page, oversizedZip(kind));
    await expect(page.getByRole("alert")).toHaveText(
      `ファイルを検査できませんでした（${kind === "entry" ? "ZIP_ENTRY_SIZE_LIMIT" : "ZIP_EXPANDED_SIZE_LIMIT"}）。対応形式・サイズを確認してください。`,
    );
    timings[kind] = Date.now() - start;
    await expect.poll(() => page.workers().length).toBe(0);
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const heapBefore = await cdp.send("Runtime.getHeapUsage");
  const lifetime = async (cancel: boolean) =>
    page.evaluate(
      async ({ cancel, url }) => {
        const module = await import(/* @vite-ignore */ url);
        return module.workerLifetime(cancel);
      },
      { cancel, url: "/tests/fixtures/importHarness.ts" },
    );
  const cancelled = await lifetime(true);
  expect(cancelled.code).toBe("WORKER_CANCELLED");
  expect(cancelled.terminated).toBe(1);
  expect(cancelled.elapsedMs).toBeLessThan(5000);
  await expect.poll(() => page.workers().length).toBe(0);
  const timeout = await lifetime(false);
  expect(timeout.code).toBe("WORKER_TIMEOUT");
  expect(timeout.terminated).toBe(1);
  expect(timeout.elapsedMs).toBeGreaterThanOrEqual(9900);
  expect(timeout.elapsedMs).toBeLessThan(13000);
  await expect.poll(() => page.workers().length).toBe(0);
  await cdp.send("HeapProfiler.collectGarbage");
  const heapAfter = await cdp.send("Runtime.getHeapUsage");
  const after = await (
    await request.get(`/api/v1/assessments/${f.id}`, { headers: { Authorization: f.token } })
  ).json();
  expect(after.data).toEqual(before.data);
  const metrics = {
    userAgent: await page.evaluate(() => navigator.userAgent),
    zipElapsedMs: timings,
    cancelled,
    timeout,
    heapBefore,
    heapAfter,
    remainingWorkers: page.workers().length,
    memoryScope:
      "CDP main-page heap after GC; dedicated worker peak memory is not exposed. Real busy workers allocated 8MiB and their targets were removed after termination.",
  };
  await writeFile(".local/import-browser-metrics.json", JSON.stringify(metrics, null, 2));
  await testInfo.attach("import-browser-metrics", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});
