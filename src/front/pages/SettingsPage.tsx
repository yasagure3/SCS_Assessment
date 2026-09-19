import { useState } from "react";
import type { ApiPage } from "../../shared/contracts/api";
import type {
  Me,
  ManagedUser,
  Invitation,
  Members,
  InvitationResult,
} from "../../shared/contracts/access";
import type { Customer } from "../../shared/contracts/cases";
import { useApi, useWrite, isAccessError } from "../lib/api";
import { WorkspaceShell, LoadState } from "../components/WorkspaceShell";
import { InviteForm, UserAccessForm, MembersForm } from "../components/access/AccessForms";
const statuses = {
  pending: "送信待ち",
  processing: "処理中",
  sent: "送信済み",
  failed: "送信失敗",
  expired: "期限切れ",
};
// Page data may disappear while SWR loads a new key. Keep the visited records
// mounted so form drafts and their base revisions survive page transitions.
function useVisitedRecords<T extends { id: string }>(page: T[] | undefined) {
  const [snapshot, setSnapshot] = useState<{ page: T[] | undefined; items: T[] }>({
    page: undefined,
    items: [],
  });
  if (page && page !== snapshot.page) {
    const items = new Map(snapshot.items.map((item) => [item.id, item]));
    for (const item of page) items.set(item.id, item);
    setSnapshot({ page, items: [...items.values()] });
  }
  return snapshot.items;
}
function NextPage({
  cursor,
  next,
  setCursor,
}: {
  cursor: string | null;
  next: string | null;
  setCursor: (value: string | null) => void;
}) {
  return (
    <div className="pagination">
      {cursor && (
        <button className="text-button" onClick={() => setCursor(null)}>
          先頭へ
        </button>
      )}
      {next && (
        <button className="button secondary" onClick={() => setCursor(next)}>
          次のページ
        </button>
      )}
    </div>
  );
}
function UserEditor({ user, refresh }: { user: ManagedUser; refresh: () => unknown }) {
  const write = useWrite();
  return (
    <UserAccessForm
      user={user}
      {...write}
      refresh={refresh}
      submit={async (input) => {
        const result = await write.send<ManagedUser>(`/api/v1/users/${user.id}`, "PATCH", input);
        if (result) void refresh();
        return result?.data ?? null;
      }}
    />
  );
}
function AssignmentEditor({
  customerId,
  users,
  blocked,
}: {
  customerId: string;
  users: ManagedUser[];
  blocked: boolean;
}) {
  const members = useApi<Members>(`/api/v1/customers/${customerId}/members`),
    write = useWrite();
  if (isAccessError(members.error))
    return <LoadState error={members.error} loading={false} retry={members.mutate} />;
  return (
    <>
      <LoadState error={members.error} loading={members.isLoading} retry={members.mutate} />
      {members.data && (
        <MembersForm
          members={members.data}
          users={users}
          {...write}
          pending={write.pending || blocked || Boolean(members.error)}
          refresh={members.mutate}
          submit={async (input) => {
            const result = await write.send<Members>(
              `/api/v1/customers/${customerId}/members`,
              "PUT",
              input,
            );
            if (result) void members.replace(result);
            return result?.data ?? null;
          }}
        />
      )}
    </>
  );
}
function Management() {
  const [userCursor, setUserCursor] = useState<string | null>(null),
    [invitationCursor, setInvitationCursor] = useState<string | null>(null),
    [customerCursor, setCustomerCursor] = useState<string | null>(null),
    [customerId, setCustomerId] = useState(""),
    [openedCustomers, setOpenedCustomers] = useState<string[]>([]);
  const query = (cursor: string | null) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
  const users = useApi<ApiPage<ManagedUser>>(`/api/v1/users${query(userCursor)}`),
    invitations = useApi<ApiPage<Invitation>>(
      `/api/v1/users/invitations${query(invitationCursor)}`,
    ),
    customers = useApi<ApiPage<Customer>>(`/api/v1/customers${query(customerCursor)}`),
    invite = useWrite(),
    retry = useWrite();
  const visitedUsers = useVisitedRecords(users.data?.items),
    visitedCustomers = useVisitedRecords(customers.data?.items);
  const accessError = [users.error, customers.error, invitations.error].find(isAccessError);
  if (accessError)
    return (
      <LoadState
        error={accessError}
        loading={false}
        retry={() => {
          void users.mutate();
          void customers.mutate();
          void invitations.mutate();
        }}
      />
    );
  return (
    <>
      <div className="two-column access-intro">
        <section className="panel">
          <h2>社内利用者を招待</h2>
          <LoadState
            error={customers.error}
            loading={customers.isLoading}
            retry={customers.mutate}
          />
          <InviteForm
            customers={customers.data?.items.filter((customer) => !customer.archivedAt) ?? []}
            {...invite}
            pending={invite.pending || customers.isLoading || Boolean(customers.error)}
            submit={async (input) => {
              const result = await invite.send<InvitationResult>(
                "/api/v1/users/invitations",
                "POST",
                input,
              );
              void invitations.mutate();
              void users.mutate();
              return result?.data.status === "sent";
            }}
          />
          {customers.data && !customers.error && (
            <NextPage
              cursor={customerCursor}
              next={customers.data.nextCursor}
              setCursor={setCustomerCursor}
            />
          )}
        </section>
        <section className="panel">
          <h2>利用上の注意</h2>
          <div className="notice">
            <p>管理者は全顧客、担当者は割り当てられた顧客だけを利用できます。</p>
            <p>
              停止・割当解除は既存のログインにも反映します。顧客担当者名の入力からメールを送信することはありません。
            </p>
          </div>
          <h3>MFA端末を紛失した場合</h3>
          <p>
            本人確認した運用者に連絡し、停止・全セッション失効・TOTP回復・再有効化を順に行ってください。
          </p>
          <p className="subtle">最後の有効な管理者は停止・降格できません。</p>
        </section>
      </div>
      <section className="panel">
        <h2>招待一覧</h2>
        <LoadState
          error={invitations.error}
          loading={invitations.isLoading}
          retry={invitations.mutate}
        />
        {retry.error && (
          <p role="alert" className="form-error">
            {retry.error.message}
          </p>
        )}
        {invitations.data && !invitations.error && (
          <>
            <div className="record-list">
              {invitations.data.items.map((invitation) => (
                <div className="record-row access-record" key={invitation.invitationId}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <p className="subtle">
                      {invitation.userStatus === "active"
                        ? "利用開始済み"
                        : statuses[invitation.status]}{" "}
                      · 有効期限 {new Date(invitation.expiresAt).toLocaleString("ja-JP")}
                    </p>
                    {invitation.status === "failed" && (
                      <p className="form-error">
                        送信できませんでした。内容を確認して再発行してください。
                      </p>
                    )}
                    {invitation.status === "processing" && (
                      <p className="subtle">
                        処理が中断した場合、5分後に再発行できます。送信済みの可能性もあるため確認してください。
                      </p>
                    )}
                  </div>
                  <button
                    className="button secondary"
                    disabled={retry.pending || !invitation.retryAllowed}
                    onClick={() => {
                      void retry
                        .send(
                          `/api/v1/users/invitations/${invitation.invitationId}/retry`,
                          "POST",
                          {},
                          { newAttemptOnConfirmedFailure: true },
                        )
                        .then(() => {
                          void invitations.mutate();
                        });
                    }}
                  >
                    招待を再発行
                  </button>
                </div>
              ))}
            </div>
            {!invitations.data.items.length && (
              <p className="empty-state">招待はまだありません。</p>
            )}
            <NextPage
              cursor={invitationCursor}
              next={invitations.data.nextCursor}
              setCursor={setInvitationCursor}
            />
            <button className="text-button" onClick={() => void invitations.mutate()}>
              招待状態を再読み込み
            </button>
          </>
        )}
      </section>
      <section className="panel">
        <h2>利用者とアクセス範囲</h2>
        <LoadState error={users.error} loading={users.isLoading} retry={users.mutate} />
        {visitedUsers.map((user) => (
          <details
            className="access-user"
            key={user.id}
            hidden={Boolean(users.error) || !users.data?.items.some((item) => item.id === user.id)}
          >
            <summary>
              <strong>{user.email}</strong>
              <span>
                {user.role === "admin" ? "管理者" : "担当者"} /{" "}
                {user.status === "active"
                  ? "有効"
                  : user.status === "suspended"
                    ? "停止"
                    : "招待中"}
              </span>
            </summary>
            <UserEditor user={user} refresh={users.mutate} />
          </details>
        ))}
        {users.data && !users.error && (
          <>
            <NextPage cursor={userCursor} next={users.data.nextCursor} setCursor={setUserCursor} />
            <button className="text-button" onClick={() => void users.mutate()}>
              利用者一覧を再読み込み
            </button>
          </>
        )}
      </section>
      <section className="panel">
        <h2>顧客の割当</h2>
        <label className="data-form">
          対象の顧客
          <select
            value={customerId}
            disabled={customers.isLoading || Boolean(customers.error)}
            onChange={(event) => {
              const id = event.target.value;
              setCustomerId(id);
              if (id && !openedCustomers.includes(id)) setOpenedCustomers([...openedCustomers, id]);
            }}
          >
            <option value="">顧客を選択してください</option>
            {customerId &&
              !customers.data?.items.some((customer) => customer.id === customerId) && (
                <option value={customerId}>
                  {visitedCustomers.find((customer) => customer.id === customerId)?.name ??
                    "選択中の顧客"}
                </option>
              )}
            {customers.data?.items
              .filter((customer) => !customer.archivedAt)
              .map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
          </select>
        </label>
        {customers.data && (
          <NextPage
            cursor={customerCursor}
            next={customers.data.nextCursor}
            setCursor={setCustomerCursor}
          />
        )}
        <LoadState
          error={customers.error || users.error}
          loading={customers.isLoading || users.isLoading}
          retry={() => {
            void customers.mutate();
            void users.mutate();
          }}
        />
        {openedCustomers.map((id) => (
          <div key={id} hidden={id !== customerId} role="region" aria-label="選択した顧客の割当">
            <AssignmentEditor
              customerId={id}
              users={users.data?.items ?? []}
              blocked={users.isLoading || Boolean(users.error)}
            />
          </div>
        ))}
      </section>
    </>
  );
}
export function SettingsPage() {
  const me = useApi<Me>("/api/v1/me");
  return (
    <WorkspaceShell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>管理・利用設定</h1>
          <p className="subtle">社内利用者の招待・役割・顧客へのアクセスを管理します。</p>
        </div>
      </header>
      <LoadState error={me.error} loading={me.isLoading} retry={me.mutate} />
      {me.data &&
        !me.error &&
        (me.data.role === "admin" ? (
          <Management />
        ) : (
          <section className="panel">
            <h2>管理者権限が必要です</h2>
            <p>招待や顧客の割当は管理者へ依頼してください。</p>
          </section>
        ))}
    </WorkspaceShell>
  );
}
