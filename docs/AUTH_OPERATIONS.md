# 認証の運用と確認

この手順は運用者が実施するための準備資料です。今回の製造ではAWSリソース作成、招待メール送信、本番D1更新を実行していません。

## 初期管理者

1. F04で利用先を決め、実CognitoのUser PoolとClientを用意する。自己登録は禁止、MFAはON、Software tokenは有効、Client secretなし、SRPとrefreshのみを許可する。実機でTOTP設定・ログインを確認する。motoでの成功を代用しない。
2. 運用者が対象管理者を本人確認し、CognitoのAdminCreateUserで招待する。初期パスワードはリポジトリやシェル履歴に書かない。AdminCreateUserの応答を `.local/invited-admin.json` に保存する。
3. 同じ対象のDescribeUserPool、GetUserPoolMfaConfig、DescribeUserPoolClientの応答を `.local/pool.json`、`.local/mfa.json`、`.local/client.json` に保存する。GetUserPoolMfaConfigにはPool IDが含まれないため、採取元Pool IDを作業記録で照合する。
4. `vp exec node scripts/bootstrap-admin.mjs --pool .local/pool.json --mfa .local/mfa.json --client .local/client.json --user .local/invited-admin.json --out .local/bootstrap-admin.sql` でSQLを準備する。これはネットワークやDBへ接続せず、既存ファイルも上書きしない。
5. SQLと対象DBを確認してから、運用者が適用する。ローカル検証は `vp exec wrangler d1 execute scs-assessment-db --local --file .local/bootstrap-admin.sql`。本番への適用はF04の承認・設定確認後に別途実施する。
6. 出力に管理者1名・invitedがあることと `user.bootstrap` の監査を確認する。既存のadminがいれば挿入は0件で終了する。監査の適用が中断された場合は同じSQLを再適用できる。別メールで管理者を追加する迂回には使わない。
7. 仮パスワード→新パスワード→TOTP登録→コード検証→GET `/api/v1/me` を完了すると、招待時のsubと一致したアカウントだけがactiveになる。

運用者が既存ユーザーをメールだけで別subへ付け替えることは禁止する。設定値は環境ごとに明示し、秘密情報や採取したJSON/SQLは `.local/` 外へコピーしない。

## MFA端末紛失・不正利用

- 既存の連絡経路で本人確認し、対応者と日時を記録する。メールから申告された情報だけで解除しない。
- 管理者が対象アカウントを停止し、`revoked_before` を `max(既存の境界値, floor(サーバー現在時刻のUNIX秒) + 5)` に進める。JWTが許容する5秒の時計ずれを含め、停止時点で受理できるすべての既存セッションを失効させる。別のactive adminを確保し、最後の管理者保護を解除しない。
- 実CognitoでAdminUserGlobalSignOutを実行する。紛失端末のTOTP設定を運用者が回復し、次回ログインで再登録する。無認証の回復APIは用意しない。
- 本人のTOTP再登録を確認した後で再有効化する。`revoked_before` は消さず、過去の値へ戻さない。`auth_time <= revoked_before` の古いaccess tokenとrefresh由来の同じauth_timeをアプリが拒否することを確認する。新規ログインのauth_timeも境界以下なら拒否されるため、境界を過ぎてから改めてログインする（失効直後は数秒の待機が必要な場合がある）。

管理画面 `/settings` から停止・再有効化・役割変更・顧客割当を実行する。停止でアプリの失効境界を保存する。Cognitoの全セッション失効とTOTP回復は上記運用者手順を続ける。運用設定・AWS権限・復旧実機テストはF04の完了条件。

## 招待と再発行

管理者が「管理・利用設定」で社内メール・役割・最初の割当を入力し、招待メールを送信する。顧客名や担当者名からの自動送信は行わない。送信成功の招待期限は7日、期限時刻と同時以降は初回ログインを拒否する。既に利用開始済みのユーザーにはこの招待期限を適用しない。

- `failed`：送信結果が失敗。入力を確認し、招待一覧の「招待を再発行」を明示的に選ぶ。通常のAPI再送ではメールを再送しない。
- `expired`：同じユーザーへの再発行で7日期限を更新する。メールを変えて二重アカウントを作らない。
- `processing`：外部操作は各5秒上限。処理開始から5分待ち、状態を再読み込みしてから、必要な場合だけ再発行する。応答喪失時はメールが送信済みの可能性があるので、利用者へ確認する。自動再試行・DB行の削除はしない。
- `pending`：予約後、処理開始前の中断。招待一覧の「招待を再発行」で同じ予約の処理を開始できる。同じIdempotency-Keyによる元の操作の再送も可能。どちらもDBで1回だけ処理を獲得する。別メールで作り直さない。

