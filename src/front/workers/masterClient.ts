import type { MasterWorkbook } from "../../shared/contracts/masterImport";
import type { ImportIssue } from "../../shared/contracts/imports";
export type MasterExcelResult = { workbook: MasterWorkbook; errors: ImportIssue[] };
export function startMasterImport(file: File) {
  let cancel = () => {};
  const promise = new Promise<MasterExcelResult>((resolve, reject) => {
    if (!/\.xlsx$/i.test(file.name)) {
      reject(new Error(".xlsxファイルを選択してください。"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("ファイルは10MiB以内で選択してください。"));
      return;
    }
    const worker = new Worker(new URL("./master.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (error?: string, result?: MasterExcelResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(new Error(error));
      else resolve(result!);
    };
    const timer = setTimeout(() => finish("検査が10秒を超えたため中止しました。"), 10000);
    cancel = () => finish("検査を中止しました。");
    worker.onmessage = (event: MessageEvent<{ error?: string; result?: MasterExcelResult }>) =>
      finish(event.data.error, event.data.result);
    worker.onerror = () => finish("Excelを読み取れませんでした。");
    worker.postMessage({ file });
  });
  return { promise, cancel: () => cancel() };
}
