import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Customer, CaseRecord, CaseCreated } from "../../shared/contracts/cases";
import { STANDARD_ID } from "../../shared/contracts/assessment";
import type { ApiPage } from "../../shared/contracts/api";
import { useApi, useWrite, isAccessError } from "../lib/api";
import { WorkspaceShell, LoadState } from "../components/WorkspaceShell";
import { EntityForm } from "../components/cases/EntityForm";
export function CustomerPage() {
  const { customerId } = useParams(),
    navigate = useNavigate(),
    [name, setName] = useState(""),
    [cursor, setCursor] = useState<string | null>(null);
  const customer = useApi<Customer>(`/api/v1/customers/${customerId}`),
    cases = useApi<ApiPage<CaseRecord>>(
      `/api/v1/customers/${customerId}/cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
    write = useWrite();
  const accessDenied = [customer.error, cases.error].some(isAccessError);
  async function create() {
    const result = await write.send<CaseCreated>(`/api/v1/customers/${customerId}/cases`, "POST", {
      name,
      standardId: STANDARD_ID,
    });
    if (result) void navigate(`/assessments/${result.data.assessmentId}`);
  }
  return (
    <WorkspaceShell>
      <Link className="breadcrumb" to="/customers">
        ← 顧客・案件
      </Link>
      <LoadState
        error={customer.error || (accessDenied ? cases.error : undefined)}
        loading={customer.isLoading}
        retry={() => {
          void customer.mutate();
          void cases.mutate();
        }}
      />
      {customer.data && !accessDenied && (
        <>
          <header className="page-heading">
            <div>
              <p className="eyebrow">CUSTOMER</p>
              <h1>{customer.data.name}</h1>
              <p className="subtle">
                {customer.data.archivedAt
                  ? "保管済み · 診断結果を閲覧できます。"
                  : "案件ごとに対象範囲を分けて診断します。"}
              </p>
            </div>
          </header>
          <div className="two-column">
            <section className="panel">
              <h2>診断案件</h2>
              <LoadState error={cases.error} loading={cases.isLoading} retry={cases.mutate} />
              {cases.data && !cases.error && (
                <>
                  <div className="record-list">
                    {cases.data.items.map((item) => (
                      <Link key={item.id} to={`/cases/${item.id}`} className="record-row">
                        <div>
                          <strong>{item.name}</strong>
                          <p className="subtle">
                            更新 {new Date(item.updatedAt).toLocaleDateString("ja-JP")}
                          </p>
                        </div>
                        <span>{item.archivedAt ? "保管済み" : "開く →"}</span>
                      </Link>
                    ))}
                  </div>
                  {!cases.data.items.length && (
                    <p className="empty-state">
                      案件はまだありません。右のフォームから追加してください。
                    </p>
                  )}
                  <div className="pagination">
                    {cursor && (
                      <button className="button secondary" onClick={() => setCursor(null)}>
                        先頭へ
                      </button>
                    )}
                    {cases.data.nextCursor && (
                      <button
                        className="button secondary"
                        onClick={() => setCursor(cases.data!.nextCursor)}
                      >
                        次のページ
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
            <section className="panel create-panel">
              <h2>案件を作成</h2>
              <p className="subtle">
                SCS ★3・81評価基準の未回答診断を作成します。対象範囲と診断日は後から入力できます。
              </p>
              <form
                className="data-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <label>
                  案件名
                  <input
                    required
                    maxLength={400}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={write.pending || Boolean(customer.data.archivedAt)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={
                    write.pending ||
                    !name.trim() ||
                    Array.from(name.trim()).length > 200 ||
                    Boolean(customer.data.archivedAt)
                  }
                >
                  案件を作成
                </button>
                {write.error && (
                  <p role="alert" className="form-error">
                    {write.error.message}
                  </p>
                )}
              </form>
            </section>
          </div>
          <details className="panel settings-panel">
            <summary>顧客名・保管状態を変更</summary>
            <EntityForm
              key={customer.data.id}
              record={customer.data}
              latest={customer.data}
              path={`/api/v1/customers/${customer.data.id}`}
              label="顧客名"
              refresh={customer.mutate}
              onSaved={customer.replace}
            />
          </details>
        </>
      )}
    </WorkspaceShell>
  );
}
