import { expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { cpus, totalmem, platform, release } from "node:os";
import { spawnSync } from "node:child_process";
import { unzipSync, zipSync } from "fflate";
import { importExcel } from "../fixtures/importExcel";
import { performanceInputs } from "./performanceInputs";
import { addTaskSchema } from "../../src/shared/contracts/improvement";
import { addEvidenceSchema } from "../../src/shared/contracts/evidence";
import { editResponseSchema } from "../../src/shared/contracts/assessment";
import { confirmAdviceSchema } from "../../src/shared/contracts/advice";
import { membersSchema } from "../../src/shared/contracts/access";
import { measurePdfWorkerMemory } from "../e2e/reportHeap";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import { requireSensitiveProcess } from "./sensitiveProcess.mjs";

// Anonymous input generators are data only. Every request and exported report
// below uses the deployed product, real auth and remote database (no fixture API).
export async function reportPerformance(
  page: Page,
  request: APIRequestContext,
  context: BrowserContext,
  operator: string,
  userId: string,
  origin: string,
  preflight: () => Promise<unknown>,
) {
  requireSensitiveProcess();
  await preflight();
  const { identifiers, scale } = JSON.parse(readFileSync(".local/live/cloud-results.json", "utf8"));
  expect(scale.assessments).toBe(500);
  const { customerId, caseId, assessmentId } = identifiers;
  const headers = () => ({ Authorization: `Bearer ${operator}`, "Idempotency-Key": randomUUID() });
  const read = async (path: string) => {
    const response = await request.get(`/api/v1${path}`, { headers: headers() });
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };
  const members = await read(`/customers/${customerId}/members`);
  const assigned = await request.put(`/api/v1/customers/${customerId}/members`, {
    headers: headers(),
    data: membersSchema.parse({
      expectedRevision: members.revision,
      mutationId: randomUUID(),
      userIds: [...new Set([...members.userIds, userId])],
    }),
  });
  expect(assigned.status()).toBe(200);
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.locator(`a[href="/customers/${customerId}"]`).click();
  await page.locator(`a[href="/cases/${caseId}"]`).click();
  await page.locator(`a[href="/assessments/${assessmentId}"]`).click();
  await page.getByRole("link", { name: "Excel取込", exact: true }).click();
  const archive = unzipSync(await importExcel());
  // Real decompression near the 10 MiB binary limit, not a forged ZIP declaration.
  archive["anonymous-padding.bin"] = randomBytes(10 * 1024 * 1024 - 200000);
  const excel = Buffer.from(zipSync(archive, { level: 0 }));
  expect(excel.length).toBeLessThanOrEqual(10485760);
  expect(excel.length).toBeGreaterThan(10485760 * 0.95);
  const importStart = Date.now();
  await page.getByLabel("Excelファイルを選択").setInputFiles({
    name: "anonymous-limit.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: excel,
  });
  await expect(page.getByRole("heading", { name: "取込内容を確認" })).toBeVisible({
    timeout: 15000,
  });
  const importMs = Date.now() - importStart;
  expect(importMs).toBeLessThan(15000); // includes upload-to-browser and remote preview; parser itself has a 10 s deadline.
  for (const [state, count] of Object.entries({ yes: 24, uncertain: 24, no: 28, unanswered: 5 }))
    await expect(page.getByTestId(`import-${state}-count`)).toHaveText(String(count));
  await page.getByRole("button", { name: "81回答を取り込む" }).click();
  await expect(
    page.getByRole("heading", { name: "この診断は取込済み、または回答を手動保存済みです" }),
  ).toBeVisible();
  let assessment: AssessmentDto = await read(`/assessments/${assessmentId}`);
  const ids = Object.keys(assessment.document.responses);
  const write = async (
    path: string,
    fields: Record<string, unknown>,
    method: "post" | "patch" = "post",
  ) => {
    const response = await request[method](`/api/v1/assessments/${assessmentId}${path}`, {
      headers: headers(),
      data: (path === "/tasks"
        ? addTaskSchema
        : path === "/evidence"
          ? addEvidenceSchema
          : path.startsWith("/responses/")
            ? editResponseSchema
            : confirmAdviceSchema
      ).parse({ expectedRevision: assessment.revision, mutationId: randomUUID(), ...fields }),
    });
    expect(response.status()).toBe(200);
    assessment = (await response.json()).data;
  };
  for (let index = assessment.document.evidence.length; index < 100; index++)
    await write("/evidence", performanceInputs(ids[index % 81], index, 0, "no").evidence);
  for (let index = assessment.document.tasks.length; index < 100; index++)
    await write("/tasks", performanceInputs(ids[index % 81], index, 0, "no").task);
  const baseBytes = Buffer.byteLength(JSON.stringify(assessment.document));
  const perField = Math.floor((1048576 - 50000 - baseBytes) / (81 * 3));
  expect(perField).toBeGreaterThan(2000);
  for (const id of ids)
    await write(
      `/responses/${id}`,
      performanceInputs(id, 0, perField, assessment.document.responses[id].status).response,
      "patch",
    );
  await write(`/advice/1-2-1-1/confirm`, performanceInputs("1-2-1-1", 0, 0, "no").advice);
  const documentBytes = Buffer.byteLength(JSON.stringify(assessment.document));
  expect(documentBytes).toBeGreaterThan(1048576 * 0.9);
  expect(documentBytes).toBeLessThanOrEqual(1048576);
  // Client-side navigation keeps the real in-memory authenticated session.
  await page.getByRole("link", { name: "レポート", exact: true }).click();
  await page.getByRole("button", { name: "出力内容を事前確認" }).click();
  await page.getByLabel("留意事項と出力内容を確認しました").check();
  await page.getByRole("button", { name: "この内容で版を確定" }).click();
  await expect(page.getByText("レポート版を確定しました。")).toBeVisible();
  const list = await read(`/assessments/${assessmentId}/reports`);
  const saved = await read(`/reports/${list.items[0].id}`);
  expect(saved.snapshot.assessment.revision).toBe(assessment.revision);
  const directory = ".local/live/report-qa";
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/snapshot.json`, JSON.stringify(saved.snapshot));
  const outputs: Record<string, unknown> = {};
  for (const [format, region, label] of [
    ["xlsx", "作業用Excelの保存", "Excel"],
    ["pdf", "PDFの保存", "PDF"],
  ] as const) {
    const panel = page.getByRole("region", { name: region });
    const memory = await measurePdfWorkerMemory(context, page),
      started = Date.now();
    await panel.getByRole("button", { name: `${label}を生成`, exact: true }).click();
    await expect(panel.getByRole("button", { name: `${label}を保存`, exact: true })).toBeVisible({
      timeout: 120000,
    });
    const elapsedMs = Date.now() - started;
    const heap = await memory.finish();
    expect(elapsedMs).toBeLessThan(120000);
    expect(heap.targets.length).toBe(1);
    expect(heap.sampleCount).toBeGreaterThan(0);
    expect(heap.errors).toEqual([]);
    const downloadEvent = page.waitForEvent("download");
    await panel.getByRole("button", { name: `${label}を保存`, exact: true }).click();
    await (await downloadEvent).saveAs(`${directory}/report.${format}`);
    outputs[format] = {
      elapsedMs,
      bytes: statSync(`${directory}/report.${format}`).size,
      sha256: createHash("sha256")
        .update(readFileSync(`${directory}/report.${format}`))
        .digest("hex"),
      heap,
    };
  }
  for (const width of [1440, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("region", { name: "PDFの保存" }).scrollIntoViewIfNeeded();
    // Anonymous report screen only: the authentication setup screen is never captured.
    await page.screenshot({ path: `${directory}/export-${width}.png`, fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  }
  const qa: Record<string, unknown> = {};
  for (const kind of ["pdf", "excel"]) {
    const result = spawnSync(
      process.env[kind === "pdf" ? "PDF_QA_PYTHON" : "EXCEL_QA_PYTHON"] ?? "python",
      ["-X", "utf8", `tests/${kind}/verify_report.py`, directory],
      { encoding: "utf8", timeout: 600000 },
    );
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({
      status: 0,
      stderr: "",
      error: undefined,
    });
    qa[kind] = JSON.parse(result.stdout);
  }
  writeFileSync(
    ".local/live/performance-results.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin,
        reportId: saved.snapshot.reportId,
        customers: 50,
        assessments: 500,
        criteria: 81,
        evidence: 100,
        tasks: 100,
        documentBytes,
        importBytes: excel.length,
        importMs,
        outputs,
        qa,
        device: {
          platform: platform(),
          release: release(),
          cpus: cpus().length,
          cpuModel: cpus()[0].model,
          totalMemory: totalmem(),
        },
        limitations:
          "This measured workstation is the release target; CDP sampled Worker heaps are not browser RSS or a memory upper bound.",
      },
      null,
      2,
    ),
  );
}
