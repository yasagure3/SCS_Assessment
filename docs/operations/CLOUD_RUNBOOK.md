# 匿名クラウド検証と復元の運用

Issue #27 の選定先は Cloudflare Workers/D1/非公開R2、Amazon Cognito、東京の非公開S3＋GuardDuty Malware Protection for S3、OpenAI gpt-6-sol。国内限定要件はない。匿名検証を進める承認と本番公開の判断を分ける。実測の正本は [RELEASE_CHECK.md](RELEASE_CHECK.md)。既存 `scs-assessment-preview`、元Excel、保存済み報告版は対象にしない。

## 対象と上限

Worker は `scs-assessment-trial-verification`、DB は同名 `-db`、復元DBは `-restore-db`、R2は `-evidence` / `-backup` / `-restore`。復旧試験Workerだけは同名 `-restore`。S3は `scs-trial-scan-<承認AWS account>-verification`。承認アカウントID・実際の各IDは `.local/cloud-input.json` に保持し、公開用例は [cloud-input.example.json](cloud-input.example.json)。例は `offlineOnly:true` で実deployを拒否する。

初回上限は担当者10名、同時操作5名、50社×10診断=500、DB 1 GB、検査用100ファイル/100 MB、証跡・バックアップ・隔離復元コピーの合計2 GB。GB/MBは10進のbyte数で制限する。個別ファイル10 MiBの既存仕様は維持する。初回AI以外$10、AI $5かつ30回。月額管理目標はAI以外$30、AI $20。価格・税・契約期間・既存利用量・課金表示の遅延を運用者が確認する。月額目標は事業者側の自動停止保証ではない。

試験を始める前に東京のGuardDutyファイル/byte課金、S3 PUT/GET/タグ/保管、Cognito、Workers Paid、D1、R2、通信費の見積を記録する。初期試験のScanは通常ファイルとEICARの2件、復元後再検査1件を基本とし、再実行も累計へ加える。Scan予約はD1の追記専用台帳で100件/100 MBを超える前に拒否する。失敗・再検査も返還しない。隔離restoreは同じS3を使うため、両DBの重複しないattemptとS3の実オブジェクト数を合算して上限を確認する。バックアップ処理もR2全3バケットの実使用量を加算して2 GB超過を拒否する。上限を緩めて試験を通さない。

## IaCと秘密の分離

1. `terraform/envs/trial` と `terraform/envs/production` は別のstate。`terraform/envs/prod` は旧テンプレートであり今回のクラウド構築には使わない。専用の非公開 `TF_DATA_DIR`、state、planを `.local/` に指定する。リソース作成前に account ID、東京、create/update/delete の全対象を確認する。既存preview・他用途GuardDutyは含めない。
2. TerraformはUser Pool（招待専用、TOTP必須、7日、secretなしClient）、D1×2、非公開R2×3、private/versioned/encrypted S3、専用Malware Protection plan、専用IAM policyを管理する。無関係のGuardDuty detectorを有効化しない。stateにアクセスキーを作るresourceはない。productionは `production_creation_confirmed=false` でplanを拒否し、Cognito削除保護ACTIVE、D1/R2/S3はprevent_destroy。
3. runtime IAMは**専用**principalへ出力の `runtime_policy_arn` を付与する。`AdminGetUser/AdminCreateUser` と検査prefixの `PutObject/GetObjectVersion/GetObjectVersionTagging` のみ。root、管理者用アクセスキー、Terraform実行キーをWorkerへ登録しない。STS session tokenを使う場合は期限前に3秘密を同時更新する。ローテーション後に招待・検査の疎通を確認し、旧キーを失効させる。
4. MFA回復は別operator権限。選定Poolに限定した `DescribeUserPool/GetUserPoolMfaConfig/DescribeUserPoolClient/AdminGetUser/AdminCreateUser/AdminUserGlobalSignOut/AdminDeleteSoftwareToken`、負荷用SUPPRESSユーザーに必要な明示的セットアップ権限を運用者に付ける。回復権限をruntimeへ足さない。
5. Cloudflare tokenは対象account内でWorker編集/D1編集/R2設定読取を必要範囲に限定する。R2 S3資格は今回の3バケットだけ。backup定期実行にはD1 export/readと次表の別資格を使い、deployやAWS資格を渡さない。資格・state・plan・SQL・token・OTP・TOTP secret・生成PDFをgit/CI artifact/チャットへ出さない。