未設定は503、送信サービスの失敗は502、各5秒の時間切れは504を返し、初回・再発行とも同じキーの再送では保存したエラーを返す。再発行の失敗応答を画面が受け取った後、もう一度「招待を再発行」を選ぶと新しい操作になる。ネットワーク切断で結果が不明な場合は同じ操作キーで確認し、勝手に新しい送信を開始しない。初回の送信フォームをもう一度押しても確定失敗した招待を再送しないため、招待一覧の再発行を使う。

プロバイダーへはまず `SUPPRESS` で作成し、予約属性 `custom:app_user_id` とsubを確認・保存してから同subに `RESEND` する。応答喪失からの回復は予約属性一致を必須とし、メールだけで別subへ付け替えない。`attempt_id` が古い完了結果は新しい処理結果へ反映しない。仮パスワード・招待メール本文・秘密鍵をDBやログから探す運用は不要で、これらは保存しない。

未使用招待を停止した場合も失効境界が残り、復旧後は招待中へ戻る。初回パスワード変更・TOTPを経て有効化する。管理画面の「有効」を選ぶだけで初回認証を済ませた扱いにはしない。

### F04でのCognito管理接続

Issue27のproduction compositionには東京Cognitoの署名済み管理transportを注入した。未設定/不一致のPool・AWS資格では閉じて失敗する。匿名fixtureを有効にする環境変数はない。Terraform定義のimmutableな `app_user_id`、AdminGetUser/AdminCreateUser のruntime最小IAM、実Poolの7日と招待専用・MFA必須設定を実機照合する。資格/秘密登録と実測は [CLOUD_RUNBOOK.md](operations/CLOUD_RUNBOOK.md)。他用途のキーやrootをruntimeへコピーしない。

TOTP紛失では停止とアプリ失効を先に保存し、別operator資格で `AdminUserGlobalSignOut` と [AdminDeleteSoftwareToken](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminDeleteSoftwareToken.html) を対象Pool/Usernameへ実行する。TOTP必須Poolでは次回ログインのMFA_SETUPで新しい認証アプリを登録する。削除/回復権限をWorker runtimeへ付けない。本人確認後、Cognito再登録とアプリ再有効化を行い、旧tokenの拒否を測定する。自動試験では停止中の403を確認し、operatorの本人確認済み手順で再有効化してから新登録を完了する。実受入が未完了なら本番対応完了と記録しない。

## 全端末のログイン失効

`POST /api/v1/session/revoke` はIdempotency-Keyを要求する。D1でcutoff・操作記録・監査・`auth_revocations` を同時保存した後、Cognito GlobalSignOutを最大5秒で試行する。失敗してもアプリの既存セッション遮断を維持し、failedと固定エラーコードを保存する。トークン本文は保存しない。

cutoffは `max(既存の境界値, floor(サーバー現在時刻のUNIX秒) + 5)` とし、`auth_time <= cutoff` を拒否する。pending/processing/failedを運用者が確認し、対象subに対するAdminUserGlobalSignOutを実施する。再試行結果は作業記録と追加監査に残す。新規ログイン以外はcutoffを超えないため、同じ失効済みtokenによるAPI再送も401になる。JWTの署名・有効期限チェックだけではCognitoの失効を検知できないため、このアプリ側cutoffを必ず適用する。

## 参考と検証の境界

- [AWS TOTP MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
- [AWS access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [AWS GlobalSignOut](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GlobalSignOut.html)

JWTに独自のmfaCompleteを要求・信用しない。招待専用かつMFA必須の実Pool設定が前提。APIは検証済みsub、発行・認証時刻、現在のapp_usersと顧客割当を照合する。ブラウザもTOTP challengeを経ずに発行されたセッションを受け入れない。

自動E2Eは `tests/fixtures/` の別構成で匿名のSDK代替を使い、製品と同じHono API・D1 adapterへ接続する。テスト設定はserve専用でビルドを拒否する。通常のビルドや環境変数からテスト認証へ切り替える経路はない。
