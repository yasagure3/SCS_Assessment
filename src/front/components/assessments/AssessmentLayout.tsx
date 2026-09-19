import type { ReactNode } from "react";
import { Link, NavLink, useParams } from "react-router";
import type { AssessmentDto, StandardDto } from "../../../shared/contracts/assessments";
import type { CaseRecord, Customer } from "../../../shared/contracts/cases";
import { useApi, isAccessError } from "../../lib/api";
import { WorkspaceShell, LoadState } from "../WorkspaceShell";
type View = {
  record: AssessmentDto;
  standard: StandardDto;
  readOnly: boolean;
  assessment: ReturnType<typeof useApi<AssessmentDto>>;
  refresh: () => Promise<void>;
};
export function AssessmentLayout({
  title,
  children,
}: {
  title: string;
  children: (view: View) => ReactNode;
}) {
  const { assessmentId } = useParams();
  const assessment = useApi<AssessmentDto>(`/api/v1/assessments/${assessmentId}`),
    record = useApi<CaseRecord>(assessment.data ? `/api/v1/cases/${assessment.data.caseId}` : null),
    customer = useApi<Customer>(
      assessment.data ? `/api/v1/customers/${assessment.data.customerId}` : null,
    ),
    standard = useApi<StandardDto>(
      assessment.data ? `/api/v1/standards/${assessment.data.standardId}` : null,
    );
  const errors = [assessment.error, record.error, customer.error, standard.error],
    accessDenied = errors.some(isAccessError),
    readOnly = Boolean(record.data?.archivedAt || customer.data?.archivedAt);
  async function refresh() {
    await Promise.all([assessment.mutate(), record.mutate(), customer.mutate(), standard.mutate()]);
  }
  return (
    <WorkspaceShell>
      <Link
        className="breadcrumb"
        to={!accessDenied && record.data ? `/cases/${record.data.id}` : "/customers"}
      >
        ← {!accessDenied ? (record.data?.name ?? "顧客・案件") : "顧客・案件"}
      </Link>
      <LoadState
        error={errors.find(Boolean)}
        loading={[assessment, record, customer, standard].some((item) => item.isLoading)}
        retry={refresh}
      />
      {assessment.data && record.data && customer.data && standard.data && !accessDenied && (
        <>
          <header className="page-heading">
            <div>
              <p className="eyebrow">ASSESSMENT / SCS ★3</p>
              <h1>{title}</h1>
              <p className="subtle">
                {customer.data.name} ／ {record.data.name}
              </p>
            </div>
            <span className="edition-badge">★3 · 81評価基準</span>
          </header>
          <nav className="assessment-nav" aria-label="診断メニュー">
            <NavLink end to={`/assessments/${assessment.data.id}`}>
              現状ダッシュボード
            </NavLink>
            <NavLink to={`/assessments/${assessment.data.id}/criteria`}>評価基準一覧</NavLink>
            <NavLink to={`/assessments/${assessment.data.id}/evidence`}>証跡</NavLink>
          </nav>
          {readOnly && (
            <div className="notice">
              <p>この顧客または案件は保管済みです。診断内容は閲覧専用です。</p>
              <button className="text-button" type="button" onClick={() => void refresh()}>
                保管状態を再確認
              </button>
            </div>
          )}
          {children({
            record: assessment.data,
            standard: standard.data,
            readOnly,
            assessment,
            refresh,
          })}
        </>
      )}
    </WorkspaceShell>
  );
}
