import { describe, expect, it, vi } from "vite-plus/test";
import { reportSnapshotFixture } from "../../../tests/fixtures/reportSnapshot";
import { startReportPdf } from "./reportClient";

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
});
