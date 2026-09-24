import { defineConfig } from "vite-plus";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
// A separate local-only test entry. The production configuration never imports this file.
export default defineConfig(({ command }) => {
  if (command !== "serve") throw new Error("The test fixture cannot be built or deployed.");
  const localArtifactDirectories = [".local", "test-results"].map((directory) =>
    resolve(directory).replaceAll("\\", "/"),
  );
  return {
    server: {
      watch: {
        ignored: (path) =>
          localArtifactDirectories.some((directory) => {
            const normalized = path.replaceAll("\\", "/");
            return normalized === directory || normalized.startsWith(`${directory}/`);
          }),
      },
    },
    cacheDir: resolve(".local/e2e-vite-cache"),
    optimizeDeps: { include: ["exceljs", "fflate", "pdf-lib", "@pdf-lib/fontkit"] },
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
