import { useRef, useState } from "react";
import { FILE_TYPES, MAX_FILE_BYTES, type FileUploaded } from "../../shared/contracts/files";
import { ApiError } from "../lib/fetcher";
export type AttachmentState = { fileId: string | null; pending: boolean; incomplete: boolean };
export type UploadFile = (file: File, key: string, signal: AbortSignal) => Promise<FileUploaded>;
export function FileAttachment({
  disabled,
  upload,
  newId,
  onChange,
}: {
  disabled: boolean;
  upload: UploadFile;
  newId: () => string;
  onChange: (state: AttachmentState) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [ready, setReady] = useState(false),
    [reselect, setReselect] = useState(false);
  const attempt = useRef(""),
    controller = useRef<AbortController | null>(null);
  function select(next: File | null) {
    setFile(next);
    setReady(false);
    setReselect(false);
    setError("");
    attempt.current = newId();
    onChange({ fileId: null, pending: false, incomplete: Boolean(next) });
    if (
      next &&
      (next.size === 0 ||
        next.size > MAX_FILE_BYTES ||
        !FILE_TYPES[next.name.split(".").at(-1)?.toLowerCase() ?? ""])
    ) {
      setReselect(true);
      setError(
        next.size > MAX_FILE_BYTES
          ? "ファイルは10MiB以下にしてください。"
          : "PDF・PNG・JPEG・TXT・DOCX・XLSXの空でないファイルを選んでください。",
      );
    }
  }
  async function send() {
    if (!file || pending || ready || reselect || disabled) return;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError("");
    onChange({ fileId: null, pending: true, incomplete: true });
    try {
      const result = await upload(file, attempt.current, abort.signal);
      if (abort.signal.aborted) throw new Error();
      if (result.status !== "ready") {
        setReselect(true);
        setError("登録が完了していません。ファイルを選び直して新しく送信してください。");
        onChange({ fileId: null, pending: false, incomplete: true });
      } else {
        setReady(true);
        onChange({ fileId: result.fileId, pending: false, incomplete: false });
      }
    } catch (reason) {
      if (abort.signal.aborted) {
        setReselect(true);
        setError("送信を中止しました。ファイルを選び直してください。");
      } else {
        if (reason instanceof ApiError && reason.requestId) setReselect(true);
        setError(reason instanceof Error ? reason.message : "送信できませんでした。");
      }
      onChange({ fileId: null, pending: false, incomplete: true });
    } finally {
      setPending(false);
      controller.current = null;
    }
  }
  return (
    <div className="file-attachment">
      <label>
        添付ファイル（任意）
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx"
          disabled={disabled || pending}
          onChange={(event) => {
            select(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <p className="field-help">
        10MiB以下。PDF / PNG / JPEG / TXT / DOCX /
        XLSX。暗号化・マクロ・外部参照を含む文書は登録できません。
      </p>
      {file && (
        <>
          <p>{file.name}</p>
          <div className="evidence-actions">
            <button
              className="button secondary"
              type="button"
              disabled={disabled || pending || ready || reselect}
              onClick={() => void send()}
            >
              {pending ? "添付を送信中…" : "添付ファイルを登録"}
            </button>
            {pending ? (
              <button
                className="button secondary"
                type="button"
                onClick={() => controller.current?.abort()}
              >
                送信を中止
              </button>
            ) : (
              <button
                className="text-button"
                type="button"
                disabled={disabled}
                onClick={() => select(null)}
              >
                添付を外す
              </button>
            )}
          </div>
        </>
      )}
      {ready && <p className="success-message">添付の登録が完了しました。内容は未確認です。</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
