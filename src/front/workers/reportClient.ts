import type { ReportSnapshot } from "../../shared/contracts/reports";
export type PdfResult = { bytes: ArrayBuffer; pages: number; elapsedMs: number; reportId: string };
export type ExcelResult = Omit<PdfResult, "pages">;
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
  createWorker: () =>
    new Worker(new URL("./report.worker.ts", import.meta.url), { type: "module" }),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id),
};
export function startReportPdf(
  snapshot: ReportSnapshot,
  onProgress: (percent: number) => void,
  ports: Ports = browserPorts,
) {
  return startReport<PdfResult>(snapshot, onProgress, "PDF", ports);
}
export function startReportExcel(
  snapshot: ReportSnapshot,
  onProgress: (percent: number) => void,
  ports: Ports = browserPorts,
) {
  return startReport<ExcelResult>(snapshot, onProgress, "EXCEL", ports);
}
function startReport<Result extends ExcelResult>(
  snapshot: ReportSnapshot,
  onProgress: (percent: number) => void,
  format: "PDF" | "EXCEL",
  ports: Ports,
) {
  let cancel = () => {};
  const promise = new Promise<Result>((resolve, reject) => {
    const worker = ports.createWorker();
    let settled = false;
    const finish = (error?: Error, result?: Result) => {
      if (settled) return;
      settled = true;
      ports.clearTimer(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = ports.setTimer(() => finish(new Error(`${format}_TIMEOUT`)), 120_000);
    cancel = () => finish(new Error(`${format}_CANCELLED`));
    worker.onmessage = (event) => {
      if (settled) return;
      const message = event.data as { progress?: number; result?: Result; error?: string };
      if (typeof message.progress === "number") onProgress(message.progress);
      else if (message.result) finish(undefined, message.result);
      else finish(new Error(message.error ?? `${format}_FAILED`));
    };
    worker.onerror = () => finish(new Error(`${format}_FAILED`));
    try {
      worker.postMessage(format === "PDF" ? { snapshot } : { snapshot, format: "excel" });
    } catch {
      finish(new Error(`${format}_FAILED`));
    }
  });
  return { promise, cancel: () => cancel() };
}
