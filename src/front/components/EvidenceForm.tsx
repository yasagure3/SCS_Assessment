import { useState } from "react";
import type { Evidence, Review } from "../../shared/contracts/assessment";
import { MAX_DOCUMENT_BYTES } from "../../shared/contracts/assessment";
import type { AssessmentDto, StandardDto } from "../../shared/contracts/assessments";
import type { ApiSuccess } from "../../shared/contracts/api";
import { evidenceFieldsSchema, reviewEvidenceSchema } from "../../shared/contracts/evidence";
import type { EvidenceCommand } from "../../shared/contracts/evidence";
import { applyEvidenceChange, evidenceSizeContext } from "../../shared/evidenceChange";
import { ApiError } from "../lib/fetcher";
export type EvidenceWriter = {
  pending: boolean;
  error: Error | null;
  clearError: () => void;
  send: (
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown>,
  ) => Promise<ApiSuccess<AssessmentDto> | null>;
};
export type EvidenceSelection = { item: Evidence | null; criterionId?: string };
export const reviewLabels = { unreviewed: "未確認", confirmed: "確認済み", rejected: "差戻し" };
const fieldsOf = (item: Evidence | null) => ({
  name: item?.name ?? "",
  url: item?.url ?? "",
  location: item?.location ?? "",
  criterionIds: item?.criterionIds ?? [],
});
export function EvidenceForm({
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
  selection: EvidenceSelection;
  readOnly: boolean;
  write: EvidenceWriter;
  onSaved: (result: ApiSuccess<AssessmentDto>, message: string) => void;
  onRefresh: () => unknown;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState(() => fieldsOf(selection.item));
  const [review, setReview] = useState<Pick<Review, "state" | "note">>(() => ({
    state: selection.criterionId
      ? selection.item!.reviews[selection.criterionId].state
      : "unreviewed",
    note: selection.criterionId ? selection.item!.reviews[selection.criterionId].note : "",
  }));
  const [revision, setRevision] = useState(record.revision);
  const latest = record.document.evidence.find((item) => item.id === selection.item?.id) ?? null;
  const conflict = write.error instanceof ApiError && write.error.code === "CONFLICT";
  const missing = Boolean(selection.item && !latest);
  const reviewMode = Boolean(selection.criterionId);
  const reviewMissing = Boolean(
    reviewMode && latest && !latest.criterionIds.includes(selection.criterionId!),
  );
  const metadata = { ...fields, url: fields.url || null };
  const checked = reviewMode
    ? reviewEvidenceSchema.safeParse({
        ...review,
        expectedRevision: revision,
        mutationId: "00000000-0000-4000-8000-000000000000",
      })
    : evidenceFieldsSchema.safeParse(metadata);
  const mutation = { expectedRevision: revision, mutationId: evidenceSizeContext.newEvidenceId };
  const command: EvidenceCommand = reviewMode
    ? {
        kind: "review",
        evidenceId: selection.item!.id,
        criterionId: selection.criterionId!,
        input: { ...mutation, ...review },
      }
    : selection.item
      ? { kind: "edit", evidenceId: selection.item.id, input: { ...mutation, ...metadata } }
      : { kind: "add", input: { ...mutation, ...metadata, fileId: null } };
  let projected = record.document,
    projectionError = false;
  if (checked.success && !missing && !reviewMissing) {
    try {
      projected = applyEvidenceChange(record.document, command, evidenceSizeContext);
    } catch {
      projectionError = true;
    }
  }
  const tooLarge =
    new TextEncoder().encode(JSON.stringify(projected)).byteLength > MAX_DOCUMENT_BYTES;
  const disabled = readOnly || write.pending;
  async function save(remove = false) {
    const base = `/api/v1/assessments/${record.id}/evidence`;
    const path = `${base}${selection.item ? `/${selection.item.id}` : ""}${reviewMode ? `/reviews/${selection.criterionId}` : ""}`;
    const body = remove
      ? { expectedRevision: revision }
      : reviewMode
        ? { expectedRevision: revision, ...review }
        : { expectedRevision: revision, ...metadata, ...(selection.item ? {} : { fileId: null }) };
    const result = await write.send(
      path,
      remove ? "DELETE" : reviewMode || !selection.item ? "POST" : "PATCH",
      body,
    );
    if (result)
      onSaved(
        result,
        remove
          ? "証跡の関連を解除しました。"
          : reviewMode
            ? "確認を保存しました。"
            : "証跡を保存しました。",
      );
    else void onRefresh();
  }
  const draftValues = reviewMode
    ? { 確認結果: reviewLabels[review.state], 確認メモ: review.note }
    : {
        文書名: fields.name,
        参照URL: fields.url,
        該当箇所: fields.location,
        関連基準: fields.criterionIds.join("、"),
      };
  const latestReview = latest?.reviews[selection.criterionId ?? ""];
  const latestValues: Record<string, string> = reviewMode
    ? {
        確認結果: latestReview ? reviewLabels[latestReview.state] : "関連解除済み",
        確認メモ: latestReview?.note ?? "",
      }
    : {
        文書名: latest?.name ?? "",
        参照URL: latest?.url ?? "",
        該当箇所: latest?.location ?? "",
        関連基準: latest?.criterionIds.join("、") ?? "",
      };
  return (
    <section className="panel evidence-editor">
      <h2>
        {reviewMode
          ? `${selection.item!.name} · ${selection.criterionId} の確認`
          : selection.item
            ? "証跡を編集"
            : "証跡を追加"}
      </h2>
      <p className="subtle">
        確認を保存しても自己評価は変わりません。編集・関連解除後は関連する助言と課題の再確認が必要です。
      </p>
      <form
        className="data-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            checked.success &&
            !disabled &&
            !conflict &&
            !missing &&
            !reviewMissing &&
            !tooLarge &&
            !projectionError
          )
            void save();
        }}
      >
        <fieldset disabled={disabled}>
          {reviewMode ? (
            <>
              <label>
                確認結果
                <select
                  value={review.state}
                  onChange={(e) =>
                    setReview({ ...review, state: e.target.value as Review["state"] })
                  }
                >
                  {Object.entries(reviewLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
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
              <p className="field-help">
                確認済み・差戻しには、照合した内容を記入してください（2000文字以内）。
              </p>
            </>
          ) : (
            <>
              <label>
                文書名
                <input
                  value={fields.name}
                  onChange={(e) => setFields({ ...fields, name: e.target.value })}
                />
              </label>
              <label>
                該当箇所
                <textarea
                  rows={2}
                  value={fields.location}
                  onChange={(e) => setFields({ ...fields, location: e.target.value })}
                />
              </label>
              <label>
                参照URL（任意）
                <input
                  value={fields.url}
                  onChange={(e) => setFields({ ...fields, url: e.target.value })}
                />
              </label>
              <fieldset className="evidence-criteria">
                <legend>関連する評価基準（1つ以上）</legend>
                <div className="evidence-criteria-grid">
                  {standard.criteria.map((criterion) => (
                    <label key={criterion.id} title={criterion.officialText}>
                      <input
                        type="checkbox"
                        checked={fields.criterionIds.includes(criterion.id)}
                        onChange={(e) =>
                          setFields({
                            ...fields,
                            criterionIds: e.target.checked
                              ? [...fields.criterionIds, criterion.id]
                              : fields.criterionIds.filter((id) => id !== criterion.id),
                          })
                        }
                      />
                      {criterion.id}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="field-help">
                文書名200文字・該当箇所2000文字・URL2048文字まで。参照URLは http / https
                を指定してください。
              </p>
            </>
          )}
        </fieldset>
        {!checked.success && <p className="field-help">{checked.error.issues[0]?.message}</p>}
        {projectionError && (
          <p role="alert" className="form-error">
            関連する基準と証跡の件数を確認してください。証跡は100件まで登録できます。
          </p>
        )}
        {tooLarge && (
          <p role="alert" className="form-error">
            診断全体が1MiBを超えています。記述を短くしてから保存してください。
          </p>
        )}
        {(missing || reviewMissing) && (
          <p role="alert" className="notice">
            この証跡または基準の関連は解除済みです。未保存の入力を確認して閉じてください。
          </p>
        )}
        <div className="evidence-actions">
          <button
            className="button primary"
            disabled={
              disabled ||
              conflict ||
              !checked.success ||
              tooLarge ||
              missing ||
              reviewMissing ||
              projectionError
            }
          >
            {write.pending ? "保存しています…" : reviewMode ? "確認を保存" : "証跡を保存"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={write.pending}
            onClick={onCancel}
          >
            閉じる
          </button>
          {selection.item && !reviewMode && (
            <button
              type="button"
              className="text-button"
              disabled={disabled || conflict || missing}
              onClick={() => void save(true)}
            >
              証跡の関連をすべて解除
            </button>
          )}
        </div>
        {selection.item && !reviewMode && (
          <p className="field-help">
            関連解除は参照課題からもこの証跡を外します。過去の履歴・レポートは保持します。
          </p>
        )}
        {write.error && (
          <p role="alert" className="form-error">
            {write.error.message}
          </p>
        )}
        {conflict && (
          <aside className="conflict-panel">
            <h3>未保存の入力と最新の保存値</h3>
            {record.revision > revision ? (
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
                    {Object.entries(draftValues).map(([key, value]) => (
                      <tr key={key}>
                        <th>{key}</th>
                        <td>{value || "未入力"}</td>
                        <td>{latestValues[key] || "未入力"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>最新の内容を確認しています。</p>
            )}
            <button
              className="button secondary"
              type="button"
              disabled={record.revision <= revision || missing || reviewMissing}
              onClick={() => {
                setRevision(record.revision);
                write.clearError();
              }}
            >
              入力を保って再編集する
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={record.revision <= revision || missing || reviewMissing}
              onClick={() => {
                setFields(fieldsOf(latest));
                if (latestReview) setReview({ state: latestReview.state, note: latestReview.note });
                setRevision(record.revision);
                write.clearError();
              }}
            >
              保存値で入力を置き換える
            </button>
          </aside>
        )}
        {write.error && (
          <button type="button" className="text-button" onClick={() => void onRefresh()}>
            最新の内容を再確認
          </button>
        )}
      </form>
    </section>
  );
}
