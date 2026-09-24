import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { unzipSync, strFromU8 } from "fflate";
import { reportSnapshotFixture } from "../../tests/fixtures/reportSnapshot";
import { createReportExcel } from "../../src/front/workers/reportExcel";

function fixture() {
  const snapshot = structuredClone(reportSnapshotFixture()),
    [first, second, third] = snapshot.standard.criteria.map((c) => c.id);
  Object.assign(snapshot.responses[first], {
    original: { sheet: "匿名", row: 6, O: " ○ ", P: "=SUM(A1:A2)", Q: "+元根拠\n次行", R: "" },
    reason: "=SUM(A1:A2)",
    basis: "+根拠",
    plannedWork: "-作業",
    supplement: "@補足\n\t末尾 ",
    adviceDraft: { gap: "UNCONFIRMED_DRAFT" },
  });
  snapshot.responses[second].reason = "\tタブ始まり";
  snapshot.responses[second].adviceState = "stale";
  snapshot.responses[second].confirmedAdvice = {
    ...snapshot.responses[first].confirmedAdvice!,
    content: { ...snapshot.responses[first].confirmedAdvice!.content, gap: "STALE_BODY" },
  };
  snapshot.responses[third].adviceState = "unconfirmed";
  const review = {
    state: "confirmed" as const,
    note: "照合済み",
    by: "reviewer",
    at: snapshot.createdAt,
    subjectHash: "b".repeat(64),
  };
  snapshot.evidence = [
    {
      id: "evidence-1",
      criterionIds: [first, second],
      name: "=文書名",
      url: "https://example.invalid/manual?token=ACCESS_SECRET&X-Amz-Signature=SIGNED_SECRET#FRAGMENT_SECRET",
      location: "\t第３章",
      fileId: "file",
      reviews: {
        [first]: review,
        [second]: { state: "unreviewed", note: "", by: null, at: null, subjectHash: null },
      },
      file: {
        id: "file",
        originalName: "+固定時ファイル.txt",
        mime: "text/plain",
        sizeBytes: 5,
        sha256: "c".repeat(64),
      },
      reviewers: [{ id: "reviewer", email: "fixed@example.invalid" }],
    },
    {
      id: "evidence-2",
      criterionIds: [first],
      name: "追加証跡",
      url: "https://example.invalid/manual?id=42#page=3",
      location: "",
      fileId: null,
      reviews: { [first]: { ...review, state: "rejected", note: "再確認" } },
      file: null,
      reviewers: [{ id: "reviewer", email: "fixed@example.invalid" }],
    },
  ];
  snapshot.tasks = ["task-1", "task-2"].map((id) => ({
    id,
    sourceTaskId: null,
    sourceAssessmentId: null,
    criterionId: first,
    title: `@課題 ${id}`,
    ownerName: "-担当",
    dueDate: "2026-09-30",
    priority: "high",
    state: "done",
    completionCondition: "+完了条件",
    result: "=結果\n次行",
    evidenceIds: ["evidence-1"],
    review,
    reviewer: { id: "reviewer", email: "fixed@example.invalid" },
  }));
  Object.assign(snapshot, { accessToken: "ROOT_ACCESS_SECRET" });
  return snapshot;
}
function rows(sheet: ExcelJS.Worksheet) {
  return Array.from({ length: sheet.rowCount }, (_, row) =>
    Array.from({ length: sheet.columnCount }, (_, col) => sheet.getCell(row + 1, col + 1).value),
  );
}
describe("working Excel from a fixed report", () => {
  it.each([
    "通常の文字列\n\t次行 ",
    "",
    "手順 _x0041_ と _x000A_ は文字列",
    "_x005F_x0041_ / _x005f_ / _x00aA_ / _x0041__x0042_ / _x0041_x0042_",
    "一行目\r\n二行目",
    "単独\rCRと\r\nCRLF\nLF\tタブ",
    "制御\u0000\u0008\u000B\u000C\u001F\u007F文字",
    "日本語𠮷と<&>\"' _xD83D__xDE00_",
  ])("preserves every free-text output family through real OOXML roundtrip: %j", async (value) => {
    const snapshot = fixture(),
      first = snapshot.standard.criteria[0].id;
    snapshot.customer.name = value;
    snapshot.case.name = value;
    snapshot.assessment.scope = {
      companies: value,
      sites: value,
      departments: value,
      systems: value,
    };
    const response = snapshot.responses[first];
    Object.assign(response, { reason: value, basis: value, plannedWork: value, supplement: value });
    Object.assign(response.original!, { O: value, P: value, Q: value, R: value });
    Object.assign(response.confirmedAdvice!.content, {
      gap: value,
      steps: [value],
      evidenceExamples: [value],
      completionCheck: value,
      notes: value,
    });
    snapshot.evidence[0].name = value;
    snapshot.evidence[0].location = value;
    snapshot.evidence[0].file!.originalName = value;
    const task = snapshot.tasks[0];
    Object.assign(task, {
      title: value,
      ownerName: value,
      completionCondition: value,
      result: value,
    });
    task.review.note = value;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(await createReportExcel(snapshot)).buffer);
    const summary = rows(book.getWorksheet("サマリー")!);
    const cell = (sheet: string, address: string) =>
      book.getWorksheet(sheet)!.getCell(address).value;
    expect({
      summary: ["顧客", "案件", "対象会社", "対象拠点", "対象部署", "対象システム"].map(
        (label) => summary.find((r) => r[0] === label)![1],
      ),
      response: ["F2", "G2", "H2", "I2", "J2", "K2", "L2", "M2"].map((address) =>
        cell("評価基準", address),
      ),
      advice: cell("評価基準", "N2"),
      evidence: ["C2", "E2", "F2"].map((address) => cell("証跡", address)),
      task: ["B2", "C2", "F2", "G2"].map((address) => cell("改善課題", address)),
      review: cell("改善課題", "H2"),
    }).toEqual({
      summary: Array(6).fill(value),
      response: Array(8).fill(value),
      advice: [
        `課題・不足：${value}`,
        `実施手順 1：${value}`,
        `証跡例 1：${value}`,
        `完了確認：${value}`,
        `補足：${value}`,
        "確認者：reviewer@example.invalid",
        `確認日：${snapshot.createdAt}`,
        "確認版：1",
      ].join("\n"),
      evidence: Array(3).fill(value),
      task: Array(4).fill(value),
      review: `確認済み\n確認者：fixed@example.invalid\n確認日：${snapshot.createdAt}\n確認記録：${value}`,
    });
  });
  it.each([
    ["https://example.invalid/manual?id=42#page=3", "https://example.invalid/manual?id=42#page=3"],
    ["https://name:password@example.invalid/manual", "アクセス情報を含むURLのため省略"],
    ...[
      "token",
      "signature",
      "credential",
      "password",
      "secret",
      "authorization",
      "auth",
      "sig",
      "key",
      "code",
      "apiKey",
      "APIKey",
      "APIKEY",
      "apikey",
      "api_key",
      "api-key",
      "authCode",
      "AUTHCode",
      "AUTHCODE",
      "authcode",
      "auth_code",
      "auth-code",
      "accessKey",
      "accessToken",
      "X-Amz-Signature",
    ].flatMap((key) =>
      ["?", "#"].map((marker) => [
        `https://example.invalid/manual${marker}${key}=ANONYMOUS_SECRET`,
        "アクセス情報を含むURLのため省略",
      ]),
    ),
  ])(
    "protects both URL fields across credential-name forms and query/fragment: %s",
    async (url, expected) => {
      const snapshot = fixture();
      snapshot.standard.sourceUrl = url;
      snapshot.evidence[0].url = url;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(new Uint8Array(await createReportExcel(snapshot)).buffer);
      expect({
        standard: rows(book.getWorksheet("サマリー")!).find((r) => r[0] === "制度資料")![1],
        evidence: book.getWorksheet("証跡")!.getCell("D2").value,
      }).toEqual({ standard: expected, evidence: expected });
    },
  );
  it("roundtrips five sheets, every official criterion and raw O–R with only current advice and frozen evidence/tasks", async () => {
    const snapshot = fixture(),
      before = JSON.stringify(snapshot);
    const output = await createReportExcel(snapshot);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(output).buffer);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      "サマリー",
      "評価基準",
      "証跡",
      "改善課題",
      "未回答・未確認",
    ]);
    expect(rows(book.getWorksheet("評価基準")!)).toEqual([
      [
        "ID",
        "要求事項",
        "分類",
        "公式文",
        "自己評価",
        "理由",
        "根拠",
        "今後作業",
        "補足",
        "原O",
        "原P",
        "原Q",
        "原R",
        "確定助言",
        "助言状態",
      ],
      ...snapshot.standard.criteria.map((c, index) => {
        const r = snapshot.responses[c.id],
          advice = r.confirmedAdvice;
        return [
          c.id,
          c.requirementId,
          c.category,
          c.officialText,
          index === 0 ? "○ 満たしている" : "未回答",
          r.reason,
          r.basis,
          r.plannedWork,
          r.supplement,
          r.original?.O ?? "",
          r.original?.P ?? "",
          r.original?.Q ?? "",
          r.original?.R ?? "",
          index === 0
            ? [
                `課題・不足：${advice!.content.gap}`,
                "実施手順 1：責任者を設定する",
                "実施手順 2：月次点検を記録する",
                "証跡例 1：点検記録",
                "証跡例 2：運用規程",
                "完了確認：直近３か月分を照合する",
                "補足：匿名確認済み助言",
                "確認者：reviewer@example.invalid",
                `確認日：${snapshot.createdAt}`,
                "確認版：1",
              ].join("\n")
            : "",
          index === 0
            ? "確定済み"
            : index === 1
              ? "再確認が必要"
              : index === 2
                ? "未確定"
                : "助言なし",
        ];
      }),
    ]);
    const [first, second] = snapshot.standard.criteria.map((c) => c.id);
    expect(rows(book.getWorksheet("証跡")!)).toEqual([
      ["ID", "基準ID", "文書名", "URL", "箇所", "ファイル名", "確認状態", "確認者", "確認日"],
      [
        "evidence-1",
        first,
        "=文書名",
        "アクセス情報を含むURLのため省略",
        "\t第３章",
        "+固定時ファイル.txt",
        "確認済み",
        "fixed@example.invalid",
        snapshot.createdAt,
      ],
      [
        "evidence-1",
        second,
        "=文書名",
        "アクセス情報を含むURLのため省略",
        "\t第３章",
        "+固定時ファイル.txt",
        "未確認",
        "",
        "",
      ],
      [
        "evidence-2",
        first,
        "追加証跡",
        "https://example.invalid/manual?id=42#page=3",
        "",
        "",
        "差戻し",
        "fixed@example.invalid",
        snapshot.createdAt,
      ],
    ]);
    expect(rows(book.getWorksheet("改善課題")!)).toEqual([
      ["基準ID", "課題", "担当", "期限", "進捗", "完了条件", "結果", "確認"],
      ...["task-1", "task-2"].map((id) => [
        first,
        `@課題 ${id}`,
        "-担当",
        "2026-09-30",
        "完了",
        "+完了条件",
        "=結果\n次行",
        `確認済み\n確認者：fixed@example.invalid\n確認日：${snapshot.createdAt}\n確認記録：照合済み`,
      ]),
    ]);
    const summary = rows(book.getWorksheet("サマリー")!);
    expect(summary[0]).toEqual(["項目", "内容", "○", "△", "×", "未回答", "合計"]);
    expect(summary.find((r) => r[0] === "報告版ID")).toEqual([
      "報告版ID",
      snapshot.reportId,
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(summary.find((r) => r[0] === "集計")).toEqual(["集計", "全評価基準", 1, 0, 0, 80, 81]);
    expect(summary.filter((r) => r[0] === "分類集計")).toEqual(
      snapshot.categoryCounts.map((c) => [
        "分類集計",
        c.category,
        c.yes,
        c.uncertain,
        c.no,
        c.unanswered,
        c.total,
      ]),
    );
    expect(summary.find((r) => r[0] === "利用上の注意")).toEqual([
      "利用上の注意",
      "作業用Excelは再取込対象外です。公式Excelの書式は再現していません。",
      "",
      "",
      "",
      "",
      "",
    ]);
    const labels = {
      unanswered: "未回答",
      notRegistered: "証跡未登録",
      unreviewed: "証跡未確認",
      rejected: "証跡差戻し",
      unconfirmedAdvice: "助言未確定",
      staleAdvice: "再確認が必要な助言",
      draftPendingIds: "新しい下書きあり（確定済み版を出力。新しい下書きは含めない）",
    };
    expect(rows(book.getWorksheet("未回答・未確認")!)).toEqual([
      ["種別", "基準ID", "内容"],
      ...Object.entries(labels).flatMap(([key, label]) =>
        snapshot.limitations[key as keyof typeof labels].map((id) => [
          label,
          id,
          snapshot.standard.criteria.find((c) => c.id === id)!.officialText,
        ]),
      ),
    ]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("stores formula-like, blank and multiline values as strings with no formulas, hyperlinks, external relations or credentials", async () => {
    const bytes = await createReportExcel(fixture()),
      book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(bytes).buffer);
    const sheet = book.getWorksheet("評価基準")!;
    expect(
      ["F2", "G2", "H2", "I2", "F3", "M2"].map((address) => ({
        value: sheet.getCell(address).value,
        type: sheet.getCell(address).type,
      })),
    ).toEqual([
      { value: "=SUM(A1:A2)", type: ExcelJS.ValueType.String },
      { value: "+根拠", type: ExcelJS.ValueType.String },
      { value: "-作業", type: ExcelJS.ValueType.String },
      { value: "@補足\n\t末尾 ", type: ExcelJS.ValueType.String },
      { value: "\tタブ始まり", type: ExcelJS.ValueType.String },
      { value: "", type: ExcelJS.ValueType.String },
    ]);
    const entries = unzipSync(new Uint8Array(bytes));
    const xml = Object.values(entries)
      .map((content) => strFromU8(content))
      .join("\n");
    expect(
      /<f[ >]|<hyperlink[ >]|TargetMode="External"|externalLink|ACCESS_SECRET|SIGNED_SECRET|FRAGMENT_SECRET|ROOT_ACCESS_SECRET|UNCONFIRMED_DRAFT|STALE_BODY/.test(
        xml,
      ),
    ).toBe(false);
  });
  it.each(["missing", "duplicate", "schema", "size"])(
    "rejects a %s snapshot before making an incomplete workbook",
    async (kind) => {
      const snapshot = structuredClone(reportSnapshotFixture());
      if (kind === "missing") snapshot.standard.criteria.pop();
      if (kind === "duplicate") snapshot.standard.criteria[1] = snapshot.standard.criteria[0];
      if (kind === "schema") Object.assign(snapshot, { schemaVersion: 2 });
      if (kind === "size") snapshot.customer.name = "x".repeat(1_572_865);
      await expect(createReportExcel(snapshot)).rejects.toThrow("REPORT_SNAPSHOT_INVALID");
    },
  );
  it.each([
    "https://user:password@example.invalid/file",
    "https://example.invalid/file#access_token=SECRET",
    "https://example.invalid/file?X-Amz-Signature=SECRET",
    "https://example.invalid/file?sig=SECRET&sp=r",
    "https://example.invalid/file?api_key=SECRET",
  ])(
    "omits a credential-bearing evidence URL while preserving raw answer text: %s",
    async (url) => {
      const snapshot = fixture();
      snapshot.evidence[0].url = url;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(new Uint8Array(await createReportExcel(snapshot)).buffer);
      expect({
        url: book.getWorksheet("証跡")!.getCell("D2").value,
        original: book.getWorksheet("評価基準")!.getCell("K2").value,
      }).toEqual({ url: "アクセス情報を含むURLのため省略", original: "=SUM(A1:A2)" });
    },
  );
});
