import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Customer } from "../../shared/contracts/cases";
import type { ApiPage } from "../../shared/contracts/api";
import { useApi, useWrite } from "../lib/api";
import { WorkspaceShell, LoadState } from "../components/WorkspaceShell";
export function CustomersPage() {
  const navigate = useNavigate(),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [name, setName] = useState("");
  const list = useApi<ApiPage<Customer>>(
      `/api/v1/customers?q=${encodeURIComponent(query)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
    write = useWrite();
  async function create() {
    const result = await write.send<Customer>("/api/v1/customers", "POST", { name });
    if (result) void navigate(`/customers/${result.data.id}`);
  }
  return (
    <WorkspaceShell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">CUSTOMERS & CASES</p>
          <h1>顧客・案件</h1>
          <p className="subtle">担当する顧客を選び、診断の準備を始めます。</p>
        </div>
        <span className="edition-badge">SCS ★3</span>
      </header>
      <div className="two-column">
        <section className="panel">
          <h2>担当顧客</h2>
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setCursor(null);
            }}
          >
            <label className="sr-only" htmlFor="customer-search">
              顧客を検索
            </label>
            <input
              id="customer-search"
              placeholder="顧客名で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="button secondary">検索</button>
            {query && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setQuery("");
                  setSearch("");
                  setCursor(null);
                }}
              >
                条件を解除
              </button>
            )}
          </form>
          <LoadState error={list.error} loading={list.isLoading} retry={list.mutate} />
          {!list.error && list.data && (
            <>
              <div className="record-list">
                {list.data.items.map((customer) => (
                  <Link key={customer.id} to={`/customers/${customer.id}`} className="record-row">
                    <div>
                      <strong>{customer.name}</strong>
                      <p className="subtle">
                        更新 {new Date(customer.updatedAt).toLocaleDateString("ja-JP")}
                      </p>
                    </div>
                    <span>{customer.archivedAt ? "保管済み" : "案件を見る →"}</span>
                  </Link>
                ))}
              </div>
              {!list.data.items.length && (
                <div className="empty-state">
                  <h3>{query ? "条件に合う顧客はありません" : "担当顧客はまだありません"}</h3>
                  <p>新しい顧客を追加すると、自分の担当顧客として登録されます。</p>
                </div>
              )}
              <div className="pagination">
                {cursor && (
                  <button className="button secondary" onClick={() => setCursor(null)}>
                    先頭へ
                  </button>
                )}
                {list.data.nextCursor && (
                  <button
                    className="button secondary"
                    onClick={() => setCursor(list.data!.nextCursor)}
                  >
                    次のページ
                  </button>
                )}
              </div>
            </>
          )}
        </section>
        <section className="panel create-panel">
          <h2>顧客を追加</h2>
          <p className="subtle">顧客名だけで開始できます。対象範囲は診断ごとに設定します。</p>
          <form
            className="data-form"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              顧客名
              <input
                required
                maxLength={400}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={write.pending}
              />
            </label>
            <button
              className="button primary"
              disabled={write.pending || !name.trim() || Array.from(name.trim()).length > 200}
            >
              {write.pending ? "追加しています…" : "顧客を追加"}
            </button>
            {write.error && (
              <p role="alert" className="form-error">
                {write.error.message}
              </p>
            )}
          </form>
        </section>
      </div>
    </WorkspaceShell>
  );
}
