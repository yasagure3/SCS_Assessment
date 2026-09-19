import type { Workbook, Cell } from "exceljs";
import type { ImportMaster, ImportRow, ImportIssue } from "../../shared/contracts/imports";
import { XLSX_LIMITS } from "./xlsxLimits";
const headers: Record<string, string> = {
  K: "★3/★4",
  L: "評価基準No.",
  M: "評価基準",
  O: "自己評価",
  P: "理由",
  Q: "根拠および実施する事",
  R: "補足情報",
};
function formula(cell: Cell) {
  const value = cell.value;
  return Boolean(
    value && typeof value === "object" && ("formula" in value || "sharedFormula" in value),
  );
}
function text(cell: Cell) {
  return cell.value === null ? "" : cell.text;
}
function isTextCell(cell: Cell) {
  const value = cell.value;
  if (value === null || typeof value === "string") return true;
  // Excel stores formatting runs separately from their text. Preserve the text,
  // while excluding hyperlink/formula objects and every non-string run value.
  return (
    typeof value === "object" &&
    "richText" in value &&
    Object.keys(value).every((key) => key === "richText") &&
    Array.isArray(value.richText) &&
    value.richText.every((run) => typeof run.text === "string")
  );
}
export function parseWorkbook(book: Workbook, master: ImportMaster) {
  const errors: ImportIssue[] = [],
    rows: ImportRow[] = [],
    known = new Map(master.rows.map((r) => [r.id, r])),
    seen = new Set<string>();
  let cells = 0,
    star4Excluded = 0;
  if (book.worksheets.length > XLSX_LIMITS.sheets) throw new Error("SHEET_LIMIT");
  for (const sheet of book.worksheets) {
    if (sheet.rowCount > XLSX_LIMITS.rows || sheet.columnCount > XLSX_LIMITS.columns)
      throw new Error("SHEET_DIMENSION_LIMIT");
    sheet.eachRow((row) => row.eachCell(() => cells++));
  }
  if (cells > XLSX_LIMITS.cells) throw new Error("CELL_LIMIT");
  const candidates = book.worksheets.filter(
    (s) =>
      s.getCell("L2").text === headers.L ||
      s.getCell("O2").text === headers.O ||
      s.getCell("K2").text === headers.K,
  );
  if (candidates.length !== 1)
    return {
      rows,
      star4Excluded,
      errors: [
        { code: "TEMPLATE_SHEET", sheet: candidates[0]?.name ?? "ブック", row: 2, column: "K:R" },
      ],
    };
  const sheet = candidates[0];
  const issue = (code: string, row: number, column: string) =>
    errors.push({ code, sheet: sheet.name, row, column });
  for (const [col, expected] of Object.entries(headers)) {
    const cell = sheet.getCell(`${col}2`);
    if (formula(cell)) issue("FORMULA_CELL", 2, col);
    else if (text(cell) !== expected) issue("HEADER_MISMATCH", 2, col);
  }
  for (let row = 3; row <= sheet.rowCount; row++) {
    let invalid = false;
    for (let col = 2; col <= 18; col++)
      if (formula(sheet.getCell(row, col))) {
        issue("FORMULA_CELL", row, sheet.getCell(row, col).address.replace(/\d+$/, ""));
        invalid = true;
      }
    if (invalid) continue;
    const id = text(sheet.getCell(`L${row}`)),
      answers = Object.fromEntries(
        ["O", "P", "Q", "R"].map((c) => [c, sheet.getCell(`${c}${row}`)]),
      );
    if (!id && Object.values(answers).every((c) => c.value === null || c.value === "")) continue;
    const official = known.get(id);
    if (!official) {
      issue("UNKNOWN_ID", row, "L");
      continue;
    }
    if (seen.has(id)) {
      issue("DUPLICATE_ID", row, "L");
      continue;
    }
    seen.add(id);
    for (let col = 2; col <= 14; col++)
      if (text(sheet.getCell(row, col)) !== official.publicCells[String(col)]) {
        issue("PUBLIC_MASTER_MISMATCH", row, sheet.getCell(row, col).address.replace(/\d+$/, ""));
        invalid = true;
      }
    for (const [col, cell] of Object.entries(answers))
      if (!isTextCell(cell)) {
        issue("RESPONSE_TYPE", row, col);
        invalid = true;
      }
    if (invalid) continue;
    if (official.level === "★4") {
      star4Excluded++;
      continue;
    }
    if (!["", "○", "△", "✖", "×", "✕"].includes(text(answers.O).trim())) {
      issue("UNKNOWN_STATUS", row, "O");
      continue;
    }
    for (const [col, cell] of Object.entries(answers))
      if (Array.from(text(cell)).length > 8000) {
        issue("TEXT_LIMIT", row, col);
        invalid = true;
      }
    if (!invalid)
      rows.push({
        criterionId: id,
        sheet: sheet.name,
        row,
        O: text(answers.O),
        P: text(answers.P),
        Q: text(answers.Q),
        R: text(answers.R),
      });
  }
  return { rows, star4Excluded, errors };
}
