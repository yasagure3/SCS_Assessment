import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  realpathSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
const visited = new Set(),
  notices = [];
function packageDirectory(name, from) {
  let directory = from;
  for (;;) {
    const candidate = resolve(directory, "node_modules", name);
    if (existsSync(resolve(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Installed production dependency missing: ${name}`);
    directory = parent;
  }
}
function visit(name, from) {
  const directory = packageDirectory(name, from),
    pkg = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
  const id = `${pkg.name}@${pkg.version}`;
  if (visited.has(id)) return;
  visited.add(id);
  const files = readdirSync(directory).filter((name) =>
    /^(license|licence|copying|notice)([.-]|$)/i.test(name),
  );
  const texts = files.map((name) => `${name}\n${readFileSync(resolve(directory, name), "utf8")}`);
  if (!texts.length) {
    const readme = readdirSync(directory).find((name) => /^readme\.(md|markdown|txt)$/i.test(name));
    const text = readme ? readFileSync(resolve(directory, readme), "utf8") : "";
    const section = text.match(/(?:^|\n)#+\s+Licen[cs]e[\s\S]*$/i)?.[0];
    if (!section) {
      if (!pkg.license && !pkg.licenses) throw new Error(`License declaration missing: ${id}`);
      texts.push(
        `The published package contains no separate license text. Original package.json declaration:\n${JSON.stringify({ name: pkg.name, version: pkg.version, license: pkg.license, licenses: pkg.licenses, repository: pkg.repository, author: pkg.author }, null, 2)}`,
      );
    } else texts.push(section);
  }
  notices.push({
    id,
    text: `${id}\nDeclared license: ${JSON.stringify(pkg.license ?? pkg.licenses)}\n${texts.join("\n\n")}`,
  });
}
const root = process.cwd(),
  pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const name of Object.keys(pkg.dependencies)) visit(name, root);
mkdirSync("public/licenses", { recursive: true });
writeFileSync(
  "public/licenses/THIRD_PARTY.txt",
  "Third-party notices for direct production dependencies.\nIncludes server-only dependencies; no license is granted here for application data.\nBundler-retained transitive license comments and public/fonts notices are also preserved.\n\n" +
    notices
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => n.text)
      .join("\n\n========================================\n\n") +
    "\n",
);
console.log(`Collected original notices for ${notices.length} installed production packages.`);
