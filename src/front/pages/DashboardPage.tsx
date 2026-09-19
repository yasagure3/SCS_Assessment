import { Link, useParams } from "react-router";
import type { AssessmentRecord } from "../../shared/contracts/assessment";
import type { CaseRecord, Customer } from "../../shared/contracts/cases";
import { useApi, isAccessError } from "../lib/api";
import { WorkspaceShell, LoadState } from "../components/WorkspaceShell";
import { ScopeForm } from "../components/cases/ScopeForm";
export function DashboardPage() {
  const { assessmentId } = useParams(),
    assessment = useApi<AssessmentRecord>(`/api/v1/assessments/${assessmentId}`),
    record = useApi<CaseRecord>(assessment.data ? `/api/v1/cases/${assessment.data.caseId}` : null),
    customer = useApi<Customer>(
      assessment.data ? `/api/v1/customers/${assessment.data.customerId}` : null,
    );
  const counts = { yes: 0, uncertain: 0, no: 0, unanswered: 0 };
  if (assessment.data)
    for (const response of Object.values(assessment.data.document.responses))
      counts[response.status]++;
  const error = assessment.error || record.error || customer.error,
    accessDenied = [assessment.error, record.error, customer.error].some(isAccessError),
    readOnly = Boolean(record.data?.archivedAt || customer.data?.archivedAt);
  return (
    <WorkspaceShell>
      <Link
        className="breadcrumb"
        to={!accessDenied && record.data ? `/cases/${record.data.id}` : "/customers"}
      >
        ← {!accessDenied ? (record.data?.name ?? "顧客・案件") : "顧客・案件"}
      </Link>
      <LoadState
        error={error}
        loading={assessment.isLoading || record.isLoading || customer.isLoading}
        retry={() => {
          void assessment.mutate();
          void record.mutate();
          void customer.mutate();
        }}
      />
      {assessment.data && record.data && customer.data && !accessDenied && (
        <>
          <header className="page-heading">
            <div>
              <p className="eyebrow">ASSESSMENT OVERVIEW</p>
              <h1>診断の現状</h1>
              <p className="subtle">
                {customer.data?.name} ／ {record.data?.name}
              </p>
            </div>
            <span className="edition-badge">★3 · 81評価基準</span>
          </header>
          {readOnly && (
            <p className="notice">この顧客または案件は保管済みです。診断内容は閲覧専用です。</p>
          )}
          <div className="summary-grid">
            {(
              [
                ["yes", "○", "満たしている"],
                ["uncertain", "△", "判断微妙"],
                ["no", "✖", "不足"],
                ["unanswered", "—", "未回答"],
              ] as const
            ).map(([key, mark, label]) => (
              <section className={`summary-card status-${key}`} key={key}>
                <p>
                  {mark} {label}
                </p>
                <strong data-testid={`${key}-count`}>{counts[key]}</strong>
                <span> / 81件</span>
              </section>
            ))}
          </div>
          <p className="subtle">
            自己評価の集計です。△を部分点に換算せず、★の取得見込みを示す点数には使用しません。
          </p>
          <section className="panel">
            <h2>対象範囲と診断日</h2>
            <ScopeForm
              key={assessment.data.id}
              record={assessment.data}
              readOnly={readOnly}
              onSaved={assessment.replace}
              onRefresh={assessment.mutate}
            />
          </section>
        </>
      )}
    </WorkspaceShell>
  );
}
