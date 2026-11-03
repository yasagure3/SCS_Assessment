import { describe, expect, it } from "vite-plus/test";
import { emptyOfficialAnswers, officialCatalog } from "../../shared/contracts/officialAssessment";
import { getOfficialProgress, supportsOfficialAnswers } from "./officialProgress";

describe("official answer coverage", () => {
  it("counts every official row and only the questions that exist", () => {
    const progress = getOfficialProgress();
    expect(progress.results).toEqual({ filled: 0, total: 108 });
    expect(progress.questions).toEqual({ filled: 0, total: 89 });
    expect(progress.organization.filled).toBe(0);
    expect(progress.organization.total).toBe(4);
    expect(progress.scope.total).toBe(8);
    expect(progress.scopePending).toBe(3);
    expect(progress.incompleteCriteria).toBe(81);
    expect(progress.complete).toBe(false);
  });
  it("does not confuse filled nonconformity with a missing answer or conformity", () => {
    const answers = emptyOfficialAnswers();
    answers.rows["1-2-1-1:1"] = { result: "適合", answer: "規程第2章" };
    answers.rows["1-2-1-1:2"].result = "不適合";
    const progress = getOfficialProgress(answers);
    expect(progress.criteria[0]).toMatchObject({ complete: true, conforming: 1, nonconforming: 1 });
    expect(progress.questions).toEqual({ filled: 1, total: 89 });
    expect(progress.incompleteCriteria).toBe(80);
    expect(progress.nonconformingCriteria).toBe(1);
    answers.rows["1-2-1-1:1"].answer = " \n　";
    expect(getOfficialProgress(answers).criteria[0].complete).toBe(false);
  });
  it("requires an exclusion reason and ignores retained results on excluded criteria", () => {
    const answers = emptyOfficialAnswers();
    answers.criteria["1-2-1-1"].excluded = true;
    answers.rows["1-2-1-1:2"].result = "不適合";
    expect(getOfficialProgress(answers).criteria[0].missingReason).toBe(true);
    answers.criteria["1-2-1-1"].exclusionReason = "対象外の条件を確認";
    const progress = getOfficialProgress(answers);
    expect(progress.criteria[0]).toMatchObject({
      complete: true,
      excluded: true,
      nonconforming: 0,
    });
    expect(progress.results).toEqual({ filled: 0, total: 106 });
    expect(progress.questions).toEqual({ filled: 0, total: 88 });
    expect(progress.excludedCriteria).toBe(1);
    expect(progress.nonconformingCriteria).toBe(0);
  });
  it.each([
    ["a.法人全体", 8, []],
    ["b.法人のうち一部(事業部等)", 9, ["1-1."]],
    ["c.複数法人を含む企業グループ", 10, ["1-2.", "1-3."]],
  ])("applies scope conditions for %s", (unit, total, conditional) => {
    const answers = emptyOfficialAnswers();
    answers.scopeAnswers["1."] = unit;
    answers.scopeAnswers["1-1."] = "前回の入力";
    const progress = getOfficialProgress(answers);
    expect(progress.scope.total).toBe(total);
    expect(progress.scopePending).toBe(0);
    expect(
      progress.scopeItems
        .filter((q) => q.id.startsWith("1-") && q.applicability === "required")
        .map((q) => q.id),
    ).toEqual(conditional);
    expect(progress.scope.filled).toBe(unit.startsWith("b.") ? 2 : 1);
  });
  it("reports all fields filled without calling an exclusion conforming", () => {
    const answers = emptyOfficialAnswers();
    answers.organization = { name: "組織", address: "住所", unit: "法人全体", scope: "基盤" };
    for (const question of officialCatalog.scopeQuestions)
      answers.scopeAnswers[question.id] = "記載あり";
    answers.scopeAnswers["1."] = "a.法人全体";
    for (const row of officialCatalog.rows) {
      answers.rows[row.key] = { result: "適合", answer: row.question ? "記載あり" : "" };
    }
    answers.criteria["1-2-1-1"] = { excluded: true, exclusionReason: "理由あり" };
    const original = JSON.stringify(answers);
    const progress = getOfficialProgress(answers);
    expect(progress.complete).toBe(true);
    expect(progress.conformingCriteria).toBe(80);
    expect(progress.excludedCriteria).toBe(1);
    expect(progress.categories.reduce((sum, c) => sum + c.total, 0)).toBe(81);
    expect(JSON.stringify(answers)).toBe(original);
  });
  it("only accepts the exact official criterion ID set, including imported masters", () => {
    const responses = Object.fromEntries(officialCatalog.standard.criteria.map((c) => [c.id, {}]));
    expect(supportsOfficialAnswers(responses)).toBe(true);
    delete responses["1-2-1-1"];
    responses["custom"] = {};
    expect(supportsOfficialAnswers(responses)).toBe(false);
  });
});
