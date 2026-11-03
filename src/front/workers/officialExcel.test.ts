// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createOfficialExcel, officialCellValues } from "./officialExcel";
import {
  emptyOfficialAnswers,
  officialCatalog,
  officialAnswersSchema,
} from "../../shared/contracts/officialAssessment";

const template = new Uint8Array(readFileSync(`public/official/${officialCatalog.template.file}`));
describe("official template export", () => {
  it("writes distinct answers by ID, keeps other package parts and every non-input cell byte-identical", async () => {
    const answers = emptyOfficialAnswers();
    answers.organization.name = "検証株式会社";
    answers.scopeAnswers["1."] = "a.法人全体";
    answers.scopeAnswers["2."] = "本社・営業所\n社内IT基盤";
    answers.rows["1-2-1-1:1"] = {
      result: "適合",
      answer: '=HYPERLINK("https://example.invalid") & <規程>\n_x0041_',
    };
    answers.rows["1-2-1-1:2"].result = "不適合";
    answers.criteria["3-1-3-1"] = {
      excluded: true,
      exclusionReason: "外部情報サービスを使用していない",
    };
    answers.rows["7-1-1-1:2"] = { result: "適合", answer: "復旧手順2026 第8章" };
    const bytes = await createOfficialExcel(template, answers);
    const before = unzipSync(template),
      after = unzipSync(bytes);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const changed = officialCellValues(answers);
    for (const name of Object.keys(before)) {
      if (!(name in changed)) expect(after[name], name).toEqual(before[name]);
      else {
        let original = strFromU8(before[name]),
          output = strFromU8(after[name]);
        const cells = changed[name as keyof typeof changed];
        for (const address of Object.keys(cells)) {
          const re = new RegExp(
            `<c\\b[^>]*\\br="${address}"[^>]*?(?:\\s*\\/>|>[\\s\\S]*?<\\/c>)`,
            "g",
          );
          expect([...output.matchAll(re)], address).toHaveLength(1);
          original = original.replace(re, "");
          output = output.replace(re, "");
        }
        expect(output, name).toBe(original);
      }
    }
    const xml = strFromU8(after["xl/worksheets/sheet2.xml"]);
    expect(xml).toMatch(/<c r="P19"[^>]*t="inlineStr"><is><t xml:space="preserve">適合/);
    expect(xml).toMatch(/<c r="P20"[^>]*t="inlineStr"><is><t xml:space="preserve">不適合/);
    expect(xml).toContain(
      '=HYPERLINK("https://example.invalid") &amp; &lt;規程&gt;\n_x005F_x0041_',
    );
    expect(xml).toMatch(/<c r="R126"[^>]*><is><t xml:space="preserve">復旧手順2026 第8章/);
  });
  it("rejects a different template, unknown keys, missing keys, invalid result and exclusion without reason", async () => {
    await expect(
      createOfficialExcel(new Uint8Array([1, 2]), emptyOfficialAnswers()),
    ).rejects.toThrow("公式テンプレート");
    for (const change of [
      (a: ReturnType<typeof emptyOfficialAnswers>) => {
        a.rows.unknown = { result: "", answer: "" };
      },
      (a: ReturnType<typeof emptyOfficialAnswers>) => {
        delete a.rows["1-2-1-1:1"];
      },
      (a: ReturnType<typeof emptyOfficialAnswers>) => {
        a.criteria["1-2-1-1"].excluded = true;
      },
      (a: ReturnType<typeof emptyOfficialAnswers>) => {
        a.rows["1-2-1-1:2"].answer = "質問のない行";
      },
    ]) {
      const a = emptyOfficialAnswers();
      change(a);
      expect(officialAnswersSchema.safeParse(a).success).toBe(false);
    }
    expect(
      officialAnswersSchema.safeParse({
        ...emptyOfficialAnswers(),
        rows: { "1-2-1-1:1": { result: "○", answer: "" } },
      }).success,
    ).toBe(false);
  });
  it("keeps unanswered results blank and suppresses saved result for an excluded criterion", () => {
    const a = emptyOfficialAnswers();
    a.criteria["1-2-1-1"] = { excluded: true, exclusionReason: "対象条件を確認" };
    a.rows["1-2-1-1:1"].result = "適合";
    const cells = officialCellValues(a)["xl/worksheets/sheet2.xml"];
    expect(cells).toMatchObject({
      L19: "○",
      L20: "○",
      M19: "対象条件を確認",
      P19: "",
      P20: "",
      P126: "",
    });
  });
});
