# ローカル開発

固定したテンプレートの出典は [TEMPLATE_ORIGIN.md](TEMPLATE_ORIGIN.md)。本番リソースの作成はこの手順に含めない。認証の設定値を空にしたまま、案内画面・接続確認・自動テストを実行できる。

## Windows（PowerShell 7 / x64）

```powershell
git clone https://github.com/yasagure3/SCS_Assessment.git
Set-Location SCS_Assessment
git switch feat/staff-auth
.\scripts\setup-vp.ps1
.\scripts\vp.ps1 install --frozen-lockfile
.\scripts\vp.ps1 exec wrangler d1 migrations apply scs-assessment-db --local
.\scripts\vp.ps1 dev --host 127.0.0.1 --port 5173 --strictPort
```

`setup-vp.ps1` は公式npmレジストリからVite+ CLI 0.2.4を取得し、SHA-512整合性を検査して `.local/tools/` に展開する。システムのPATHや他プロジェクトのNodeを変更しない。ラッパーは作業プロセス内でVP_HOME/PATHを設定する。取得した実行ファイル・キャッシュはGit管理外。

ほかのOSでは [公式Vite+の導入手順](https://github.com/voidzero-dev/vite-plus) に従い、Vite+ 0.2.4を用意して `vp` を使用する。Node 24、pnpm 11.2.2を利用する。pnpm 11の設定は [公式移行資料](https://github.com/pnpm/pnpm.io/blob/main/docs/migration.md) に従い `pnpm-workspace.yaml` に置く。

## 検証

```powershell
.\scripts\vp.ps1 test --run
.\scripts\vp.ps1 exec vitest run -c vitest.workers.config.ts
.\scripts\vp.ps1 check
.\scripts\vp.ps1 build
.\scripts\vp.ps1 exec playwright install chromium
$env:E2E_PORT = '5181'
.\scripts\vp.ps1 exec playwright test
```

既存のMicrosoft Edgeで実行する場合のみ `$env:E2E_CHANNEL = 'msedge'` を指定できる。通常とCIはPlaywrightに対応するChromiumを使用する。E2Eは指定ポートに新しいサーバーを起動するため、ポートが使用中の場合は失敗する。起動済みサーバーへの相乗りはしない。

Frontはjsdom、APIはCloudflare Workers poolで実行する。認証署名検証のテストは鍵を注入し、外部JWKSへ接続しない。Cognitoの実サービスによる招待・MFAの確認はF04の別工程。

## worktree

```powershell
git worktree add ../scs-check -b check/local
Set-Location ../scs-check
.\scripts\setup-vp.ps1
.\scripts\vp.ps1 install --frozen-lockfile
.\scripts\vp.ps1 exec wrangler d1 migrations apply scs-assessment-db --local
$env:E2E_PORT = '5182'
.\scripts\vp.ps1 dev --host 127.0.0.1 --port 5174 --strictPort
```

各worktreeは独立した `.wrangler/` とローカルDBを持つ。秘密を含む `.dev.vars` / `.env.local`、顧客ファイル、`.local/` の自動コピーはしない。必要な認証設定だけを各作業者が別途設定する。`.env.local.example` / `.dev.vars.example` は空の公開設定例。

## 公開範囲

ビルドの静的配信先は `dist/client` のみ。GitHub Actionsは検証のみで、デプロイworkflowは設けない。顧客原本、証跡、キー、Terraform state、生成レポートはGit管理外。`terraform/` は候補構成のソースであり、この手順ではapplyしない。


## 認証機能の検証

運用・初期管理者の準備は [AUTH_OPERATIONS.md](AUTH_OPERATIONS.md)。通常の起動ではCognito設定が空ならログインを受け付けない。ユーザー情報は `/api/v1/me` で取得する。

`vp exec playwright test` は通常アプリと別構成の匿名fixtureアプリを起動する。fixtureではSDKのみ代替し、Hono・D1・アカウント有効化・停止・失効は製品のコードを使う。fixture専用D1とViteキャッシュを `.local/` に分離し、ブラウザ試験は1 workerで直列実行する。`E2E_PORT` とその次のポートが空いている必要がある。fixture構成はserve専用でbuild不可、通常build後は `vp exec node scripts/check-production-build.mjs` でテスト認証の混入を検査する。

初期管理者SQLの再送・二重作成防止は `vp exec node --test tests/scripts/bootstrap-admin.check.mjs` で匿名JSONとインメモリSQLiteを使って検証する。Node 24が必要。
