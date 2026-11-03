import type { Workbook, Cell } from "exceljs";
import type { MasterWorkbook } from "../../shared/contracts/masterImport";
import type { ImportIssue } from "../../shared/contracts/imports";
import { XLSX_LIMITS } from "./xlsxLimits";

const headers: Record<string, string[]> = {
  B: ["大分類No."],
  C: ["大分類"],
  D: ["中分類No."],
  E: ["中分類"],
  F: ["要求事項No."],
  G: ["★3"],
  H: ["★4"],
  I: ["要求事項名"],
  J: ["要求事項"],
  K: ["★3/★4"],
  L: ["評価基準No."],
  M: ["評価基準"],
  N: ["NIST CSFにおける機能"],
  O: ["自己評価"],
  P: ["理由"],
  Q: ["根拠および実施する事", "根拠"],
  R: ["補足情報", "補足"],
};
function plain(cell: Cell, numeric: boolean) {
  const v = cell.value;
  return (
    v === null ||
    typeof v === "string" ||
    (numeric && typeof v === "number") ||
    (typeof v === "object" &&
      v !== null &&
      "richText" in v &&
      Object.keys(v).every((k) => k === "richText") &&
      v.richText.every((run) => typeof run.text === "string"))
  );
}
export function parseMasterWorkbook(book: Workbook) {
  const errors: ImportIssue[] = [];
  const masterRows: MasterWorkbook["masterRows"] = [];
  const answers: MasterWorkbook["answers"] = [];
  let cells = 0;
  if (book.worksheets.length > XLSX_LIMITS.sheets) throw new Error("SHEET_LIMIT");
  for (const sheet of book.worksheets) {
    if (sheet.rowCount > XLSX_LIMITS.rows || sheet.columnCount > XLSX_LIMITS.columns)
      throw new Error("SHEET_DIMENSION_LIMIT");
    sheet.eachRow((row) => row.eachCell(() => cells++));
  }
  if (cells > XLSX_LIMITS.cells) throw new Error("CELL_LIMIT");
  const candidates = book.worksheets.flatMap((sheet) =>
    Array.from({ length: Math.min(20, sheet.rowCount) }, (_, i) => i + 1)
      .filter((row) => sheet.getCell(`L${row}`).text === "評価基準No.")
      .map((headerRow) => ({ sheet, headerRow })),
  );
  if (candidates.length !== 1)
    return {
      sheet: "",
      headerRow: 1,
      masterRows,
      answers,
      errors: [{ code: "TEMPLATE_SHEET", sheet: "ブック", row: 1, column: "L" }],
    };
  const { sheet, headerRow } = candidates[0];
  const issue = (code: string, row: number, column: string) =>
    errors.push({ code, sheet: sheet.name, row, column });
  for (const [column, labels] of Object.entries(headers))
    if (
      !plain(sheet.getCell(`${column}${headerRow}`), false) ||
      !labels.includes(sheet.getCell(`${column}${headerRow}`).text)
    )
      issue("HEADER_MISMATCH", headerRow, column);
  const seen = new Set<string>();
  for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
    if (
      Array.from({ length: 17 }, (_, i) => sheet.getCell(row, i + 2)).every(
        (c) => c.value === null || c.value === "",
      )
    )
      continue;
    let invalid = false;
    for (let col = 2; col <= 18; col++) {
      const cell = sheet.getCell(row, col);
      if (!plain(cell, col <= 14) || Array.from(cell.text).length > 8000) {
        issue("CELL_TYPE", row, cell.address.replace(/\d+$/, ""));
        invalid = true;
      }
    }
    const id = sheet.getCell(`L${row}`).text,
      level = sheet.getCell(`K${row}`).text;
    if (!/^\d+-\d+-\d+-\d+$/.test(id) || !["★3", "★4"].includes(level)) {
      issue("INVALID_MASTER_ROW", row, "K:L");
      continue;
    }
    if (seen.has(id)) {
      issue("DUPLICATE_ID", row, "L");
      continue;
    }
    seen.add(id);
    if (invalid) continue;
    masterRows.push({
      id,
      level: level as "★3" | "★4",
      sourceRow: row,
      publicCells: Object.fromEntries(
        Array.from({ length: 13 }, (_, i) => [String(i + 2), sheet.getCell(row, i + 2).text]),
      ),
    });
    if (level !== "★3") continue;
    const O = sheet.getCell(`O${row}`).text;
    if (!["", "-", "○", "△", "✖", "×", "✕"].includes(O.trim())) issue("UNKNOWN_STATUS", row, "O");
    answers.push({
      criterionId: id,
      sheet: sheet.name,
      row,
      O,
      P: sheet.getCell(`P${row}`).text,
      Q: sheet.getCell(`Q${row}`).text,
      R: sheet.getCell(`R${row}`).text,
    });
  }
  return { sheet: sheet.name, headerRow, masterRows, answers, errors };
}
