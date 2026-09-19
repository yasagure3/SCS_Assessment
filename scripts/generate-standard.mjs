import fs from "node:fs";
import { createHash } from "node:crypto";

// Public cells B:N only, validated against the official workbook in the Excel PoC.
const publicRows = JSON.parse(fs.readFileSync("poc/excel/master.json", "utf8"));
const criteria = publicRows
  .flatMap((row, index) =>
    row.level === "★3"
      ? [
          {
            id: row.id,
            requirementId: row.publicCells["6"],
            category: row.publicCells["3"],
            requirementText: row.publicCells["10"],
            officialText: row.publicCells["13"],
            orderNo: 0,
            sourceRow: index + 3,
          },
        ]
      : [],
  )
  .map((row, index) => ({ ...row, orderNo: index + 1 }));
if (criteria.length !== 81 || new Set(criteria.map((row) => row.id)).size !== 81)
  throw new Error("Invalid public master");
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const standard = {
  id: "scs-20260327-star3",
  publicationDate: "2026-03-27",
  level: 3,
  sourceUrl: "https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/20260327001-c.xlsx",
  sourceSha256: "d4c27aa4bfed5521a98ff9ce8c042743e4204e4b8310ceb3df0c54eabfdc8dd1",
  contentSha256: createHash("sha256").update(canonical(criteria)).digest("hex"),
  criteria,
};
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = [
  `-- Fixed public standard; regenerating must not change an already released migration.`,
  `INSERT INTO standards SELECT ${[standard.id, standard.publicationDate, 3, standard.sourceUrl, standard.sourceSha256, standard.contentSha256, 81].map(q).join(",")},NULL WHERE NOT EXISTS(SELECT 1 FROM standards WHERE id=${q(standard.id)});`,
];
for (const row of criteria)
  sql.push(
    `INSERT INTO criteria SELECT ${[standard.id, row.id, row.requirementId, row.category, row.orderNo, row.requirementText, row.officialText, row.sourceRow].map(q).join(",")} WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id=${q(standard.id)} AND criterion_id=${q(row.id)});`,
  );
sql.push(
  `UPDATE standards SET sealed_at='2026-09-18T00:00:00.000Z' WHERE id=${q(standard.id)} AND sealed_at IS NULL;`,
);
const migrationPath = "migrations/0002_public_standard.sql";
const migrationText = sql.join("\n") + "\n";
if (
  fs.existsSync(migrationPath) &&
  fs.readFileSync(migrationPath, "utf8").replaceAll("\r\n", "\n") !== migrationText
) {
  throw new Error(
    "Existing migration differs. Introduce a new standard version instead of rewriting it.",
  );
}
fs.mkdirSync("src/server/db/seed", { recursive: true });
fs.writeFileSync(
  "src/server/db/seed/scs-20260327-star3.json",
  JSON.stringify(standard, null, 2) + "\n",
);
fs.writeFileSync(migrationPath, migrationText);
console.log(`Public standard: ${criteria.length} criteria, SHA256 ${standard.contentSha256}`);
