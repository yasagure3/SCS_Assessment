import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(__dirname, "migrations");
      const migrations = await readD1Migrations(migrationsPath);

      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Even a mistakenly configured adapter cannot reach an external API in tests.
          outboundService: {
            node: (_request: IncomingMessage, response: ServerResponse) => {
              response.writeHead(503, { "Content-Type": "text/plain" });
              response.end("TEST_OUTBOUND_BLOCKED");
            },
          },
          bindings: {
            TEST_MIGRATIONS: migrations,
            OPENAI_API_KEY: "",
            OPENAI_MODE: "disabled",
            OPENAI_MODEL: "",
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/worker/**/*.test.ts"],
  },
});