| 定期backupの対象 | 必須操作 | 資格設定 |
|---|---|---|
| `-evidence` | List / Get | 対象バケット限定の読取 |
| `-backup` | List / Get / Put / multipart開始・完了・失敗時中止 | 対象バケット限定の読取・書込 |
| `-restore` | List（3バケット合計2 GB照合） | 対象バケット限定の読取。R2の資格単位がObject Readの場合はGetも含むが書込は許可しない |

GitHub Environmentの `SCS_BACKUP_R2_ACCESS_KEY_ID` / `SCS_BACKUP_R2_SECRET_ACCESS_KEY` には3バケット限定のObject Read資格を登録し、`SCS_BACKUP_WRITE_R2_ACCESS_KEY_ID` / `SCS_BACKUP_WRITE_R2_SECRET_ACCESS_KEY` にはbackupバケットだけのObject Read & Write資格を登録する。workflowは前者をList/Get、後者をbackup書込・multipartに使う。3バケット共通の書込権限へ広げない。いずれかのListが403ならbackupは完了manifestを発行せず失敗させる。`cloud-backup.check.mjs` が専用資格での成功と3種それぞれのList不足時の書込0回、`cloud-io.check.mjs` が署名資格の使い分けを検査する。

資格名・対象バケット選択は [Cloudflare R2 Authentication](https://developers.cloudflare.com/r2/api/tokens/) のS3互換API向けObject権限に従う。restore操作時は定期backup用writer環境変数を外し、別途承認した復元operator資格を使う。

以下は運用者が公開IDの入力を確認してから実施する。実環境へのコマンドは独立レビュー後の対象だけを扱う。Windowsでは必ず `./scripts/vp.ps1` を入口とする。Terraformの実行ファイルも `vp exec` 経由にする。

```powershell
# accountごとの認証とstate先を先に指定し、planを保存・確認してからapplyする
./scripts/vp.ps1 exec terraform -chdir=terraform/envs/trial init
./scripts/vp.ps1 exec terraform -chdir=terraform/envs/trial validate
./scripts/vp.ps1 exec terraform -chdir=terraform/envs/trial plan -var-file=../../../.local/trial.tfvars -out=../../../.local/trial.plan
# 確認済みplanだけをapply。public_configurationを .local/cloud-input.json に保存
./scripts/cloud.ps1 -Config .local/cloud-input.json -Action Prepare
./scripts/cloud.ps1 -Config .local/cloud-input.json -Action DryRun
./scripts/vp.ps1 exec wrangler d1 migrations apply scs-assessment-trial-verification-db --remote --config .local/cloud/wrangler.json
```

`./scripts/cloud.ps1 -Action Deploy` は `SCS_LIVE_ALLOW` が入力のWorker名と一致する匿名trialだけ許可する。build時に環境を選び、生成Workerのaccount/DB/R2/vars、SPAのPool/Client、静的配信がdist/clientだけであること、fixture/秘密混入を確認する。復元用は同じコマンドに `-Restore` を付ける。通常trialとは別名・別bindingで、OpenAIは強制disabled。本番の公開、route/custom domain、既存previewへのdeployをこのスクリプトは行わない。

Worker秘密は `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、必要時 `AWS_SESSION_TOKEN`、承認したSCS専用projectの `OPENAI_API_KEY`。`VITE_*` / JSON input / tfvars / `.env` に秘密を入れない。対話的 `vp exec wrangler secret put <name> --config .local/cloud/wrangler.json` 等で本文を表示せず登録する。復元Workerも独立してAWS秘密を登録する（OpenAIキーは不要）。Worker新規作成時のsecret登録順はWranglerの確認表示で対象名を照合する。

## 実認証とテスト入力

[AUTH_OPERATIONS.md](../AUTH_OPERATIONS.md) の本人確認・初期管理者bootstrapを専用Pool/DBだけに実施。招待メールは明示許可された本人管理メールだけ。公開先の設定画面から実招待し、`SUPPRESS→sub/予約属性照合→RESEND` の実行結果と監査を記録する。通常のメール再送は行わず、期限/failedの試験は別の明示的操作として承認先だけで実施する。

同時操作用5名と未割当の1名は、operatorが専用Pool内にsynthetic address＋SUPPRESSで作成してよい。CLI/SDKの**実Cognito** challengeで仮パスワード変更・TOTP登録を行い、アプリの対応するapp_userを管理者手順で登録する。無関係な社員への招待や5名分の実メールは不要。本人UIテスト用ユーザーとは分け、10名を超えない。SDK stub、fixture token、管理者全員のtokenでは認可/同時操作の代用にならない。

実suiteは以下をoperatorプロセス環境で受け取り、ファイルを探して資格を流用しない。値そのものをログへ書かない。

| 入力 | 用途 |
|---|---|
| SCS_CLOUD_INPUT / SCS_LIVE_ALLOW / SCS_LIVE_BASE_URL | .local公開設定、専用Worker名、対応するhttps workers.dev origin |
| SCS_CF_API_TOKEN / SCS_R2_ACCESS_KEY_ID / SCS_R2_SECRET_ACCESS_KEY | 実inventory、DB照合、private R2 backup/restore |
| SCS_AWS_ACCESS_KEY_ID / SCS_AWS_SECRET_ACCESS_KEY / 任意SCS_AWS_SESSION_TOKEN | operatorの実STS、Cognito設定/回復、S3/GuardDuty照合 |
| SCS_LIVE_TOKENS_JSON | 5 distinct app_userの有効access token配列。先頭admin、他は割当staff |
| SCS_LIVE_OTHER_TOKEN | 検証対象顧客への割当がないstaff |
| SCS_LIVE_TEST_EMAIL / SCS_LIVE_MAILBOX_CONFIRMED | 同じ明示許可メール |
| SCS_LIVE_TEMP_PASSWORD / SCS_LIVE_PASSWORD / SCS_LIVE_OPERATOR_ACCESS_TOKEN | 本人専用招待、設定するpassword、別adminの実session |
| SCS_OPENAI_API_KEY / SCS_OPENAI_DATA_CONFIRMED=true | SCS専用projectとモデル利用/データ設定を照合した生成用キー |
| SCS_COST_ESTIMATE_CONFIRMED | 初回非AI$10内の見積を確認した専用Worker名 |
| SCS_BACKUP_MANIFEST / SCS_RESTORE_MEASUREMENT | 完了したbackupとprepare-restoreのローカルmanifest/measurementの絶対パス |
| SCS_RECOVERY_EVIDENCE | backup前のclean/EICAR準備試験が保存した `.local/live/recovery-evidence/<cleanFileId>.json` の絶対パス。実fileId/SHA-256/sizeとsource Worker/DBを復旧対象の照合に使用 |
| SCS_LIVE_RESTORE_BASE_URL / SCS_LIVE_RESTORED_TOKEN | 隔離復元WorkerのURLと復元失効境界より後に新ログインしたadmin token |

Playwrightのtrace/video/認証画面スクリーンショットは無効。ブラウザにpassword/token/TOTPを永続化しない。本人が手動登録を済ませたユーザーを「初回招待状態」と偽って試験しない。親のUI handoffと自動suiteは同じ状態遷移を二重実行しないよう日程を合わせる。

## 実測の順序

1. 実inventory検査（account、専用ID、MFA、private、S3 version、GuardDuty ACTIVE、Worker全公開binding）は全live入口の必須preflight。VitestはbeforeAll、live-authは最初のnavigation前、性能試験は最初のAPI前、隔離復旧はrestore WorkerのAPI前に成功を要求する。照合失敗時は `/me` を含む製品要求・データ作成・生成を行わない。テストを個別選択してもこの前提は外れない。500診断/5並行CAS/remote rollback/clean＋EICARの初回準備は `vp exec vitest run -c vitest.live.config.ts -t 'creates at most|rolls back|holds actual'`。必要入力が欠けたら失敗する。履歴を削除したりskipして合格にしない。
2. `vp exec playwright test tests/e2e/live-auth.spec.ts`。実招待→TOTP必須→誤コード拒否→全端末失効→停止→operatorによるTOTP削除→新secret再登録→旧token拒否。続けて500診断環境で約10 MiB Excelを実ブラウザ解析し、100証跡/100課題/81回答で診断文書1 MiBの90%以上をPDFとExcelへ出力する。両生成は120秒以内、パーサは10秒の製品上限、ブラウザ選択＋remote previewの観測は15秒以内。Pythonの独立内容照合/画像化は別時間を記録し、UIの120秒を延長しない。PC型/CPU/メモリ/実Worker heapを測り、対象端末の記録として残す。低性能端末一般の保証に置き換えない。
3. 手順1の `cloud-results.json` の `scan.recoveryEvidencePath` を `SCS_RECOVERY_EVIDENCE` に固定し、そのclean/EICAR両件を含めて、完成した報告版のbackup→隔離restore→新規ログインを実施する。最後に `vp exec vitest run -c vitest.live.config.ts` を全件実行する。全件試験のscanは新しいファイルと別名の識別JSONを作るため、環境変数はbackup前のパスのまま維持する（新しい `cloud-results.json` のパスへ差し替えない）。識別JSONは上書き禁止で保存され、manifestの先頭・UUID順・ファイル名から正常ファイルを推測しない。両件のID/hash/sizeがbackupと一致しない場合は受入失敗とする。AI受入の前に公開inputを `openAiMode:trial` にし、専用Workerへ承認キーと同じ設定をdeployする。5キーpayloadの送信境界確認（`openaiTransport`）に加え、Workerの製品APIから生成→run取得→永続run/予算照合→検証済み下書き採用（`openaiProduct`）を行う。前者だけでは合格にしない。通常2回/20 centsの予約を累計へ含め、未設定503・provider502・timeout504・予算429は受入失敗とする。復元の全行hash/証跡hash、復元後業務更新と再検査も検証する。OpenAIの失敗も予約を返還せず、勝手にリトライしない。
4. `.local/live/{auth,performance,cloud}-results.json`、report-qaの独立検査、幅1440/640とPDFページ画像、コマンドexit code、resource inventoryとsecret値を除く版をRELEASE_CHECKに転記する。合格していない項目があればIssueをcloseしない。

負荷データ名は匿名検証1〜50/匿名診断1〜10。既存の非匿名データがあるDBでは停止する。最終suiteのCASはmain trialのrevisionを進めるため、復元データはバックアップ時点を正本に比較する。ブラウザの取込と復元後業務更新は一度だけの測定。再実行には記録を残して別の空の専用検証/復元先を用意し、既存の証跡や台帳を消して試験を通さない。

## バックアップ、隔離復元、RPO/RTO

```powershell
./scripts/vp.ps1 exec node scripts/cloud-backup.mjs backup .local/cloud-input.json
./scripts/vp.ps1 exec node scripts/cloud-backup.mjs prepare-restore .local/cloud-input.json .local/backups/<id>/manifest.json
# measurement.jsonに記録したsqlFileとhash、restore DB IDを照合してから適用する
./scripts/vp.ps1 exec wrangler d1 execute scs-assessment-trial-verification-restore-db --remote --file .local/restore/<id>/restore.sql --config .local/cloud-restore/wrangler.json
./scripts/cloud.ps1 -Config .local/cloud-input.json -Action Deploy -Restore
```

restore用configは先に `cloud.ps1 -Action Prepare -Restore` で作る。空でないD1へのprepare-restoreは拒否。R2もIf-None-Matchで上書きを拒否する。DB exportは署名URLを固定されたR2 originから取得し、DB時点に含まれる証跡のid/key/size/SHA-256をprivate backupに複製する。ready/uploading/rejectedの配布状態にかかわらず、R2に保管済みの証跡をhash照合して隔離backup/restoreへ含める。再検査失敗でも旧report/historyとbytesを保持する。R2に存在しないrejected uploadと未保存の0 byte uploadingはmanifestのomittedFilesへ理由を記録し、存在するが破損したbytes、ready等の必要object欠落、checksum不足時は完了manifestを発行しない。rejectedの復元後も配布拒否を維持し、明示的再検査のclean結果だけで配布する。SQLは最大1 GBをoperatorメモリに保持するため、検証端末に十分な空きメモリが必要。大きいR2 uploadは8 MiB multipart、失敗uploadはabortする。

復元SQLは全scan判定をfailed、元readyファイルをuploading、全app_userの失効境界を復元時刻+5秒以降へ進める。全テーブルを復元SQLの実SQLite結果と比較し、証跡をR2から再読込みhash照合する。その後、新しい実認証で隔離Workerの診断を読取り/更新する。`SCS_RECOVERY_EVIDENCE` の正常ファイルをID/hash/sizeで照合し、初めはuploadingかつ配布409、明示的再検査後にのみready/取得200となり、取得bytesのhash/sizeが準備時と一致することを確認する。同じ記録の検出済みEICARは、復元直後と正常ファイルの再検査完了後の両方で、同じID/hash/size、rejected、配布409を確認する。EICARを正常復旧の対象にせず、保持と配布拒否を別に検証する。結果は `cloud-results.json` の `restore.restoredEvidence` に両件のID/hashと拒否確認を残す。コピーだけの完了を業務復旧と扱わない。

ローカル回帰は `./scripts/vp.ps1 test --run tests/acceptance/restored-evidence.test.ts`。実backup/prepare-restoreとSQLiteでready/uploading/rejectedの全6順列を通し、全bytes保持・正常ファイルだけの再検査・検出済みファイルの配布拒否を検査する。入力不一致、拒否漏れ、復旧download破損の失敗対照も含む。外部HTTPだけを置換した試験であり、実GuardDuty/EICARや実クラウド復旧の合格を意味しない。実環境DoDは未実施のまま保持し、この回帰の成功だけでIssueをcloseしない。

RPOは障害想定開始（prepare-restore.startedAt）からbackup開始時点まで24時間以内、RTOはその開始から全内容照合＋認証/業務更新/再検査完了まで8時間以内（1営業日を保守的に8連続時間として測定）。失敗で時計をリセットしない。復旧後のmain/preview切替は行わない。

`.github/workflows/backup.yml` は既定無効。初回復元ドリル成功後、専用GitHub Environmentへ最小秘密と公開inputを設定し、資格・対象Worker/DB/3バケットを確認する。次にjobの実行条件であるrepository変数 `SCS_BACKUP_ENABLED=true` を設定してから手動dispatchし、成功と完了manifestを確認する。その後、翌日の日次成功を確認して運用受入へ記録する。日次00:15 UTC。schedulerに厳密時刻の保証はないため最新完了manifestの経過時間を営業開始時にも確認し、24時間へ近づいたら手動backup、超過/失敗なら出荷条件未達として対応記録を残す。workflow実行失敗通知の宛先は既存運用者が管理する。再送ループや業務メール通知は追加しない。週次にmanifest/hash、月次とmigration前に隔離復元を実施する。

## 保持期限、削除前確認、再検査

`customer_contracts` は確認した契約終了日(UTC日付)、確認者ID、時刻を運用者が登録する。archive日を契約終了日に推測しない。未確認の顧客は削除候補に入れない。

```powershell
./scripts/vp.ps1 exec node scripts/cloud-backup.mjs retention-dry-run .local/cloud-input.json
```

本体は終了日の3年後（2月29日は3年後2月末）、backupはobject最終更新から30日で候補を列挙する。出力はworker/DB、顧客ID、診断ID、file key/size/hash、backup key/size/date、plan hashと `deleted:0`。この出力は機微な運用記録なので `.local/` に保存する。契約・保留/訴訟等の別保持指示・旧report/history参照・最新健全backupを担当者が照合し、承認者とplan hashを記録してから個別の保守操作を準備する。誤り/対象変化があればdry-runをやり直す。アプリ内archive/関連解除は物理削除をしない。

実データ削除を自動実行するCLIは設けていない。物理削除は停止時間内に、対象顧客の参照グラフ（reports/history/evidence/tasks/files/scan/cases/assessment/membership/監査保持方針）を含む個別レビュー済みmigrationとR2対象一覧で行う。immutable triggerを包括的に外したり、bucketを再帰的に消す操作は禁止。監査と承認記録を残し、復元検証済みbackupの期限が到来するまで保持する。削除対象の復元が必要なら隔離先へ復元する。

backupの30日期限削除は `backup_expiry_confirmed=false` が既定。dry-run対象・namespaceを確認し承認した後だけtrial/prodの同変数をtrueにしたplanを確認する。S3は検査用コピーだけ7日で期限切れ、R2の正式証跡は消さない。期限切れ設定を変更した時刻と対象を残す。

管理者が `POST /api/v1/files/:id/rescan`（UUID Idempotency-Key）を明示すると新attemptで再検査し、その間は配布を止める。同一keyは新しいcopyを作らない。予約直後の中断は再送で二重copyをせず現在状態を返すので、運用者が現scanと予算を確認した後に新しいkeyでやり直す。scan行は現attemptのみ、再検査監査と非返還の予算台帳を保持する。旧結果・重複/偽装通知からreadyへ変えるHTTP入口は存在しない。S3の版指定HEAD/タグ読取りだけが判定の根拠で、R2 version/key/hash/sizeが一致し `NO_THREATS_FOUND` の場合だけ配布する。失敗/不明/非対応/権限不足/検出/待機は配布不可。24時間待機はfailedとし、復元や従来ready行は再検査対象。

## 公式根拠

- [Cognito AdminDeleteSoftwareToken](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminDeleteSoftwareToken.html)：operatorがPool/Username指定で削除、必須MFAの次回ログインで再登録。
- [GuardDuty IAM要件](https://docs.aws.amazon.com/guardduty/latest/ug/malware-protection-s3-iam-policy-prerequisite.html)、[結果と版](https://docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html)、[S3版指定タグAPI](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectTagging.html)。
- [D1 export/query API](https://developers.cloudflare.com/api/resources/d1/)、[R2 private設定API](https://developers.cloudflare.com/api/resources/r2/)。
- [OpenAI設定と予算](OPENAI_SETUP.md)。本文を含むpacket captureやログを作らず、5キーとinput hash、request ID、予約台帳だけを実測へ残す。

