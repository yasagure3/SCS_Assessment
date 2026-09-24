import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
      continue;
    }
    if (entry.name === ".dev.vars" && directory.includes("client"))
      throw new Error("Secret file in client output");
    if (!/\.(js|json|html)$/.test(entry.name)) continue;
    const text = await readFile(path, "utf8");
    if (text.includes("E2E_ONLY_") || text.includes("/__fixture/"))
      throw new Error(`Test authentication leaked into production output: ${path}`);
  }
}
await inspect("dist/client");
await inspect(process.argv[2] ?? "dist/scs_assessment");
console.log(
  "PASS: production client and Worker contain no test authentication or fixture endpoints",
);
