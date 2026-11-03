import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  officialAnswersSchema,
  officialCatalog as catalog,
  type OfficialAnswers,
} from "../../shared/contracts/officialAssessment";

function xmlText(value: string) {
  // Preserve Excel escape-looking text and XML control characters as literal text.
  return value
    .replace(/_(?=x[0-9a-f]{4}_)/gi, "_x005F_")
    .split("")
    .map((c) => {
      const code = c.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 0xfffe || code === 0xffff
        ? `_x${code.toString(16).padStart(4, "0")}_`
        : c;
    })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
export function officialCellValues(answers: OfficialAnswers) {
  const scope: Record<string, string> = {};
  const assessment: Record<string, string> = {
    P2: answers.organization.name,
    P3: answers.organization.address,
    P4: answers.organization.unit,
    P5: answers.organization.scope,
    P13: "1.1",
    P14: "1.0",
  };
  for (const q of catalog.scopeQuestions) scope[q.cell] = answers.scopeAnswers[q.id];
  for (const row of catalog.rows) {
    const criterion = answers.criteria[row.criterionId];
    assessment[row.exclusionCell] = criterion.excluded ? "○" : "";
    assessment[row.exclusionReasonCell] = criterion.excluded ? criterion.exclusionReason : "";
    assessment[row.resultCell] = criterion.excluded ? "" : answers.rows[row.key].result;
    if (row.question) assessment[row.answerCell] = answers.rows[row.key].answer;
  }
  return { "xl/worksheets/sheet1.xml": scope, "xl/worksheets/sheet2.xml": assessment };
}
export async function createOfficialExcel(
  template: Uint8Array,
  input: OfficialAnswers,
): Promise<Uint8Array> {
  const answers = officialAnswersSchema.parse(input);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(template)));
  if (
    Array.from(digest, (v) => v.toString(16).padStart(2, "0")).join("") !== catalog.template.sha256
  )
    throw new Error("公式テンプレートの版を確認できません。再読み込みしてください。");
  const entries = unzipSync(template);
  for (const [file, values] of Object.entries(officialCellValues(answers))) {
    let xml = strFromU8(entries[file]);
    for (const [cell, value] of Object.entries(values)) {
      // The pinned template has an explicit blank cell at every mapped address.
      const pattern = new RegExp(
        `<c\\b([^>]*\\br="${cell}"[^>]*?)(?:\\s*\\/>|>([\\s\\S]*?)<\\/c>)`,
        "g",
      );
      let matches = 0;
      xml = xml.replace(pattern, (_match, attributes: string, content: string | undefined) => {
        matches++;
        if (content?.includes("<f")) throw new Error(`数式セル ${cell} には書き込めません。`);
        return `<c${attributes.replace(/\s+t="[^"]*"/, "")} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
      });
      if (matches !== 1) throw new Error(`出力先 ${cell} を確認できません。`);
    }
    entries[file] = strToU8(xml);
  }
  // All other XML, formulas, relationships, styles and the ★4 sheet are byte-identical.
  return zipSync(entries);
}
