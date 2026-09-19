import { Link } from "react-router";
import { ScopeForm } from "../components/cases/ScopeForm";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { statusLabels, evidenceLabels } from "../components/assessments/labels";
import type { Status, EvidenceState } from "../../shared/contracts/assessments";
export function DashboardPage() {
  return (
    <AssessmentLayout title="診断の現状">
      {({ record, standard, readOnly, assessment, refresh }) => (
        <>
          {!record.document.importInfo && (
            <p className="notice">
              Excelは未取込です。原回答がない基準は、公式文を確認して手動で記入できます。
            </p>
          )}
          <div className="summary-grid">
            {(Object.keys(statusLabels) as Status[]).map((key) => (
              <Link
                className={`summary-card status-${key}`}
                key={key}
                to={`/assessments/${record.id}/criteria?status=${key}`}
              >
                <p>{statusLabels[key]}</p>
                <strong data-testid={`${key}-count`}>{record.counts[key]}</strong>
                <span> / 81件</span>
              </Link>
            ))}
          </div>
          <p className="subtle">
            自己評価○の割合 {Math.round((record.counts.yes / 81) * 100)}%（{record.counts.yes} /
            81件）。△を部分点に換算せず、★の取得見込みを示す点数には使用しません。
          </p>
          <div className="assessment-overview">
            <section className="panel">
              <h2>評価基準マップ</h2>
              <p className="subtle">1マス＝1評価基準。選択して原文と現在の回答を確認できます。</p>
              {record.categoryCounts.map((category) => (
                <div className="criterion-map-group" key={category.category}>
                  <h3>{category.category}</h3>
                  <p className="subtle">
                    ○ {category.yes} ／ △ {category.uncertain} ／ ✖ {category.no} ／ 未回答{" "}
                    {category.unanswered} · 計 {category.total}件
                  </p>
                  <div className="criterion-map">
                    {standard.criteria
                      .filter((c) => c.category === category.category)
                      .map((c) => (
                        <Link
                          className={`criterion-tile status-${record.document.responses[c.id].status}`}
                          key={c.id}
                          to={`/assessments/${record.id}/criteria/${c.id}`}
                          aria-label={`${c.id} ${statusLabels[record.document.responses[c.id].status]}`}
                          title={`${c.id} ${c.officialText}`}
                        >
                          <small>{c.id}</small>
                          <strong>
                            {statusLabels[record.document.responses[c.id].status].split(" ")[0]}
                          </strong>
                        </Link>
                      ))}
                  </div>
                </div>
              ))}
            </section>
            <aside>
              <section className="panel">
                <h2>証跡の確認</h2>
                {(Object.keys(evidenceLabels) as (EvidenceState | "unconfirmedYes")[]).map(
                  (key) => (
                    <Link
                      className="summary-row"
                      key={key}
                      to={`/assessments/${record.id}/criteria?evidenceState=${key}`}
                    >
                      <span>{evidenceLabels[key]}</span>
                      <strong>{record.evidenceSummary[key].count}件</strong>
                    </Link>
                  ),
                )}
                <p className="subtle">
                  未確認と差戻しは重複します。証跡の確認だけで自己評価を変更しません。
                </p>
              </section>
              <section className="panel">
                <h2>助言の確認状況</h2>
                {(
                  [
                    ["currentConfirmed", "確定済み"],
                    ["draftOnly", "下書きのみ"],
                    ["stale", "再確認が必要"],
                    ["none", "助言なし"],
                    ["draftPending", "未確定の案あり"],
                  ] as const
                ).map(([key, label]) => (
                  <p className="summary-row" key={key}>
                    <span>{label}</span>
                    <strong>{record.adviceSummary[key]}件</strong>
                  </p>
                ))}
                <p className="subtle">未確定の案は、確定済み・再確認の助言と併存します。</p>
              </section>
            </aside>
          </div>
          <section className="panel">
            <h2>対象範囲と診断日</h2>
            <ScopeForm
              key={record.id}
              record={record}
              readOnly={readOnly}
              onSaved={assessment.replace}
              onRefresh={refresh}
            />
          </section>
        </>
      )}
    </AssessmentLayout>
  );
}
