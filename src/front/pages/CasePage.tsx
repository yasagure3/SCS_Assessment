import { useState } from "react";
import { Link, useParams } from "react-router";
import type { CaseRecord, Customer, AssessmentListItem } from "../../shared/contracts/cases";
import type { ApiPage } from "../../shared/contracts/api";
import { useApi, isAccessError } from "../lib/api";
import { WorkspaceShell, LoadState } from "../components/WorkspaceShell";
import { EntityForm } from "../components/cases/EntityForm";
export function CasePage() {
  const { caseId } = useParams(),
    [cursor, setCursor] = useState<string | null>(null);
  const record = useApi<CaseRecord>(`/api/v1/cases/${caseId}`),
    customer = useApi<Customer>(record.data ? `/api/v1/customers/${record.data.customerId}` : null),
    list = useApi<ApiPage<AssessmentListItem>>(
      `/api/v1/cases/${caseId}/assessments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
  const accessDenied = [record.error, customer.error, list.error].some(isAccessError);
  return (
    <WorkspaceShell>
      <Link
        className="breadcrumb"
        to={!accessDenied && record.data ? `/customers/${record.data.customerId}` : "/customers"}
      >
        ← {!accessDenied ? (customer.data?.name ?? "顧客・案件") : "顧客・案件"}
      </Link>
      <LoadState
        error={record.error || customer.error || (accessDenied ? list.error : undefined)}
        loading={record.isLoading || customer.isLoading}
        retry={() => {
          void record.mutate();
          void customer.mutate();
        }}
      />
      {record.data && customer.data && !accessDenied && (
        <>
          <header className="page-heading">
            <div>
              <p className="eyebrow">ASSESSMENT CASE</p>
              <h1>{record.data.name}</h1>
              <p className="subtle">
                {record.data.archivedAt || customer.data?.archivedAt
                  ? "保管済み · 診断内容は閲覧専用です。"
                  : "診断を選択して、回答と対象範囲を確認してください。"}
              </p>
            </div>
          </header>
          <section className="panel">
            <h2>診断の履歴</h2>
            <LoadState error={list.error} loading={list.isLoading} retry={list.mutate} />
            {list.data && !list.error && (
              <>
                <div className="record-list">
                  {list.data.items.map((item) => (
                    <Link key={item.id} to={`/assessments/${item.id}`} className="record-row">
                      <div>
                        <strong>
                          診断 · 更新 {new Date(item.updatedAt).toLocaleDateString("ja-JP")}
                        </strong>
                        <p className="subtle">診断日 {item.diagnosisDate ?? "未入力"} · SCS ★3</p>
                      </div>
                      <span>診断を開く →</span>
                    </Link>
                  ))}
                </div>
                {!list.data.items.length && <p className="empty-state">診断はまだありません。</p>}
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
          {!customer.data?.archivedAt && (
            <details className="panel settings-panel">
              <summary>案件名・保管状態を変更</summary>
              <EntityForm
                key={record.data.id}
                record={record.data}
                latest={record.data}
                path={`/api/v1/cases/${record.data.id}`}
                label="案件名"
                refresh={record.mutate}
                onSaved={() => record.mutate()}
              />
            </details>
          )}
        </>
      )}
    </WorkspaceShell>
  );
}
