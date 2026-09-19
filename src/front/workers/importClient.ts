import type { ImportMaster, NormalizedImport, ImportIssue } from "../../shared/contracts/imports";
export type ExcelResult = {
  normalized: NormalizedImport;
  errors: ImportIssue[];
  metrics: { elapsedMs: number; expandedBytes: number; fileBytes: number; entries: number };
};
type WorkerPort = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (value: unknown) => void;
  terminate: () => void;
};
type Ports = {
  createWorker: () => WorkerPort;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
};
const browserPorts: Ports = {
  createWorker: () => new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" }),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id),
};
export function startExcelImport(file: File, master: ImportMaster, ports: Ports = browserPorts) {
  let cancel = () => {};
  const promise = new Promise<ExcelResult>((resolve, reject) => {
    if (!/\.xlsx$/i.test(file.name)) {
      reject(new Error("XLSX_REQUIRED"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("FILE_SIZE_LIMIT"));
      return;
    }
    const worker = ports.createWorker();
    let settled = false;
    const finish = (error?: Error, result?: ExcelResult) => {
      if (settled) return;
      settled = true;
      ports.clearTimer(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = ports.setTimer(() => finish(new Error("WORKER_TIMEOUT")), 10000);
    cancel = () => finish(new Error("WORKER_CANCELLED"));
    worker.onmessage = (event) => {
      const message = event.data as { result?: ExcelResult; error?: string };
      if (message.result) finish(undefined, message.result);
      else finish(new Error(message.error ?? "WORKER_FAILED"));
    };
    worker.onerror = () => finish(new Error("WORKER_FAILED"));
    worker.postMessage({ file, master });
  });
  return { promise, cancel: () => cancel() };
}
