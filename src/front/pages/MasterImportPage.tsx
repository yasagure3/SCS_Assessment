import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { useAccess } from "../lib/useAccess";
import { isAccessError, useWrite } from "../lib/api";
import { startMasterImport, type MasterExcelResult } from "../workers/masterClient";
import type { MasterPreview, MasterImportResult } from "../../shared/contracts/masterImport";

const fields: Record<string, string> = {
  requirementId: "要求事項No.",
  category: "大分類",
  requirementText: "要求事項",
  officialText: "評価基準",
  orderNo: "表示順",
};
const issues: Record<string, string> = {
  TEMPLATE_SHEET: "評価基準No.の見出しがあるシートを1つにしてください。",
  HEADER_MISMATCH: "見出しが対応形式と異なります。",
  CELL_TYPE: "文字数またはセルの種類を確認してください。数式は明細に使用できません。",
  INVALID_MASTER_ROW: "評価基準No.・★3/★4を確認してください。",
  DUPLICATE_ID: "評価基準No.が重複しています。",
  UNKNOWN_STATUS: "自己評価は○・△・✖・×・✕・-・空欄で入力してください。",
};
export function MasterImportForm({
  assessmentId,
  revision,
  readOnly,
}: {
  assessmentId: string;
  revision: number;
  readOnly: boolean;
}) {
  const write = useWrite();
  const [parsed, setParsed] = useState<MasterExcelResult | null>(null);
  const [preview, setPreview] = useState<MasterPreview | null>(null);
  const [done, setDone] = useState<MasterImportResult | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [ack, setAck] = useState(false);
  const job = useRef<ReturnType<typeof startMasterImport> | null>(null);
  const generation = useRef(0),
    sourceRevision = useRef(revision);
  const lifecycle = useCallback((node: HTMLElement | null) => {
    if (node)
      return () => {
        generation.current++;
        job.current?.cancel();
      };
  }, []);
  const pending = checking || write.pending;
  async function select(file: File) {
    const run = ++generation.current;
    job.current?.cancel();
    sourceRevision.current = revision;
    setChecking(true);
    setParsed(null);
    setPreview(null);
    setError("");
    setAck(false);
    write.clearError();
    try {
      job.current = startMasterImport(file);
      const result = await job.current.promise;
      if (run !== generation.current) return;
      setParsed(result);
      if (result.errors.length) return;
      const response = await write.send<MasterPreview>(
        `/api/v1/assessments/${assessmentId}/master-imports/preview`,
        "POST",
        { expectedRevision: sourceRevision.current, workbook: result.workbook },
        { readOnly: true },
      );
      if (run === generation.current && response) setPreview(response.data);
    } catch (failure) {
      if (run === generation.current)
        setError(failure instanceof Error ? failure.message : "読込に失敗しました。");
    } finally {
      if (run === generation.current) {
        setChecking(false);
        job.current = null;
      }
    }
  }
  async function commit() {
    if (!parsed || !preview || !ack || pending) return;
    const run = generation.current;
    const response = await write.send<MasterImportResult>(
      `/api/v1/assessments/${assessmentId}/master-imports`,
      "POST",
      {
        expectedRevision: sourceRevision.current,
        workbook: parsed.workbook,
        previewSha256: preview.previewSha256,
      },
    );
    if (response && run === generation.current) {
      setDone(response.data);
      setParsed(null);
      setPreview(null);
    }
  }
  if (isAccessError(write.error)) return <p role="alert">{write.error?.message}</p>;
  return (
    <section className="import-workspace" ref={lifecycle}>
      <p className="notice">
        評価項目マスタと自己評価を読み込み、同じ案件に新しい診断を作成します。既存診断の回答・証跡・履歴は保持されます。取込後はダッシュボード
        → 評価基準一覧・証跡 → 公式シート回答・Excel出力へ進めます。
      </p>
      <p>
        取込元はB〜N列のマスタとO〜R列の自己評価です。公式アセスメントシートは出力専用の別テンプレートとして管理します。
      </p>
      {(error || write.error) && (
        <p role="alert" className="notice danger">
          {error || write.error?.message}
        </p>
      )}
      {done ? (
        <section className="panel">
          <h2>取込が完了しました</h2>
          <p role="status">★3マスタ {done.preview.counts.total}件と自己評価を保存しました。</p>
          <Link className="button primary" to={`/assessments/${done.assessmentId}`}>
            取り込んだ診断のダッシュボードを開く
          </Link>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>自己評価Excelを選択</h2>
            <p>
              ★3の81評価基準に対応します。★4は参考マスタとして保持し、診断対象から除外します。.xlsx、10MiB以内。
            </p>
            <label className="field-label">
              評価項目マスタのExcel
              <input
                type="file"
                accept=".xlsx"
                disabled={pending || readOnly}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void select(file);
                }}
              />
            </label>
            {checking && (
              <>
                <p role="status">Excelと差分を確認しています…</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    generation.current++;
                    job.current?.cancel();
                    setChecking(false);
                    setParsed(null);
                    setPreview(null);
                  }}
                >
                  検査を中止
                </button>
              </>
            )}
          </section>
          {parsed?.errors.length ? (
            <section className="panel" role="alert">
              <h2>Excelを修正してください</h2>
              {parsed.errors.slice(0, 100).map((issue, i) => (
                <p key={i}>
                  {issue.sheet} {issue.row}行 {issue.column}列：{issues[issue.code] ?? issue.code}
                </p>
              ))}
            </section>
          ) : null}
          {preview && parsed && (
            <section className="panel">
              <h2>取込内容とマスタ差分</h2>
              <p>
                {parsed.workbook.fileName} ／ {parsed.workbook.sheet} ／ 見出し{" "}
                {parsed.workbook.headerRow}行目
              </p>
              <p>
                ★3 {preview.counts.total}件 ／ ★4対象外 {preview.star4Excluded}件
              </p>
              <p>
                追加 {preview.diff.added.length}件・変更 {preview.diff.changed.length}件・削除候補{" "}
                {preview.diff.removed.length}件・変更なし {preview.diff.unchanged}件
              </p>
              <p>
                ○ {preview.counts.yes}件 ／ △ {preview.counts.uncertain}件 ／ ✖ {preview.counts.no}
                件 ／ 未回答 {preview.counts.unanswered}件
              </p>
              <p>
                「-」{preview.dashCount}
                件は未回答として集計します。O：自己評価、P：理由、Q：根拠、R：補足の原文を保持し、それぞれの回答欄に反映します。
              </p>
              {preview.errors.map((e) => (
                <p role="alert" key={e}>
                  {e}
                </p>
              ))}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>評価項目ID</th>
                      <th>変更列</th>
                      <th>現在</th>
                      <th>取込後</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.diff.changed.flatMap((c) =>
                      c.fields.map((f) => (
                        <tr key={`${c.id}-${f.field}`}>
                          <td>{c.id}</td>
                          <td>{fields[f.field] ?? f.field}</td>
                          <td className="import-raw">{f.before}</td>
                          <td className="import-raw">{f.after}</td>
                        </tr>
                      )),
                    )}
                    {preview.diff.added.map((c) => (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>追加</td>
                        <td>—</td>
                        <td className="import-raw">{c.officialText}</td>
                      </tr>
                    ))}
                    {preview.diff.removed.map((c) => (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>削除候補</td>
                        <td className="import-raw">{c.officialText}</td>
                        <td>新しい診断には含めません。既存診断には残ります。</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>自己評価の原文と出典を確認</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {["評価項目ID", "行", "O 自己評価", "P 理由", "Q 根拠", "R 補足"].map(
                          (h) => (
                            <th key={h}>{h}</th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.workbook.answers.map((r) => (
                        <tr key={r.criterionId}>
                          {[r.criterionId, String(r.row), r.O, r.P, r.Q, r.R].map((v, i) => (
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
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={pending || readOnly}
                  onChange={(e) => setAck(e.target.checked)}
                />
                差分を確認し、新しいマスタ版と診断を作成します
              </label>
              <button
                type="button"
                className="button primary"
                disabled={
                  !ack ||
                  !preview.canCommit ||
                  pending ||
                  readOnly ||
                  revision !== sourceRevision.current
                }
                onClick={() => void commit()}
              >
                {write.pending ? "保存中…" : "マスタと自己評価を取り込む"}
              </button>
              {revision !== sourceRevision.current && (
                <p role="alert">
                  元の診断が更新されました。ファイルを選択し直して差分を確認してください。
                </p>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
export function MasterImportPage() {
  const { me } = useAccess();
  return (
    <AssessmentLayout title="自己評価Excel取込">
      {({ record, readOnly }) =>
        me.data?.role === "admin" && !me.error ? (
          <MasterImportForm
            key={record.id}
            assessmentId={record.id}
            revision={record.revision}
            readOnly={readOnly}
          />
        ) : (
          <p>評価項目マスタの取込は管理者が実行できます。</p>
        )
      }
    </AssessmentLayout>
  );
}
