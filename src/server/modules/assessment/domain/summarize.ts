import type { AssessmentDocument, Criterion } from "../../../../shared/contracts/assessment";
import type {
  AssessmentSummary,
  CriterionSet,
  StatusCounts,
} from "../../../../shared/contracts/assessments";
import { DomainError } from "./assessment";
const emptyCounts = (): StatusCounts => ({ yes: 0, uncertain: 0, no: 0, unanswered: 0, total: 0 });
const emptySet = (): CriterionSet => ({ count: 0, criterionIds: [] });
export function summarize(document: AssessmentDocument, criteria: Criterion[]): AssessmentSummary {
  if (criteria.length !== 81) throw new DomainError("INVALID_CRITERIA");
  const counts = { yes: 0, uncertain: 0, no: 0, unanswered: 0, total: 81 as const };
  const categories = new Map<string, StatusCounts & { category: string }>();
  const evidenceSummary = {
    notRegistered: emptySet(),
    unreviewed: emptySet(),
    rejected: emptySet(),
    allConfirmed: emptySet(),
    unconfirmedYes: emptySet(),
  };
  const adviceSummary = { currentConfirmed: 0, draftOnly: 0, stale: 0, none: 0, draftPending: 0 };
  for (const criterion of criteria) {
    const response = document.responses[criterion.id];
    if (!response) throw new DomainError("INVALID_CRITERIA");
    counts[response.status]++;
    const category = categories.get(criterion.category) ?? {
      category: criterion.category,
      ...emptyCounts(),
    };
    category[response.status]++;
    category.total++;
    categories.set(criterion.category, category);
    const evidence = document.evidence.filter((item) => item.criterionIds.includes(criterion.id));
    const states = evidence.map((item) => item.reviews[criterion.id].state);
    const flags = {
      notRegistered: evidence.length === 0,
      unreviewed: states.includes("unreviewed"),
      rejected: states.includes("rejected"),
      allConfirmed: evidence.length > 0 && states.every((state) => state === "confirmed"),
    };
    for (const key of Object.keys(flags) as (keyof typeof flags)[])
      if (flags[key]) evidenceSummary[key].criterionIds.push(criterion.id);
    if (response.status === "yes" && !flags.allConfirmed)
      evidenceSummary.unconfirmedYes.criterionIds.push(criterion.id);
    if (response.confirmedAdvice) {
      if (response.confirmedAdvice.basisHash === response.basisHash)
        adviceSummary.currentConfirmed++;
      else adviceSummary.stale++;
    } else if (response.adviceDraft) adviceSummary.draftOnly++;
    else adviceSummary.none++;
    if (response.adviceDraft) adviceSummary.draftPending++;
  }
  for (const set of Object.values(evidenceSummary)) set.count = set.criterionIds.length;
  return { counts, categoryCounts: [...categories.values()], evidenceSummary, adviceSummary };
}
