import { Link, useParams } from "react-router";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { ResponseForm } from "../components/assessments/ResponseForm";
import { useWrite } from "../lib/api";
export function CriterionPage() {
  const { criterionId } = useParams(),
    write = useWrite();
  return (
    <AssessmentLayout title={`評価基準 ${criterionId ?? ""}`}>
      {({ record, standard, readOnly, assessment, refresh }) => {
        const criterion = standard.criteria.find((c) => c.id === criterionId),
          response = criterion && record.document.responses[criterion.id];
        if (!criterion || !response)
          return (
            <section className="panel">
              <p role="alert">評価基準が見つかりません。</p>
              <Link to={`/assessments/${record.id}/criteria`}>評価基準一覧へ</Link>
            </section>
          );
        const related = record.document.evidence.filter((item) =>
          item.criterionIds.includes(criterion.id),
        );
        return (
          <>
            <div className="criterion-links">
              <a href="#criterion-evidence">関連する証跡へ</a>
              <a href="#criterion-advice">助言の確認へ</a>
            </div>
            <div className="criterion-detail">
              <section className="panel">
                <p className="eyebrow">OFFICIAL CRITERION</p>
                <h2>公式評価基準 · {criterion.id}</h2>
                <p className="preline">{criterion.officialText}</p>
                <p className="subtle">
                  {criterion.category} ／ {standard.publicationDate}版
                </p>
                <details className="source-details">
                  <summary>要求事項 {criterion.requirementId}</summary>
                  <p className="preline">{criterion.requirementText}</p>
                  <a href={standard.sourceUrl} target="_blank" rel="noreferrer">
                    公式の出典を開く
                  </a>
                </details>
                <div className="original-response">
                  <h2>取込時の原回答（O〜R）</h2>
                  {response.original ? (
                    <>
                      <p className="subtle">
                        {response.original.sheet} · {response.original.row}行
                      </p>
                      <dl>
                        {(
                          [
                            ["O", "自己評価"],
                            ["P", "理由"],
                            ["Q", "根拠および実施する事"],
                            ["R", "補足情報"],
                          ] as const
                        ).map(([key, label]) => (
                          <div key={key}>
                            <dt>
                              {key}列：{label}
                            </dt>
                            <dd data-testid={`original-${key}`}>
                              {response.original![key] || "空欄"}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  ) : (
                    <p className="subtle">この基準の取込原文はありません。</p>
                  )}
                </div>
              </section>
              <section className="panel">
                <h2>現在の回答を編集</h2>
                <p className="subtle">
                  保存時に集計と助言の再確認状態が更新されます。取込時の原回答は保持します。
                </p>
                <ResponseForm
                  key={`${record.id}/${criterion.id}`}
                  record={record}
                  criterionId={criterion.id}
                  readOnly={readOnly}
                  write={write}
                  onSaved={assessment.replace}
                  onRefresh={refresh}
                />
              </section>
            </div>
            <div className="criterion-detail">
              <section className="panel" id="criterion-evidence">
                <h2>関連する証跡</h2>
                {related.length ? (
                  related.map((item) => (
                    <div className="evidence-entry" key={item.id}>
                      <strong>{item.name}</strong>
                      <p className="preline">{item.location}</p>
                      <p>
                        {
                          { unreviewed: "未確認", confirmed: "確認済み", rejected: "差戻し" }[
                            item.reviews[criterion.id].state
                          ]
                        }
                      </p>
                      <p className="preline">{item.reviews[criterion.id].note}</p>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          証跡の参照先を開く
                        </a>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="subtle">証跡はまだ関連付けられていません。</p>
                )}
              </section>
              <section className="panel" id="criterion-advice">
                <h2>助言の確認</h2>
                {response.confirmedAdvice ? (
                  <>
                    <p
                      className={
                        response.confirmedAdvice.basisHash === response.basisHash
                          ? "success-message"
                          : "notice"
                      }
                    >
                      {response.confirmedAdvice.basisHash === response.basisHash
                        ? "担当者が確定した助言"
                        : "回答・根拠が変更されたため、助言の再確認が必要です。"}
                    </p>
                    <p className="preline">{response.confirmedAdvice.content.gap}</p>
                    <ol>
                      {response.confirmedAdvice.content.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    <p className="preline">{response.confirmedAdvice.content.completionCheck}</p>
                  </>
                ) : (
                  <p className="subtle">確定済みの助言はありません。</p>
                )}
                {response.adviceDraft && (
                  <details>
                    <summary>未確定の助言案</summary>
                    <p className="preline">{response.adviceDraft.gap}</p>
                    <ol>
                      {response.adviceDraft.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </details>
                )}
              </section>
            </div>
          </>
        );
      }}
    </AssessmentLayout>
  );
}
