import { useState } from "react";
import type { Customer } from "../../../shared/contracts/cases";
import type { ApiSuccess } from "../../../shared/contracts/api";
import { ApiError } from "../../lib/fetcher";
import { useWrite } from "../../lib/api";
export function EntityForm({
  record,
  path,
  label,
  onSaved,
  latest,
  refresh,
}: {
  record: Customer;
  path: string;
  label: string;
  onSaved: (result: ApiSuccess<Customer>) => unknown;
  latest: Customer;
  refresh: () => unknown;
}) {
  const [name, setName] = useState(record.name),
    [archived, setArchived] = useState(Boolean(record.archivedAt)),
    [revision, setRevision] = useState(record.revision),
    [saved, setSaved] = useState(false),
    write = useWrite();
  const conflict = write.error instanceof ApiError && write.error.code === "CONFLICT";
  const latestReady = latest.revision > revision;
  async function save() {
    setSaved(false);
    const result = await write.send<Customer>(path, "PATCH", {
      name,
      archived,
      expectedRevision: revision,
    });
    if (result) {
      setRevision(result.data.revision);
      setSaved(true);
      void onSaved(result);
    } else void refresh();
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
        {label}
        <input
          required
          value={name}
          maxLength={400}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          disabled={write.pending}
        />
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => {
            setArchived(e.target.checked);
            setSaved(false);
          }}
          disabled={write.pending}
        />
        保管する（診断内容の編集を止める）
      </label>
      <button
        className="button secondary"
        disabled={write.pending || !name.trim() || Array.from(name.trim()).length > 200}
      >
        変更を保存
      </button>
      {saved && (
        <p role="status" className="success-message">
          保存しました。
        </p>
      )}
      {write.error && (
        <p role="alert" className="form-error">
          {write.error.message}
        </p>
      )}
      {conflict && (
        <aside className="conflict-panel">
          <h3>最新の保存値</h3>
          {latestReady ? (
            <p>
              {latest.name}／{latest.archivedAt ? "保管済み" : "利用中"}
            </p>
          ) : (
            <p>最新の内容を確認しています。通信が復旧しない場合は再確認してください。</p>
          )}
          <p>上の入力内容は保持しています。最新の内容を確認して、どちらを使うか選んでください。</p>
          <button
            type="button"
            className="button secondary"
            disabled={!latestReady}
            onClick={() => {
              setName(latest.name);
              setArchived(Boolean(latest.archivedAt));
              setRevision(latest.revision);
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
              setRevision(latest.revision);
              write.clearError();
            }}
          >
            入力を保って再編集する
          </button>
          <button type="button" className="text-button" onClick={() => void refresh()}>
            最新の内容を再確認
          </button>
        </aside>
      )}
    </form>
  );
}
