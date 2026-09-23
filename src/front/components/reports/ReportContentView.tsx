import type { ReportContent, ReportLimitations } from "../../../shared/contracts/reports";
const statusLabels = {
  yes: "○ 満たしている",
  uncertain: "△ 判断微妙",
  no: "✖ 不足",
  unanswered: "未回答",
};
const limitationLabels: Record<keyof ReportLimitations, string> = {
  unanswered: "未回答",
  notRegistered: "証跡未登録",
  unreviewed: "証跡未確認",
  rejected: "証跡差戻し",
  unconfirmedAdvice: "助言未確定",
  staleAdvice: "再確認が必要な助言",
  draftPendingIds: "新しい下書きあり",
};
const adviceLabels = {
  current: "確定済み",
  none: "助言なし",
  unconfirmed: "未確定のため本文なし",
  stale: "再確認が必要なため本文なし",
};
const reviewLabels = { confirmed: "確認済み", unreviewed: "未確認", rejected: "差戻し" };
export function ReportContentView({ content }: { content: ReportContent }) {
  return (
    <div className="report-content">
      <div className="report-cover">
        <p className="eyebrow">SCS ★3 / 診断報告</p>
        <h3>
          {content.customer.name} ／ {content.case.name}
        </h3>
        <p>
          診断日: {content.assessment.diagnosisDate ?? "未入力"} · 制度公表日:{" "}
          {content.standard.publicationDate}
        </p>
        <dl className="report-scope">
          {Object.entries(content.assessment.scope).map(([key, value]) => (
            <div key={key}>
              <dt>
                {
                  { companies: "会社", sites: "拠点", departments: "部署", systems: "システム" }[
                    key
                  ]
                }
              </dt>
              <dd>{value || "未入力"}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="report-counts" aria-label="自己評価の集計">
        {(["yes", "uncertain", "no", "unanswered"] as const).map((key) => (
          <div key={key}>
            <span>{statusLabels[key]}</span>
            <strong>
              {content.counts[key]}
              <small> / 81</small>
            </strong>
          </div>
        ))}
      </div>
      <details>
        <summary>分類ごとの集計</summary>
        <div className="assessment-table-wrap">
          <table className="assessment-table">
            <thead>
              <tr>
                <th>分類</th>
                <th>○</th>
                <th>△</th>
                <th>✖</th>
                <th>未回答</th>
                <th>計</th>
              </tr>
            </thead>
            <tbody>
              {content.categoryCounts.map((category) => (
                <tr key={category.category}>
                  <th>{category.category}</th>
                  <td>{category.yes}</td>
                  <td>{category.uncertain}</td>
                  <td>{category.no}</td>
                  <td>{category.unanswered}</td>
                  <td>{category.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <h3>主要課題</h3>
      {content.majorIssues.length ? (
        <ol>
          {content.majorIssues.map((id) => (
            <li key={id}>
              <strong>{id}</strong>{" "}
              {content.standard.criteria.find((c) => c.id === id)?.officialText}
            </li>
          ))}
        </ol>
      ) : (
        <p className="subtle">主要課題は選択されていません。</p>
      )}
      <h3>留意事項</h3>
      <div className="report-limitations">
        {(Object.keys(limitationLabels) as (keyof ReportLimitations)[]).map((key) => (
          <details key={key}>
            <summary>
              {limitationLabels[key]}: {content.limitations[key].length}件
            </summary>
            <p className="report-ids">{content.limitations[key].join("、") || "該当なし"}</p>
          </details>
        ))}
      </div>
      {content.limitations.draftPendingIds.length > 0 && (
        <p className="notice">確定済み版を出力。新しい下書きは含めない</p>
      )}
      <details className="report-all-criteria">
        <summary>全{content.standard.criteria.length}基準の報告内容を開く</summary>
        {content.standard.criteria.map((criterion) => {
          const response = content.responses[criterion.id];
          return (
            <details key={criterion.id}>
              <summary>
                {criterion.id} · {response ? statusLabels[response.status] : "未回答"}
              </summary>
              <p className="preline">{criterion.requirementText}</p>
              <p className="preline">{criterion.officialText}</p>
              {response && (
                <>
                  <dl>
                    {(["reason", "basis", "plannedWork", "supplement"] as const).map((key) => (
                      <div key={key}>
                        <dt>
                          {
                            {
                              reason: "理由",
                              basis: "根拠",
                              plannedWork: "今後の作業",
                              supplement: "補足",
                            }[key]
                          }
                        </dt>
                        <dd className="preline">{response[key] || "記載なし"}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>助言: {adviceLabels[response.adviceState]}</p>
                  {response.confirmedAdvice && (
                    <div className="notice">
                      <p>{response.confirmedAdvice.content.gap}</p>
                      <ol>
                        {response.confirmedAdvice.content.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                      <p>証跡例: {response.confirmedAdvice.content.evidenceExamples.join("、")}</p>
                      <p>完了条件: {response.confirmedAdvice.content.completionCheck}</p>
                      <p>{response.confirmedAdvice.content.notes}</p>
                      <p>
                        確認者: {response.confirmedAdvice.reviewer.email} /{" "}
                        {response.confirmedAdvice.at}
                      </p>
                    </div>
                  )}
                  {response.original && (
                    <details>
                      <summary>取込時の原文 O〜R</summary>
                      {(["O", "P", "Q", "R"] as const).map((key) => (
                        <p key={key} className="preline">
                          {key}: {response.original![key]}
                        </p>
                      ))}
                    </details>
                  )}
                </>
              )}
              {content.evidence
                .filter((e) => e.criterionIds.includes(criterion.id))
                .map((e) => (
                  <div key={e.id}>
                    <h4>証跡: {e.name}</h4>
                    <p>
                      {e.location} / {reviewLabels[e.reviews[criterion.id].state]}
                    </p>
                    {e.url && <p className="report-ids">URL: {e.url}</p>}
                    <p>ファイル: {e.file?.originalName ?? "なし"}</p>
                    <p>
                      確認者:{" "}
                      {e.reviewers.find((r) => r.id === e.reviews[criterion.id].by)?.email ??
                        "未確認"}
                    </p>
                  </div>
                ))}
              {content.tasks
                .filter((task) => task.criterionId === criterion.id)
                .map((task) => (
                  <div key={task.id}>
                    <h4>課題: {task.title}</h4>
                    <p>
                      {task.ownerName} / {task.dueDate} /{" "}
                      {
                        {
                          todo: "未着手",
                          doing: "進行中",
                          awaiting_review: "確認待ち",
                          done: "完了",
                        }[task.state]
                      }
                    </p>
                    <p>完了条件: {task.completionCondition}</p>
                    <p>結果: {task.result || "記載なし"}</p>
                  </div>
                ))}
            </details>
          );
        })}
      </details>
    </div>
  );
}
