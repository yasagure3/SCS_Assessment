// oxlint-disable-next-line no-restricted-imports -- Worker cancellation is an external resource cleanup on report change/logout.
import { useEffect, useRef, useState } from "react";
import type { ReportSnapshot } from "../../../shared/contracts/reports";
import { startReportPdf, type PdfResult } from "../../workers/reportClient";

function savePdf(bytes: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "PDF_FAILED";
  if (code.startsWith("PDF_GLYPH_MISSING:"))
    return `フォントに収録されていない文字があります（${code.slice(18)}）。内容を確認してください。`;
  return (
    (
      {
        PDF_CANCELLED: "生成を取り消しました。同じ報告版で再試行できます。",
        PDF_TIMEOUT: "120秒以内に生成できませんでした。同じ報告版で再試行してください。",
        PDF_FONT_FAILED: "フォントを読み込めませんでした。同じ報告版で再試行してください。",
        REPORT_SNAPSHOT_INVALID:
          "報告内容の形式またはサイズを確認できません。報告版を読み直してください。",
      } as Record<string, string>
    )[code] ?? "PDFを生成できませんでした。同じ報告版で再試行してください。"
  );
}
export function ReportPdfExport({
  snapshot,
  start = startReportPdf,
  save = savePdf,
}: {
  snapshot: ReportSnapshot;
  start?: typeof startReportPdf;
  save?: (bytes: ArrayBuffer, filename: string) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState(""),
    [result, setResult] = useState<PdfResult | null>(null);
  const active = useRef<ReturnType<typeof start> | null>(null);
  useEffect(
    () => () => {
      const run = active.current;
      active.current = null;
      run?.cancel();
    },
    [],
  );
  async function generate() {
    if (active.current) return;
    setError("");
    setResult(null);
    setProgress(0);
    const run = start(snapshot, setProgress);
    active.current = run;
    try {
      const output = await run.promise;
      if (active.current === run) setResult(output);
    } catch (failure) {
      if (active.current === run) setError(errorMessage(failure));
    } finally {
      if (active.current === run) {
        active.current = null;
        setProgress(null);
      }
    }
  }
  return (
    <section className="report-pdf-export" aria-label="PDFの保存">
      <h3>PDFを保存</h3>
      <p>
        日本語フォントを含む約14MBのPDFを、この報告版から生成します。生成中も画面を操作できます。
      </p>
      <div className="task-actions">
        <button
          className="button primary"
          disabled={progress !== null}
          onClick={() => void generate()}
        >
          {progress !== null ? "生成しています…" : "PDFを生成"}
        </button>
        {progress !== null && (
          <button className="button secondary" onClick={() => active.current?.cancel()}>
            生成を取り消す
          </button>
        )}
        {result && (
          <button
            className="button primary"
            onClick={() => save(result.bytes, `SCS-${result.reportId}.pdf`)}
          >
            PDFを保存
          </button>
        )}
      </div>
      {progress !== null && (
        <div role="status">
          <label>
            PDF生成 {progress}% <progress value={progress} max={100} />
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          PDFの生成が完了しました。{result.pages}ページ /{" "}
          {(result.bytes.byteLength / 1024 / 1024).toFixed(1)}MB /{" "}
          {(result.elapsedMs / 1000).toFixed(1)}秒
        </p>
      )}
      <p className="subtle">
        <a href="/fonts/OFL.txt" target="_blank" rel="noreferrer">
          フォントライセンス
        </a>{" "}
        ·{" "}
        <a href="/fonts/NOTICE.txt" target="_blank" rel="noreferrer">
          PDFの配布情報
        </a>
      </p>
    </section>
  );
}
