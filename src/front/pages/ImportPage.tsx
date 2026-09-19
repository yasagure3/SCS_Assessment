import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { LoadState } from "../components/WorkspaceShell";
import { useApi, useWrite, isAccessError } from "../lib/api";
import { startExcelImport, type ExcelResult } from "../workers/importClient";
import type {
  ImportMaster,
  ImportPreview,
  PreviewImport,
  CommitImport,
  ImportCommitted,
} from "../../shared/contracts/imports";
import type { AssessmentDto } from "../../shared/contracts/assessments";
const issueLabels: Record<string, string> = {
  FORMULA_CELL: "数式は取り込めません。文字列で入力してください。",
  RESPONSE_TYPE: "回答は文字列のセルで入力してください。",
  UNKNOWN_ID: "公式マスターにない評価基準No.です。",
  DUPLICATE_ID: "評価基準No.が重複しています。",
  PUBLIC_MASTER_MISMATCH: "公開マスターの文言または★3/★4の値が一致しません。",
  HEADER_MISMATCH: "列見出しが一致しません。",
  TEMPLATE_SHEET: "対応するシートを1つにしてください。",
  UNKNOWN_STATUS: "自己評価は○・△・✖・空欄で入力してください。",
  TEXT_LIMIT: "8000文字を超えています。",
};
const errorLabels: Record<string, string> = {
  WORKER_TIMEOUT: "検査が10秒を超えたため中止しました。ファイルを確認して再選択してください。",
  WORKER_CANCELLED: "検査を中止しました。診断は変更していません。",
  XLSX_REQUIRED: "拡張子が .xlsx のファイルを選択してください。",
  FILE_SIZE_LIMIT: "ファイルは10MiB以内で選択してください。",
};
export function ImportForm({
  revision,
  master,
  importer = startExcelImport,
  preview,
  commit,
}: {
  revision: number;
  master: ImportMaster;
  importer?: typeof startExcelImport;
  preview: (input: PreviewImport) => Promise<ImportPreview | null>;
  commit: (input: CommitImport) => Promise<boolean>;
}) {
  const [stage, setStage] = useState("select"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [result, setResult] = useState<ExcelResult | null>(null),
    [verified, setVerified] = useState<ImportPreview | null>(null),
    [ack, setAck] = useState(false),
    [saving, setSaving] = useState(false);
  const generation = useRef(0),
    job = useRef<ReturnType<typeof startExcelImport> | null>(null),
    mutation = useRef("");
  const lifecycle = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    return () => {
      generation.current++;
      job.current?.cancel();
      job.current = null;
    };
  }, []);
  function cancel() {
    generation.current++;
    job.current?.cancel();
    job.current = null;
    setStage("select");
    setResult(null);
    setVerified(null);
    setNotice(errorLabels.WORKER_CANCELLED);
  }
  async function select(file: File) {
    job.current?.cancel();
    const current = ++generation.current,
      expectedRevision = revision;
    setStage("checking");
    setError("");
    setNotice("");
    setResult(null);
    setVerified(null);
    setAck(false);
    try {
      job.current = importer(file, master);
      const parsed = await job.current.promise;
      if (current !== generation.current) return;
      job.current = null;
      setResult(parsed);
      if (parsed.errors.length) {
        setStage("invalid");
        return;
      }
      const response = await preview({ expectedRevision, normalized: parsed.normalized });
      if (current !== generation.current) return;
      if (!response) {
        setStage("select");
        return;
      }
      mutation.current = crypto.randomUUID();
      setVerified(response);
      setStage("preview");
    } catch (reason) {
      if (current !== generation.current) return;
      job.current = null;
      setStage("select");
      const code = reason instanceof Error ? reason.message : "WORKER_FAILED";
      setError(
        errorLabels[code] ??
          `ファイルを検査できませんでした（${code}）。対応形式・サイズを確認してください。`,
      );
    }
  }
  async function save() {
    if (!result || !verified || saving) return;
    setSaving(true);
    try {
      const ok = await commit({
        expectedRevision: verified.revision,
        mutationId: mutation.current,
        normalized: result.normalized,
        normalizedSha256: verified.normalizedSha256,
        acknowledgedMissingIds: ack ? verified.missingIds : [],
      });
      if (ok) {
        setResult(null);
        setVerified(null);
        setStage("done");
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="import-workspace" ref={lifecycle}>
      <ol className="import-steps" aria-label="取込手順">
        <li aria-current={stage === "select" ? "step" : undefined}>01　ファイルを選択</li>
        <li aria-current={["checking", "preview", "invalid"].includes(stage) ? "step" : undefined}>
          02　取込内容を確認
        </li>
        <li aria-current={stage === "done" ? "step" : undefined}>03　診断を開始</li>
      </ol>
      <p className="notice">
        2026-03-27版の一次スクリーニングExcelに対応しています。作業用Excelは初回取込フォーマットではありません。元Excelはブラウザ内で検査し、サーバーには保存しません。
      </p>
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {stage !== "done" && (
        <section className="panel import-select">
          <div>
            <p className="eyebrow">LOCAL EXCEL INSPECTION</p>
            <h2>スクリーニング結果を選択</h2>
            <p className="subtle">.xlsx · 10MiB以内 · O〜Rの原文を保持</p>
          </div>
          <label className="field-label">
            Excelファイルを選択
            <input
              type="file"
              accept=".xlsx"
              disabled={saving || stage === "checking"}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void select(file);
              }}
            />
          </label>
        </section>
      )}
      {stage === "checking" && (
        <div className="notice import-actions">
          <p role="status">ファイルと81基準を検査しています…</p>
          <button type="button" className="button" onClick={cancel}>
            検査を中止
          </button>
        </div>
      )}
      {result?.errors.length ? (
        <section className="panel">
          <h2>取込できない箇所</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>シート</th>
                  <th>行・列</th>
                  <th>確認内容</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((issue, i) => (
                  <tr key={i}>
                    <td>{issue.sheet}</td>
                    <td>
                      {issue.row}行 {issue.column}列
                    </td>
                    <td>{issueLabels[issue.code] ?? issue.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {verified && result && (
        <section className="panel import-preview">
          <h2>取込内容を確認</h2>
          <p className="subtle">
            {result.normalized.fileName} · ★3 81基準 / ★4 {result.normalized.star4Excluded}
            基準を除外
          </p>
          <div className="import-counts">
            {(
              [
                ["yes", "○ 満たしている"],
                ["uncertain", "△ 判断できない"],
                ["no", "✖ 満たしていない"],
                ["unanswered", "未回答"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <strong data-testid={`import-${key}-count`}>{verified.counts[key]}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Excelの列</th>
                  <th>取込先</th>
                  <th>原文の扱い</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["L", "評価基準No.", "公式マスターとの照合キー"],
                  ["O", "自己評価", "○・△・✖・空欄を保持"],
                  ["P", "判定理由", "空白・改行を含め保持"],
                  ["Q", "根拠・実施内容", "今後の作業と分けて確認"],
                  ["R", "補足情報", "原文を保持"],
                ].map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell) => (
                      <td key={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="notice">
            Q列には今後の作業が混ざる場合があります。取込後に「根拠・実施内容」と「今後の作業」を分けて確認してください。今後の作業は空欄で開始します。
          </p>
          {verified.warnings.map((w, i) => (
            <p className="notice" key={i}>
              {w.sheet} {w.row}行 O列：「
              {result.normalized.rows.find((r) => r.sheet === w.sheet && r.row === w.row)?.O}」を「✖
              満たしていない」に正規化します。原文は保持します。
            </p>
          ))}
          {verified.missingIds.length > 0 && (
            <div className="notice warn">
              <h3>欠落した★3基準 {verified.missingIds.length}件</h3>
              <p>{verified.missingIds.join("、")}</p>
              <label>
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.currentTarget.checked)}
                />
                欠落した基準を未回答として取り込むことを確認しました
              </label>
            </div>
          )}
          <details>
            <summary>原文と出典行を確認（{result.normalized.rows.length}件）</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "評価基準No.",
                      "シート・行",
                      "O 自己評価",
                      "P 理由",
                      "Q 根拠および実施する事",
                      "R 補足情報",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.normalized.rows.map((r) => (
                    <tr key={r.criterionId}>
                      <td>{r.criterionId}</td>
                      <td>
                        {r.sheet} {r.row}行
                      </td>
                      {[r.O, r.P, r.Q, r.R].map((v, i) => (
                        <td className="import-raw" key={i}>
                          {v || "（空欄）"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="import-actions">
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => {
                setStage("select");
                setResult(null);
                setVerified(null);
              }}
            >
              選択に戻る
            </button>
            <button
              type="button"
              className="button primary"
              disabled={saving || (!verified.canCommit && !ack)}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "81回答を取り込む"}
            </button>
          </div>
        </section>
      )}
      {stage === "done" && (
        <p role="status" className="notice">
          81回答を取り込みました。
        </p>
      )}
    </section>
  );
}
function ImportContent({
  record,
  readOnly,
  refresh,
  replace,
}: {
  record: AssessmentDto;
  readOnly: boolean;
  refresh: () => Promise<void>;
  replace: (record: AssessmentDto) => Promise<unknown>;
}) {
  const master = useApi<ImportMaster>(`/api/v1/standards/${record.standardId}/import-master`),
    write = useWrite();
  const unavailable =
    record.document.importInfo !== null ||
    Object.values(record.document.responses).some((r) => r.manualEdited);
  return (
    <>
      <LoadState loading={master.isLoading} error={master.error} retry={master.mutate} />
      {write.error && (
        <div role="alert" className="notice danger">
          <p>{write.error.message}</p>
          <button type="button" className="text-button" onClick={() => void refresh()}>
            診断を再読込して確認
          </button>
        </div>
      )}
      {isAccessError(write.error) ? null : unavailable ? (
        <section className="panel">
          <h2>この診断は取込済み、または回答を手動保存済みです</h2>
          <p>Excel取込には新しい診断を使用してください。</p>
          <Link className="text-button" to={`/assessments/${record.id}`}>
            現状ダッシュボードへ
          </Link>
        </section>
      ) : (
        !readOnly &&
        master.data &&
        !isAccessError(master.error) && (
          <ImportForm
            revision={record.revision}
            master={master.data}
            preview={async (input) =>
              (
                await write.send<ImportPreview>(
                  `/api/v1/assessments/${record.id}/imports/preview`,
                  "POST",
                  input,
                  { readOnly: true },
                )
              )?.data ?? null
            }
            commit={async (input) => {
              const response = await write.send<ImportCommitted>(
                `/api/v1/assessments/${record.id}/imports`,
                "POST",
                input,
              );
              if (!response) return false;
              await replace(response.data.assessment);
              return true;
            }}
          />
        )
      )}
    </>
  );
}
export function ImportPage() {
  return (
    <AssessmentLayout title="Excelから診断を始める">
      {({ record, readOnly, refresh, assessment }) => (
        <ImportContent
          key={record.id}
          record={record}
          readOnly={readOnly}
          refresh={refresh}
          replace={(record) => assessment.replace({ data: record, requestId: "import" })}
        />
      )}
    </AssessmentLayout>
  );
}
