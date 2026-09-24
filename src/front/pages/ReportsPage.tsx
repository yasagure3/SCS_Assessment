import { useState } from "react";
import { Link } from "react-router";
import type { AssessmentDto, StandardDto } from "../../shared/contracts/assessments";
import type { ApiPage } from "../../shared/contracts/api";
import type {
  ReportLimitations,
  ReportListItem,
  ReportPreview,
  SavedReport,
} from "../../shared/contracts/reports";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { ReportContentView } from "../components/reports/ReportContentView";
import { LoadState } from "../components/WorkspaceShell";
import { isAccessError, useApi, useWrite } from "../lib/api";
import { ApiError, isUnknownWriteOutcome } from "../lib/fetcher";

export async function hashReportLimitations(value: ReportLimitations): Promise<string> {
  const text = `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, ids]) => `${JSON.stringify(key)}:${JSON.stringify(ids)}`)
    .join(",")}}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
type Props = { hashLimitations?: (value: ReportLimitations) => Promise<string> };
export function ReportsPage({ hashLimitations = hashReportLimitations }: Props) {
  return (
    <AssessmentLayout title="レポート">
      {({ record, standard, readOnly, refresh }) => (
        <ReportWorkspace
          key={record.id}
          record={record}
          standard={standard}
          readOnly={readOnly}
          refresh={refresh}
          hashLimitations={hashLimitations}
        />
      )}
    </AssessmentLayout>
  );
}
function ReportWorkspace({
  record,
  standard,
  readOnly,
  refresh,
  hashLimitations,
}: {
  record: AssessmentDto;
  standard: StandardDto;
  readOnly: boolean;
  refresh: () => Promise<void>;
  hashLimitations: NonNullable<Props["hashLimitations"]>;
}) {
  const write = useWrite();
  const [lastOperation, setLastOperation] = useState<"preview" | "finalize">("preview");
  const [preview, setPreview] = useState<ReportPreview | null>(null),
    [majorIds, setMajorIds] = useState<string[] | undefined>(),
    [acknowledged, setAcknowledged] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [hashing, setHashing] = useState(false),
    [hashError, setHashError] = useState("");
  const history = useApi<ApiPage<ReportListItem>>(
    `/api/v1/assessments/${record.id}/reports${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const selected = useApi<SavedReport>(selectedId ? `/api/v1/reports/${selectedId}` : null);
  const conflict = write.error instanceof ApiError && write.error.status === 409;
  const accessError = [write.error, history.error, selected.error].find(isAccessError);
  const accessDenied = Boolean(accessError);
  const unknownOutcome = lastOperation === "finalize" && isUnknownWriteOutcome(write.error);
  const pending = write.pending || hashing;
  const visiblePreview = preview && !conflict && !accessDenied ? preview : null;
  async function inspect() {
    setLastOperation("preview");
    setMessage("");
    setHashError("");
    setAcknowledged(false);
    const result = await write.send<ReportPreview>(
      `/api/v1/assessments/${record.id}/report-preview`,
      "POST",
      {
        expectedRevision: record.revision,
        ...(majorIds ? { majorIssueCriterionIds: majorIds } : {}),
      },
      { readOnly: true },
    );
    if (result) {
      setPreview(result.data);
      setMajorIds(result.data.content.majorIssues);
    } else {
      setPreview(null);
      await refresh();
    }
  }
  async function finalize() {
    if (
      !visiblePreview ||
      !acknowledged ||
      pending ||
      readOnly ||
      visiblePreview.blockingErrors.length
    )
      return;
    setLastOperation("finalize");
    setHashing(true);
    setHashError("");
    try {
      const result = await write.send<SavedReport>(
        `/api/v1/assessments/${record.id}/reports`,
        "POST",
        {
          expectedRevision: visiblePreview.revision,
          previewHash: visiblePreview.previewHash,
          majorIssueCriterionIds: visiblePreview.content.majorIssues,
          acknowledgedLimitationHash: await hashLimitations(visiblePreview.limitations),
        },
        { readOnly: true },
      );
      if (result) {
        setSelectedId(result.data.reportId);
        setPreview(null);
        setAcknowledged(false);
        setMessage("レポート版を確定しました。");
        setCursor(null);
        await history.mutate();
      } else await refresh();
    } catch {
      setHashError("留意事項を確認できませんでした。もう一度お試しください。");
    } finally {
      setHashing(false);
    }
  }
  return (
    <div className="report-workspace">
      <p className="notice">
        診断内容と留意事項を確認し、顧客へ報告する版を確定します。未回答があっても確定できます。自己評価は公式の合否や取得可能性を表しません。
      </p>
      {write.error && (
        <p role="alert" className="error-message">
          {write.error.message}
        </p>
      )}
      {accessError && !write.error && <p role="alert">{accessError.message}</p>}
      {hashError && <p role="alert">{hashError}</p>}
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      {!accessDenied && (
        <>
          <section className="panel report-compose" aria-label="レポートの事前確認">
            <h2>1. 報告内容を確認</h2>
            <p>
              <Link to={`/cases/${record.caseId}`}>対象範囲・診断日を編集</Link>
            </p>
            <details className="report-major-selection">
              <summary>主要課題を選ぶ（最大5件 / 現在 {majorIds?.length ?? 0}件）</summary>
              <p className="subtle">
                初回の事前確認では、未完了の課題を優先度・期日・基準順で提案します。
              </p>
              <div className="report-criterion-choices">
                {standard.criteria.map((criterion) => (
                  <label key={criterion.id}>
                    <input
                      type="checkbox"
                      aria-label={`主要課題 ${criterion.id}`}
                      checked={majorIds?.includes(criterion.id) ?? false}
                      disabled={
                        pending ||
                        readOnly ||
                        unknownOutcome ||
                        ((majorIds?.length ?? 0) >= 5 && !majorIds?.includes(criterion.id))
                      }
                      onChange={(event) => {
                        setMajorIds(
                          event.target.checked
                            ? [...(majorIds ?? []), criterion.id]
                            : (majorIds ?? []).filter((id) => id !== criterion.id),
                        );
                        setPreview(null);
                        setAcknowledged(false);
                        write.clearError();
                      }}
                    />
                    <span>
                      <strong>{criterion.id}</strong> {criterion.officialText}
                    </span>
                  </label>
                ))}
              </div>
            </details>
            {conflict && (
              <p className="notice">
                内容が変わりました。主要課題の選択を保持しています。もう一度事前確認してください。
              </p>
            )}
            {unknownOutcome && preview && (
              <p className="notice">
                確定結果を確認できません。同じ内容で確定を再試行してください。
              </p>
            )}
            <button
              className="button primary"
              disabled={pending || readOnly || unknownOutcome}
              onClick={() => void inspect()}
            >
              {pending && !hashing ? "確認しています…" : "出力内容を事前確認"}
            </button>
          </section>
          {visiblePreview && (
            <section className="panel report-preview" aria-label="出力内容のプレビュー">
              <h2>2. 留意事項を確認して確定</h2>
              {visiblePreview.blockingErrors.length > 0 && (
                <div className="notice">
                  {visiblePreview.blockingErrors.map((error) => (
                    <p key={error.path}>
                      {(
                        {
                          "scope.companies": "対象会社",
                          "scope.sites": "対象拠点",
                          "scope.departments": "対象部署",
                          "scope.systems": "対象システム",
                          diagnosisDate: "診断日",
                        } as Record<string, string>
                      )[error.path] ?? error.path}
                      : {error.reason}
                    </p>
                  ))}
                </div>
              )}
              <ReportContentView content={visiblePreview.content} />
              <div className="report-confirm">
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={pending || readOnly || unknownOutcome}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />{" "}
                  留意事項と出力内容を確認しました
                </label>
                <button
                  className="button primary"
                  disabled={
                    pending || readOnly || !acknowledged || visiblePreview.blockingErrors.length > 0
                  }
                  onClick={() => void finalize()}
                >
                  {hashing ? "確定しています…" : "この内容で版を確定"}
                </button>
              </div>
            </section>
          )}
          <section className="panel" aria-label="確定済みレポート">
            <h2>確定済みレポート</h2>
            <LoadState error={history.error} loading={history.isLoading} retry={history.mutate} />
            {history.data && !history.data.items.length && (
              <p className="subtle">確定したレポートはまだありません。</p>
            )}
            {history.data && history.data.items.length > 0 && (
              <ul className="report-history">
                {history.data.items.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>診断版 {item.assessmentRevision}</strong>
                      <p>{item.createdAt}</p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setSelectedId(item.id);
                        setMessage("");
                      }}
                    >
                      この版を開く
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="task-actions">
              {cursor && (
                <button className="button secondary" onClick={() => setCursor(null)}>
                  最新の版へ
                </button>
              )}
              {history.data?.nextCursor && (
                <button
                  className="button secondary"
                  onClick={() => setCursor(history.data!.nextCursor)}
                >
                  次の版を表示
                </button>
              )}
            </div>
          </section>
          {selectedId && (
            <section className="panel" aria-label="保存済みの報告内容">
              <h2>保存済みの報告内容</h2>
              <LoadState
                error={selected.error}
                loading={selected.isLoading}
                retry={selected.mutate}
              />
              {selected.data && !selected.error && (
                <>
                  <p className="report-id">
                    報告版 ID: <strong>{selected.data.reportId}</strong>
                  </p>
                  <p className="subtle">
                    確定日時: {selected.data.snapshot.createdAt} / 作成者:{" "}
                    {selected.data.snapshot.createdBy}
                  </p>
                  <ReportContentView content={selected.data.snapshot} />
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
