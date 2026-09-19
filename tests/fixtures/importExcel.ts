import ExcelJS from "exceljs";
import { Buffer } from "node:buffer";
import { zipSync, strToU8 } from "fflate";
import master from "../../poc/excel/master.json" with { type: "json" };
export async function importExcel(kind = "normal") {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("匿名検証");
  const headers = {
    K: "★3/★4",
    L: "評価基準No.",
    M: "評価基準",
    O: "自己評価",
    P: "理由",
    Q: "根拠および実施する事",
    R: "補足情報",
  };
  for (const [column, value] of Object.entries(headers)) sheet.getCell(`${column}2`).value = value;
  let index = 0;
  master.forEach((r, i) => {
    for (const [column, value] of Object.entries(r.publicCells))
      sheet.getCell(i + 3, Number(column)).value = value;
    if (r.level !== "★3") return;
    const n = i + 3;
    sheet.getCell(`O${n}`).value = index < 24 ? "○" : index < 48 ? "△" : index < 76 ? "✖" : "";
    sheet.getCell(`P${n}`).value = ` 匿名理由-${r.id}\n2行目 `;
    sheet.getCell(`Q${n}`).value = `匿名根拠と作業-${r.id}`;
    sheet.getCell(`R${n}`).value = `匿名補足-${r.id}`;
    index++;
  });
  const first = master.findIndex((r) => r.level === "★3") + 3;
  // The browser golden path must cover ordinary formatted text without changing
  // the anonymous O–R values or the 24/24/28/5 distribution.
  for (const column of ["O", "P", "Q", "R"]) {
    const cell = sheet.getCell(`${column}${first}`);
    const value = cell.text;
    cell.value = {
      richText: [{ text: value.slice(0, 1), font: { bold: true } }, { text: value.slice(1) }],
    };
  }
  // Real merged K cells exercise resolution and ★3/★4 boundaries.
  let start = 3;
  for (let row = 4; row <= master.length + 3; row++)
    if (
      row === master.length + 3 ||
      sheet.getCell(`K${row}`).value !== sheet.getCell(`K${start}`).value
    ) {
      if (row - start > 1) sheet.mergeCells(`K${start}:K${row - 1}`);
      start = row;
    }
  if (kind === "missing")
    for (const col of ["L", "O", "P", "Q", "R"]) sheet.getCell(`${col}${first}`).value = null;
  if (kind === "formula") sheet.getCell(`Q${first}`).value = { formula: "1+1", result: "cached" };
  if (kind === "unknown") sheet.getCell(`L${first}`).value = "99-99-99-99";
  if (kind === "version") sheet.getCell(`M${first}`).value = "異なる制度版";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export function oversizedZip(kind: "entry" | "total") {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8("<workbook/>"),
  };
  if (kind === "entry") files["ignored.bin"] = new Uint8Array(11 * 1024 * 1024);
  else for (let i = 0; i < 6; i++) files[`ignored-${i}.bin`] = new Uint8Array(9 * 1024 * 1024);
  const bytes = zipSync(files),
    view = new DataView(bytes.buffer);
  if (kind === "entry")
    for (let p = 0; p < bytes.length - 46; p++)
      if (
        view.getUint32(p, true) === 0x02014b50 &&
        view.getUint32(p + 24, true) > 10 * 1024 * 1024
      ) {
        view.setUint32(p + 24, 1, true);
        view.setUint32(view.getUint32(p + 42, true) + 22, 1, true);
      }
  return Buffer.from(bytes);
}
