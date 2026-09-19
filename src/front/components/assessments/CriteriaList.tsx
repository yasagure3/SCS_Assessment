import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  AssessmentDto,
  StandardDto,
  Status,
  EvidenceState,
} from "../../../shared/contracts/assessments";
import { statusLabels, evidenceLabels } from "./labels";
export function CriteriaList({
  record,
  standard,
}: {
  record: AssessmentDto;
  standard: StandardDto;
}) {
  const [params] = useSearchParams();
  const [text, setText] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState(params.get("status") ?? ""),
    [evidence, setEvidence] = useState(params.get("evidenceState") ?? "");
  const rows = standard.criteria.filter((criterion) => {
    const response = record.document.responses[criterion.id];
    return (
      (!category || criterion.category === category) &&
      (!status || response.status === status) &&
      (!evidence ||
        record.evidenceSummary[evidence as EvidenceState | "unconfirmedYes"]?.criterionIds.includes(
          criterion.id,
        )) &&
      [
        criterion.id,
        criterion.officialText,
        criterion.requirementText,
        response.reason,
        response.basis,
        response.plannedWork,
        response.supplement,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(text.toLocaleLowerCase())
    );
  });
  return (
    <section className="panel">
      <div className="criteria-filters data-form">
        <label>
          評価基準を検索
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="基準ID・公式文・編集した記述"
          />
        </label>
        <label>
          大分類
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">すべて</option>
            {record.categoryCounts.map((c) => (
              <option key={c.category}>{c.category}</option>
            ))}
          </select>
        </label>
        <label>
          自己評価で絞り込み
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">すべて</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ({record.counts[value as Status]})
              </option>
            ))}
          </select>
        </label>
        <label>
          証跡の確認
          <select value={evidence} onChange={(e) => setEvidence(e.target.value)}>
            <option value="">すべて</option>
            {Object.entries(evidenceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="subtle">{rows.length} / 81件</p>
      <div className="assessment-table-wrap">
        <table className="assessment-table">
          <thead>
            <tr>
              <th>基準No.</th>
              <th>公式評価基準</th>
              <th>大分類</th>
              <th>自己評価</th>
              <th>証跡</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <th>
                  <Link
                    to={`/assessments/${record.id}/criteria/${c.id}`}
                    aria-label={`${c.id} 詳細`}
                  >
                    {c.id}
                  </Link>
                </th>
                <td className="criterion-text">{c.officialText}</td>
                <td>{c.category}</td>
                <td>
                  <span className={`status-label status-${record.document.responses[c.id].status}`}>
                    {statusLabels[record.document.responses[c.id].status]}
                  </span>
                </td>
                <td>
                  {(Object.keys(evidenceLabels) as (EvidenceState | "unconfirmedYes")[])
                    .filter(
                      (key) =>
                        key !== "unconfirmedYes" &&
                        record.evidenceSummary[key].criterionIds.includes(c.id),
                    )
                    .map((key) => (
                      <p key={key}>{evidenceLabels[key]}</p>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="empty-state">
          <h3>条件に一致する評価基準がありません</h3>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setText("");
              setCategory("");
              setStatus("");
              setEvidence("");
            }}
          >
            条件をクリア
          </button>
        </div>
      )}
    </section>
  );
}
