import {
  emptyOfficialAnswers,
  officialCatalog as catalog,
  type OfficialAnswers,
} from "../../shared/contracts/officialAssessment";

export const organizationFields = [
  ["name", "登録組織の名称"],
  ["address", "登録組織の住所"],
  ["unit", "取得単位"],
  ["scope", "適用範囲"],
] as const;

export function supportsOfficialAnswers(responses: Record<string, unknown>) {
  return (
    Object.keys(responses).length === catalog.standard.criteria.length &&
    catalog.standard.criteria.every((c) => Object.hasOwn(responses, c.id))
  );
}

export function getOfficialProgress(answers: OfficialAnswers = emptyOfficialAnswers()) {
  const organizationItems = organizationFields.map(([key, label]) => ({
    key,
    label,
    filled: Boolean(answers.organization[key].trim()),
  }));
  // These conditions are printed in the pinned template, scope sheet D4:D6.
  const unit = answers.scopeAnswers["1."];
  const validUnit = catalog.scopeQuestions[0].options?.includes(unit);
  const scopeItems = catalog.scopeQuestions.map((question) => {
    const conditionalUnit =
      question.id === "1-1."
        ? "b.法人のうち一部(事業部等)"
        : ["1-2.", "1-3."].includes(question.id)
          ? "c.複数法人を含む企業グループ"
          : null;
    const applicability = !conditionalUnit
      ? "required"
      : !validUnit
        ? "pending"
        : unit === conditionalUnit
          ? "required"
          : "notApplicable";
    return {
      ...question,
      applicability,
      filled:
        question.id === "1."
          ? Boolean(validUnit)
          : Boolean(answers.scopeAnswers[question.id]?.trim()),
    };
  });
  const criteria = catalog.standard.criteria.map((criterion) => {
    const exclusion = answers.criteria[criterion.id];
    const excluded = exclusion?.excluded ?? false;
    const rows = catalog.rows
      .filter((row) => row.criterionId === criterion.id)
      .map((row, index) => {
        const answer = answers.rows[row.key];
        return {
          ...row,
          number: index + 1,
          result: answer?.result ?? "",
          answer: answer?.answer ?? "",
          missingResult: !excluded && !answer?.result,
          missingAnswer: !excluded && Boolean(row.question) && !answer?.answer.trim(),
        };
      });
    const active = excluded ? [] : rows;
    const questions = active.filter((row) => row.question);
    const missingReason = excluded && !exclusion.exclusionReason.trim();
    const complete =
      !missingReason && rows.every((row) => !row.missingResult && !row.missingAnswer);
    return {
      ...criterion,
      rows,
      excluded,
      missingReason,
      complete,
      exclusionReason: exclusion?.exclusionReason ?? "",
      results: { filled: active.filter((r) => !r.missingResult).length, total: active.length },
      questions: {
        filled: questions.filter((r) => !r.missingAnswer).length,
        total: questions.length,
      },
      conforming: active.filter((r) => r.result === "適合").length,
      nonconforming: active.filter((r) => r.result === "不適合").length,
    };
  });
  const sum = (key: "results" | "questions") => ({
    filled: criteria.reduce((n, c) => n + c[key].filled, 0),
    total: criteria.reduce((n, c) => n + c[key].total, 0),
  });
  const organization = {
    filled: organizationItems.filter((i) => i.filled).length,
    total: organizationItems.length,
  };
  const requiredScope = scopeItems.filter((i) => i.applicability === "required");
  const scope = {
    filled: requiredScope.filter((i) => i.filled).length,
    total: requiredScope.length,
  };
  const scopePending = scopeItems.filter((i) => i.applicability === "pending").length;
  const incompleteCriteria = criteria.filter((c) => !c.complete).length;
  return {
    criteria,
    organization,
    organizationItems,
    scope,
    scopeItems,
    scopePending,
    results: sum("results"),
    questions: sum("questions"),
    incompleteCriteria,
    excludedCriteria: criteria.filter((c) => c.excluded).length,
    nonconformingCriteria: criteria.filter((c) => c.nonconforming > 0).length,
    conformingCriteria: criteria.filter((c) => !c.excluded && c.conforming === c.results.total)
      .length,
    complete:
      incompleteCriteria === 0 &&
      organization.filled === organization.total &&
      scope.filled === scope.total &&
      scopePending === 0,
    categories: [...new Set(criteria.map((c) => c.category))].map((category) => {
      const members = criteria.filter((c) => c.category === category);
      return {
        category,
        total: members.length,
        complete: members.filter((c) => c.complete).length,
      };
    }),
  };
}
