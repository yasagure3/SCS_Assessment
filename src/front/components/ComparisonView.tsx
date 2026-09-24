import { useState } from "react";
import { Link } from "react-router";
import type { Task } from "../../shared/contracts/assessment";
import type { ComparisonDto } from "../../shared/contracts/improvement";
import { statusLabels, responseLabels } from "./assessments/labels";
import { scopeLabels } from "./ReassessmentForm";
import { taskStateLabels, taskPriorityLabels } from "./TaskForm";

function TaskSummary({ task }: { task: Task }) {
  return (
    <div className="comparison-task">
      <strong>{task.title}</strong>
      <p>
        {taskStateLabels[task.state]} / {task.ownerName} / {task.dueDate} /{" "}
        {taskPriorityLabels[task.priority]}
      </p>
      <p className="preline">完了条件: {task.completionCondition}</p>
      <p className="preline">結果: {task.result || "未報告"}</p>
      <p>
        関連証跡: {task.evidenceIds.length}件 / 完了確認:{" "}
        {task.review.state === "confirmed"
          ? "確認済み"
          : task.review.state === "rejected"
            ? "差戻し"
            : "未確認"}
      </p>
      {task.review.note && <p className="preline">確認メモ: {task.review.note}</p>}
    </div>
  );
}
export function ComparisonView({ data }: { data: ComparisonDto }) {
  const [changesOnly, setChangesOnly] = useState(true);
  const unmatchedTasks = data.current.document.copiedFrom?.assessmentId !== data.previous.id;
  const rows = data.rows.filter(
    (row) =>
      !changesOnly ||
      row.changed ||
      (unmatchedTasks && (row.tasks.previous.length || row.tasks.current.length)),
  );
  return (
    <section className="panel comparison-results">
      <h2>診断の差分</h2>
      <p className="comparison-revisions">
        今回 revision {data.current.revision} / 前回 revision {data.previous.revision}
      </p>
      <p className="subtle">
        今回: {data.current.document.diagnosisDate ?? "診断日未入力"}（{data.current.standardId}） /
        前回: {data.previous.document.diagnosisDate ?? "診断日未入力"}（{data.previous.standardId}）
      </p>
      <p className="notice">
        状態の変化をそのまま表示します。△を含む変化に改善・悪化の序列を付けません。
      </p>
      {data.standardChanged && (
        <p className="notice">制度版が異なります。基準IDが一致する項目のみ比較しています。</p>
      )}
      {!!data.scopeChanges.length && (
        <div className="notice">
          <strong>診断の対象範囲が異なります。</strong>
          {data.scopeChanges.map((c) => (
            <p key={c.field}>
              {scopeLabels[c.field]}: {c.before || "空欄"} → {c.after || "空欄"}
            </p>
          ))}
        </div>
      )}
      {(data.unmatchedIds.previous.length > 0 || data.unmatchedIds.current.length > 0) && (
        <p className="notice">
          対応する基準なし — 前回: {data.unmatchedIds.previous.join(", ") || "なし"} / 今回:{" "}
          {data.unmatchedIds.current.join(", ") || "なし"}
        </p>
      )}
      {unmatchedTasks && (
        <p className="notice">
          課題は対応付けなし。直接のコピー元ではないため、前回・今回の一覧を表示します。
        </p>
      )}
      <label className="check-field">
        <input
          type="checkbox"
          checked={changesOnly}
          onChange={(e) => setChangesOnly(e.target.checked)}
        />
        変更がある項目だけ表示
      </label>
      {!rows.length && <p className="empty-state">回答・課題の変更はありません。</p>}
      {rows.map((row) => (
        <article key={row.criterionId} className="comparison-row">
          <h3>
            <Link to={`/assessments/${data.current.id}/criteria/${row.criterionId}`}>
              {row.criterionId}
            </Link>
          </h3>
          <p className="status-transition">
            {statusLabels[row.beforeStatus]} → {statusLabels[row.afterStatus]}
          </p>
          {row.responseChanges.map((c) => (
            <div key={c.field}>
              <strong>{responseLabels[c.field]}</strong>
              <p className="preline">
                {c.before || "空欄"} → {c.after || "空欄"}
              </p>
            </div>
          ))}
          {row.tasks.matched.map((pair) => (
            <div className="comparison-pair" key={pair.after.id}>
              <div>
                <h4>前回の課題</h4>
                <TaskSummary task={pair.before} />
              </div>
              <div>
                <h4>引き継いだ課題</h4>
                <TaskSummary task={pair.after} />
              </div>
            </div>
          ))}
          {row.tasks.notCarried.map((task) => (
            <div key={task.id}>
              <h4>未引継ぎの課題</h4>
              <TaskSummary task={task} />
            </div>
          ))}
          {row.tasks.added.map((task) => (
            <div key={task.id}>
              <h4>新規の課題</h4>
              <TaskSummary task={task} />
            </div>
          ))}
          {row.tasks.mode === "unmatched" &&
            (row.tasks.previous.length > 0 || row.tasks.current.length > 0) && (
              <div className="comparison-pair">
                <div>
                  <h4>前回の課題（対応付けなし）</h4>
                  {row.tasks.previous.map((task) => (
                    <TaskSummary key={task.id} task={task} />
                  ))}
                </div>
                <div>
                  <h4>今回の課題（対応付けなし）</h4>
                  {row.tasks.current.map((task) => (
                    <TaskSummary key={task.id} task={task} />
                  ))}
                </div>
              </div>
            )}
        </article>
      ))}
    </section>
  );
}
