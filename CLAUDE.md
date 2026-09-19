# CLAUDE.md

React 19 (SPA) + Hono (API Worker) + Cloudflare D1 (Drizzle ORM) を単一の Cloudflare Workers プロジェクトにまとめたフルスタックテンプレート。`@cloudflare/vite-plugin` で SPA と Worker を同一 `vp dev` で開発する。詳細は README.md を参照。

## 新規プロジェクトとして使い始めるとき

このリポジトリから `gh repo create --template` で clone した直後に必ず行う:

```bash
bash scripts/rename-project.sh <project-name>
wrangler d1 create <project-name>-db   # database_id を wrangler.jsonc に反映
```

スクリプト実行後に手で始末するものが 3 つある（詳細は README「2. プロジェクト名のリネーム」）。

- `.github/workflows/deploy.yml` の `if: github.event.repository.name != ...` ガード行を削除する（スクリプトの一括置換でこの行も新プロジェクト名に書き換わり、放置すると deploy ジョブが常に skip される）
- `.github/workflows/deploy.yml.bak` を削除する（スクリプトの `.bak` 掃除が深さ 3 に届かない）
- `src/front/pages/HomePage.tsx` の見出しと `HomePage.test.tsx` の期待値を直す（スクリプトの置換対象外）

## コマンド

`vp`（Vite+）に統一。生の `pnpm` / `vite` / `vitest` を直接叩かない。

- `vp install` — 依存インストール（`postinstall` で `worker-configuration.d.ts` も生成・フォーマットされる。ただし node_modules 既存時は走らないことがある）
- `vp dev` — SPA + Worker を同時起動
- `vp test` — フロントエンドテスト（jsdom）
- `vp exec vitest run -c vitest.workers.config.ts` — バックエンドテスト（`@cloudflare/vitest-pool-workers`）
- `vp check` / `vp check --fix` — 型チェック + lint + フォーマット
- `vp lint` — lint のみ実行（レイヤ境界違反の確認に使う）
- `vp build` — `dist/client`（SPA）+ `dist/<name>`（Worker）をビルド
- `vp exec wrangler types` — `wrangler.jsonc` の bindings/`main` から `Env` 型を再生成

`git push` 時は lefthook の `pre-push` フックが `vp check` + `vp build` を自動実行する（`lefthook.yml`、`vp install` で自動セットアップ）。失敗すると push はブロックされる。

## 守るべき規約

- **`useEffect` は import 禁止**（`vite.config.ts` の `no-restricted-imports` で lint エラー）。データ取得は `useSWR` を使う。他の用途でどうしても必要なら oxlint-disable コメントで理由を明記する
- ディレクトリ構成: `src/front`（SPA）/ `src/server`（Worker）/ `src/shared`（両者共有の型。現状は未作成）。`src/server` は `index.ts`（composition root）と `db/schema.ts` を直下に置き、機能は `modules/<bounded context>/{domain,usecase,adapter}` に分ける。`usecase/` は該当するロジックが出てきた時点で作る（現状は空のまま置かない）
- **レイヤ境界は lint で強制される**（`vite.config.ts` の `lint.overrides`）。`domain/` はフレームワーク（`hono` / `drizzle-orm` / `react` 等）も外側レイヤ（`adapter` / `db` / `routes` / `usecase` 等）も import できない。`usecase/` が依存してよいのは `domain/` のみ。`src/front` ↔ `src/server` の直接 import は双方向で禁止（共有する型は `src/shared` に置く）。違反は `oxlint-disable` で回避せず Port と DI に直す。禁止 import の一覧・Port と DI の書き方・設定を編集するときの注意は README「レイヤ境界の lint」が正本
- フロント/バックエンドのテストは別ランナー（`vite.config.ts` の jsdom テストと `vitest.workers.config.ts` の Workers pool テストは同一プロセスで共存できない。`vite.config.ts` は `process.env.VITEST` のとき `cloudflare()` プラグインを無効化している）。バックエンドのテストは `test/worker/` に置く（Workers ランナーの `include` が `test/worker/**` 固定のため、`src/server/modules/` にコロケートすると jsdom 側で実行されてしまう）
- `worker-configuration.d.ts` は commit 済みの生成物。**bindings（`d1_databases` / `vars` 等）か `main` を変更したときだけ** `vp exec wrangler types` で再生成して commit し直す（`name` 等それ以外のフィールドは型に影響しない）。CI は `vp install` の postinstall で毎回再生成するため commit 済みの内容に依存しないが、postinstall が走らなかったローカル環境では commit 済みの型が使われ、再生成を忘れると `vp check` が型エラーで検出する。`vars` の型は生成時に `.dev.vars` でその変数が定義されているかで決まる（定義があれば `string`、無ければリテラル型）ため、commit 済みと再生成結果は一致しないことがある
- `wrangler.jsonc` の `assets.directory` は必ず `./dist/client` を指す。トップレベル `./dist/` を指定すると Worker ビルド成果物（ローカルシークレットを含む `.dev.vars` 等）まで静的配信対象に入ってしまう

## 認証（Cognito）を使う場合

- User Pool / Client は `terraform/` で管理。`terraform/modules/cognito/` が共通定義、`terraform/envs/local/`（moto 対象、local backend）と `terraform/envs/prod/`（実 AWS Cognito 対象、Cloudflare R2 backend）が state を分離して呼び出す
- ローカルは `docker compose up -d`（moto を localhost:5001 で起動）→ `vp run cognito:setup` → `.dev.vars` / `.env.local` が生成される
- `/login` 画面（`amazon-cognito-identity-js` の SRP 認証）はローカルでもサインインできる（moto）。ただし moto は SRP のパスワード署名を検証しない（誤ったパスワードでも成功する）ことと、IdToken の `email` クレームが正しく入らない既知の不具合がある（README「認証（Amazon Cognito）」節の「既知の制限（moto を使ったローカル認証）」参照）。パスワード検証込みの確認は実 AWS Cognito でのみ可能
- Worker 側は `COGNITO_ISSUER`（署名検証用）と `COGNITO_JWKS_URL`（鍵取得先、未設定時は `{issuer}/.well-known/jwks.json` にフォールバック）を分離している（`src/server/modules/auth/adapter/authenticate.ts` の `resolveJwksUrl`）。moto のトークンは `iss` が `https://cognito-idp.{region}.amazonaws.com/{pool_id}` 固定で JWKS は moto 自身が返すため、この分離が必要
- 認証が不要なプロジェクトでは README「認証が不要な場合」に列挙されたファイル・依存を削除する

## テスト・実装方針

- TDD（RED→GREEN→REFACTOR）で実装する
- 外部ネットワーク呼び出し（JWKS 取得等）は関数注入で DI し、テストはオフラインで完結させる（`src/server/modules/auth/domain/verifyAccessToken.ts` の `getKey` 引数を参照）
