import type { ReactNode } from "react";
import type {
  Advice,
  AssessmentRecord,
  Evidence,
  Review,
  Scope,
  Task,
} from "../../shared/contracts/assessment";
import { responseTextFields } from "../../shared/contracts/improvement";
import { responseLabels, statusLabels } from "./assessments/labels";
import { taskPriorityLabels, taskStateLabels } from "./TaskForm";

export const scopeLabels: Record<keyof Scope, string> = {
  companies: "対象会社",
  sites: "対象拠点",
  departments: "対象部署",
  systems: "対象システム",
};
type SourceRow = { label: string; value: unknown; display: ReactNode };
// Compare JSON structure, not text prepared for display. Array entries and field
// boundaries are significant; object property insertion order is not.
function structuralValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(structuralValue).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${structuralValue(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="preline">{children}</dd>
    </div>
  );
}
function TextList({ label, values }: { label: string; values: string[] }) {
  return values.length ? (
    <ol aria-label={label}>
      {values.map((value, index) => (
        <li className="preline" key={index}>
          {value || "空欄"}
        </li>
      ))}
    </ol>
  ) : (
    <>なし</>
  );
}
function ReviewValue({ value }: { value: Review }) {
  return (
    <dl>
      <Field label="確認状態">
        {{ unreviewed: "未確認", confirmed: "確認済み", rejected: "差戻し" }[value.state]}
      </Field>
      <Field label="確認メモ">{value.note || "空欄"}</Field>
      <Field label="確認者">{value.by ?? "なし"}</Field>
      <Field label="確認日時">{value.at ?? "なし"}</Field>
      <Field label="確認対象の識別子">{value.subjectHash ?? "なし"}</Field>
    </dl>
  );
}
type ReferenceAdvice = {
  source: "下書き" | "確定助言";
  content: Advice;
  confirmation: null | Omit<
    NonNullable<AssessmentRecord["document"]["responses"][string]["confirmedAdvice"]>,
    "content"
  >;
} | null;
function AdviceValue({ value }: { value: ReferenceAdvice }) {
  if (!value) return <>なし</>;
  const { content, confirmation } = value;
  return (
    <dl>
      <Field label="コピーする助言">{value.source}</Field>
      <Field label="助言の出所">
        {{ template: "定型助言", manual: "手動", ai: "AI案" }[content.origin]}
      </Field>
      <Field label="テンプレートID">{content.templateId ?? "なし"}</Field>
      <Field label="不足内容">{content.gap || "空欄"}</Field>
      <Field label="実施手順">
        <TextList label="実施手順" values={content.steps} />
      </Field>
      <Field label="証跡例">
        <TextList label="証跡例" values={content.evidenceExamples} />
      </Field>
      <Field label="完了の確認方法">{content.completionCheck || "空欄"}</Field>
      <Field label="助言の補足">{content.notes || "空欄"}</Field>
      {confirmation && (
        <>
          <Field label="助言の確定者">{confirmation.by}</Field>
          <Field label="助言の確定日時">{confirmation.at}</Field>
          <Field label="助言の確定版">{confirmation.version}</Field>
          <Field label="確定時の根拠識別子">{confirmation.basisHash}</Field>
        </>
      )}
    </dl>
  );
}
function EvidenceValue({ value }: { value: Evidence }) {
  return (
    <dl>
      <Field label="証跡名">{value.name || "空欄"}</Field>
      <Field label="関連する評価基準">
        <TextList label="関連する評価基準" values={value.criterionIds} />
      </Field>
      <Field label="該当箇所">{value.location || "空欄"}</Field>
      <Field label="参照URL">{value.url ?? "なし"}</Field>
      <Field label="添付ファイルID">{value.fileId ?? "なし"}</Field>
      {Object.entries(value.reviews).map(([criterionId, review]) => (
        <Field key={criterionId} label={`${criterionId} の証跡確認`}>
          <ReviewValue value={review} />
        </Field>
      ))}
    </dl>
  );
}
function TaskValue({ value, record }: { value: Task; record: AssessmentRecord }) {
  return (
    <dl>
      <Field label="課題名">{value.title || "空欄"}</Field>
      <Field label="関連する評価基準">{value.criterionId}</Field>
      <Field label="担当者">{value.ownerName || "空欄"}</Field>
      <Field label="期日">{value.dueDate || "未入力"}</Field>
      <Field label="優先度">{taskPriorityLabels[value.priority]}</Field>
      <Field label="進捗">{taskStateLabels[value.state]}</Field>
      <Field label="完了条件">{value.completionCondition || "空欄"}</Field>
      <Field label="結果">{value.result || "空欄"}</Field>
      <Field label="関連する証跡">
        {value.evidenceIds.length ? (
          <ul aria-label="関連する証跡">
            {value.evidenceIds.map((id) => (
              <li key={id}>
                {record.document.evidence.find((evidence) => evidence.id === id)?.name ?? "証跡"}（
                {id}）
              </li>
            ))}
          </ul>
        ) : (
          "なし"
        )}
      </Field>
      <Field label="コピー元の診断ID">{value.sourceAssessmentId ?? "なし"}</Field>
      <Field label="コピー元の課題ID">{value.sourceTaskId ?? "なし"}</Field>
      <Field label="完了確認">
        <ReviewValue value={value.review} />
      </Field>
    </dl>
  );
}
function sourceRows(record: AssessmentRecord): Map<string, SourceRow> {
  const rows = new Map<string, SourceRow>();
  const add = (key: string, label: string, value: unknown, display: ReactNode) =>
    rows.set(key, { label, value, display });
  add(
    "diagnosisDate",
    "診断日",
    record.document.diagnosisDate,
    record.document.diagnosisDate ?? "未入力",
  );
  for (const [field, label] of Object.entries(scopeLabels)) {
    const value = record.document.scope[field as keyof Scope];
    add(`scope/${field}`, label, value, value || "空欄");
  }
  for (const [id, response] of Object.entries(record.document.responses)) {
    add(`${id}/status`, `${id} 自己評価`, response.status, statusLabels[response.status]);
    for (const field of responseTextFields)
      add(
        `${id}/${field}`,
        `${id} ${responseLabels[field]}`,
        response[field],
        response[field] || "空欄",
      );
    let advice: ReferenceAdvice = null;
    if (response.adviceDraft)
      advice = { source: "下書き", content: response.adviceDraft, confirmation: null };
    else if (response.confirmedAdvice) {
      const { content, ...confirmation } = response.confirmedAdvice;
      advice = { source: "確定助言", content, confirmation };
    }
    add(`${id}/advice`, `${id} 参考にする助言`, advice, <AdviceValue value={advice} />);
  }
  for (const value of record.document.evidence)
    add(`evidence/${value.id}`, `証跡: ${value.name}`, value, <EvidenceValue value={value} />);
  for (const value of record.document.tasks)
    add(
      `task/${value.id}`,
      `課題: ${value.title}`,
      value,
      <TaskValue value={value} record={record} />,
    );
  return rows;
}
export function ReassessmentSourceDiff({
  source,
  latest,
}: {
  source: AssessmentRecord;
  latest: AssessmentRecord;
}) {
  const before = sourceRows(source),
    after = sourceRows(latest);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (key) =>
      structuralValue(before.get(key)?.value ?? null) !==
      structuralValue(after.get(key)?.value ?? null),
  );
  return (
    <div className="assessment-table-wrap">
      <table className="assessment-table reassessment-source-diff">
        <thead>
          <tr>
            <th>項目</th>
            <th>選択時</th>
            <th>最新</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((key) => (
            <tr key={key}>
              <th>{before.get(key)?.label ?? after.get(key)?.label}</th>
              <td className="preline">{before.get(key)?.display ?? "なし"}</td>
              <td className="preline">{after.get(key)?.display ?? "なし"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
