import { useState } from "react";
import type { AssessmentDto, Status } from "../../../shared/contracts/assessments";
import type { AssessmentResponse } from "../../../shared/contracts/assessment";
import { MAX_DOCUMENT_BYTES } from "../../../shared/contracts/assessment";
import type { ApiSuccess } from "../../../shared/contracts/api";
import { ApiError } from "../../lib/fetcher";
import { statusLabels, responseLabels } from "./labels";
export type ResponseWriter = {
  pending: boolean;
  error: Error | null;
  clearError: () => void;
  send: (
    path: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
  ) => Promise<ApiSuccess<AssessmentDto> | null>;
};
type Fields = Pick<
  AssessmentResponse,
  "status" | "reason" | "basis" | "plannedWork" | "supplement"
>;
const fieldsOf = ({
  status,
  reason,
  basis,
  plannedWork,
  supplement,
}: AssessmentResponse): Fields => ({ status, reason, basis, plannedWork, supplement });
export function ResponseForm({
  record,
  criterionId,
  readOnly,
  write,
  onSaved,
  onRefresh,
}: {
  record: AssessmentDto;
  criterionId: string;
  readOnly: boolean;
  write: ResponseWriter;
  onSaved: (result: ApiSuccess<AssessmentDto>) => unknown;
  onRefresh: () => unknown;
}) {
  const [fields, setFields] = useState(() => fieldsOf(record.document.responses[criterionId])),
    [revision, setRevision] = useState(record.revision),
    [saved, setSaved] = useState(false);
  const conflict = write.error instanceof ApiError && write.error.code === "CONFLICT";
  const latestReady = record.revision > revision;
  const latest = fieldsOf(record.document.responses[criterionId]);
  const errors = (Object.keys(fields) as (keyof Fields)[]).filter(
    (key) => key !== "status" && Array.from(fields[key]).length > 8000,
  );
  const currentResponse = record.document.responses[criterionId];
  const changed = (Object.keys(fields) as (keyof Fields)[]).some(
    (key) => fields[key] !== currentResponse[key],
  );
  const projected = {
    ...record.document,
    responses: {
      ...record.document.responses,
      [criterionId]: {
        ...currentResponse,
        ...fields,
        manualEdited: currentResponse.manualEdited || changed || !record.document.importInfo,
        adviceBasisVersion: currentResponse.adviceBasisVersion + Number(changed),
      },
    },
  };
  const tooLarge =
    new TextEncoder().encode(JSON.stringify(projected)).byteLength > MAX_DOCUMENT_BYTES;
  async function save() {
    setSaved(false);
    const result = await write.send(
      `/api/v1/assessments/${record.id}/responses/${criterionId}`,
      "PATCH",
      { expectedRevision: revision, ...fields },
    );
    if (result) {
      setRevision(result.data.revision);
      setSaved(true);
      void onSaved(result);
    } else void onRefresh();
  }
  function update(key: keyof Fields, value: string) {
    setFields({ ...fields, [key]: value });
    setSaved(false);
  }
  return (
    <form
      className="data-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        {responseLabels.status}
        <select
          value={fields.status}
          disabled={readOnly || write.pending}
          onChange={(e) => update("status", e.target.value)}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {(["reason", "basis", "plannedWork", "supplement"] as const).map((key) => (
        <label key={key}>
          {responseLabels[key]}
          <textarea
            aria-label={responseLabels[key]}
            rows={3}
            value={fields[key]}
            disabled={readOnly || write.pending}
            onChange={(e) => update(key, e.target.value)}
            aria-invalid={errors.includes(key)}
          />
          <span className="field-help">{Array.from(fields[key]).length} / 8000文字</span>
          {errors.includes(key) && (
            <span className="form-error">
              {responseLabels[key]}は8000文字以内で入力してください。
            </span>
          )}
        </label>
      ))}
      <p className="notice">
        対象外の可能性は補足情報に理由と範囲を記録してください。分母81から自動除外しません。
      </p>
      <button
        className="button primary"
        disabled={readOnly || write.pending || conflict || errors.length > 0 || tooLarge}
      >
        {write.pending ? "保存しています…" : "判定を保存"}
      </button>
      {tooLarge && (
        <p className="form-error" role="alert">
          診断全体が1MiBを超えています。記述を短くしてから保存してください。
        </p>
      )}
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
          <h3>未保存の入力と最新の保存値</h3>
          {latestReady ? (
            <div className="assessment-table-wrap">
              <table className="assessment-table">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>自分の未保存文</th>
                    <th>最新の保存値</th>
                    <th>差分</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(responseLabels) as (keyof Fields)[]).map((key) => (
                    <tr key={key}>
                      <th>{responseLabels[key]}</th>
                      <td>
                        {key === "status" ? statusLabels[fields.status] : fields[key] || "未入力"}
                      </td>
                      <td>
                        {key === "status"
                          ? statusLabels[latest.status as Status]
                          : latest[key] || "未入力"}
                      </td>
                      <td>{fields[key] === latest[key] ? "同じ" : "変更あり"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>最新の内容を確認しています。通信が復旧しない場合は再確認してください。</p>
          )}
          <p>選択するまで入力は保持されます。差分を確認してから再編集してください。</p>
          <button
            type="button"
            className="button secondary"
            disabled={!latestReady}
            onClick={() => {
              setFields(latest);
              setRevision(record.revision);
              setSaved(false);
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
