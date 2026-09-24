import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { importExcel } from "../fixtures/importExcel";
import type { AssessmentDto } from "../../src/shared/contracts/assessments";
import type { SavedReport } from "../../src/shared/contracts/reports";

test.use({ actionTimeout: 15_000 });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByLabel("新しいパスワード").fill("NewPassword123!");
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("link", { name: "顧客・案件を開く" })).toBeVisible();
}

test("an invited operator completes import, evidence, human advice, tasks, reassessment and both fixed exports while preserving the previous report", async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  const directory = ".local/journey";
  await mkdir(directory, { recursive: true });
  const errors: string[] = [],
    external: string[] = [];
  const reset = await request.post("/__fixture/access-reset");
  expect(reset.status()).toBe(200);
  const { assigned } = await reset.json();
  const email = `access-journey-${crypto.randomUUID()}@example.invalid`;
  await login(page, "access-admin@example.invalid");
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await page.getByRole("link", { name: "管理・利用設定" }).click();
  await page.getByLabel("社内メールアドレス").fill(email);
  await page.getByLabel(`割当会社-${assigned}`, { exact: true }).check();
  await page.getByRole("button", { name: "招待メールを送信" }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  expect(await (await request.get("/__fixture/invitation-deliveries")).json()).toEqual([
    { email, sub: expect.stringMatching(/^fixture-invited-/) },
  ]);
  const context = await browser.newContext({ baseURL }),
    staff = await context.newPage();
  let token = "";
  staff.on("pageerror", (error) => errors.push(error.message));
  staff.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
    if (!req.url().startsWith(baseURL!)) external.push(req.url());
  });
  try {
    await login(staff, email);
    await staff.getByRole("link", { name: "顧客・案件を開く" }).click();
    await staff.getByLabel("顧客名", { exact: true }).fill("匿名業務動線社");
    await staff.getByRole("button", { name: "顧客を追加", exact: true }).click();
    await staff.getByLabel("案件名", { exact: true }).fill("匿名の初回診断");
    await staff.getByRole("button", { name: "案件を作成", exact: true }).click();
    await expect(staff.getByTestId("unanswered-count")).toHaveText("81");
    const id = new URL(staff.url()).pathname.split("/").at(-1)!;
    const read = async (assessmentId = id): Promise<AssessmentDto> => {
      const response = await request.get(`/api/v1/assessments/${assessmentId}`, {
        headers: { Authorization: token },
      });
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };
    await staff.getByRole("link", { name: "レポート", exact: true }).click();
    await expect(
      staff.getByText("確定したレポートはまだありません。", { exact: true }),
    ).toBeVisible();
    await staff.getByRole("button", { name: "出力内容を事前確認" }).click();
    const confirmation = staff.getByRole("group", { name: "レポート版の確定" });
    await confirmation.getByLabel("留意事項と出力内容を確認しました").check();
    const confirm = confirmation.getByRole("button", { name: "この内容で版を確定" });
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAccessibleDescription(
      "必須項目を入力すると版を確定できます。 対象会社: 対象範囲を入力してください。 対象拠点: 対象範囲を入力してください。 対象部署: 対象範囲を入力してください。 対象システム: 対象範囲を入力してください。 診断日: 診断日を入力してください。 不足項目を入力する 保存後、レポートに戻って事前確認してください。",
    );
    await confirmation.scrollIntoViewIfNeeded();
    await staff.screenshot({ path: `${directory}/missing-scope.png` });
    await confirmation.getByRole("link", { name: "不足項目を入力する" }).click();
    await expect(staff).toHaveURL(new RegExp(`/assessments/${id}#assessment-scope$`));
    for (const [name, value] of [
      ["対象会社", "匿名業務動線社"],
      ["対象拠点", "本社"],
      ["対象部署", "管理部"],
      ["対象システム", "基幹"],
    ])
      await staff.getByLabel(name, { exact: true }).fill(value);
    await staff.getByLabel("診断日", { exact: true }).fill("2026-09-25");
    await staff.getByRole("button", { name: "対象範囲を保存" }).click();
    await expect(staff.getByRole("status")).toHaveText("保存しました。");
    await staff.getByRole("link", { name: "Excel取込", exact: true }).click();
    await staff.getByLabel("Excelファイルを選択").setInputFiles({
      name: "anonymous.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await importExcel(),
    });
    await expect(staff.getByRole("heading", { name: "取込内容を確認" })).toBeVisible();
    for (const [state, count] of Object.entries({ yes: 24, uncertain: 24, no: 28, unanswered: 5 }))
      await expect(staff.getByTestId(`import-${state}-count`)).toHaveText(String(count));
    await staff.getByRole("button", { name: "81回答を取り込む" }).click();
    await expect(
      staff.getByRole("heading", { name: "この診断は取込済み、または回答を手動保存済みです" }),
    ).toBeVisible();
    const imported = await read(),
      first = "1-2-1-1";
    expect(imported.counts).toEqual({ yes: 24, uncertain: 24, no: 28, unanswered: 5, total: 81 });
    await staff.getByRole("link", { name: "証跡", exact: true }).click();
    await expect(
      staff.getByText("証跡はまだ関連付けられていません。", { exact: true }),
    ).toBeVisible();
    await staff.getByRole("button", { name: "証跡を追加", exact: true }).click();
    await staff.getByLabel("文書名").fill("匿名規程");
    await staff.getByLabel("該当箇所").fill("第2章");
    await staff.getByRole("checkbox", { name: first, exact: true }).check();
    await staff.getByRole("button", { name: "証跡を保存", exact: true }).click();
    await expect(staff.getByRole("status")).toHaveText("証跡を保存しました。");
    await staff.getByRole("button", { name: `匿名規程 ${first} の確認を記録` }).click();
    await staff.getByLabel("確認結果").selectOption("confirmed");
    await staff.getByLabel("確認メモ").fill("原本の責任者と照合");
    await staff.getByRole("button", { name: "確認を保存", exact: true }).click();
    await expect(staff.getByRole("status")).toHaveText("確認を保存しました。");
    expect((await read()).counts).toEqual(imported.counts);
    await staff.getByRole("link", { name: first, exact: true }).click();
    await staff.getByLabel("判定理由・確認メモ").fill("人が原本を確認した理由");
    const current = await read();
    // A real concurrent API write exercises the visible 409 recovery without discarding the draft.
    const changed = await request.patch(`/api/v1/assessments/${id}/responses/${first}`, {
      headers: { Authorization: token },
      data: {
        expectedRevision: current.revision,
        mutationId: crypto.randomUUID(),
        status: "yes",
        reason: "別担当者の理由",
        basis: "別担当者の根拠",
        plannedWork: "",
        supplement: "",
      },
    });
    expect(changed.status()).toBe(200);
    await staff.getByRole("button", { name: "判定を保存", exact: true }).click();
    await expect(staff.getByLabel("判定理由・確認メモ")).toHaveValue("人が原本を確認した理由");
    await staff.getByRole("button", { name: "入力を保って再編集する", exact: true }).click();
    await staff.getByRole("button", { name: "判定を保存", exact: true }).click();
    await expect(staff.getByRole("status")).toHaveText("保存しました。");
    await staff.getByRole("link", { name: "助言の確認へ" }).click();
    // Saving the response advances the shared revision. Review the latest basis
    // before editing advice; the editor intentionally blocks AI during conflict.
    await staff
      .getByRole("button", {
        name: "助言の入力を保って再編集する",
        exact: true,
      })
      .click();
    await staff.getByRole("button", { name: "定型助言を下書きへコピー" }).click();
    const gap = staff.getByRole("textbox", { name: "不足点", exact: true });
    await gap.fill("統括役員と部署の分担を規程に反映する。");
    expect((await request.post("/__fixture/ai-unconfigured")).status()).toBe(200);
    await staff.getByRole("button", { name: "AI 下書きを作成", exact: true }).click();
    const dialog = staff.getByRole("dialog");
    await dialog.getByLabel("匿名化した状況", { exact: true }).fill("役割を検討中");
    await dialog.getByLabel("匿名化した不足点", { exact: true }).fill("承認が未完了");
    await dialog.getByLabel("送信全文を確認し、匿名化しました", { exact: true }).check();
    await dialog.getByRole("button", { name: "確認した内容で生成", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "AIは未設定です。定型助言と手入力を利用できます。",
    );
    await dialog.getByRole("button", { name: "閉じて手入力を続ける", exact: true }).click();
    await expect(gap).toHaveValue("統括役員と部署の分担を規程に反映する。");
    expect((await read()).document.responses[first].adviceDraft).toBeNull();
    expect((await read()).document.responses[first].confirmedAdvice).toBeNull();
    await staff.getByRole("button", { name: "下書きを保存", exact: true }).click();
    await expect(staff.locator("#criterion-advice").getByRole("status")).toHaveText(
      "下書きを保存しました。",
    );
    await staff.getByLabel("現在の回答・範囲・証跡と助言内容を確認しました").check();
    await staff.getByRole("button", { name: "助言を確定", exact: true }).click();
    await expect(staff.locator("#criterion-advice").getByRole("status")).toHaveText(
      "助言を確定しました。",
    );
    const withAdvice = await read();
    expect(withAdvice.document.responses[first].confirmedAdvice).toEqual({
      content: {
        origin: "template",
        templateId: "scs-20260327-star3:1-2-1-1:v1",
        gap: "統括役員と部署の分担を規程に反映する。",
        steps: [
          "平時の推進体制として、役割分担と連絡先の管理者を決め、点検予定をまとめる。",
          "経営判断、対策実施、承認の担当を統括役員と担当部署に割り当て、職務分掌に記載する。",
        ],
        evidenceExamples: ["承認済み職務分掌", "組織図"],
        completionCheck: "統括役員と担当部署双方の役割・責任を規程の該当箇所で説明できる。",
        notes: "",
      },
      basisHash: withAdvice.document.responses[first].basisHash,
      by: expect.any(String),
      at: expect.any(String),
      version: 1,
    });
    await staff.getByRole("link", { name: "改善課題", exact: true }).click();
    await expect(
      staff.getByText("改善課題はまだ登録されていません。", { exact: true }),
    ).toBeVisible();
    await staff.getByRole("button", { name: "課題を追加", exact: true }).click();
    await staff.getByLabel("課題名").fill("役割分担表の承認");
    await staff.getByLabel("関連する評価基準").selectOption(first);
    await staff.getByLabel("担当者名").fill("匿名担当");
    await staff.getByLabel("期日（日本時間）").fill("2026-10-01");
    await staff.getByLabel("完了条件").fill("承認済み規程を確認できる");
    await staff.getByRole("button", { name: "課題を保存", exact: true }).click();
    await expect(staff.getByRole("status")).toHaveText("課題を保存しました。");
    await staff.getByRole("button", { name: "役割分担表の承認を編集" }).click();
    await staff.getByLabel("進捗").selectOption("awaiting_review");
    await staff.getByLabel("結果", { exact: true }).fill("責任者が承認");
    await staff.getByRole("checkbox", { name: "匿名規程", exact: true }).check();
    await staff.getByRole("button", { name: "課題を保存", exact: true }).click();
    await expect(staff.getByRole("status")).toHaveText("課題を保存しました。");
    await staff.getByRole("button", { name: "役割分担表の承認の完了を確認" }).click();
    await staff.getByLabel("確認メモ").fill("完了条件と照合");
    await staff.getByRole("button", { name: "完了確認を保存", exact: true }).click();
    await expect(staff.getByText("完了（確認済み）", { exact: true })).toBeVisible();
    const previous = await read();
    expect(previous.document.responses).toEqual(withAdvice.document.responses);
    async function finalize(assessmentId: string): Promise<SavedReport> {
      await staff.getByRole("link", { name: "レポート", exact: true }).click();
      await staff.getByRole("button", { name: "出力内容を事前確認" }).click();
      await staff.getByLabel("留意事項と出力内容を確認しました").check();
      await staff.getByRole("button", { name: "この内容で版を確定" }).click();
      await expect(staff.getByText("レポート版を確定しました。", { exact: true })).toBeVisible();
      await expect(
        staff.getByRole("heading", { name: "3. PDF・Excelを生成して保存", exact: true }),
      ).toBeVisible();
      const list = await request.get(`/api/v1/assessments/${assessmentId}/reports`, {
        headers: { Authorization: token },
      });
      expect(list.status()).toBe(200);
      const reportId = (await list.json()).data.items[0].id;
      const saved = await request.get(`/api/v1/reports/${reportId}`, {
        headers: { Authorization: token },
      });
      expect(saved.status()).toBe(200);
      return (await saved.json()).data;
    }
    const old = await finalize(id);
    await staff.getByRole("link", { name: "再診断比較", exact: true }).click();
    await expect(
      staff.getByText("前回の診断がありません。下のフォームから新しい診断時点を作成できます。", {
        exact: true,
      }),
    ).toBeVisible();
    await staff.getByLabel("再診断日").fill("2026-10-01");
    await staff.getByRole("checkbox", { name: "役割分担表の承認", exact: true }).check();
    await staff.getByRole("button", { name: "再診断を作成", exact: true }).click();
    await expect(staff.getByText("診断の差分", { exact: true })).toBeVisible();
    const nextId = /\/assessments\/([^/]+)\/comparison/.exec(staff.url())![1];
    const copied = await read(nextId);
    expect(copied.document.copiedFrom).toEqual({ assessmentId: id, revision: previous.revision });
    expect({
      advice: copied.document.responses[first].confirmedAdvice,
      original: copied.document.responses[first].original,
      task: copied.document.tasks[0].state,
      review: copied.document.evidence[0].reviews[first],
    }).toEqual({
      advice: null,
      original: null,
      task: "todo",
      review: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
    });
    await staff.getByRole("link", { name: first, exact: true }).click();
    await staff.getByLabel("現在の自己評価").selectOption("uncertain");
    await staff.getByLabel("判定理由・確認メモ").fill("再診断で改めて確認する");
    await staff.getByRole("button", { name: "判定を保存", exact: true }).click();
    await expect(staff.getByRole("status")).toHaveText("保存しました。");
    await staff.getByRole("link", { name: "再診断比較", exact: true }).click();
    await expect(staff.getByText("○ 満たしている → △ 判断微妙", { exact: true })).toBeVisible();
    const saved = await finalize(nextId);
    expect(saved.snapshot.counts).toEqual({
      yes: 23,
      uncertain: 25,
      no: 28,
      unanswered: 5,
      total: 81,
    });
    await writeFile(`${directory}/snapshot.json`, JSON.stringify(saved.snapshot));
    for (const [format, extension] of [
      ["Excel", "xlsx"],
      ["PDF", "pdf"],
    ]) {
      await staff.getByRole("button", { name: `${format}を生成`, exact: true }).click();
      const save = staff.getByRole("button", { name: `${format}を保存`, exact: true });
      await expect(save).toBeVisible({ timeout: 120_000 });
      const download = staff.waitForEvent("download");
      await save.click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(`SCS-${saved.reportId}.${extension}`);
      await file.saveAs(`${directory}/report.${extension}`);
    }
    const qa = spawnSync(
      process.env.EXCEL_QA_PYTHON ?? process.env.PDF_QA_PYTHON ?? "python",
      ["-X", "utf8", "tests/excel/verify_report.py", directory, "report.xlsx"],
      { encoding: "utf8", timeout: 120_000 },
    );
    expect({ status: qa.status, stderr: qa.stderr, error: qa.error?.message }).toEqual({
      status: 0,
      stderr: "",
      error: undefined,
    });
    expect(JSON.parse(qa.stdout)).toEqual({
      reportId: saved.reportId,
      sheets: ["サマリー", "評価基準", "証跡", "改善課題", "未回答・未確認"],
      criteria: 81,
      counts: saved.snapshot.counts,
      allRowsMatch: true,
      pdfMatches: true,
    });
    await staff.getByRole("link", { name: "生成・保存ボタンへ移動" }).click();
    await staff.screenshot({ path: `${directory}/exports.png` });
    expect(await read()).toEqual(previous);
    const oldAgain = await request.get(`/api/v1/reports/${old.reportId}`, {
      headers: { Authorization: token },
    });
    expect((await oldAgain.json()).data).toEqual(old);
    expect(
      Object.fromEntries(
        Object.entries(old.snapshot.responses).map(([key, response]) => [key, response.original]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(imported.document.responses).map(([key, response]) => [
          key,
          response.original,
        ]),
      ),
    );
    await writeFile(
      `${directory}/verification.json`,
      JSON.stringify(
        {
          ...JSON.parse(qa.stdout),
          previousReportId: old.reportId,
          previousReportUnchanged: true,
          originalCells: 324,
          errors,
          external,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  } finally {
    await context.close();
  }
});

test("an expired memory session refreshes subsequent reads and writes but cannot restore a revoked session", async ({
  page,
  request,
}) => {
  expect((await request.post("/__fixture/reset")).status()).toBe(200);
  let token = "";
  const writes: { token: string; key: string; body: unknown }[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
    if (req.method() === "POST" && req.url().endsWith("/api/v1/customers"))
      writes.push({
        token: req.headers().authorization,
        key: req.headers()["idempotency-key"],
        body: req.postDataJSON(),
      });
  });
  await login(page, "fixture@example.invalid");
  const original = token;
  expect(
    (
      await request.post("/__fixture/expire-session", {
        data: { token: original.replace("Bearer ", "") },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("link", { name: "顧客・案件を開く" }).click();
  await expect(page.getByRole("heading", { name: "顧客・案件", exact: true })).toBeVisible();
  await expect.poll(() => token).toBe(`${original}_REFRESH_1`);
  await page.getByLabel("顧客名", { exact: true }).fill("更新後の匿名顧客");
  // Expire again while this form is open: a write must retain its operation identity on retry.
  expect(
    (
      await request.post("/__fixture/expire-session", {
        data: { token: token.replace("Bearer ", "") },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "顧客を追加", exact: true }).click();
  await expect(page.getByRole("heading", { name: "更新後の匿名顧客", exact: true })).toBeVisible();
  expect(writes).toEqual([
    { token: `${original}_REFRESH_1`, key: expect.any(String), body: { name: "更新後の匿名顧客" } },
    { token: `${original}_REFRESH_2`, key: writes[0].key, body: writes[0].body },
  ]);
  await expect.poll(() => token).toBe(`${original}_REFRESH_2`);
  const revoke = await request.post("/api/v1/session/revoke", {
    headers: { Authorization: token, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
  expect(revoke.status()).toBe(200);
  expect(
    (
      await request.post("/__fixture/expire-session", {
        data: { token: token.replace("Bearer ", "") },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("link", { name: "顧客・案件", exact: true }).click();
  await page.getByLabel("顧客を検索", { exact: true }).fill("失効後の確認");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "利用権限を確認できません", exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.get("/api/v1/customers", {
        headers: { Authorization: `${original}_REFRESH_3` },
      })
    ).status(),
  ).toBe(401);
  const storage = await page.evaluate(
    "({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie })",
  );
  expect(storage).toEqual({ local: 0, session: 0, cookie: "" });
  await page.screenshot({ path: ".local/journey/revoked-after-refresh.png" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "担当者ログイン", exact: true })).toBeVisible();
});

test("a real browser at 200 percent keeps keyboard focus, form controls and the scope correction route usable", async ({
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  expect((await request.post("/__fixture/reset")).status()).toBe(200);
  await mkdir(".local/journey", { recursive: true });
  const profile = await mkdtemp(resolve(".local/journey/zoom-profile-"));
  const extension = resolve("tests/fixtures/browser-zoom");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    baseURL,
    viewport: null,
    // Own undefined overrides Desktop Chrome's inherited emulation option.
    // Native window sizing lets browser zoom reduce the CSS viewport itself.
    deviceScaleFactor: undefined,
    args: [
      "--window-size=1440,1000",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // Playwright's clipped screenshot can capture only background after browser
    // zoom + scrolling. Capture the native compositor viewport without a clip.
    async function captureWindow(path: string) {
      await page.bringToFront();
      const screenshot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      await writeFile(path, Buffer.from(screenshot.data, "base64"));
    }
    await login(page, "fixture@example.invalid");
    const beforeZoomWidth = await page
      .locator("html")
      .evaluate((element) => element.ownerDocument.defaultView!.innerWidth);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const zoom = await worker.evaluate(async () => {
      const api = (globalThis as any).chrome;
      const tabs = await api.tabs.query({ url: "http://127.0.0.1/*" });
      if (tabs.length !== 1)
        throw new Error(`Expected exactly one fixture tab, got ${tabs.length}`);
      await api.tabs.setZoomSettings(tabs[0].id, { mode: "automatic", scope: "per-origin" });
      await api.tabs.setZoom(tabs[0].id, 2);
      return api.tabs.getZoom(tabs[0].id);
    });
    expect(zoom).toBe(2);
    await page.getByRole("link", { name: "顧客・案件を開く" }).click();
    await page.keyboard.press("Control+Home");
    await page.getByRole("link", { name: "本文へ移動" }).focus();
    await expect(page.getByRole("link", { name: "本文へ移動" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await page.getByLabel("顧客名", { exact: true }).focus();
    await page.keyboard.type("Keyboard anonymous");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "顧客を追加", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByLabel("案件名", { exact: true }).fill("200% keyboard");
    await page.getByRole("button", { name: "案件を作成", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("unanswered-count")).toHaveText("81");
    await page.getByRole("link", { name: "レポート", exact: true }).click();
    await page.getByRole("button", { name: "出力内容を事前確認" }).focus();
    await page.keyboard.press("Enter");
    const correction = page.getByRole("link", { name: "不足項目を入力する" });
    await correction.scrollIntoViewIfNeeded();
    await correction.focus();
    await captureWindow(".local/journey/browser-zoom-200-report.png");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("対象会社", { exact: true })).toBeVisible();
    await expect(page.locator("#assessment-scope")).toBeFocused();
    const metrics = await page.locator("html").evaluate((element) => {
      const browserWindow = element.ownerDocument.defaultView!;
      return {
        innerWidth: browserWindow.innerWidth,
        outerWidth: browserWindow.outerWidth,
        devicePixelRatio: browserWindow.devicePixelRatio,
        cssZoom: browserWindow.getComputedStyle(element).zoom,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(Math.abs(metrics.innerWidth * 2 - beforeZoomWidth)).toBeLessThanOrEqual(2);
    expect(metrics.cssZoom).toBe("1");
    for (const label of ["対象会社", "対象拠点", "対象部署", "対象システム", "診断日"]) {
      const bounds = await page.getByLabel(label, { exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(metrics.innerWidth);
    }
    const finalZoom = await worker.evaluate(async () => {
      const api = (globalThis as any).chrome;
      const tabs = await api.tabs.query({ url: "http://127.0.0.1/*" });
      return api.tabs.getZoom(tabs[0].id);
    });
    expect(finalZoom).toBe(2);
    await captureWindow(".local/journey/browser-zoom-200-scope.png");
    await writeFile(
      ".local/journey/browser-zoom.json",
      JSON.stringify(
        {
          zoom: finalZoom,
          beforeZoomWidth,
          ...metrics,
          browser: context.browser()?.version(),
          keyboard: "skip link, customer and case creation, report preview, correction link",
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
