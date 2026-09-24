// oxlint-disable-next-line no-restricted-imports -- Terminate the export Worker on report change/logout.
import { useEffect, useRef, useState } from "react";
import type { ReportSnapshot } from "../../../shared/contracts/reports";
import { startReportExcel, type ExcelResult } from "../../workers/reportClient";

function saveExcel(bytes: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "EXCEL_FAILED";
  return (
    (
      {
        EXCEL_CANCELLED: "生成を取り消しました。同じ報告版で再試行できます。",
        EXCEL_TIMEOUT: "120秒以内に生成できませんでした。同じ報告版で再試行してください。",
        REPORT_SNAPSHOT_INVALID:
          "報告内容の形式またはサイズを確認できません。報告版を読み直してください。",
      } as Record<string, string>
    )[code] ?? "Excelを生成できませんでした。同じ報告版で再試行してください。"
  );
}
export function ReportExcelExport({
  snapshot,
  start = startReportExcel,
  save = saveExcel,
}: {
  snapshot: ReportSnapshot;
  start?: typeof startReportExcel;
  save?: (bytes: ArrayBuffer, filename: string) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState(""),
    [result, setResult] = useState<ExcelResult | null>(null);
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
    <section className="report-excel-export" aria-label="作業用Excelの保存">
      <h3>作業用Excelを保存</h3>
      <p>作業用Excelは再取込対象外です。PDFと同じ報告版から5シートを生成します。</p>
      <p className="subtle">証跡URLにアクセス情報がある場合はURLを省略します。</p>
      <div className="task-actions">
        <button
          className="button primary"
          disabled={progress !== null}
          onClick={() => void generate()}
        >
          {progress !== null ? "Excelを生成しています…" : "Excelを生成"}
        </button>
        {progress !== null && (
          <button className="button secondary" onClick={() => active.current?.cancel()}>
            Excel生成を取り消す
          </button>
        )}
        {result && (
          <button
            className="button primary"
            onClick={() => save(result.bytes, `SCS-${result.reportId}.xlsx`)}
          >
            Excelを保存
          </button>
        )}
      </div>
      {progress !== null && (
        <div role="status">
          <label>
            Excel生成 {progress}% <progress value={progress} max={100} />
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          Excelの生成が完了しました。5シート / {(result.bytes.byteLength / 1024).toFixed(1)}KB /{" "}
          {(result.elapsedMs / 1000).toFixed(1)}秒
        </p>
      )}
    </section>
  );
}
