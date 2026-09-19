import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import master from "../../../poc/excel/master.json";
import { parseWorkbook } from "./parseWorkbook";
import { inspectXlsx, XLSX_LIMITS } from "./xlsxLimits";

function workbook() {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("匿名検証");
  for (const [col, value] of Object.entries({
    K: "★3/★4",
    L: "評価基準No.",
    M: "評価基準",
    O: "自己評価",
    P: "理由",
    Q: "根拠および実施する事",
    R: "補足情報",
  }))
    sheet.getCell(`${col}2`).value = value;
  let index = 0;
  master.forEach((item, i) => {
    const row = i + 3;
    for (const [col, value] of Object.entries(item.publicCells))
      sheet.getCell(row, Number(col)).value = value;
    if (item.level !== "★3") return;
    sheet.getCell(`O${row}`).value = index < 24 ? " ○ " : index < 48 ? "△" : index < 76 ? "✖" : "";
    sheet.getCell(`P${row}`).value = ` 理由-${item.id}\n2行目 `;
    sheet.getCell(`Q${row}`).value = `根拠と作業-${item.id}`;
    sheet.getCell(`R${row}`).value = `補足-${item.id}`;
    index++;
  });
  return { book, sheet };
}
const reference = {
  standardId: "scs-20260327-star3",
  masterContentSha256: "a".repeat(64),
  rows: master,
};
const firstRow = master.findIndex((r) => r.level === "★3") + 3;
describe("Excel text and master validation", () => {
  it("preserves all distinct O–R strings and merged K values with 81 answers and 72 excluded", () => {
    const { book, sheet } = workbook();
    sheet.mergeCells(`K${firstRow}:K${firstRow + 1}`);
    const result = parseWorkbook(book, reference);
    expect(result.errors).toEqual([]);
    expect(result.star4Excluded).toBe(72);
    expect(result.rows).toEqual(
      master
        .filter((r) => r.level === "★3")
        .map((r, i) => ({
          criterionId: r.id,
          sheet: "匿名検証",
          row: master.indexOf(r) + 3,
          O: i < 24 ? " ○ " : i < 48 ? "△" : i < 76 ? "✖" : "",
          P: ` 理由-${r.id}\n2行目 `,
          Q: `根拠と作業-${r.id}`,
          R: `補足-${r.id}`,
        })),
    );
  });
  it.each(["O", "P", "Q", "R", "L", "B", "K"])(
    "rejects cached formulas in %s without evaluating them",
    (col) => {
      const { book, sheet } = workbook();
      sheet.getCell(`${col}${firstRow}`).value = { formula: "1+1", result: "○" };
      expect(parseWorkbook(book, reference).errors).toEqual(
        expect.arrayContaining([
          { code: "FORMULA_CELL", sheet: "匿名検証", row: firstRow, column: col },
        ]),
      );
    },
  );
  it.each([42, true, new Date("2026-01-01"), { text: "○", hyperlink: "https://example.invalid" }])(
    "rejects non-string answer cell types",
    (value) => {
      const { book, sheet } = workbook();
      sheet.getCell(`O${firstRow}`).value = value;
      expect(parseWorkbook(book, reference).errors).toEqual([
        { code: "RESPONSE_TYPE", sheet: "匿名検証", row: firstRow, column: "O" },
      ]);
    },
  );
  it.each(["O", "P", "Q", "R"] as const)(
    "preserves formatted text in %s as the exact original string after xlsx roundtrip",
    async (column) => {
      const { book, sheet } = workbook();
      const value = column === "O" ? " ○ \n" : ` 前半-${column}\n後半 𠮷 `;
      sheet.getCell(`${column}${firstRow}`).value = value;
      const expected = parseWorkbook(book, reference);
      sheet.getCell(`${column}${firstRow}`).value = {
        richText: [
          { text: value.slice(0, 2), font: { bold: true } },
          { text: value.slice(2), font: { italic: true } },
        ],
      };
      const bytes = new Uint8Array(await book.xlsx.writeBuffer());
      expect(inspectXlsx(bytes).fileBytes).toBe(bytes.length);
      const loaded = new ExcelJS.Workbook();
      await loaded.xlsx.load(bytes.buffer as ArrayBuffer);
      expect(parseWorkbook(loaded, reference)).toEqual(expected);
      expect(expected.rows[0][column]).toBe(value);
    },
  );
  it.each(["unknown", "duplicate", "public", "header", "level"])(
    "rejects %s with a sheet/row/column location",
    (kind) => {
      const { book, sheet } = workbook();
      if (kind === "unknown") sheet.getCell(`L${firstRow}`).value = "99-99-99-99";
      if (kind === "duplicate")
        sheet.getCell(`L${firstRow + 1}`).value = sheet.getCell(`L${firstRow}`).value;
      if (kind === "public") sheet.getCell(`M${firstRow}`).value = "変更した文言";
      if (kind === "header") sheet.getCell("Q2").value = "変更列";
      if (kind === "level") sheet.getCell(`K${firstRow}`).value = "★4";
      expect(parseWorkbook(book, reference).errors.length).toBeGreaterThan(0);
    },
  );
  it("does not invent rows for missing criteria and rejects formulas even on excluded rows", () => {
    const { book, sheet } = workbook();
    for (const col of ["L", "O", "P", "Q", "R"]) sheet.getCell(`${col}${firstRow}`).value = null;
    expect(parseWorkbook(book, reference).rows.length).toBe(80);
    sheet.getCell("R3").value = { formula: "1+1", result: "private star4 text" };
    expect(parseWorkbook(book, reference).errors).toEqual([
      { code: "FORMULA_CELL", sheet: "匿名検証", row: 3, column: "R" },
    ]);
  });
});
function zip(extra: Record<string, Uint8Array> = {}) {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8("<workbook/>"),
    ...extra,
  });
}
function falsifySize(bytes: Uint8Array, name: string, size: number) {
  const view = new DataView(bytes.buffer),
    decoder = new TextDecoder();
  for (let pos = 0; pos < bytes.length - 46; pos++)
    if (view.getUint32(pos, true) === 0x02014b50) {
      const length = view.getUint16(pos + 28, true);
      if (decoder.decode(bytes.subarray(pos + 46, pos + 46 + length)) === name) {
        view.setUint32(pos + 24, size, true);
        view.setUint32(view.getUint32(pos + 42, true) + 22, size, true);
        return bytes;
      }
    }
  throw new Error("missing zip entry");
}
// Reuse the four anonymous filename-metadata cases from the independent local review.
function unicodePath(name: string, effective: string) {
  const data = strToU8(name);
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const result = new Uint8Array(5 + strToU8(effective).length);
  result[0] = 1;
  new DataView(result.buffer).setUint32(1, (crc ^ 0xffffffff) >>> 0, true);
  result.set(strToU8(effective), 5);
  return result;
}
describe("actual ZIP expansion", () => {
  it.each([
    [
      "xl/worksheets/_rels/sheet1.xml.rels",
      '<Relationships><Relationship TargetMode="External" /></Relationships>',
      "EXTERNAL_REFERENCE",
    ],
    ["xl/vbaProject.bin", "forbidden payload", "UNSUPPORTED_PACKAGE"],
    ["xl/externalLinks/externalLink1.xml", "forbidden payload", "UNSUPPORTED_PACKAGE"],
    ["xl/embeddings/oleObject1.bin", "forbidden payload", "UNSUPPORTED_PACKAGE"],
  ])(
    "rejects unsupported filename metadata before interpreting %s",
    (path, content, directError) => {
      expect(() => inspectXlsx(zip({ [path]: strToU8(content) }))).toThrow(directError);
      const aliased = zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "xl/workbook.xml": strToU8("<workbook/>"),
        "innocent.bin": [
          strToU8(content),
          { extra: { 0x7075: unicodePath("innocent.bin", path) } },
        ],
      });
      expect(() => inspectXlsx(aliased)).toThrow("ZIP_FILENAME_METADATA_UNSUPPORTED");
    },
  );
  it.each(["Exter&#110;al", "Exter&#x6e;al"])(
    "rejects XML-encoded external reference mode %s",
    (mode) => {
      expect(() =>
        inspectXlsx(
          zip({
            "_rels/.rels": strToU8(
              `<Relationships><Relationship TargetMode="${mode}" /></Relationships>`,
            ),
          }),
        ),
      ).toThrow("EXTERNAL_REFERENCE");
    },
  );
  it("validates CRC, encryption flags, ZIP64 and entry counts", () => {
    const mutate = (fn: (view: DataView, pos: number, bytes: Uint8Array) => void) => {
      const b = zip({ "ignored.bin": strToU8("abc") }),
        v = new DataView(b.buffer);
      for (let p = 0; p < b.length - 46; p++)
        if (v.getUint32(p, true) === 0x02014b50) {
          fn(v, p, b);
          return b;
        }
      throw new Error("missing directory");
    };
    expect(() =>
      inspectXlsx(
        mutate((v, p) => {
          v.setUint32(p + 16, 0, true);
          v.setUint32(v.getUint32(p + 42, true) + 14, 0, true);
        }),
      ),
    ).toThrow("ZIP_CRC_MISMATCH");
    expect(() => inspectXlsx(mutate((v, p) => v.setUint16(p + 8, 1, true)))).toThrow(
      "ENCRYPTED_UNSUPPORTED",
    );
    expect(() =>
      inspectXlsx(mutate((v, _p, b) => v.setUint16(b.length - 12, 65535, true))),
    ).toThrow("ZIP64_UNSUPPORTED");
    const entries = Object.fromEntries(
      Array.from({ length: 499 }, (_, i) => [`entry${i}`, new Uint8Array()]),
    );
    expect(() => inspectXlsx(zip(entries))).toThrow("ZIP_ENTRY_LIMIT");
  });
  it("rejects duplicate ZIP names and locally inconsistent headers", () => {
    const input = zip({ "a.bin": strToU8("a"), "b.bin": strToU8("b") }),
      view = new DataView(input.buffer),
      decoder = new TextDecoder();
    for (let p = 0; p < input.length - 46; p++)
      if (
        view.getUint32(p, true) === 0x02014b50 &&
        decoder.decode(input.subarray(p + 46, p + 51)) === "b.bin"
      ) {
        input[p + 46] = 97;
        input[view.getUint32(p + 42, true) + 30] = 97;
      }
    expect(() => inspectXlsx(input)).toThrow("ZIP_DUPLICATE_PATH");
    const broken = zip();
    broken[0] = 0;
    expect(() => inspectXlsx(broken)).toThrow("INVALID_ZIP_HEADER");
  });
  it("counts every entry and rejects a falsely declared small entry during inflation", () => {
    const input = falsifySize(zip({ "ignored.bin": new Uint8Array(20000) }), "ignored.bin", 1);
    expect(() => inspectXlsx(input, { ...XLSX_LIMITS, entryBytes: 10000 })).toThrow(
      "ZIP_ENTRY_SIZE_LIMIT",
    );
    expect(() => inspectXlsx(input)).toThrow("ZIP_SIZE_MISMATCH");
  });
  it("enforces cumulative actual expanded bytes across unrelated entries", () => {
    const input = zip({ "a.bin": new Uint8Array(6000), "b.bin": new Uint8Array(6000) });
    expect(() => inspectXlsx(input, { ...XLSX_LIMITS, expandedBytes: 11000 })).toThrow(
      "ZIP_EXPANDED_SIZE_LIMIT",
    );
    expect(inspectXlsx(input).expandedBytes).toBe(12019);
  });
  it.each(["xl/vbaProject.bin", "xl/externalLinks/externalLink1.xml"])(
    "rejects unsupported package entry %s",
    (name) =>
      expect(() => inspectXlsx(zip({ [name]: strToU8("x") }))).toThrow("UNSUPPORTED_PACKAGE"),
  );
  it("rejects external relationships and malformed input before ExcelJS", () => {
    expect(() =>
      inspectXlsx(
        zip({
          "_rels/.rels": strToU8(
            '<Relationships><Relationship TargetMode="External" /></Relationships>',
          ),
        }),
      ),
    ).toThrow("EXTERNAL_REFERENCE");
    expect(() => inspectXlsx(new Uint8Array([1, 2, 3]))).toThrow("INVALID_ZIP");
  });
});
