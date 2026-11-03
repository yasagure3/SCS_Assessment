import type { AssessmentResponse } from "../../shared/contracts/assessment";
import { officialCatalog, type OfficialAnswers } from "../../shared/contracts/officialAssessment";

export type OfficialDraftChange = {
  key: string;
  criterionId: string;
  result: boolean;
  answer: boolean;
};

/** Local, deterministic suggestions only. The caller must explicitly review and save them. */
export function createOfficialDraft(
  responses: Record<string, AssessmentResponse>,
  current: OfficialAnswers,
  saved: OfficialAnswers,
) {
  const answers = structuredClone(current);
  const changes: OfficialDraftChange[] = [];
  const tooLongCriteria: string[] = [];
  let resultCount = 0,
    answerCount = 0,
    protectedFields = 0,
    excludedCriteria = 0;
  for (const criterion of officialCatalog.standard.criteria) {
    const source = responses[criterion.id];
    if (!source?.original) continue;
    // Never fill an exclusion, including one that the user is currently editing.
    if (current.criteria[criterion.id].excluded || saved.criteria[criterion.id].excluded) {
      excludedCriteria++;
      continue;
    }
    const result = source.status === "yes" ? "適合" : source.status === "no" ? "不適合" : "";
    const status = { yes: "○", no: "✖", uncertain: "△", unanswered: "未回答" }[source.status];
    const sections = [
      ["理由", source.reason],
      ["根拠", source.basis],
      ["補足", source.supplement],
    ]
      .filter(([, value]) => value.trim())
      .map(([label, value]) => `【${label}】\n${value.trim()}`);
    const text = sections.length ? [`【自己評価】${status}`, ...sections].join("\n\n") : "";
    for (const row of officialCatalog.rows.filter((r) => r.criterionId === criterion.id)) {
      const change = { key: row.key, criterionId: criterion.id, result: false, answer: false };
      const target = answers.rows[row.key];
      // Check both saved values and current form edits, not just trimmed text.
      if (target.result !== "" || saved.rows[row.key].result !== "") protectedFields++;
      else if (result) {
        target.result = result;
        change.result = true;
        resultCount++;
      }
      if (row.question) {
        if (target.answer !== "" || saved.rows[row.key].answer !== "") protectedFields++;
        else if (text.length > 8000) {
          if (!tooLongCriteria.includes(criterion.id)) tooLongCriteria.push(criterion.id);
        } else if (text) {
          target.answer = text;
          change.answer = true;
          answerCount++;
        }
      }
      if (change.result || change.answer) changes.push(change);
    }
  }
  return {
    answers,
    changes,
    resultCount,
    answerCount,
    protectedFields,
    excludedCriteria,
    tooLongCriteria,
  };
}
