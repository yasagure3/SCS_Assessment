import { describe, expect, it, vi } from "vite-plus/test";
import { reportSnapshotFixture } from "../../../tests/fixtures/reportSnapshot";
import { startReportPdf, startReportExcel } from "./reportClient";

describe("PDF generation lifetime", () => {
  function fixture() {
    const worker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    return {
      worker,
      ports: {
        createWorker: () => worker,
        setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimer: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      },
    };
  }
  it("terminates at exactly 120 seconds and retains the snapshot for a new attempt", async () => {
    vi.useFakeTimers();
    try {
      const { worker, ports } = fixture(),
        snapshot = reportSnapshotFixture();
      const run = startReportPdf(snapshot, () => {}, ports);
      const result = run.promise.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(119999);
      expect(worker.terminate).toHaveBeenCalledTimes(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe("PDF_TIMEOUT");
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      const retry = startReportPdf(snapshot, () => {}, ports);
      expect(worker.postMessage.mock.calls).toEqual([[{ snapshot }], [{ snapshot }]]);
      const cancelled = retry.promise.catch((e: Error) => e.message);
      retry.cancel();
      expect(await cancelled).toBe("PDF_CANCELLED");
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancels once and ignores late worker messages", async () => {
    const { worker, ports } = fixture(),
      progress = vi.fn();
    const run = startReportPdf(reportSnapshotFixture(), progress, ports);
    const result = run.promise.catch((e: Error) => e.message);
    const late = worker.onmessage!;
    run.cancel();
    run.cancel();
    late(new MessageEvent("message", { data: { progress: 70 } }));
    expect(await result).toBe("PDF_CANCELLED");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBe(null);
    expect(progress.mock.calls).toEqual([]);
  });
  it("routes Excel the same snapshot and terminates after a completed result", async () => {
    const { worker, ports } = fixture(),
      snapshot = reportSnapshotFixture(),
      progress = vi.fn();
    const run = startReportExcel(snapshot, progress, ports);
    worker.onmessage!(new MessageEvent("message", { data: { progress: 75 } }));
    const output = { bytes: new ArrayBuffer(5), reportId: snapshot.reportId, elapsedMs: 30 };
    worker.onmessage!(new MessageEvent("message", { data: { result: output } }));
    expect(await run.promise).toEqual(output);
    expect({
      sent: worker.postMessage.mock.calls,
      progress: progress.mock.calls,
      terminated: worker.terminate.mock.calls,
    }).toEqual({ sent: [[{ snapshot, format: "excel" }]], progress: [[75]], terminated: [[]] });
  });
  it("times out Excel at 120 seconds and cancels a same-snapshot retry", async () => {
    vi.useFakeTimers();
    try {
      const { worker, ports } = fixture(),
        snapshot = reportSnapshotFixture();
      const run = startReportExcel(snapshot, () => {}, ports),
        error = run.promise.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(119999);
      expect(worker.terminate).toHaveBeenCalledTimes(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(await error).toBe("EXCEL_TIMEOUT");
      const retry = startReportExcel(snapshot, () => {}, ports),
        cancelled = retry.promise.catch((e: Error) => e.message);
      retry.cancel();
      expect(await cancelled).toBe("EXCEL_CANCELLED");
      expect(worker.postMessage.mock.calls).toEqual([
        [{ snapshot, format: "excel" }],
        [{ snapshot, format: "excel" }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
