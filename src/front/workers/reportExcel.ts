import type { Workbook, Worksheet } from "exceljs";
import type { ReportLimitations, ReportSnapshot } from "../../shared/contracts/reports";
import { MAX_REPORT_BYTES } from "../../shared/contracts/assessment";

export const EXCEL_RENDERER_VERSION = "scs-report-1";
const statuses = {
  yes: "○ 満たしている",
  uncertain: "△ 判断微妙",
  no: "× 不足",
  unanswered: "未回答",
};
const reviews = { confirmed: "確認済み", unreviewed: "未確認", rejected: "差戻し" };
const adviceStates = {
  current: "確定済み",
  none: "助言なし",
  unconfirmed: "未確定",
  stale: "再確認が必要",
};
const limitations: Record<keyof ReportLimitations, string> = {
  unanswered: "未回答",
  notRegistered: "証跡未登録",
  unreviewed: "証跡未確認",
  rejected: "証跡差戻し",
  unconfirmedAdvice: "助言未確定",
  staleAdvice: "再確認が必要な助言",
  draftPendingIds: "新しい下書きあり（確定済み版を出力。新しい下書きは含めない）",
};

// Ordinary document IDs and page anchors remain intact. Credential-bearing
// links are omitted as a whole rather than producing a misleading broken URL.
function documentUrl(value: string | null): string {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const credentialKey =
    /token|signature|credential|password|secret|authorization|(?:^|[-_])(auth|sig|key|code)(?:$|[-_])/i;
  const keys = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  const hasCredential = keys.some((key) => {
    const words = key
      .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_");
    const compact = words.replaceAll("_", "").toLowerCase();
    return (
      credentialKey.test(words) ||
      /^(api|access|auth|session|private|signing)(key|code)$/.test(compact)
    );
  });
  if (url.username || url.password || hasCredential) return "アクセス情報を含むURLのため省略";
  return value;
}
function escapeExcelText(value: string): string {
  // ST_Xstring: protect literal escapes first, including overlapping tokens.
  // Encode CR before XML newline normalization; LF and tab remain literal.
  const protectedText = value.replace(/_(?=x[0-9A-Fa-f]{4}_)/g, "_x005F_");
  return Array.from(protectedText, (character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10) ||
      code === 127 ||
      code === 0xfffe ||
      code === 0xffff
      ? `_x${code.toString(16).toUpperCase().padStart(4, "0")}_`
      : character;
  }).join("");
}
function addRow(sheet: Worksheet, values: (string | number)[]) {
  const row = sheet.addRow(
    values.map((value) => (typeof value === "string" ? escapeExcelText(value) : value)),
  );
  row.eachCell({ includeEmpty: true }, (cell) => {
    // Assigning primitive strings (including "") preserves whitespace, prevents
    // formula evaluation, and creates no relationship even for URL-like values.
    if (typeof cell.value === "string") cell.numFmt = "@";
    cell.alignment = { vertical: "top", wrapText: true };
  });
}
function addSheet(book: Workbook, name: string, headers: string[], widths: number[]) {
  const sheet = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  addRow(sheet, headers);
  sheet.columns.forEach((column, i) => {
    column.width = widths[i] ?? 32;
  });
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17334D" } };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return sheet;
}
export async function createReportExcel(
  snapshot: ReportSnapshot,
  onProgress: (percent: number) => void = () => {},
): Promise<Uint8Array> {
  const criteria = snapshot.standard.criteria,
    ids = new Set(criteria.map((c) => c.id));
  if (
    snapshot.schemaVersion !== 1 ||
    criteria.length !== 81 ||
    ids.size !== 81 ||
    Object.keys(snapshot.responses).length !== 81 ||
    [...ids].some((id) => !snapshot.responses[id]) ||
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_REPORT_BYTES
  )
    throw new Error("REPORT_SNAPSHOT_INVALID");
  const ExcelJS = await import("exceljs"),
    book = new ExcelJS.default.Workbook();
  book.creator = "SCS Assessment";
  book.created = new Date(snapshot.createdAt);
  book.modified = new Date(snapshot.createdAt);
  const summary = addSheet(
    book,
    "サマリー",
    ["項目", "内容", "○", "△", "×", "未回答", "合計"],
    [28, 76, 10, 10, 10, 12, 10],
  );
  const metadata: [string, string][] = [
    ["利用上の注意", "作業用Excelは再取込対象外です。公式Excelの書式は再現していません。"],
    ["報告版ID", snapshot.reportId],
    ["顧客", snapshot.customer.name],
    ["案件", snapshot.case.name],
    ["診断ID", snapshot.assessment.id],
    ["診断版", String(snapshot.assessment.revision)],
    ["対象会社", snapshot.assessment.scope.companies],
    ["対象拠点", snapshot.assessment.scope.sites],
    ["対象部署", snapshot.assessment.scope.departments],
    ["対象システム", snapshot.assessment.scope.systems],
    ["診断日", snapshot.assessment.diagnosisDate ?? ""],
    ["制度版", snapshot.assessment.standardId],
    ["制度公表日", snapshot.standard.publicationDate],
    ["制度資料", documentUrl(snapshot.standard.sourceUrl)],
    ["制度本文SHA-256", snapshot.standard.contentSha256],
    ["確定日時", snapshot.createdAt],
    ["作成者", snapshot.createdBy],
    ["保存時の描画版", snapshot.rendererVersion],
    ["今回の描画版", EXCEL_RENDERER_VERSION],
    ["評価上の注意", "自己評価は公式の合否や取得可能性を表しません。"],
    [
      "URLの扱い",
      "証跡URLの認証情報・token・署名パラメータを検出した場合はURLを省略します。通常の文書ID・ページ指定は保持します。",
    ],
  ];
  for (const row of metadata) addRow(summary, [...row, "", "", "", "", ""]);
  const counts = snapshot.counts;
  addRow(summary, [
    "集計",
    "全評価基準",
    counts.yes,
    counts.uncertain,
    counts.no,
    counts.unanswered,
    counts.total,
  ]);
  for (const c of snapshot.categoryCounts)
    addRow(summary, ["分類集計", c.category, c.yes, c.uncertain, c.no, c.unanswered, c.total]);
  for (const id of snapshot.majorIssues)
    addRow(summary, [
      "主要課題",
      `${id}：${criteria.find((c) => c.id === id)!.officialText}`,
      "",
      "",
      "",
      "",
      "",
    ]);
  for (const [key, label] of Object.entries(limitations)) {
    const values = snapshot.limitations[key as keyof ReportLimitations];
    addRow(summary, [
      "留意事項",
      `${label}：${values.length}件\n${values.join("、") || "該当なし"}`,
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  onProgress(15);
  const evaluation = addSheet(
    book,
    "評価基準",
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
    [18, 18, 24, 70, 20, 40, 40, 40, 40, 18, 40, 40, 40, 80, 24],
  );
  for (const c of criteria) {
    const response = snapshot.responses[c.id];
    const advice = response.adviceState === "current" ? response.confirmedAdvice : null;
    const adviceText = advice
      ? [
          `課題・不足：${advice.content.gap}`,
          ...advice.content.steps.map((value, i) => `実施手順 ${i + 1}：${value}`),
          ...advice.content.evidenceExamples.map((value, i) => `証跡例 ${i + 1}：${value}`),
          `完了確認：${advice.content.completionCheck}`,
          `補足：${advice.content.notes}`,
          `確認者：${advice.reviewer.email}`,
          `確認日：${advice.at}`,
          `確認版：${advice.version}`,
        ].join("\n")
      : "";
    addRow(evaluation, [
      c.id,
      c.requirementId,
      c.category,
      c.officialText,
      statuses[response.status],
      response.reason,
      response.basis,
      response.plannedWork,
      response.supplement,
      response.original?.O ?? "",
      response.original?.P ?? "",
      response.original?.Q ?? "",
      response.original?.R ?? "",
      adviceText,
      adviceStates[response.adviceState],
    ]);
  }
  onProgress(40);
  const evidence = addSheet(
    book,
    "証跡",
    ["ID", "基準ID", "文書名", "URL", "箇所", "ファイル名", "確認状態", "確認者", "確認日"],
    [38, 18, 36, 52, 36, 40, 18, 36, 28],
  );
  for (const item of snapshot.evidence)
    for (const id of item.criterionIds) {
      const review = item.reviews[id];
      addRow(evidence, [
        item.id,
        id,
        item.name,
        documentUrl(item.url),
        item.location,
        item.file?.originalName ?? "",
        reviews[review.state],
        item.reviewers.find((r) => r.id === review.by)?.email ?? "",
        review.at ?? "",
      ]);
    }
  const tasks = addSheet(
    book,
    "改善課題",
    ["基準ID", "課題", "担当", "期限", "進捗", "完了条件", "結果", "確認"],
    [18, 48, 24, 18, 18, 48, 48, 52],
  );
  for (const task of snapshot.tasks)
    addRow(tasks, [
      task.criterionId,
      task.title,
      task.ownerName,
      task.dueDate,
      { todo: "未着手", doing: "進行中", awaiting_review: "確認待ち", done: "完了" }[task.state],
      task.completionCondition,
      task.result,
      `${reviews[task.review.state]}\n確認者：${task.reviewer?.email ?? ""}\n確認日：${task.review.at ?? ""}\n確認記録：${task.review.note}`,
    ]);
  const outstanding = addSheet(book, "未回答・未確認", ["種別", "基準ID", "内容"], [54, 18, 80]);
  for (const [key, label] of Object.entries(limitations))
    for (const id of snapshot.limitations[key as keyof ReportLimitations])
      addRow(outstanding, [label, id, criteria.find((c) => c.id === id)!.officialText]);
  onProgress(75);
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  onProgress(100);
  return bytes;
}
