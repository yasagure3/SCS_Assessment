import { useState } from "react";
import type {
  InviteInput,
  ManagedUser,
  Members,
  UpdateUserInput,
  MembersInput,
} from "../../../shared/contracts/access";
import { inviteSchema } from "../../../shared/contracts/access";
import { ApiError } from "../../lib/fetcher";
type WriteState = { pending: boolean; error: Error | null };
function Feedback({ error, saved }: { error: Error | null; saved: boolean }) {
  return (
    <>
      {error && (
        <p role="alert" className="form-error">
          {error.message}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="success-message">
          保存しました。
        </p>
      )}
    </>
  );
}
function Conflict({
  active,
  ready,
  latest,
  accept,
  refresh,
}: {
  active: boolean;
  ready: boolean;
  latest: string;
  accept: () => void;
  refresh: () => unknown;
}) {
  return active ? (
    <aside className="conflict-panel">
      <h3>最新の保存値</h3>
      <p>{latest}</p>
      <p>入力内容を保持しています。最新の内容を確認してから再編集してください。</p>
      <button type="button" className="button secondary" disabled={!ready} onClick={accept}>
        入力を保って再編集する
      </button>
      <button type="button" className="text-button" onClick={() => void refresh()}>
        最新の内容を再確認
      </button>
    </aside>
  ) : null;
}
export function InviteForm({
  customers,
  submit,
  pending,
  error,
}: WriteState & {
  customers: { id: string; name: string }[];
  submit: (input: InviteInput) => Promise<boolean>;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<InviteInput["role"]>("staff"),
    [customerIds, setCustomerIds] = useState<string[]>([]),
    [saved, setSaved] = useState(false);
  const body = { email, role, customerIds },
    valid = inviteSchema.safeParse(body).success;
  return (
    <form
      className="data-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        void submit(body).then((success) => {
          if (success) {
            setEmail("");
            setCustomerIds([]);
            setSaved(true);
          }
        });
      }}
    >
      <label>
        社内メールアドレス
        <input
          type="email"
          required
          maxLength={254}
          value={email}
          disabled={pending}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        招待する役割
        <select
          value={role}
          disabled={pending}
          onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "staff")}
        >
          <option value="staff">担当者：割当顧客のみ</option>
          <option value="admin">管理者：全顧客</option>
        </select>
      </label>
      <fieldset disabled={pending}>
        <legend>最初に割り当てる顧客</legend>
        {customers.map((customer) => (
          <label className="check-field" key={customer.id}>
            <input
              type="checkbox"
              checked={customerIds.includes(customer.id)}
              onChange={(event) =>
                setCustomerIds(
                  event.target.checked
                    ? [...customerIds, customer.id]
                    : customerIds.filter((id) => id !== customer.id),
                )
              }
            />
            {customer.name}
          </label>
        ))}
      </fieldset>
      <p className="subtle">招待は7日間有効です。送信先は社内利用者のみ指定してください。</p>
      <button className="button primary" disabled={pending || !valid}>
        招待メールを送信
      </button>
      <Feedback error={error} saved={saved} />
    </form>
  );
}
export function UserAccessForm({
  user,
  submit,
  pending,
  error,
  refresh,
}: WriteState & {
  user: ManagedUser;
  submit: (input: Omit<UpdateUserInput, "mutationId">) => Promise<ManagedUser | null>;
  refresh: () => unknown;
}) {
  const [role, setRole] = useState(user.role),
    [status, setStatus] = useState<"active" | "suspended">(
      user.status === "suspended" ? "suspended" : "active",
    ),
    [revision, setRevision] = useState(user.revision),
    [dirty, setDirty] = useState(false),
    [accepted, setAccepted] = useState(0),
    [saved, setSaved] = useState(false);
  if (!dirty && !pending && !error && user.revision > revision) {
    setRole(user.role);
    setStatus(user.status === "suspended" ? "suspended" : "active");
    setRevision(user.revision);
    setSaved(false);
  }
  const conflict = error instanceof ApiError && error.code === "CONFLICT" && accepted !== revision;
  return (
    <form
      className="data-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        setAccepted(0);
        setDirty(true);
        void submit({ role, status, expectedRevision: revision }).then((result) => {
          if (result) {
            setRevision(result.revision);
            setDirty(false);
            setSaved(true);
          } else void refresh();
        });
      }}
    >
      <label>
        役割
        <select
          value={role}
          disabled={pending}
          onChange={(event) => {
            setDirty(true);
            setRole(event.target.value === "admin" ? "admin" : "staff");
          }}
        >
          <option value="staff">担当者</option>
          <option value="admin">管理者</option>
        </select>
      </label>
      <label>
        利用状態
        <select
          value={status}
          disabled={pending}
          onChange={(event) => {
            setDirty(true);
            setStatus(event.target.value === "suspended" ? "suspended" : "active");
          }}
        >
          <option value="active">{user.status === "invited" ? "初回ログイン待ち" : "有効"}</option>
          <option value="suspended">停止</option>
        </select>
      </label>
      <button className="button secondary" disabled={pending || conflict}>
        利用者の変更を保存
      </button>
      <Feedback error={error} saved={saved} />
      <Conflict
        active={conflict}
        ready={user.revision > revision}
        latest={`${user.role === "admin" ? "管理者" : "担当者"} / ${user.status === "active" ? "有効" : "停止"} / 版 ${user.revision}`}
        accept={() => {
          setRevision(user.revision);
          setAccepted(user.revision);
        }}
        refresh={refresh}
      />
    </form>
  );
}
export function MembersForm({
  members,
  users,
  submit,
  pending,
  error,
  refresh,
}: WriteState & {
  members: Members;
  users: ManagedUser[];
  submit: (input: Omit<MembersInput, "mutationId">) => Promise<Members | null>;
  refresh: () => unknown;
}) {
  const [userIds, setUserIds] = useState(members.userIds),
    [revision, setRevision] = useState(members.revision),
    [dirty, setDirty] = useState(false),
    [accepted, setAccepted] = useState(0),
    [saved, setSaved] = useState(false);
  if (!dirty && !pending && !error && members.revision > revision) {
    setUserIds(members.userIds);
    setRevision(members.revision);
    setSaved(false);
  }
  const conflict = error instanceof ApiError && error.code === "CONFLICT" && accepted !== revision;
  return (
    <form
      className="data-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        setAccepted(0);
        setDirty(true);
        void submit({ userIds, expectedRevision: revision }).then((result) => {
          if (result) {
            setRevision(result.revision);
            setDirty(false);
            setSaved(true);
          } else void refresh();
        });
      }}
    >
      <fieldset disabled={pending}>
        <legend>この顧客にアクセスできる担当者</legend>
        {users.map((user) => (
          <label className="check-field" key={user.id}>
            <input
              type="checkbox"
              disabled={user.status === "suspended" && !userIds.includes(user.id)}
              checked={userIds.includes(user.id)}
              onChange={(event) => {
                setDirty(true);
                setUserIds(
                  event.target.checked
                    ? [...userIds, user.id]
                    : userIds.filter((id) => id !== user.id),
                );
              }}
            />
            {user.email}
          </label>
        ))}
      </fieldset>
      <p className="subtle">
        管理者は割当にかかわらず全顧客へアクセスできます。他のページの選択も保持します。
      </p>
      <button className="button secondary" disabled={pending || conflict}>
        顧客の割当を保存
      </button>
      <Feedback error={error} saved={saved} />
      <Conflict
        active={conflict}
        ready={members.revision > revision}
        latest={`版 ${members.revision}：${members.userIds.map((id) => users.find((user) => user.id === id)?.email ?? "別ページの利用者").join("、") || "割当なし"}`}
        accept={() => {
          setRevision(members.revision);
          setAccepted(members.revision);
        }}
        refresh={refresh}
      />
    </form>
  );
}
