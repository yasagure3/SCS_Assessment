import type { ReportSnapshot } from "../../shared/contracts/reports";
import { createReportPdf } from "./reportPdf";

const fontPath = "/fonts/NotoSansCJKjp-Regular.otf";
const fontSha256 = "68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5";
self.onmessage = async (event: MessageEvent<{ snapshot: ReportSnapshot; format?: "excel" }>) => {
  const started = performance.now();
  try {
    self.postMessage({ progress: 1 });
    if (event.data.format === "excel") {
      const { createReportExcel } = await import("./reportExcel");
      const output = await createReportExcel(event.data.snapshot, (progress) =>
        self.postMessage({ progress }),
      );
      const bytes = new Uint8Array(output).buffer;
      self.postMessage(
        {
          result: {
            bytes,
            elapsedMs: performance.now() - started,
            reportId: event.data.snapshot.reportId,
          },
        },
        { transfer: [bytes] },
      );
      return;
    }
    let fontBytes: Uint8Array;
    try {
      const response = await fetch(new URL(fontPath, self.location.origin), {
        credentials: "same-origin",
        redirect: "error",
      });
      if (!response.ok) throw new Error("font fetch failed");
      const bytes = await response.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== fontSha256) throw new Error("font checksum failed");
      fontBytes = new Uint8Array(bytes);
    } catch {
      throw new Error("PDF_FONT_FAILED");
    }
    const output = await createReportPdf(event.data.snapshot, fontBytes, (progress) =>
      self.postMessage({ progress }),
    );
    const bytes = new Uint8Array(output.bytes).buffer;
    self.postMessage(
      {
        result: {
          bytes,
          pages: output.pages,
          elapsedMs: performance.now() - started,
          reportId: event.data.snapshot.reportId,
        },
      },
      { transfer: [bytes] },
    );
  } catch (error) {
    // Error codes only. Never serialize report text or a stack containing content.
    const message = error instanceof Error ? error.message : "PDF_FAILED";
    self.postMessage({
      error: /^(PDF_GLYPH_MISSING:U\+[A-F0-9]+|REPORT_SNAPSHOT_INVALID|PDF_FONT_FAILED)$/.test(
        message,
      )
        ? message
        : event.data.format === "excel"
          ? "EXCEL_FAILED"
          : "PDF_FAILED",
    });
  }
};
