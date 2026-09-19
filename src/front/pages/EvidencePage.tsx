import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { EvidenceForm, reviewLabels, type EvidenceSelection } from "../components/EvidenceForm";
import { useWrite } from "../lib/api";
import useSWR from "swr";
import { getCurrentSession } from "../lib/cognitoClient";
import { browserFileClient } from "../lib/fileClient";

export function EvidencePage() {
  const write = useWrite();
  const { data: session } = useSWR("cognito-session", getCurrentSession);
  const [downloadError, setDownloadError] = useState(""),
    [downloading, setDownloading] = useState<string | null>(null);
  async function download(id: string) {
    if (!session || downloading) return;
    setDownloading(id);
    setDownloadError("");
    try {
      await browserFileClient.download(session.accessToken, id);
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : "取得できませんでした。");
    } finally {
      setDownloading(null);
    }
  }
  const [selection, setSelection] = useState<EvidenceSelection | null>(null),
    [message, setMessage] = useState("");
  const [params] = useSearchParams();
  function select(value: EvidenceSelection) {
    write.clearError();
    setMessage("");
    setSelection(value);
  }
  return (
    <AssessmentLayout title="証跡管理">
      {({ record, standard, readOnly, assessment, refresh }) => {
        const criterionId = params.get("criterionId"),
          items = criterionId
            ? record.document.evidence.filter((item) => item.criterionIds.includes(criterionId))
            : record.document.evidence;
        return (
          <>
            <div className="evidence-toolbar">
              <p>評価の根拠となる文書と箇所を関連付け、基準ごとに内容を確認します。</p>
              <button
                className="button primary"
                disabled={readOnly || write.pending || record.document.evidence.length >= 100}
                onClick={() => select({ item: null })}
              >
                証跡を追加
              </button>
            </div>
            {criterionId && (
              <p className="notice">
                基準 {criterionId} の証跡を表示中。
                <Link to={`/assessments/${record.id}/evidence`}>すべて表示</Link>
              </p>
            )}
            {message && (
              <p className="success-message" role="status">
                {message}
              </p>
            )}
            {downloadError && (
              <p className="form-error" role="alert">
                {downloadError}
              </p>
            )}
            <section className="panel">
              <h2>
                文書と確認状況 <span className="subtle">{items.length}件</span>
              </h2>
              {!items.length ? (
                <p className="subtle">証跡はまだ関連付けられていません。</p>
              ) : (
                <div className="assessment-table-wrap">
                  <table className="assessment-table evidence-table">
                    <thead>
                      <tr>
                        <th>文書名 / 該当箇所</th>
                        <th>関連する評価基準・確認状況</th>
                        <th>参照</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.name}</strong>
                            <p className="preline">{item.location || "箇所未記入"}</p>
                          </td>
                          <td>
                            {item.criterionIds.map((id) => (
                              <div className="evidence-review" key={id}>
                                <Link to={`/assessments/${record.id}/criteria/${id}`}>{id}</Link>
                                <span>{reviewLabels[item.reviews[id].state]}</span>
                                <p className="preline">{item.reviews[id].note}</p>
                                {item.reviews[id].by && (
                                  <p className="field-help">
                                    確認者: {item.reviews[id].by}
                                    <br />
                                    確認日時: {item.reviews[id].at}
                                  </p>
                                )}
                                <button
                                  className="text-button"
                                  disabled={readOnly || write.pending}
                                  aria-label={`${item.name} ${id} の確認を記録`}
                                  onClick={() => select({ item, criterionId: id })}
                                >
                                  内容の確認を記録
                                </button>
                              </div>
                            ))}
                          </td>
                          <td>
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noopener noreferrer">
                                参照先を開く
                              </a>
                            ) : (
                              "URLなし"
                            )}
                            {item.fileId && (
                              <p>
                                <button
                                  className="text-button"
                                  disabled={Boolean(downloading)}
                                  onClick={() => void download(item.fileId!)}
                                  aria-label={`${item.name}の添付をダウンロード`}
                                >
                                  {downloading === item.fileId ? "取得中…" : "添付をダウンロード"}
                                </button>
                              </p>
                            )}
                          </td>
                          <td>
                            <button
                              className="button secondary"
                              disabled={readOnly || write.pending}
                              aria-label={`${item.name}を編集`}
                              onClick={() => select({ item })}
                            >
                              編集
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {selection && (
              <EvidenceForm
                key={`${selection.item?.id ?? "new"}/${selection.criterionId ?? "metadata"}`}
                record={record}
                standard={standard}
                selection={selection}
                readOnly={readOnly}
                write={write}
                uploadFile={(file, key, signal) =>
                  browserFileClient.upload(
                    session?.accessToken ?? "",
                    record.caseId,
                    file,
                    key,
                    signal,
                  )
                }
                onSaved={(result, text) => {
                  void assessment.replace(result);
                  setSelection(null);
                  setMessage(text);
                }}
                onRefresh={refresh}
                onCancel={() => {
                  setSelection(null);
                  write.clearError();
                }}
              />
            )}
            <p className="notice">
              文書名のみでも登録できます。参照先はリンクを選んだときだけ開きます。証跡の登録と内容確認は別の操作です。
            </p>
          </>
        );
      }}
    </AssessmentLayout>
  );
}
