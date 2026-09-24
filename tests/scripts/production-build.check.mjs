import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "../../scripts/check-production-build.mjs";

test("production inspection accepts a public asset and rejects fake providers and secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "scs-public-build-"));
  try {
    await writeFile(join(root, "app.js"), "const label = '公開用アプリ';");
    await inspect(root, true);
    for (const marker of [
      "FakeAiProvider",
      "sk-LOCAL-TEST-ONLY-NOT-A-REAL-KEY",
      "OPENAI_API_KEY",
      "/__fixture/ai-inputs",
    ]) {
      await writeFile(join(root, "app.js"), marker);
      await assert.rejects(inspect(root, true), /Secret or test code in production output/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
