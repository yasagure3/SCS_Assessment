import { inspectXlsx } from "./xlsxLimits";
import { parseMasterWorkbook } from "./parseMasterWorkbook";
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const { file } = event.data;
    const bytes = new Uint8Array(await file.arrayBuffer());
    inspectXlsx(bytes);
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.default.Workbook();
    await book.xlsx.load(bytes.buffer as ArrayBuffer);
    const { errors, ...parsed } = parseMasterWorkbook(book);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    self.postMessage({
      result: {
        workbook: {
          ...parsed,
          fileName: file.name,
          fileSha256: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(
            "",
          ),
        },
        errors,
      },
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "WORKER_FAILED" });
  }
};
