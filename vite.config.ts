import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // vitest (jsdom) と @cloudflare/vite-plugin の Worker environment は競合するため、
  // テスト実行時 (process.env.VITEST) は cloudflare() を無効化する。
  // バックエンド (Workers) のテストは vitest.workers.config.ts を別途使う。
  plugins: [react(), tailwindcss(), !process.env.VITEST && cloudflare()],
  // amazon-cognito-identity-js は Node の `global` を参照するが、ブラウザには存在しないためエイリアスする。
  define: {
    global: "globalThis",
  },
  fmt: {
    ignorePatterns: [
      ".reference/**",
      ".local/**",
      "poc/**",
      "docs/**",
      "**/*.md",
      "pnpm-lock.yaml",
    ],
  },
  lint: {
    ignorePatterns: [".reference/**", ".local/**", "poc/**", "docs/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              importNames: ["useEffect"],
              message:
                "useEffect は誤用が多いため禁止。どうしても必要な場合は該当行に oxlint-disable コメントを付けて理由を明記する。",
            },
          ],
        },
      ],
    },
    // レイヤ境界の機械チェック。glob は import 文字列に対してマッチするため、
    // 相対 import ("../adapter/x") も捕捉できる。
    // 注意: overrides はルール単位で上書きされるため、各 override は自己完結させる
    // (front には useEffect 禁止を、レイヤには front/server 境界を再掲する)。
    // 注意: 禁止パターンを定数変数に括り出すと defineConfig の型比較が深度超過 (TS2321) するため、
    // 重複してもリテラルで書く。
    overrides: [
      {
        files: ["src/front/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "react",
                  importNames: ["useEffect"],
                  message:
                    "useEffect は誤用が多いため禁止。どうしても必要な場合は該当行に oxlint-disable コメントを付けて理由を明記する。",
                },
              ],
              patterns: [
                {
                  group: ["**/server/**"],
                  message:
                    "境界違反: src/front は src/server を直接 import できない。通信は HTTP 経由で行い、共有する型は src/shared に置く。",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/server/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["**/front/**"],
                  message:
                    "境界違反: src/server は src/front を直接 import できない。共有する型は src/shared に置く。",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/shared/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "react",
                  importNames: ["useEffect"],
                  message:
                    "useEffect は誤用が多いため禁止。どうしても必要な場合は該当行に oxlint-disable コメントを付けて理由を明記する。",
                },
              ],
              patterns: [
                {
                  group: ["**/front/**", "**/server/**"],
                  message:
                    "境界違反: src/shared は front / server のどちらにも依存できない (両者から参照される共有層のため)。",
                },
              ],
            },
          ],
        },
      },
      {
        // domain: 何にも依存しない最内層。usecase を含む全ての外側レイヤを禁止する。
        files: ["src/**/domain/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "**/adapter/**",
                    "**/adapters/**",
                    "**/infrastructure/**",
                    "**/infra/**",
                    "**/presentation/**",
                    "**/middleware/**",
                    "**/routes/**",
                    "**/db/**",
                    "**/usecase/**",
                    "**/usecases/**",
                    "**/application/**",
                  ],
                  message:
                    "Clean Architecture 違反: domain 層は外側のレイヤに依存できない。domain に Port (interface) を定義し、外側に Adapter 実装を置いて DI で繋ぐ。",
                },
                {
                  // jose は鍵取得を DI する純計算ライブラリのため対象外。
                  group: [
                    "hono",
                    "hono/*",
                    "drizzle-orm",
                    "drizzle-orm/*",
                    "react",
                    "react/*",
                    "react-dom",
                    "react-dom/*",
                    "react-router",
                    "react-router/*",
                    "swr",
                    "swr/*",
                    "amazon-cognito-identity-js",
                    "amazon-cognito-identity-js/*",
                    "@cloudflare/*",
                  ],
                  message:
                    "Clean Architecture 違反: domain 層はフレームワーク・IO ライブラリに依存できない。IO は関数注入 (DI) で外側から渡す。",
                },
                {
                  group: ["**/front/**", "**/server/**"],
                  message:
                    "境界違反: src/front と src/server は互いを直接 import できない。共有する型は src/shared に置く。",
                },
              ],
            },
          ],
        },
      },
      {
        // usecase: domain にのみ依存してよい。外側レイヤとフレームワークは禁止。
        files: ["src/**/usecase/**", "src/**/usecases/**", "src/**/application/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "**/adapter/**",
                    "**/adapters/**",
                    "**/infrastructure/**",
                    "**/infra/**",
                    "**/presentation/**",
                    "**/middleware/**",
                    "**/routes/**",
                    "**/db/**",
                  ],
                  message:
                    "Clean Architecture 違反: usecase 層は外側のレイヤに依存できない。domain の Port (interface) を介して DI で受け取る。",
                },
                {
                  group: [
                    "hono",
                    "hono/*",
                    "drizzle-orm",
                    "drizzle-orm/*",
                    "react",
                    "react/*",
                    "react-dom",
                    "react-dom/*",
                    "react-router",
                    "react-router/*",
                    "swr",
                    "swr/*",
                    "amazon-cognito-identity-js",
                    "amazon-cognito-identity-js/*",
                    "@cloudflare/*",
                  ],
                  message:
                    "Clean Architecture 違反: usecase 層はフレームワーク・IO ライブラリに依存できない。IO は関数注入 (DI) で外側から渡す。",
                },
                {
                  group: ["**/front/**", "**/server/**"],
                  message:
                    "境界違反: src/front と src/server は互いを直接 import できない。共有する型は src/shared に置く。",
                },
              ],
            },
          ],
        },
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // .direnv は direnv が flake の入力を展開する場所で、この一式のコピーが
    // 丸ごと入る。除外しないと同じテストを nix store 側のパスで二重に拾い、
    // 「Cannot find module '/@fs/nix/store/...'」で失敗する (README が direnv を
    // 推奨しているので、手元で `vp test` を叩けば誰でも踏む)。
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.direnv/**",
      ".reference/**",
      ".local/**",
      "poc/**",
      "test/worker/**",
      "tests/e2e/**",
    ],
  },
});
