import { useRef, useState } from "react";
import {
  generateAiSchema,
  hashAiInput,
  canonicalAiInput,
  type AiRunDto,
  type GenerateAiInput,
} from "../../shared/contracts/aiAdvice";
import type { AssessmentDto } from "../../shared/contracts/assessments";
import type { ApiSuccess } from "../../shared/contracts/api";
import { useWrite } from "../lib/api";
import { ApiError } from "../lib/fetcher";

export type AiWriter = {
  pending: boolean;
  error: Error | null;
  clearError: () => void;
  send: <T>(
    path: string,
    method: "POST",
    body: Record<string, unknown>,
    options?: { readOnly?: boolean; operationKey?: string },
  ) => Promise<ApiSuccess<T> | null>;
};
type Props = {
  record: AssessmentDto;
  criterionId: string;
  officialRequirement: string;
  readOnly: boolean;
  onAdopted: (result: ApiSuccess<AssessmentDto>) => unknown;
  onRefresh: () => unknown;
  onClose: () => void;
};
export function AiDraftDialog(props: Props) {
  const write = useWrite();
  return (
    <dialog
      className="ai-dialog"
      aria-labelledby="ai-dialog-title"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!write.pending) props.onClose();
      }}
    >
      <AiDraftForm {...props} write={write} read={write.read} />
    </dialog>
  );
}

