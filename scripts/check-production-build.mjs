import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export async function inspect(directory, client = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path, client);
      continue;
    }
    if (entry.name === ".dev.vars" && directory.includes("client"))
      throw new Error("Secret file in client output");
    if (!/\.(js|json|html)$/.test(entry.name)) continue;
    const text = await readFile(path, "utf8");
    if (
      /E2E_ONLY_|\/__fixture\/|FakeAiProvider|sk-[A-Za-z0-9_-]{16,}/.test(text) ||
      (client && text.includes("OPENAI_API_KEY"))
    )
      throw new Error(`Secret or test code in production output: ${path}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await inspect("dist/client", true);
  await inspect(process.argv[2] ?? "dist/scs_assessment");
  console.log(
    "PASS: production client and Worker contain no secret literals, fake providers or fixture endpoints",
  );
}
