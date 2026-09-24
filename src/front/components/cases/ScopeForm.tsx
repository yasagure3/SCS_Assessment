import { useState } from "react";
import type { Scope } from "../../../shared/contracts/assessment";
import type { AssessmentDto } from "../../../shared/contracts/assessments";
import type { ApiSuccess } from "../../../shared/contracts/api";
import { useWrite } from "../../lib/api";
import { ApiError } from "../../lib/fetcher";
const labels: Record<keyof Scope, string> = {
  companies: "対象会社",
  sites: "対象拠点",
  departments: "対象部署",
  systems: "対象システム",
};
export function ScopeForm({
  record,
  readOnly,
  onSaved,
  onRefresh,
}: {
  record: AssessmentDto;
  readOnly: boolean;
  onSaved: (result: ApiSuccess<AssessmentDto>) => unknown;
  onRefresh: () => unknown;
}) {
  const [scope, setScope] = useState(record.document.scope),
    [date, setDate] = useState(record.document.diagnosisDate ?? ""),
    [revision, setRevision] = useState(record.revision),
    [saved, setSaved] = useState(false),
    write = useWrite();
  const conflict = write.error instanceof ApiError && write.error.code === "CONFLICT",
    latestReady = record.revision > revision;
  const now = new Date(),
    today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  async function save() {
    setSaved(false);
    const result = await write.send<AssessmentDto>(
      `/api/v1/assessments/${record.id}/scope`,
      "PATCH",
      { scope, diagnosisDate: date || null, expectedRevision: revision },
    );
    if (result) {
      setRevision(result.data.revision);
      setSaved(true);
      void onSaved(result);
    } else void onRefresh();
  }
  return (
    <form
      className="data-form scope-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="scope-fields">
        {(Object.keys(labels) as (keyof Scope)[]).map((key) => (
          <label key={key}>
            {labels[key]}
            <textarea
              aria-label={labels[key]}
              aria-describedby={`scope-${key}-help`}
              rows={3}
              maxLength={4000}
              value={scope[key]}
              disabled={readOnly || write.pending}
              onChange={(e) => {
                setScope({ ...scope, [key]: e.target.value });
                setSaved(false);
              }}
            />
            <span className="field-help" id={`scope-${key}-help`}>
              {Array.from(scope[key]).length} / 2000文字
            </span>
          </label>
        ))}
      </div>
      <label>
        診断日
        <input
          type="date"
          value={date}
          disabled={readOnly || write.pending}
          onChange={(e) => {
            setDate(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      {date > today && (
        <p className="notice">
          未来の日付です。予定している診断日であることを確認して保存してください。
        </p>
      )}
      <p className="subtle">
        不明な項目は空欄で下書き保存できます。範囲を変更すると、81項目の確定済み助言が再確認の対象になります。
      </p>
      <button
        className="button primary"
        disabled={
          readOnly ||
          write.pending ||
          conflict ||
          Object.values(scope).some((value) => Array.from(value).length > 2000)
        }
      >
        {write.pending ? "保存しています…" : "対象範囲を保存"}
      </button>
      {saved && (
        <p className="success-message" role="status">
          保存しました。
        </p>
      )}
      {write.error && (
        <p className="form-error" role="alert">
          {write.error.message}
        </p>
      )}
      {write.error && !conflict && (
        <button type="button" className="text-button" onClick={() => void onRefresh()}>
          最新の内容を再確認
        </button>
      )}
      {conflict && (
        <aside className="conflict-panel">
          <h3>最新の保存値</h3>
          {latestReady ? (
            <dl>
              {(Object.keys(labels) as (keyof Scope)[]).map((key) => (
                <div key={key}>
                  <dt>{labels[key]}</dt>
                  <dd>{record.document.scope[key] || "未入力"}</dd>
                </div>
              ))}
              <div>
                <dt>診断日</dt>
                <dd>{record.document.diagnosisDate ?? "未入力"}</dd>
              </div>
            </dl>
          ) : (
            <p>最新の内容を確認しています。通信が復旧しない場合は再確認してください。</p>
          )}
          <p>上の入力は保持しています。保存値と比較し、再編集してから保存してください。</p>
          <button
            type="button"
            className="button secondary"
            disabled={!latestReady}
            onClick={() => {
              setScope(record.document.scope);
              setDate(record.document.diagnosisDate ?? "");
              setRevision(record.revision);
              write.clearError();
            }}
          >
            保存値で入力を置き換える
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!latestReady}
            onClick={() => {
              setRevision(record.revision);
              write.clearError();
            }}
          >
            入力を保って再編集する
          </button>
          <button type="button" className="text-button" onClick={() => void onRefresh()}>
            最新の内容を再確認
          </button>
        </aside>
      )}
    </form>
  );
}
