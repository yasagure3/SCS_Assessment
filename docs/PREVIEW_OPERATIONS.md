# 匿名データでの検証公開

Issue #43 の一時的な検証環境。実 Cognito の初期管理者が、匿名の顧客・診断・報告版を試す。本番受入、#19 のAI追加修正、#26 の全体結合、#27 の本番構成・実環境検証は別作業。

## 対象と制約

- Worker は `scs-assessment-preview`（任意で `-<suffix>`）、D1 は同名 `-db`、非公開R2は同名 `-evidence`。既存本番リソースを流用しない。Cloudflare account IDを明示して、そのアカウント内の新規検証用リソースを照合する。
- 認証は招待専用・必須TOTP・secretなしの実Cognito。JWT・D1利用者・顧客権限の検査は通常ビルドと同じ。テスト専用ログインを公開しない。
- 現在の composition にはCognito管理transportがないため、**アプリ内の担当者招待・再発行は利用不可（503）**。初期管理者1名は既存のoffline bootstrapで登録する。
- AI事業者は未接続。AI送信をこの検証で有効にしない。証跡は形式・サイズ検査のみでマルウェアスキャン未接続のため、アップロードも匿名の検証用ファイルに限定する。
- 認証情報・招待応答・SQL・Terraform state・検証出力は `.local/` に保管する。公開設定JSONにもパスワード、キー、メールを入れない。初回パスワードとTOTP秘密は記録・画面採取しない。

## 設定と事前確認

1. 独立したcheckoutに依存を導入する。既存の `.env.local` / `.dev.vars` や本番Terraform stateをコピーしない。
2. オペレーターがCloudflareログイン先を確認し、検証用D1とR2を作成する。R2の `r2.dev` 公開と独自ドメイン公開は無効のままにする。既存同名リソースがある場合は検証専用であることを確認してから使用する。
3. `preview.config.example.json` を `.local/preview-input.json` へコピーし、実際の公開IDを入力する。空欄・ダミー値では通常の公開処理は停止する。`offlineOnly` は実リソースの照合後に `false` とする。Worker名からD1/R2名を一意に導出する。
4. CognitoのPoolとClientは同じ検証環境のものを指定する。`cognitoRegion` とPool IDのprefixも一致させる。ID書式の検査はリソースの存在・所有アカウント・MFA設定の証明ではない。AWS APIの取得結果で別途確認する。

PowerShellでリポジトリルートから実行する。`scripts/vp.ps1` が固定Vite+を起動する。

```powershell
./scripts/vp.ps1 check
./scripts/vp.ps1 build
./scripts/vp.ps1 exec node scripts/check-production-build.mjs
./scripts/vp.ps1 exec node --test scripts/preview-config.check.mjs tests/scripts/bootstrap-admin.check.mjs
./scripts/preview.ps1 -Config .local/preview-input.json -Action Prepare
```

専用の `.local/preview/wrangler.json` を生成する。本番用 `wrangler.jsonc` と既存envファイルは書き換えない。生成ディレクトリに `.env*` / `.dev.vars*` がある場合は停止する。Viteは `SCS_PREVIEW_INPUT` を使って**ビルド時**にCloudflare `configPath`を選択し、同じ入力の公開Pool/ClientをSPAへ埋め込む。プレビューではenvファイルの自動読込を無効にする。

Cloudflare Viteはビルド時に設定を確定するため、通常ビルド後に `wrangler deploy --env preview` を付ける手順では切り替わらない。[Cloudflare environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)

## 検証用Cognitoと初期管理者

新しいPoolが必要な場合は `terraform/envs/preview` を利用できる。共通の招待専用・必須TOTPモジュールを利用し、ユーザーや恒久パスワードはTerraformで作成しない。`aws_account_id` は必須で、AWS providerの `allowed_account_ids` により別アカウントへの適用を拒否する。AWSログイン・対象アカウントはオペレーターが確定する。

PowerShellでは `-var-file=...` などの引数全体を引用符で囲む。引用符なしの相対パスは引数が分割され、Terraformが `Too many command line arguments` で停止する場合がある。

```powershell
# .local/preview/terraform.tfvars.json に承認済み aws_account_id / aws_region / preview_name をJSONで記載。
terraform '-chdir=terraform/envs/preview' init
terraform '-chdir=terraform/envs/preview' validate
terraform '-chdir=terraform/envs/preview' plan '-var-file=../../../.local/preview/terraform.tfvars.json' '-out=../../../.local/preview/cognito.plan'
# plan の追加対象とアカウントを確認してから実行する。
terraform '-chdir=terraform/envs/preview' apply '../../../.local/preview/cognito.plan'
terraform '-chdir=terraform/envs/preview' output -json > '.local/preview/cognito-outputs.json'
```

