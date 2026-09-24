import type { ReportSnapshot } from "../../shared/contracts/reports";
export type PdfResult = { bytes: ArrayBuffer; pages: number; elapsedMs: number; reportId: string };
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
  let cancel = () => {};
  const promise = new Promise<PdfResult>((resolve, reject) => {
    const worker = ports.createWorker();
    let settled = false;
    const finish = (error?: Error, result?: PdfResult) => {
      if (settled) return;
      settled = true;
      ports.clearTimer(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = ports.setTimer(() => finish(new Error("PDF_TIMEOUT")), 120_000);
    cancel = () => finish(new Error("PDF_CANCELLED"));
    worker.onmessage = (event) => {
      if (settled) return;
      const message = event.data as { progress?: number; result?: PdfResult; error?: string };
      if (typeof message.progress === "number") onProgress(message.progress);
      else if (message.result) finish(undefined, message.result);
      else finish(new Error(message.error ?? "PDF_FAILED"));
    };
    worker.onerror = () => finish(new Error("PDF_FAILED"));
    try {
      worker.postMessage({ snapshot });
    } catch {
      finish(new Error("PDF_FAILED"));
    }
  });
  return { promise, cancel: () => cancel() };
}
