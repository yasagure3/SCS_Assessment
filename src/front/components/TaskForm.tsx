import { useState } from "react";
import { MAX_DOCUMENT_BYTES, type Task } from "../../shared/contracts/assessment";
import type { AssessmentDto, StandardDto } from "../../shared/contracts/assessments";
import type { ApiSuccess } from "../../shared/contracts/api";
import {
  addTaskSchema,
  editTaskSchema,
  reviewTaskSchema,
  type TaskCommand,
} from "../../shared/contracts/improvement";
import { applyTaskChange, taskSizeContext } from "../../shared/taskChange";
import { ApiError, isUnknownWriteOutcome } from "../lib/fetcher";

export const taskStateLabels = {
  todo: "未着手",
  doing: "進行中",
  awaiting_review: "確認待ち",
  done: "完了（確認済み）",
};
export const taskPriorityLabels = { high: "高", normal: "通常", low: "低" };
export type TaskSelection = { item: Task | null; review?: boolean; criterionId?: string };
export type TaskWriter = {
  pending: boolean;
  error: Error | null;
  clearError: () => void;
  send: (
    path: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
  ) => Promise<ApiSuccess<AssessmentDto> | null>;
};
const fieldsOf = (item: Task | null) => ({
  title: item?.title ?? "",
  ownerName: item?.ownerName ?? "",
  dueDate: item?.dueDate ?? "",
  priority: item?.priority ?? "normal",
  completionCondition: item?.completionCondition ?? "",
  state: item?.state ?? "todo",
  result: item?.result ?? "",
  evidenceIds: item?.evidenceIds ?? [],
});