export function AiDraftForm({
  record,
  criterionId,
  officialRequirement,
  readOnly,
  write,
  read,
  onAdopted,
  onRefresh,
  onClose,
}: Props & { write: AiWriter; read: (path: string) => Promise<ApiSuccess<AiRunDto> | null> }) {
  const [answer, setAnswer] = useState(""),
    [gap, setGap] = useState(""),
    [reviewed, setReviewed] = useState("");
  const [attempt, setAttempt] = useState<{ body: GenerateAiInput; key: string } | null>(null);
  const [run, setRun] = useState<AiRunDto | null>(null),
    [loading, setLoading] = useState(false),
    [readError, setReadError] = useState<Error | null>(null);
  const busy = useRef(false);
  const basis = record.document.responses[criterionId].basisHash;
  const payload = {
    standardId: record.standardId,
    criterionId,
    officialRequirement,
    anonymousAnswer: answer.trim(),
    anonymousGap: gap.trim(),
  };
  const token = JSON.stringify([record.revision, basis, payload]);
  const valid =
    generateAiSchema.safeParse({
      expectedRevision: record.revision,
      basisHash: basis,
      anonymousAnswer: payload.anonymousAnswer,
      anonymousGap: payload.anonymousGap,
      reviewedInputHash: "0".repeat(64),
      anonymizationReviewed: true,
    }).success && new TextEncoder().encode(canonicalAiInput(payload)).byteLength <= 8000;
  const pending = write.pending || loading,
    disabled = pending || readOnly;
  const error = readError ?? write.error;
  const runId = run?.runId ?? (error instanceof ApiError ? error.runId : undefined);
  const stale =
    run?.status === "stale" ||
    (run && run.basisHash !== basis) ||
    (error instanceof ApiError && error.code === "AI_STALE");
  const knownFailure = error instanceof ApiError && Boolean(error.requestId);
  const resetAllowed =
    run?.status === "succeeded" || run?.status === "failed" || stale || knownFailure;
  async function generate(retry = false) {
    if (busy.current || disabled || (!retry && (reviewed !== token || !valid || attempt))) return;
    busy.current = true;
    setLoading(true);
    setReadError(null);
    try {
      const current = retry
        ? attempt
        : {
            body: {
              expectedRevision: record.revision,
              basisHash: basis,
              anonymousAnswer: payload.anonymousAnswer,
              anonymousGap: payload.anonymousGap,
              anonymizationReviewed: true as const,
              reviewedInputHash: await hashAiInput(payload),
            },
            key: crypto.randomUUID(),
          };
      if (!current) return;
      setAttempt(current);
      const result = await write.send<AiRunDto>(
        `/api/v1/assessments/${record.id}/advice/${criterionId}/ai-runs`,
        "POST",
        current.body,
        { readOnly: true, operationKey: current.key },
      );
      if (result) setRun(result.data);
    } catch (reason) {
      setReadError(
        reason instanceof Error ? reason : new Error("生成状態を確認できませんでした。"),
      );
    } finally {
      setLoading(false);
      busy.current = false;
    }
  }
  async function refreshRun() {
    if (!runId || disabled || busy.current) return;
    busy.current = true;
    setLoading(true);
    setReadError(null);
    try {
      const result = await read(`/api/v1/assessments/${record.id}/ai-runs/${runId}`);
      if (result) {
        setRun(result.data);
        write.clearError();
      }
    } catch (reason) {
      setReadError(
        reason instanceof Error ? reason : new Error("生成状態を確認できませんでした。"),
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  async function adopt() {
    if (disabled || busy.current || stale || run?.status !== "succeeded") return;
    busy.current = true;
    setLoading(true);
    try {
      const result = await write.send<AssessmentDto>(
        `/api/v1/assessments/${record.id}/advice/${criterionId}/adopt-ai`,
        "POST",
        { expectedRevision: record.revision, runId: run.runId },
      );
      if (result) {
        void onAdopted(result);
        onClose();
      } else void onRefresh();
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  return (
    <div className="data-form">
      <h2 id="ai-dialog-title">匿名化した内容から AI 下書き</h2>
      <p className="notice">
        顧客名・原回答・証跡は自動転記しません。顧客や個人を特定できる情報を除き、送信全文を確認してください。生成・採用だけでは助言は確定しません。
      </p>
      <label>
        匿名化した状況
        <textarea
          rows={3}
          value={answer}
          disabled={disabled || Boolean(attempt)}
          onChange={(event) => {
            setAnswer(event.target.value);
            setReviewed("");
          }}
        />
      </label>
      <label>
        匿名化した不足点
        <textarea
          rows={3}
          value={gap}
          disabled={disabled || Boolean(attempt)}
          onChange={(event) => {
            setGap(event.target.value);
            setReviewed("");
          }}
        />
      </label>
      <p className="field-help">
        各2000文字、公開要件を含む送信全文8000バイト以内。匿名化は担当者が判断します。
      </p>
      {/(?:https?:\/\/|[\w.+-]+@[\w.-]+)/i.test(`${answer} ${gap}`) && (
        <p className="notice">
          メールアドレスまたは URL らしい記述があります。特定につながらないか確認してください。
        </p>
      )}
      {(answer || gap) && !valid && (
        <p role="alert" className="form-error">
          両欄を入力し、文字数・送信サイズの上限内にしてください。
        </p>
      )}
      <h3>送信される公開要件と匿名文</h3>
      <pre aria-label="送信全文" className="ai-payload">
        {JSON.stringify(payload, null, 2)}
      </pre>
      <label className="advice-review">
        <input
          type="checkbox"
          checked={reviewed === token}
          disabled={disabled || !valid || Boolean(attempt)}
          onChange={(event) => setReviewed(event.target.checked ? token : "")}
        />
        送信全文を確認し、匿名化しました
      </label>
      <button
        type="button"
        className="button primary"
        disabled={disabled || !valid || reviewed !== token || Boolean(attempt)}
        onClick={() => void generate()}
      >
        確認した内容で生成
      </button>
      {pending && <p role="status">AI生成・保存の状態を確認しています…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error.message}
        </p>
      )}
      {run?.status === "failed" && (
        <p role="alert" className="form-error">
          生成に失敗しました（{run.errorCode}）。新しい試行を準備するか、手入力を続けてください。
        </p>
      )}
      {stale && (
        <p role="alert" className="form-error">
          回答・範囲・証跡が変わりました。最新状態を読み込み、送信内容を確認し直してください。
        </p>
      )}
      {attempt && !runId && (
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() => void generate(true)}
        >
          同じ送信の状態を確認
        </button>
      )}
      {runId && (
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() => void refreshRun()}
        >
          生成状態を再確認
        </button>
      )}
      {run && ["pending", "running"].includes(run.status) && (
        <p role="status">生成中です。最大30秒待機し、通信が切れた場合も同じ生成を確認できます。</p>
      )}
      {run?.draft && (
        <section className="ai-result" aria-label="AI下書きの内容">
          <h3>AI 下書き · 未確定</h3>
          <p className="preline">{run.draft.gap}</p>
          <h4>実施手順</h4>
          <ul>
            {run.draft.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
          <h4>証跡例</h4>
          <ul>
            {run.draft.evidenceExamples.map((example, i) => (
              <li key={i}>{example}</li>
            ))}
          </ul>
          <h4>完了確認</h4>
          <p className="preline">{run.draft.completionCheck}</p>
          <p className="preline">{run.draft.notes}</p>
          <p>採用すると編集中の助言下書きを置き換えます。保存済みの確定版は保持します。</p>
          <button
            type="button"
            className="button primary"
            disabled={disabled || Boolean(stale) || run.status !== "succeeded"}
            onClick={() => void adopt()}
          >
            AI案を下書きへ採用
          </button>
        </section>
      )}
      {attempt && resetAllowed && (
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() => {
            setAttempt(null);
            setRun(null);
            setReviewed("");
            setReadError(null);
            write.clearError();
            void onRefresh();
          }}
        >
          新しい試行を準備
        </button>
      )}
      <button type="button" className="button secondary" disabled={pending} onClick={onClose}>
        閉じて手入力を続ける
      </button>
    </div>
  );
}
