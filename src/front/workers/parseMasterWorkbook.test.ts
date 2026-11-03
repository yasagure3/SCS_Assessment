import { describe, it, expect } from "vite-plus/test";
import ExcelJS from "exceljs";
import { parseMasterWorkbook } from "./parseMasterWorkbook";

function workbook() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("自己評価");
  [
    "大分類No.",
    "大分類",
    "中分類No.",
    "中分類",
    "要求事項No.",
    "★3",
    "★4",
    "要求事項名",
    "要求事項",
    "★3/★4",
    "評価基準No.",
    "評価基準",
    "NIST CSFにおける機能",
    "自己評価",
    "理由",
    "根拠および実施する事",
    "補足情報",
  ].forEach((v, i) => (sheet.getCell(4, i + 2).value = v));
  sheet.getCell("O3").value = { formula: 'COUNTIF(O5:O6,"○")', result: 1 };
  [
    "1",
    "組織",
    "1-1",
    "体制",
    "1-1-1",
    "○",
    "○",
    "要求名",
    "要求本文",
    "★3",
    "1-1-1-1",
    "評価本文",
    "GV",
    "-",
    " 理由\n ",
    "根拠",
    "補足",
  ].forEach((v, i) => (sheet.getCell(5, i + 2).value = v));
  return { book, sheet };
}
describe("master Excel parsing", () => {
  it("finds row 4, ignores summary formulas and preserves O:R independently", () => {
    const { book } = workbook();
    const parsed = parseMasterWorkbook(book);
    expect(parsed.errors).toEqual([]);
    expect(parsed.headerRow).toBe(4);
    expect(parsed.masterRows[0].publicCells["13"]).toBe("評価本文");
    expect(parsed.answers[0]).toMatchObject({ O: "-", P: " 理由\n ", Q: "根拠", R: "補足" });
    expect(parsed.masterRows[0].publicCells).not.toHaveProperty("15");
  });
  it("rejects formula answer cells and duplicate IDs with location", () => {
    const { book, sheet } = workbook();
    sheet.getCell("P5").value = { formula: "1+1", result: 2 };
    expect(parseMasterWorkbook(book).errors).toContainEqual({
      code: "CELL_TYPE",
      sheet: "自己評価",
      row: 5,
      column: "P",
    });
    sheet.getRow(6).values = sheet.getRow(5).values;
    expect(parseMasterWorkbook(book).errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });
  it("rejects ambiguous sheets, missing columns, invalid levels and unknown status", () => {
    const { book, sheet } = workbook();
    sheet.getCell("O5").value = "unknown";
    expect(parseMasterWorkbook(book).errors.some((e) => e.code === "UNKNOWN_STATUS")).toBe(true);
    sheet.getCell("K5").value = "★5";
    expect(parseMasterWorkbook(book).errors.some((e) => e.code === "INVALID_MASTER_ROW")).toBe(
      true,
    );
    sheet.getCell("Q4").value = "別の列";
    expect(parseMasterWorkbook(book).errors.some((e) => e.code === "HEADER_MISMATCH")).toBe(true);
    const second = book.addWorksheet("複製");
    second.getCell("L2").value = "評価基準No.";
    expect(parseMasterWorkbook(book).errors[0].code).toBe("TEMPLATE_SHEET");
  });
});
