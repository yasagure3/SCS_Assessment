import { useState } from "react";
import { adviceSchema, MAX_DOCUMENT_BYTES, type Advice } from "../../shared/contracts/assessment";
import { completeAdviceSchema, type AdviceTemplate } from "../../shared/contracts/advice";
import type { AssessmentDto } from "../../shared/contracts/assessments";
import type { ApiSuccess } from "../../shared/contracts/api";
import { ApiError } from "../lib/fetcher";
import { AiDraftDialog } from "./AiDraftDialog";

export type AdviceWriter = {
  pending: boolean;
  error: Error | null;
  clearError: () => void;
  send: (
    path: string,
    method: "PUT" | "POST",
    body: Record<string, unknown>,
  ) => Promise<ApiSuccess<AssessmentDto> | null>;
};
const emptyAdvice: Advice = {
  origin: "manual",
  templateId: null,
  gap: "",
  steps: [],
  evidenceExamples: [],
  completionCheck: "",
  notes: "",
};
const labels = {
  gap: "不足点",
  steps: "実施手順（1行1件）",
  evidenceExamples: "証跡例（1行1件）",
  completionCheck: "完了確認",
  notes: "補足",
};
type Field = keyof typeof labels;
const textFields = (content: Advice) => ({
  gap: content.gap,
  steps: content.steps.join("\n"),
  evidenceExamples: content.evidenceExamples.join("\n"),
  completionCheck: content.completionCheck,
  notes: content.notes,
});
const existingAdvice = (record: AssessmentDto, id: string) =>
  record.document.responses[id].adviceDraft ??
  record.document.responses[id].confirmedAdvice?.content ??
  emptyAdvice;