export function TaskForm({
  record,
  standard,
  selection,
  readOnly,
  write,
  onSaved,
  onRefresh,
  onCancel,
}: {
  record: AssessmentDto;
  standard: StandardDto;
  selection: TaskSelection;
  readOnly: boolean;
  write: TaskWriter;
  onSaved: (result: ApiSuccess<AssessmentDto>, message: string) => void;
  onRefresh: () => unknown;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState(() => fieldsOf(selection.item));
  const [criterionId, setCriterionId] = useState(
    selection.item?.criterionId ?? selection.criterionId ?? "",
  );
  const [review, setReview] = useState<{ state: "confirmed" | "rejected"; note: string }>({
    state: "confirmed",
    note: "",
  });
  const [revision, setRevision] = useState(record.revision);
  const [submittedRequest, setSubmittedRequest] = useState<string | null>(null);
  const latest = record.document.tasks.find((item) => item.id === selection.item?.id);
  const conflict = write.error instanceof ApiError && write.error.code === "CONFLICT";
  const disabled = readOnly || write.pending;
  const mutation = { expectedRevision: revision, mutationId: taskSizeContext.newTaskId };
  const { title, ownerName, dueDate, priority, completionCondition } = fields;
  const command: TaskCommand = selection.review
    ? { kind: "review", taskId: selection.item!.id, input: { ...mutation, ...review } }
    : selection.item
      ? { kind: "edit", taskId: selection.item.id, input: { ...mutation, ...fields } }
      : {
          kind: "add",
          input: {
            ...mutation,
            criterionId,
            title,
            ownerName,
            dueDate,
            priority,
            completionCondition,
          },
        };
  const requestSignature = JSON.stringify({ assessmentId: record.id, command });
  // A lost response can be followed by a GET of the already-committed document.
  // The exact previously validated request is a receipt replay, not a new transition.
  // useWrite retains its operation key; changed input must pass normal validation.
  const retryingUnknownOutcome =
    submittedRequest === requestSignature && isUnknownWriteOutcome(write.error);
  const checked = (
    command.kind === "add"
      ? addTaskSchema
      : command.kind === "edit"
        ? editTaskSchema
        : reviewTaskSchema
  ).safeParse(command.input);
  let projected = record.document,
    projectionError = "";
  if (checked.success && !retryingUnknownOutcome) {
    try {
      projected = applyTaskChange(record.document, command, taskSizeContext);
    } catch {
      projectionError = selection.review
        ? "完了報告済みの課題だけ確認できます。最新の進捗と証跡を確認してください。"
        : "完了報告には結果と関連する証跡が1件以上必要です。課題は100件まで登録できます。";
    }
  }
  const tooLarge =
    new TextEncoder().encode(JSON.stringify(projected)).byteLength > MAX_DOCUMENT_BYTES;
  const missing = Boolean(selection.item && !latest);
  const canSave =
    checked.success && !disabled && !conflict && !projectionError && !tooLarge && !missing;
  const evidence = record.document.evidence.filter((item) =>
    item.criterionIds.includes(criterionId),
  );
  const latestFields = latest ? fieldsOf(latest) : null;
  const labels: Record<keyof typeof fields, string> = {
    title: "課題名",
    ownerName: "担当者名",
    dueDate: "期日",
    priority: "優先度",
    completionCondition: "完了条件",
    state: "進捗",
    result: "結果",
    evidenceIds: "関連証跡",
  };
  function display(key: keyof typeof fields, value: string | string[]) {
    if (key === "state") return taskStateLabels[value as Task["state"]];
    if (key === "priority") return taskPriorityLabels[value as Task["priority"]];
    if (Array.isArray(value))
      return (
        value
          .map((id) => record.document.evidence.find((item) => item.id === id)?.name ?? id)
          .join("、") || "未登録"
      );
    return value || "未入力";
  }
  async function save() {
    setSubmittedRequest(requestSignature);
    const { mutationId: _unused, ...body } = command.input;
    const result = await write.send(
      `/api/v1/assessments/${record.id}/tasks${command.kind === "add" ? "" : `/${command.taskId}`}${selection.review ? "/review" : ""}`,
      command.kind === "edit" ? "PATCH" : "POST",
      body,
    );
    if (result) {
      setSubmittedRequest(null);
      onSaved(result, selection.review ? "完了確認を保存しました。" : "課題を保存しました。");
    } else void onRefresh();
  }
  return (
    <section className="panel task-editor">
      <h2>
        {selection.review ? "作業の完了を確認" : selection.item ? "課題を編集" : "課題を追加"}
      </h2>
      <p className="subtle">作業の完了と自己評価は別です。課題を完了しても○には変わりません。</p>
      <form
        className="data-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save();
        }}
      >
        <fieldset disabled={disabled}>
          {selection.review ? (
            <>
              <dl className="task-review-context">
                <dt>課題</dt>
                <dd>{latest?.title ?? selection.item?.title}</dd>
                <dt>完了条件</dt>
                <dd>{latest?.completionCondition}</dd>
                <dt>結果</dt>
                <dd>{latest?.result}</dd>
                <dt>関連証跡</dt>
                <dd>
                  {latest?.evidenceIds.map((id) => {
                    const item = record.document.evidence.find((e) => e.id === id);
                    return (
                      <p key={id}>
                        {item?.name} {item?.location}
                        {item?.url && (
                          <>
                            {" "}
                            ·{" "}
                            <a href={item.url} target="_blank" rel="noopener noreferrer">
                              証跡を開く
                            </a>
                          </>
                        )}
                      </p>
                    );
                  })}
                </dd>
              </dl>
              <label>
                確認結果
                <select
                  value={review.state}
                  onChange={(e) =>
                    setReview({ ...review, state: e.target.value as "confirmed" | "rejected" })
                  }
                >
                  <option value="confirmed">確認済みとして完了</option>
                  <option value="rejected">差戻し（進行中に戻す）</option>
                </select>
              </label>
              <label>
                確認メモ
                <textarea
                  rows={3}
                  value={review.note}
                  onChange={(e) => setReview({ ...review, note: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                課題名
                <input
                  value={fields.title}
                  onChange={(e) => setFields({ ...fields, title: e.target.value })}
                />
              </label>
              <label>
                関連する評価基準
                <select
                  value={criterionId}
                  disabled={Boolean(selection.item)}
                  onChange={(e) => setCriterionId(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {standard.criteria.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.officialText}
                    </option>
                  ))}
                </select>
              </label>
              <div className="task-fields-grid">
                <label>
                  担当者名
                  <input
                    value={fields.ownerName}
                    onChange={(e) => setFields({ ...fields, ownerName: e.target.value })}
                  />
                </label>
                <label>
                  期日（日本時間）
                  <input
                    type="date"
                    value={fields.dueDate}
                    onChange={(e) => setFields({ ...fields, dueDate: e.target.value })}
                  />
                </label>
                <label>
                  優先度
                  <select
                    value={fields.priority}
                    onChange={(e) =>
                      setFields({ ...fields, priority: e.target.value as Task["priority"] })
                    }
                  >
                    {Object.entries(taskPriorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="field-help">
                担当者名は作業管理用の文字列です。アカウント発行やメール送信は行いません。
              </p>
              <label>
                完了条件
                <textarea
                  rows={3}
                  value={fields.completionCondition}
                  onChange={(e) => setFields({ ...fields, completionCondition: e.target.value })}
                />
              </label>
              {selection.item && (
                <>
                  <label>
                    進捗
                    <select
                      value={fields.state}
                      onChange={(e) =>
                        setFields({ ...fields, state: e.target.value as Task["state"] })
                      }
                    >
                      {Object.entries(taskStateLabels)
                        .filter(([value]) => value !== "done" || selection.item?.state === "done")
                        .map(([value, label]) => (
                          <option key={value} value={value}>
                            {value === "awaiting_review" ? "完了報告（確認待ち）" : label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    結果
                    <textarea
                      rows={4}
                      value={fields.result}
                      onChange={(e) => setFields({ ...fields, result: e.target.value })}
                    />
                  </label>
                  <fieldset className="task-evidence">
                    <legend>完了の根拠となる証跡</legend>
                    {evidence.length ? (
                      evidence.map((item) => (
                        <label key={item.id}>
                          <input
                            type="checkbox"
                            checked={fields.evidenceIds.includes(item.id)}
                            onChange={(e) =>
                              setFields({
                                ...fields,
                                evidenceIds: e.target.checked
                                  ? [...fields.evidenceIds, item.id]
                                  : fields.evidenceIds.filter((id) => id !== item.id),
                              })
                            }
                          />
                          {item.name}
                        </label>
                      ))
                    ) : (
                      <p className="field-help">
                        この基準の証跡がありません。証跡管理で登録してから完了報告してください。
                      </p>
                    )}
                  </fieldset>
                  <p className="field-help">
                    完了報告には結果と証跡が必要です。報告後に結果・完了条件・証跡を変えると進行中に戻ります。保存後に改めて完了報告してください。
                  </p>
                </>
              )}
            </>
          )}
        </fieldset>
        {!checked.success && <p className="field-help">{checked.error.issues[0]?.message}</p>}
        {projectionError && (
          <p role="alert" className="form-error">
            {projectionError}
          </p>
        )}
        {tooLarge && (
          <p role="alert" className="form-error">
            診断全体が1MiBを超えています。記述を短くしてから保存してください。
          </p>
        )}
        {missing && (
          <p role="alert" className="form-error">
            課題が見つかりません。未保存の入力を確認してください。
          </p>
        )}
        <div className="task-actions">
          <button className="button primary" disabled={!canSave}>
            {write.pending ? "保存しています…" : selection.review ? "完了確認を保存" : "課題を保存"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={write.pending}
            onClick={onCancel}
          >
            閉じる
          </button>
        </div>
        {write.error && (
          <p role="alert" className="form-error">
            {write.error.message}
          </p>
        )}
        {conflict && (
          <aside className="conflict-panel">
            <h3>未保存の入力と最新の保存値</h3>
            {record.revision > revision ? (
              <>
                <p>
                  最新の診断版: {record.revision}
                  。入力内容を確認してから再編集してください。
                </p>
                <div className="assessment-table-wrap">
                  <table className="assessment-table">
                    <thead>
                      <tr>
                        <th>項目</th>
                        <th>自分の未保存文</th>
                        <th>最新の保存値</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(labels) as (keyof typeof fields)[]).map((key) => (
                        <tr key={key}>
                          <th>{labels[key]}</th>
                          <td>{display(key, fields[key])}</td>
                          <td>{latestFields ? display(key, latestFields[key]) : "新規課題"}</td>
                        </tr>
                      ))}
                      {selection.review && (
                        <>
                          <tr>
                            <th>確認結果</th>
                            <td>{review.state === "confirmed" ? "確認済み" : "差戻し"}</td>
                            <td>
                              {latest?.review.state === "confirmed"
                                ? "確認済み"
                                : latest?.review.state === "rejected"
                                  ? "差戻し"
                                  : "未確認"}
                            </td>
                          </tr>
                          <tr>
                            <th>確認メモ</th>
                            <td>{review.note || "未入力"}</td>
                            <td>{latest?.review.note || "未入力"}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>最新の内容を確認しています。</p>
            )}
            <button
              className="button secondary"
              type="button"
              disabled={record.revision <= revision || missing}
              onClick={() => {
                setRevision(record.revision);
                write.clearError();
              }}
            >
              入力を保って再編集する
            </button>
            <button className="text-button" type="button" onClick={() => void onRefresh()}>
              最新の内容を再取得
            </button>
          </aside>
        )}
      </form>
    </section>
  );
}
