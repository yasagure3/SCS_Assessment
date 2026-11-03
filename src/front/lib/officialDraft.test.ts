import { describe, expect, it } from "vite-plus/test";
import {
  emptyOfficialAnswers,
  officialAnswersSchema,
} from "../../shared/contracts/officialAssessment";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import { createOfficialDraft } from "./officialDraft";

function source() {
  const response = assessmentFixture().record.document.responses["C-1"];
  return {
    "1-2-1-1": {
      ...response,
      status: "yes" as const,
      reason: "担当部署を設定済み",
      basis: "組織規程 第2章",
      supplement: "組織図を更新予定",
    },
  };
}
describe("official drafts from imported self assessment", () => {
  it("uses current edited source text, maps yes/no as candidates and only writes question rows", () => {
    const responses = source();
    const answers = emptyOfficialAnswers();
    const original = JSON.stringify({ responses, answers });
    const draft = createOfficialDraft(responses, answers, emptyOfficialAnswers());
    expect(draft.resultCount).toBe(2);
    expect(draft.answerCount).toBe(1);
    expect(draft.answers.rows["1-2-1-1:1"].result).toBe("適合");
    expect(draft.answers.rows["1-2-1-1:1"].answer).toContain("【自己評価】○");
    for (const value of ["担当部署を設定済み", "組織規程 第2章", "組織図を更新予定"])
      expect(draft.answers.rows["1-2-1-1:1"].answer).toContain(value);
    expect(draft.answers.rows["1-2-1-1:1"].answer).not.toContain("元の理由");
    expect(draft.answers.rows["1-2-1-1:2"].answer).toBe("");
    expect(JSON.stringify({ responses, answers })).toBe(original);
    expect(officialAnswersSchema.safeParse(draft.answers).success).toBe(true);
  });
  it.each(["no", "uncertain", "unanswered"] as const)(
    "maps %s without inventing a confirmed result",
    (status) => {
      const responses = source();
      const draft = createOfficialDraft(
        { "1-2-1-1": { ...responses["1-2-1-1"], status } },
        emptyOfficialAnswers(),
        emptyOfficialAnswers(),
      );
      expect(draft.answers.rows["1-2-1-1:1"].result).toBe(status === "no" ? "不適合" : "");
      expect(draft.answerCount).toBe(1);
    },
  );
  it("protects saved answers, unsaved edits and even whitespace, independently per field", () => {
    const saved = emptyOfficialAnswers();
    saved.rows["1-2-1-1:1"].answer = "保存済みの回答";
    const current = structuredClone(saved);
    current.rows["1-2-1-1:1"].result = "不適合";
    current.rows["1-2-1-1:1"].answer = ""; // An intentional manual deletion is not refilled.
    const draft = createOfficialDraft(source(), current, saved);
    expect(draft.answers.rows["1-2-1-1:1"]).toEqual(current.rows["1-2-1-1:1"]);
    expect(draft.resultCount).toBe(1);
    expect(draft.protectedFields).toBe(2);
    current.rows["1-2-1-1:1"].answer = "　 ";
    expect(
      createOfficialDraft(source(), current, emptyOfficialAnswers()).answers.rows["1-2-1-1:1"]
        .answer,
    ).toBe("　 ");
  });
  it("preserves excluded criteria, organization, scope and exclusion reasons", () => {
    const answers = emptyOfficialAnswers();
    answers.criteria["1-2-1-1"] = { excluded: true, exclusionReason: "既存理由" };
    answers.organization.name = "既存組織";
    answers.scopeAnswers["2."] = "既存範囲";
    const draft = createOfficialDraft(source(), answers, answers);
    expect(draft.answers).toEqual(answers);
    expect(draft.excludedCriteria).toBe(1);
    expect(draft.changes).toEqual([]);
  });
  it("skips absent imported sources, status-only text and oversized text without truncating", () => {
    const response = source()["1-2-1-1"];
    const draft = (value: typeof response) =>
      createOfficialDraft({ "1-2-1-1": value }, emptyOfficialAnswers(), emptyOfficialAnswers());
    expect(draft({ ...response, original: null }).changes).toEqual([]);
    expect(draft({ ...response, reason: "", basis: "　", supplement: "" }).answerCount).toBe(0);
    const long = draft({ ...response, basis: "あ".repeat(8000) });
    expect(long.answerCount).toBe(0);
    expect(long.resultCount).toBe(2);
    expect(long.tooLongCriteria).toEqual(["1-2-1-1"]);
  });
  it("is idempotent and never replaces an edited draft on subsequent generation", () => {
    const saved = emptyOfficialAnswers();
    const first = createOfficialDraft(source(), saved, saved);
    first.answers.rows["1-2-1-1:1"].answer = "確認して修正した回答";
    const second = createOfficialDraft(source(), first.answers, saved);
    expect(second.changes).toEqual([]);
    expect(second.answers).toEqual(first.answers);
  });
});