export function AdviceEditor({
  record,
  criterionId,
  template,
  readOnly,
  write,
  onSaved,
  onRefresh,
}: {
  record: AssessmentDto;
  criterionId: string;
  template?: AdviceTemplate;
  readOnly: boolean;
  write: AdviceWriter;
  onSaved: (result: ApiSuccess<AssessmentDto>) => unknown;
  onRefresh: () => unknown;
}) {
  const initial = existingAdvice(record, criterionId);
  const [fields, setFields] = useState(() => textFields(initial)),
    [provenance, setProvenance] = useState(() => ({
      origin: initial.origin,
      templateId: initial.templateId,
    })),
    [revision, setRevision] = useState(record.revision),
    [reviewed, setReviewed] = useState(""),
    [saved, setSaved] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const content: Advice = {
    ...provenance,
    ...fields,
    steps: fields.steps === "" ? [] : fields.steps.split("\n"),
    evidenceExamples: fields.evidenceExamples === "" ? [] : fields.evidenceExamples.split("\n"),
  };
  const response = record.document.responses[criterionId],
    latest = textFields(existingAdvice(record, criterionId));
  const reviewToken = JSON.stringify([record.revision, response.basisHash, content]);
  const conflict =
    (write.error instanceof ApiError && write.error.code === "CONFLICT") ||
    record.revision > revision;
  const latestReady = record.revision > revision;
  const valid = adviceSchema.safeParse(content).success,
    complete = completeAdviceSchema.safeParse(content).success;
  function exceedsLimit(confirm: boolean) {
    const proposed = {
      ...record.document,
      responses: {
        ...record.document.responses,
        [criterionId]: {
          ...response,
          ...(confirm
            ? {
                confirmedAdvice: {
                  content,
                  basisHash: response.basisHash,
                  by: "00000000-0000-4000-8000-000000000000",
                  at: "2026-09-20T00:00:00.000Z",
                  version: (response.confirmedAdvice?.version ?? 0) + 1,
                },
              }
            : { adviceDraft: content }),
        },
      },
    };
    return new TextEncoder().encode(JSON.stringify(proposed)).byteLength > MAX_DOCUMENT_BYTES;
  }
  const draftTooLarge = exceedsLimit(false),
    confirmTooLarge = exceedsLimit(true);
  async function save(confirm: boolean) {
    if (
      readOnly ||
      write.pending ||
      conflict ||
      !valid ||
      (confirm ? !complete || reviewed !== reviewToken || confirmTooLarge : draftTooLarge)
    )
      return;
    setSaved("");
    const result = await write.send(
      `/api/v1/assessments/${record.id}/advice/${criterionId}/${confirm ? "confirm" : "draft"}`,
      confirm ? "POST" : "PUT",
      { expectedRevision: revision, content, ...(confirm ? { reviewed: true } : {}) },
    );
    if (result) {
      setRevision(result.data.revision);
      setReviewed("");
      setSaved(confirm ? "助言を確定しました。" : "下書きを保存しました。");
      void onSaved(result);
    } else void onRefresh();
  }
  function copy(value: Advice) {
    setFields(textFields(value));
    setProvenance({ origin: value.origin, templateId: value.templateId });
    setReviewed("");
    setSaved("");
  }
  return (
    <div className="advice-editor">
      <h3>当社の実施例・助言案</h3>
      <p className="notice">
        以下は当社の提案です。公式要件の追加や取得の判定ではありません。実態に合わせて編集し、回答・範囲・証跡を確認して確定してください。
      </p>
      {template && (
        <div className="advice-template">
          <p className="subtle">
            基準 {template.criterionId} · 定型版 {template.version}
          </p>
          {template.sourceUrls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              定型助言が参照する公式出典
            </a>
          ))}
          <p className="preline">{template.content.gap}</p>
          <button
            type="button"
            className="button secondary"
            disabled={readOnly || write.pending}
            onClick={() => copy(template.content)}
          >
            定型助言を下書きへコピー
          </button>
          <p className="field-help">コピー後に保存してください。保存済みの確定版は保持されます。</p>
        </div>
      )}
      {template && (
        <button
          type="button"
          className="button secondary"
          disabled={readOnly || write.pending || conflict}
          onClick={() => setAiOpen(true)}
        >
          AI 下書きを作成
        </button>
      )}
      {aiOpen && template && (
        <AiDraftDialog
          record={record}
          criterionId={criterionId}
          officialRequirement={template.officialRequirement}
          readOnly={readOnly}
          onClose={() => setAiOpen(false)}
          onRefresh={onRefresh}
          onAdopted={(result) => {
            const adopted = result.data.document.responses[criterionId].adviceDraft;
            if (adopted) copy(adopted);
            setRevision(result.data.revision);
            setSaved("AI案を下書きへ採用しました。内容を確認して確定してください。");
            void onSaved(result);
          }}
        />
      )}
      <form
        className="data-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        {(Object.keys(labels) as Field[]).map((key) => (
          <label key={key}>
            {labels[key]}
            <textarea
              rows={key === "steps" ? 5 : 3}
              value={fields[key]}
              disabled={readOnly || write.pending}
              onChange={(e) => {
                setFields({ ...fields, [key]: e.target.value });
                setReviewed("");
                setSaved("");
              }}
            />
          </label>
        ))}
        <p className="field-help">
          下書きは途中でも保存できます。確定時は不足点・実施手順・証跡例・完了確認が必要です。
        </p>
        {!valid && (
          <p className="form-error" role="alert">
            助言は合計12000文字以内、手順・証跡例は各30件以内で入力してください。
          </p>
        )}
        {(draftTooLarge || confirmTooLarge) && (
          <p className="form-error" role="alert">
            診断全体が1MiBを超えています。記述を短くしてから保存してください。
          </p>
        )}
        <button
          className="button secondary"
          disabled={readOnly || write.pending || conflict || !valid || draftTooLarge}
        >
          下書きを保存
        </button>
        <label className="advice-review">
          <input
            type="checkbox"
            checked={reviewed === reviewToken}
            disabled={readOnly || write.pending || conflict}
            onChange={(e) => setReviewed(e.target.checked ? reviewToken : "")}
          />
          現在の回答・範囲・証跡と助言内容を確認しました
        </label>
        <button
          type="button"
          className="button primary"
          disabled={
            readOnly ||
            write.pending ||
            conflict ||
            !complete ||
            reviewed !== reviewToken ||
            confirmTooLarge
          }
          onClick={() => void save(true)}
        >
          助言を確定
        </button>
        {write.pending && <p role="status">助言を保存しています…</p>}
        {saved && (
          <p className="success-message" role="status">
            {saved}
          </p>
        )}
        {write.error && (
          <p className="form-error" role="alert">
            {write.error.message}
          </p>
        )}
        {write.error && !conflict && (
          <button type="button" className="text-button" onClick={() => void onRefresh()}>
            助言の最新状態を再確認
          </button>
        )}
        {conflict && (
          <aside className="conflict-panel">
            <h3>助言の未保存入力と最新の保存値</h3>
            <p>診断が更新されました。最新の回答・範囲・証跡と差分を確認し、再編集してください。</p>
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
                    {(Object.keys(labels) as Field[]).map((key) => (
                      <tr key={key}>
                        <th>{labels[key]}</th>
                        <td>{fields[key] || "未入力"}</td>
                        <td>{latest[key] || "未入力"}</td>
                        <td>{fields[key] === latest[key] ? "同じ" : "変更あり"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>最新の内容を取得してから再編集できます。</p>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={!latestReady}
              onClick={() => {
                setRevision(record.revision);
                setReviewed("");
                setSaved("");
                write.clearError();
              }}
            >
              助言の入力を保って再編集する
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!latestReady}
              onClick={() => {
                copy(existingAdvice(record, criterionId));
                setRevision(record.revision);
                write.clearError();
              }}
            >
              助言を保存値で置き換える
            </button>
            <button type="button" className="text-button" onClick={() => void onRefresh()}>
              助言の最新状態を再確認
            </button>
          </aside>
        )}
      </form>
    </div>
  );
}
