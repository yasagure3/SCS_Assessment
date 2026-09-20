import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import {
  TaskForm,
  taskPriorityLabels,
  taskStateLabels,
  type TaskSelection,
} from "../components/TaskForm";
import { taskIsOverdue } from "../../shared/taskChange";
import { useWrite } from "../lib/api";

export function TasksPage({ now = () => new Date().toISOString() }: { now?: () => string }) {
  const write = useWrite();
  const [selection, setSelection] = useState<TaskSelection | null>(null);
  const [message, setMessage] = useState("");
  const [params] = useSearchParams();
  function select(value: TaskSelection) {
    write.clearError();
    setMessage("");
    setSelection(value);
  }
  return (
    <AssessmentLayout title="改善課題">
      {({ record, standard, readOnly, assessment, refresh }) => {
        const criterionId = params.get("criterionId");
        const items = record.document.tasks.filter(
          (item) => !criterionId || item.criterionId === criterionId,
        );
        const currentTime = now();
        return (
          <>
            <div className="task-toolbar">
              <p>担当・期日・対策の進捗を管理し、結果と証跡に基づいて完了を確認します。</p>
              <button
                className="button primary"
                disabled={readOnly || write.pending || record.document.tasks.length >= 100}
                onClick={() => select({ item: null, criterionId: criterionId ?? undefined })}
              >
                課題を追加
              </button>
            </div>
            {criterionId && (
              <p className="notice">
                基準 {criterionId} の課題を表示中。
                <Link to={`/assessments/${record.id}/tasks`}>すべて表示</Link>
              </p>
            )}
            {message && (
              <p className="success-message" role="status">
                {message}
              </p>
            )}
            <section className="panel">
              <h2>
                対策の状況 <span className="subtle">{items.length}件</span>
              </h2>
              {!items.length ? (
                <p className="subtle">改善課題はまだ登録されていません。</p>
              ) : (
                <div className="assessment-table-wrap">
                  <table className="assessment-table task-table">
                    <thead>
                      <tr>
                        <th>課題 / 評価基準</th>
                        <th>担当者 / 期日</th>
                        <th>優先度 / 進捗</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.title}</strong>
                            <p>
                              <Link to={`/assessments/${record.id}/criteria/${item.criterionId}`}>
                                {item.criterionId}
                              </Link>
                            </p>
                            <p className="preline">{item.completionCondition}</p>
                            {item.result && <p className="preline">結果: {item.result}</p>}
                          </td>
                          <td>
                            {item.ownerName}
                            <p>{item.dueDate}</p>
                            {taskIsOverdue(item, currentTime) && (
                              <span className="status-label status-no">期限超過</span>
                            )}
                          </td>
                          <td>
                            {taskPriorityLabels[item.priority]}
                            <p className="status-label">{taskStateLabels[item.state]}</p>
                            {item.review.state === "rejected" && <p>差戻し: {item.review.note}</p>}
                            {item.review.state === "confirmed" && item.review.note && (
                              <p className="preline">確認メモ: {item.review.note}</p>
                            )}
                            {item.review.by && (
                              <p className="field-help">
                                確認者: {item.review.by}
                                <br />
                                確認日時: {item.review.at}
                              </p>
                            )}
                          </td>
                          <td>
                            <div className="task-actions">
                              <button
                                className="button secondary"
                                disabled={readOnly || write.pending}
                                aria-label={`${item.title}を編集`}
                                onClick={() => select({ item })}
                              >
                                編集・完了報告
                              </button>
                              {item.state === "awaiting_review" && (
                                <button
                                  className="button secondary"
                                  disabled={readOnly || write.pending}
                                  aria-label={`${item.title}の完了を確認`}
                                  onClick={() => select({ item, review: true })}
                                >
                                  完了を確認
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {selection && (
              <TaskForm
                key={`${selection.item?.id ?? "new"}/${selection.review ? "review" : "edit"}`}
                record={record}
                standard={standard}
                selection={selection}
                readOnly={readOnly}
                write={write}
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
              期限は日本時間の日付で判定します。課題の完了は自己評価や助言の確定に影響しません。根拠を登録できない場合は結果欄に事情を記し、進行中として管理してください。
            </p>
          </>
        );
      }}
    </AssessmentLayout>
  );
}
