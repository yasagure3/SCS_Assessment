import { z } from "zod";
import catalog from "../data/official-scs-v1.1.json";

export const OFFICIAL_STANDARD_ID = "scs-20261028-v1.1-star3";
export { catalog as officialCatalog };
const text = z.string().max(8000);
const rowSchema = z.strictObject({ result: z.enum(["", "適合", "不適合"]), answer: text });
const criterionSchema = z.strictObject({
  excluded: z.boolean(),
  exclusionReason: text,
});
export const officialAnswersSchema = z
  .strictObject({
    standardId: z.literal(OFFICIAL_STANDARD_ID),
    templateSha256: z.literal(catalog.template.sha256),
    organization: z.strictObject({ name: text, address: text, unit: text, scope: text }),
    scopeAnswers: z.record(z.string(), text),
    criteria: z.record(z.string(), criterionSchema),
    rows: z.record(z.string(), rowSchema),
  })
  .superRefine((answers, context) => {
    const exactKeys = (actual: object, expected: string[], path: string) => {
      const keys = Object.keys(actual);
      if (keys.length !== expected.length || keys.some((key) => !expected.includes(key)))
        context.addIssue({ code: "custom", path: [path], message: "公式版の項目と一致しません" });
    };
    exactKeys(
      answers.criteria,
      catalog.standard.criteria.map((c) => c.id),
      "criteria",
    );
    exactKeys(
      answers.rows,
      catalog.rows.map((r) => r.key),
      "rows",
    );
    exactKeys(
      answers.scopeAnswers,
      catalog.scopeQuestions.map((q) => q.id),
      "scopeAnswers",
    );
    const unit = answers.scopeAnswers["1."];
    if (unit && !catalog.scopeQuestions[0].options?.includes(unit))
      context.addIssue({
        code: "custom",
        path: ["scopeAnswers", "1."],
        message: "取得単位を選択してください",
      });
    for (const [id, criterion] of Object.entries(answers.criteria)) {
      if (criterion.excluded && !criterion.exclusionReason.trim())
        context.addIssue({
          code: "custom",
          path: ["criteria", id],
          message: "対象外とする理由が必要です",
        });
    }
    for (const row of catalog.rows) {
      if (!row.question && answers.rows[row.key]?.answer)
        context.addIssue({
          code: "custom",
          path: ["rows", row.key],
          message: "質問のない行には回答できません",
        });
    }
  });
export type OfficialAnswers = z.infer<typeof officialAnswersSchema>;
export function emptyOfficialAnswers(): OfficialAnswers {
  return {
    standardId: OFFICIAL_STANDARD_ID,
    templateSha256: catalog.template.sha256,
    organization: { name: "", address: "", unit: "", scope: "" },
    scopeAnswers: Object.fromEntries(catalog.scopeQuestions.map((q) => [q.id, ""])),
    criteria: Object.fromEntries(
      catalog.standard.criteria.map((c) => [c.id, { excluded: false, exclusionReason: "" }]),
    ),
    rows: Object.fromEntries(catalog.rows.map((r) => [r.key, { result: "", answer: "" }])),
  };
}
