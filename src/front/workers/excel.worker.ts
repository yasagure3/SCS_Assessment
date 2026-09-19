import type { ImportMaster } from "../../shared/contracts/imports";
import { inspectXlsx } from "./xlsxLimits";
import { parseWorkbook } from "./parseWorkbook";
self.onmessage = async (event: MessageEvent<{ file: File; master: ImportMaster }>) => {
  const start = performance.now();
  try {
    const { file, master } = event.data,
      bytes = new Uint8Array(await file.arrayBuffer()),
      zip = inspectXlsx(bytes);
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.default.Workbook();
    await book.xlsx.load(bytes.buffer as ArrayBuffer);
    const parsed = parseWorkbook(book, master);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const normalized = {
      standardId: master.standardId,
      fileName: file.name,
      clientFileSha256: Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
      masterContentSha256: master.masterContentSha256,
      star4Excluded: parsed.star4Excluded,
      rows: parsed.rows,
    };
    self.postMessage({
      result: {
        normalized,
        errors: parsed.errors,
        metrics: { ...zip, elapsedMs: performance.now() - start },
      },
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "WORKER_FAILED" });
  }
};
