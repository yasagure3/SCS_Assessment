import { startExcelImport } from "../../src/front/workers/importClient";
// Browser-only diagnostic fixture: a real busy Worker, never included in production.
export async function workerLifetime(cancel: boolean) {
  const url = URL.createObjectURL(
    new Blob(
      [
        "const memory = new Uint8Array(8 * 1024 * 1024); memory.fill(1); while (true) { memory[0] = (memory[0] + 1) % 255; }",
      ],
      { type: "text/javascript" },
    ),
  );
  let terminated = 0;
  const start = performance.now(),
    run = startExcelImport(
      new File(["x"], "anonymous.xlsx"),
      { standardId: "x", masterContentSha256: "0".repeat(64), rows: [] },
      {
        createWorker: () => {
          const worker = new Worker(url);
          return {
            set onmessage(value) {
              worker.onmessage = value;
            },
            get onmessage() {
              return worker.onmessage;
            },
            set onerror(value) {
              worker.onerror = value;
            },
            get onerror() {
              return worker.onerror;
            },
            postMessage: (value) => worker.postMessage(value),
            terminate: () => {
              terminated++;
              worker.terminate();
            },
          };
        },
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (id) => clearTimeout(id),
      },
    );
  if (cancel) setTimeout(() => run.cancel(), 150);
  let code = "";
  try {
    await run.promise;
  } catch (error) {
    code = (error as Error).message;
  } finally {
    URL.revokeObjectURL(url);
  }
  return {
    code,
    terminated,
    elapsedMs: performance.now() - start,
    allocatedWorkerBytes: 8 * 1024 * 1024,
  };
}
