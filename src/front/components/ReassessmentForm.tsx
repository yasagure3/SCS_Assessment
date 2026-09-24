import { useState } from "react";
import type { AssessmentDto } from "../../shared/contracts/assessments";
import { MAX_DOCUMENT_BYTES, STANDARD_ID, type Scope } from "../../shared/contracts/assessment";
import { reassessmentSchema } from "../../shared/contracts/improvement";
import { reassessmentCopy } from "../../shared/reassessmentCopy";
import type { useWrite } from "../lib/api";
import { ApiError } from "../lib/fetcher";
import { ReassessmentSourceDiff, scopeLabels } from "./ReassessmentSourceDiff";
export { scopeLabels } from "./ReassessmentSourceDiff";
export function ReassessmentForm({
  record,
  readOnly,
  write,
  onRefresh,
  onCreated,
}: {
  record: AssessmentDto;
  readOnly: boolean;
  write: ReturnType<typeof useWrite>;
  onRefresh: () => unknown;
  onCreated: (record: AssessmentDto) => void;
}) {
  const [source, setSource] = useState(record);
  const [scope, setScope] = useState(record.document.scope);
  const [date, setDate] = useState("");
  const [copyResponses, setCopyResponses] = useState(true);
  const [copyTaskIds, setCopyTaskIds] = useState<string[]>([]);
  const input = {
    previousAssessmentId: source.id,
    expectedPreviousRevision: source.revision,
    standardId: STANDARD_ID,
    diagnosisDate: date || null,
    scope,
    copyResponses,
    copyTaskIds,
  };
  const parsed = reassessmentSchema.safeParse(input);
  let bytes = 0;
  const supported = source.standardId === STANDARD_ID;
  if (parsed.success && supported)
    bytes = new TextEncoder().encode(
      JSON.stringify(
        reassessmentCopy(source, parsed.data, () => "00000000-0000-4000-8000-000000000000"),
      ),
    ).byteLength;
  const conflict = write.error instanceof ApiError && write.error.code === "CONFLICT";
  const denied =
    write.error instanceof ApiError &&
    ([401, 403, 404].includes(write.error.status) || write.error.code === "ARCHIVED");
  const disabled = readOnly || write.pending || denied || !supported;
  async function submit() {
    if (disabled || conflict || !parsed.success || bytes > MAX_DOCUMENT_BYTES) return;
    const result = await write.send<AssessmentDto>(
      `/api/v1/cases/${record.caseId}/reassessments`,
      "POST",
      parsed.data,
    );
    if (result) onCreated(result.data);
    else void onRefresh();
  }
  return (
    <section className="panel task-editor reassessment-editor">
      <h2>この診断から再診断を作成</h2>
      <p className="subtle">
        コピー元 revision {source.revision}
        。元の診断は保持されます。証跡・課題・助言は再確認が必要です。
      </p>
      {!supported && <p className="notice">この制度版からの再診断作成は未対応です。</p>}
      <form
        className="data-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={disabled}>
          <label>
            再診断日
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="scope-fields">
            {(Object.keys(scopeLabels) as (keyof Scope)[]).map((field) => (
              <label key={field}>
                {scopeLabels[field]}
                <textarea
                  rows={2}
                  value={scope[field]}
                  onChange={(e) => setScope({ ...scope, [field]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={copyResponses}
              onChange={(e) => setCopyResponses(e.target.checked)}
            />
            回答・証跡・参考助言をコピーする
          </label>
          <p className="field-help">
            確認状態はすべて解除されます。回答をコピーしない場合、未回答81件から始め、課題の証跡関連も解除します。
          </p>
          <fieldset className="copy-tasks">
            <legend>引き継ぐ改善課題</legend>
            {source.document.tasks.length ? (
              source.document.tasks.map((task) => (
                <label className="check-field" key={task.id}>
                  <input
                    type="checkbox"
                    checked={copyTaskIds.includes(task.id)}
                    onChange={(e) =>
                      setCopyTaskIds(
                        e.target.checked
                          ? [...copyTaskIds, task.id]
                          : copyTaskIds.filter((id) => id !== task.id),
                      )
                    }
                  />
                  {task.title}
                </label>
              ))
            ) : (
              <p className="subtle">引き継ぐ課題はありません。</p>
            )}
          </fieldset>
        </fieldset>
        {!parsed.success && (
          <p className="form-error">
            対象範囲は各2000文字以内、日付は実在する日付を入力してください。
          </p>
        )}
        {bytes > MAX_DOCUMENT_BYTES && (
          <p className="form-error">
            コピー後の診断全体が1MiBを超えています。回答または引き継ぐ課題を減らしてください。
          </p>
        )}
        <button
          className="button primary"
          disabled={disabled || conflict || !parsed.success || bytes > MAX_DOCUMENT_BYTES}
        >
          {write.pending ? "作成しています…" : "再診断を作成"}
        </button>
        {write.error && (
          <p className="form-error" role="alert">
            {write.error.message}
          </p>
        )}
        {conflict && (
          <div className="conflict-panel">
            <h3>コピー元の変更を確認</h3>
            <p>
              選択時 revision {source.revision} / 最新 revision {record.revision}
            </p>
            <ReassessmentSourceDiff source={source} latest={record} />
            <button
              type="button"
              className="button secondary"
              disabled={record.revision <= source.revision || disabled}
              onClick={() => {
                setSource(record);
                setCopyTaskIds(
                  copyTaskIds.filter((id) => record.document.tasks.some((t) => t.id === id)),
                );
                write.clearError();
              }}
            >
              入力を保って最新の前回を選び直す
            </button>
            <button type="button" className="text-button" onClick={() => void onRefresh()}>
              コピー元を再読み込み
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