stateは `.local/preview/terraform.tfstate` に限定し、非公開バックアップを保管する。prodディレクトリのinit/applyやstate移行は行わない。Pool/Client出力を入力JSONへ転記し、Prepareを再実行する。

1. 承認済みの管理者メール宛にCognito `AdminCreateUser` を実行し、Cognitoによる仮パスワードのメール配信を使う。パスワードをコマンド引数・履歴に渡さない。応答は `.local/invited-admin.json` に保存する。
2. 同じPoolから `DescribeUserPool`、`GetUserPoolMfaConfig`、`DescribeUserPoolClient` の応答を取得し、[認証運用](AUTH_OPERATIONS.md)の手順で `.local/pool.json` / `.local/mfa.json` / `.local/client.json` を保存する。入力JSONのPool/Client IDと一致、自己登録禁止、MFA ON、software token有効、public SRP/refresh clientであることを照合する。
3. 以下で全migrationを適用し、既存のoffline bootstrapで初期管理者のSQLを生成する。対象設定は常に明示する。

```powershell
./scripts/vp.ps1 exec wrangler d1 migrations apply DB --remote --config .local/preview/wrangler.json
./scripts/vp.ps1 exec node scripts/bootstrap-admin.mjs --pool .local/pool.json --mfa .local/mfa.json --client .local/client.json --user .local/invited-admin.json --out .local/bootstrap-admin.sql
# SQLと対象D1を照合してから実行する。応答は個人情報を含めず作業記録へ。
./scripts/vp.ps1 exec wrangler d1 execute DB --remote --config .local/preview/wrangler.json --file .local/bootstrap-admin.sql
```

既存adminがある場合はbootstrapで増員しない。仮パスワード→新パスワード→TOTP登録・検証→ `/api/v1/me` で同じsubの管理者がactiveになることを実ブラウザで確認する。端末紛失・失効の手順は [AUTH_OPERATIONS.md](AUTH_OPERATIONS.md) に従う。

## ビルド、dry-run、公開

```powershell
./scripts/preview.ps1 -Config .local/preview-input.json -Action DryRun
# 実リソース・MFA・初期管理者・匿名データ方針の照合後に公開する。
./scripts/preview.ps1 -Config .local/preview-input.json -Action Deploy
```

各回にビルドし、生成されたWorker設定のaccount/Worker/D1/R2/CognitoとSPAの公開IDを照合する。静的配信は `dist/client` だけ、`/api/*` はWorkerが処理する。テスト認証の混入検査後、照合した `dist/<preview_worker>/wrangler.json` を明示してWranglerを実行する。失敗時は公開へ進まない。通常の `deploy` npm scriptはこの検証公開には使わない。

オフラインQAだけは `offlineOnly: true` と明示したダミー入力を `.local/preview-offline.json` に作り、同じ `DryRun` を実行できる。これは認証を有効にした通常の製品ビルドであり、外部へのログインやAPI利用は成立しない。`Deploy` は必ず拒否する。dry-run成功は実接続の成功を意味しない。

## 公開後の確認記録

URL、git commit、Cloudflare deployment/version ID、対象リソース、実施日時を `.local/preview/verification.md` に残す。未実施項目は「未確認」、失敗項目は失敗として記録し、healthだけで合格にしない。

| 確認 | 合格条件 |
|---|---|
| SPAとAPI境界 | 公開URLのログイン画面が表示され、未認証の `/api/v1/me` と顧客APIが401。APIのブラウザ直アクセスもHTMLへ置き換わらない |
| 初期管理者 | 実招待・初回パスワード変更・TOTP設定・再ログインが成功し、active/adminの本人が取得される |
| 匿名の業務操作 | 匿名顧客→案件→診断→回答更新→81基準の集計を実操作で確認 |
| 固定報告版 | 留意事項を確認して確定し、PDF/Excelを両方保存。同じ報告版ID・件数・日本語本文を照合する |
| 非公開証跡 | 匿名ファイルだけを登録し、未認証取得を拒否。R2に公開URL・公開ドメインがない |
| 限界 | 招待adapter・AI・マルウェアスキャン・本番受入は未完了として記録 |

UI変更を含まない準備コードの自動試験は、設定欠落/本番名/秘密混入/Pool不一致/生成設定の改変/公開範囲逸脱/ダミー公開拒否を扱う。実Cognitoと公開URLでの業務操作は接続後の別の確認である。
