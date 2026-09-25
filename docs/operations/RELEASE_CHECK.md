# Issue #27 出荷判定記録

状態：**実クラウド受入は未完了。本番公開は未承認。Issueをcloseしない。**

2026-09-25時点の実装・ローカル準備記録。選定/承認条件はIssue #27、手順と機械試験は [CLOUD_RUNBOOK.md](CLOUD_RUNBOOK.md)。以下の実測欄を担当者が実結果で更新する。fake/local試験、IaC plan成功、モデルmetadata 200だけを実接続の合格にしない。

## 対象と条件

匿名Worker `scs-assessment-trial-verification`、隔離復元 `scs-assessment-trial-verification-restore`。既存preview、元Excel、既存レポートは変更しない。実account/Pool/Client/DB/R2/S3/plan/project IDは実取得inventoryと `.local/cloud-input.json` を照合し、公開してよいIDと測定日時だけをここへ転記する。秘密の値は記録しない。

担当者10名、並行5名、50社/500診断、DB 1 GB、初回Scan100件/100 MB、証跡+backup2 GB。初回非AI$10/AI$5かつ30回、月非AI$30/AI$20。RPO24h/RTO1営業日（ドリル8h以内）。保持は契約終了後3年、backup30日。国内限定要件なし。地域の実単価、税、契約の課金単位、実使用量を見積へ含める。

## ローカル実測

| コマンド/検査 | 観測 | 限界 |
|---|---|---|
| `vp test run` | 40 files / 440 tests pass | jsdom、外部サービスではない |
| `vp run test:worker` | 25 files / 341 tests pass | real local D1/R2、外部AWS/OpenAIは境界double |
| `vp check` | 実装中の型/lint検査済み、最終結果は実装報告へ記録 | 出荷前HEADで再検査 |
| cloud config/backup/recovery checks | 原子性、隔離、hash、保持日、secret混入拒否をローカル検査 | real cloud検査ではない |
| `cloud.ps1 -Action DryRun` | 親担当proxyでexit 0、build/identity/separation/wrangler pass | offlineOnly入力、実deployなし |
| authentication/evidence-files Playwright | 親担当proxyで3 passed / 34.2s | fixture認証、実MFA受入ではない |
| Terraform trial init/validate | AWS6.66.0/Cloudflare5.25.0でexit 0 | apply/実クラウド挙動ではない |
| Terraform trial plan | 親担当が19 create / 0 update / 0 deleteを確認 | 後続source差分はfreeze後replan |

Windows sandboxはWrangler registry mkdir EPERM、esbuildの上位ディレクトリread拒否を起こした。同じコマンドを親の許可された実行で再測定し、設定回避で合格にしない。Workersの `Request` は `redirect:'error'` を受け付けずTypeErrorとなることを観測したため、固定URL＋manual＋3xx拒否の回帰試験を追加した。

## 実クラウド受入（すべて測定待ち）

| 対象/機械試験 | 合格基準 | 実コマンド・日時・結果 |
|---|---|---|
| account/identity/private inventory | 専用CF/AWS、東京、DB/restore相違、R2公開無効、S3version/private/タグwriter制限、GuardDuty ACTIVE | 未実施 |
| 実招待/期限・再発行 | 明示許可本人メール、7日設定、app予約属性/sub一致、重複再送なし、実メール/監査 | 未実施 |
| `vp exec playwright test tests/e2e/live-auth.spec.ts` | 初回password、TOTP必須/誤code拒否、失効401、停止403、operator回復、新TOTP、旧token拒否 | 未実施 |
| remote scale/CAS/rollback | 50社500診断、別5名同時1勝/4競合、0行後続書込なし、失敗batch全rollback、DB上限内 | 未実施 |
| R2/S3/GuardDuty | 待機は配布不可、cleanの実bytes一致、EICAR拒否、他顧客404、偽装タグ拒否、復元は再検査必須 | 未実施 |
| 専用OpenAIproject/実payload/Worker製品API | 専用生成キー、gpt-6-sol利用可、data settings/予算確認、実5キー一致、Worker生成/run取得/下書き採用、永続run/非返還累計予約（transport単独は不可） | 未実施 |
| 上限Excel/PDF | 約10MiB取込、500診断環境、81回答/100証跡/100課題、診断1MiBの90%以上、両生成≤120s、全内容と集計一致 | 未実施 |
| ブラウザ/文書画像 | 端末/CPU/RAM/Worker heap記録、1440/640画像、全81本文/改ページ/フォントhash/欠字なし | 未実施 |
| backup/restore/RPO/RTO | 日次export+対応manifest、全テーブル/証跡hash一致、隔離Workerで新認証/業務更新/再scan取得、RPO≤24h/RTO≤8h | 未実施 |
| retention | 3年/30日候補一覧、対象確認/plan hash、承認前deleted=0、30日期限rule有効化の判断記録 | 未実施 |
| 日次運用/費用 | 復元ドリル後の手動/翌日schedule成功、24h鮮度監視手順、初回予算内の実計数 | 未実施 |

最終cloud機械試験コマンドは `vp exec vitest run -c vitest.live.config.ts`。準備用のfilter実行は最終全件の代用にならない。RELEASE_CHECKには非秘密の測定値・stderrの固定error code・failedの理由も記録する。

## 出荷判断に残ること

独立レビュー、最終HEADのcheck/build/必要試験、対象inventory、全実受入、日次backup継続確認、費用見積/実計数、専用OpenAIキー/data settings確認が必要。受入で失敗した場合は原因と制約をここへ記載して修正・再測定する。基準を緩めて合格に変更しない。本番公開先・資格・運用者・切替/切戻し手順を示し、測定後にユーザーの公開判断を得る。匿名trialの承認だけではproduction route/domainや実顧客データ送信を有効化しない。
