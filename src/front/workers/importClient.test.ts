import { describe, it, expect, vi } from "vitest";
import { startExcelImport } from "./importClient";
describe("Excel worker lifetime", () => {
  function fixture() {
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const ports = {
      createWorker: () => worker,
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    };
    return { worker, ports };
  }
  it("terminates at 10 seconds and ignores a late successful result", async () => {
    vi.useFakeTimers();
    const { worker, ports } = fixture();
    const run = startExcelImport(
      new File(["x"], "a.xlsx"),
      { standardId: "x", masterContentSha256: "a".repeat(64), rows: [] },
      ports,
    );
    const result = run.promise.catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(9999);
    expect(worker.terminate).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("WORKER_TIMEOUT");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBe(null);
    expect(worker.onerror).toBe(null);
    vi.useRealTimers();
  });
  it("cancels immediately and releases worker handlers exactly once", async () => {
    const { worker, ports } = fixture(),
      run = startExcelImport(
        new File(["x"], "a.xlsx"),
        { standardId: "x", masterContentSha256: "a".repeat(64), rows: [] },
        ports,
      ),
      result = run.promise.catch((e) => e.message);
    run.cancel();
    run.cancel();
    expect(await result).toBe("WORKER_CANCELLED");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBe(null);
  });
});
