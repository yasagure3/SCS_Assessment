import { useState } from "react";
import { Link } from "react-router";
import type { AssessmentDto } from "../../shared/contracts/assessments";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { getOfficialProgress, supportsOfficialAnswers } from "../lib/officialProgress";
import { evidenceLabels } from "../components/assessments/labels";

export function OfficialStatusView({ record }: { record: AssessmentDto }) {
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const progress = getOfficialProgress(record.document.officialAnswers);
  const base = `/assessments/${record.id}`;
  const official = (criterion: string, target = "") =>
    `${base}/official?criterion=${criterion}${target ? `#official-${target}` : ""}`;
  const visible = progress.criteria.filter(
    (c) =>
      (!category || category === c.category) &&
      (!query.trim() ||
        `${c.id} ${c.officialText} ${c.rows.map((r) => `${r.conformity} ${r.question}`).join(" ")}`.includes(
          query.trim(),
        )) &&
      (filter === "all" ||
        (filter === "missing" && !c.complete) ||
        (filter === "nonconforming" && c.nonconforming > 0) ||
        (filter === "excluded" && c.excluded) ||
        (filter === "complete" && c.complete)),
  );
  return (
    <div className="official-status">
      <section className="panel official-status-intro">
        <p className="eyebrow">OFFICIAL SHEET / ★3</p>
        <h2>確認依頼に向けて、記載漏れを確認</h2>
        <p>
          81評価基準の判定・質問への回答と、登録組織・適用範囲を確認できます。
          保存済みの公式回答を表示しています。自己評価Excelの○・△・✖はこの集計には含みません。
        </p>
        <div className="official-status-verdict">
          <strong>
            {progress.complete
              ? "入力対象の欄はすべて記入済みです"
              : "記入が必要な欄が残っています"}
          </strong>
          <span>
            不適合のある評価基準：{progress.nonconformingCriteria}件 ／ 対象外：
            {progress.excludedCriteria}件
          </span>
        </div>
        <p className="subtle">
          記入済みは文字・判定の入力有無です。内容の十分性、対象外の妥当性、★3取得の可否は自動判定しません。
          適用される全基準の充足について、★3確認責任者の確認が必要です。
          <a
            href="https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/SCS-410-self-assess-guide-v1.0.pdf"
            target="_blank"
            rel="noreferrer"
          >
            自己評価等ガイド
          </a>
        </p>
        {!record.document.officialAnswers && (
          <p className="notice">
            公式回答はまだ保存されていません。公式シート回答画面で入力・保存してください。
          </p>
        )}
        <Link className="button primary" to={official("organization")}>
          公式シート回答・Excel出力を開く
        </Link>
      </section>

      <div className="summary-grid official-status-metrics">
        {(
          [
            ["判定の入力", progress.results, "対象外を除く適合基準"],
            ["質問への回答", progress.questions, "対象外・質問のない行を除く"],
            ["登録組織", progress.organization, "名称・住所・取得単位・適用範囲"],
            [
              "適用範囲の質問",
              progress.scope,
              progress.scopePending
                ? "取得単位の選択後に追加質問を確定"
                : "取得単位に応じた質問のみ",
            ],
          ] as const
        ).map(([label, count, help]) => (
          <div className="summary-card" key={label}>
            <p>{label}</p>
            <strong>{count.filled}</strong>
            <span> / {count.total}件</span>
            <progress aria-label={label} value={count.filled} max={count.total || 1} />
            <small>{help}</small>
          </div>
        ))}
      </div>

      <section className="panel">
        <details>
          <summary className="official-section-summary">
            登録組織・適用範囲の記入欄
            <span>
              未記入{" "}
              {progress.organization.total -
                progress.organization.filled +
                progress.scope.total -
                progress.scope.filled}
              件{progress.scopePending > 0 && ` ／ 条件未確定 ${progress.scopePending}件`}
            </span>
          </summary>
          <p className="subtle">
            取得単位に応じて質問1-1〜1-3の要否を判定します。資産の一覧などを尋ねる質問で該当するものがない場合は、その旨を回答欄に記載してください。
          </p>
          <ul className="official-field-list">
            {progress.organizationItems.map((item) => (
              <li key={item.key}>
                <Link to={official("organization", `organization-${item.key}`)}>{item.label}</Link>
                <span>{item.filled ? "記入済み" : "未記入"}</span>
              </li>
            ))}
            {progress.scopeItems.map((item) => (
              <li key={item.id}>
                <Link to={official("organization", `scope-${item.id}`)}>
                  {item.id} {item.question}
                </Link>
                <span>
                  {item.applicability === "pending"
                    ? "取得単位の選択待ち"
                    : item.applicability === "notApplicable"
                      ? "回答不要"
                      : item.filled
                        ? "記入済み"
                        : "未記入"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="panel">
        <h2>評価基準ごとの記載状況</h2>
        <p className="subtle">
          基準を展開すると、必要な記載内容と保存済み回答を比較できます。証跡は評価基準一覧で確認・紐づけできます。
        </p>
        <div className="official-status-filters">
          <label>
            表示する状況
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">すべて（81件）</option>
              <option value="missing">未記入あり（{progress.incompleteCriteria}件）</option>
              <option value="nonconforming">
                不適合あり（{progress.nonconformingCriteria}件）
              </option>
              <option value="excluded">対象外（{progress.excludedCriteria}件）</option>
              <option value="complete">記入済み（{81 - progress.incompleteCriteria}件）</option>
            </select>
          </label>
          <label>
            カテゴリ
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">すべてのカテゴリ</option>
              {progress.categories.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category}（記入済み {c.complete}/{c.total}）
                </option>
              ))}
            </select>
          </label>
          <label>
            評価基準ID・内容で検索
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例：4-4-4-1、規程"
            />
          </label>
        </div>
        <p className="subtle" role="status">
          {visible.length} /
          81件を表示。未記入と不適合は重複する場合があります。記入済みには対象外理由の記入を含みます。
        </p>
        <div className="official-criteria-list">
          {visible.map((c) => {
            const evidence = (
              ["rejected", "unreviewed", "allConfirmed", "notRegistered"] as const
            ).find((state) => record.evidenceSummary[state].criterionIds.includes(c.id));
            return (
              <article className="official-criterion" key={c.id} aria-label={`評価基準 ${c.id}`}>
                <div className="official-criterion-heading">
                  <strong>{c.id}</strong>
                  <span className={`official-status-tag ${c.complete ? "filled" : "missing"}`}>
                    {c.complete ? "記入済み" : "未記入あり"}
                  </span>
                  {c.nonconforming > 0 && (
                    <span className="official-status-tag nonconforming">不適合あり</span>
                  )}
                  {c.excluded && <span className="official-status-tag">対象外</span>}
                  <Link
                    className="official-answer-link"
                    aria-label={`${c.id} の公式回答を開く`}
                    to={official(c.id)}
                  >
                    公式回答を開く →
                  </Link>
                </div>
                <details>
                  <summary className="official-criterion-description">
                    <span>{c.officialText}</span>
                    <small>基準・質問・回答を確認</small>
                  </summary>
                  <p className="subtle">{c.category}</p>
                  {c.excluded && (
                    <p className="preline">
                      対象外理由：{c.exclusionReason || "未記入"}
                      。対象外の条件は自己評価等ガイドで確認してください。
                    </p>
                  )}
                  {c.rows.map((row) => (
                    <div key={row.key} className="official-required-row">
                      <h3>適合基準 {row.number}</h3>
                      <p className="preline">{row.conformity}</p>
                      <details>
                        <summary>自己評価方法・確認する証跡</summary>
                        <p className="preline">{row.method}</p>
                      </details>
                      <p>判定：{c.excluded ? "対象外（集計対象外）" : row.result || "未記入"}</p>
                      {row.question ? (
                        <>
                          <h4>必要な記載内容</h4>
                          <p className="preline">{row.question}</p>
                          <h4>{c.excluded ? "保存済みの回答（集計対象外）" : "保存済みの回答"}</h4>
                          <p className="official-saved-answer preline">
                            {row.answer.trim() ? row.answer : "未記入"}
                          </p>
                        </>
                      ) : (
                        <p className="subtle">この行に質問への回答欄はありません。</p>
                      )}
                      <Link to={official(c.id, `row-${row.key}`)}>
                        適合基準 {row.number} の回答欄へ
                      </Link>
                    </div>
                  ))}
                </details>
                <div className="official-criterion-foot">
                  <p>
                    {c.excluded
                      ? `対象外理由：${c.missingReason ? "未記入" : "記入済み"}`
                      : `判定 ${c.results.filled}/${c.results.total}件 ／ 質問 ${c.questions.filled}/${c.questions.total}件 ／ 適合 ${c.conforming}・不適合 ${c.nonconforming}`}
                  </p>
                  <Link to={`${base}/criteria/${c.id}`}>
                    証跡：{evidence ? evidenceLabels[evidence] : "確認する"}
                  </Link>
                </div>
              </article>
            );
          })}
          {visible.length === 0 && (
            <p className="empty-state">条件に一致する評価基準はありません。</p>
          )}
        </div>
      </section>
      <p className="subtle">
        記入後は回答内容と証跡を確認し、公式Excelを出力してください。確認責任者の記名・自己適合宣言はExcel上で確認・記入します。この画面ではその完了状況を管理しません。
      </p>
    </div>
  );
}

export function OfficialStatusPage() {
  return (
    <AssessmentLayout title="公式回答状況">
      {({ record }) =>
        supportsOfficialAnswers(record.document.responses) ? (
          <OfficialStatusView key={record.id} record={record} />
        ) : (
          <section className="panel">
            <p>
              取込マスタの評価項目IDが公式テンプレートと一致しません。公式シートへの対応関係を確認してください。
            </p>
          </section>
        )
      }
    </AssessmentLayout>
  );
}
