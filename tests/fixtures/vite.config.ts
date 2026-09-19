import { defineConfig } from "vite-plus";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
// A separate local-only test entry. The production configuration never imports this file.
export default defineConfig(({ command }) => {
  if (command !== "serve") throw new Error("The test fixture cannot be built or deployed.");
  return {
    cacheDir: resolve(".local/e2e-vite-cache"),
    optimizeDeps: { include: ["exceljs", "fflate"] },
    plugins: [
      react(),
      tailwindcss(),
      cloudflare({
        configPath: resolve(import.meta.dirname, "wrangler.jsonc"),
        persistState: { path: resolve(".local/e2e-state") },
        inspectorPort: false,
        remoteBindings: false,
      }),
    ],
    resolve: {
      alias: { "amazon-cognito-identity-js": resolve(import.meta.dirname, "cognito.mjs") },
    },
    define: {
      global: "globalThis",
      "import.meta.env.VITE_COGNITO_USER_POOL_ID": JSON.stringify("ap-northeast-1_fixture"),
      "import.meta.env.VITE_COGNITO_CLIENT_ID": JSON.stringify("fixture-client"),
    },
  };
});
