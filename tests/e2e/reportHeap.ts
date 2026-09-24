import type { BrowserContext, Page } from "@playwright/test";

type HeapUsage = {
  usedSize: number;
  totalSize: number;
  embedderHeapUsedSize: number;
  backingStorageSize: number;
};
type HeapSample = HeapUsage & { elapsedMs: number; targetId: string };

// Protocol fields follow the installed playwright-core/types/protocol.d.ts:
// Target.setAutoAttach / receivedMessageFromTarget and Runtime.getHeapUsage.
// This samples the actual dedicated PDF Worker isolate, never the page's heap.
export async function measurePdfWorkerMemory(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  const started = performance.now(),
    samples: HeapSample[] = [],
    errors: string[] = [];
  const targets: { targetId: string; url: string }[] = [];
  const sessions = new Map<
    string,
    { targetId: string; pendingId: number | null; timer: ReturnType<typeof setInterval> }
  >();
  let sequence = 0,
    droppedAtTermination = 0;
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    const session = sessions.get(event.sessionId);
    if (!session) return;
    const response = JSON.parse(event.message) as {
      id?: number;
      result?: HeapUsage;
      error?: { message: string };
    };
    if (response.id !== session.pendingId) return;
    session.pendingId = null;
    if (response.error) errors.push(response.error.message);
    else if (response.result)
      samples.push({
        ...response.result,
        elapsedMs: performance.now() - started,
        targetId: session.targetId,
      });
  });
  cdp.on("Target.attachedToTarget", (event) => {
    if (event.targetInfo.type !== "worker" || !event.targetInfo.url.includes("report.worker"))
      return;
    const { sessionId } = event;
    targets.push({ targetId: event.targetInfo.targetId, url: event.targetInfo.url });
    const sample = () => {
      const session = sessions.get(sessionId);
      if (!session || session.pendingId !== null) return;
      const id = ++sequence;
      session.pendingId = id;
      void cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method: "Runtime.getHeapUsage" }),
        })
        .catch((error: Error) => {
          if (sessions.has(sessionId)) errors.push(error.message);
        });
    };
    sessions.set(sessionId, {
      targetId: event.targetInfo.targetId,
      pendingId: null,
      timer: setInterval(sample, 100),
    });
    sample();
  });
  cdp.on("Target.detachedFromTarget", (event) => {
    const session = sessions.get(event.sessionId);
    if (!session) return;
    if (session.pendingId !== null) droppedAtTermination++;
    clearInterval(session.timer);
    sessions.delete(event.sessionId);
  });
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
    filter: [{ type: "worker" }],
  });
  return {
    finish: async () => {
      for (const session of sessions.values()) clearInterval(session.timer);
      await cdp.send("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: false,
      });
      await cdp.detach();
      return {
        method: "CDP Runtime.getHeapUsage on the actual report.worker dedicated Worker isolate",
        requestedIntervalMs: 100,
        sampleCount: samples.length,
        targets,
        errors,
        droppedAtTermination,
        peaks: Object.fromEntries(
          (["usedSize", "totalSize", "embedderHeapUsedSize", "backingStorageSize"] as const).map(
            (key) => [key, Math.max(0, ...samples.map((sample) => sample[key]))],
          ),
        ),
        samples,
        limitations:
          "Sampled peaks only; a busy isolate can delay replies and an outstanding sample can be lost when the worker terminates. CDP JS heap/GC embedder heap/backing storage are not total browser process RSS or an upper bound. No GC is forced and no minimum-memory-device guarantee is implied.",
      };
    },
  };
}
