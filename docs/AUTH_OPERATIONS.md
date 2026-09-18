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
- 管理者が対象アカウントを停止し、`revoked_before` を現在のUNIX秒に進める。別のactive adminを確保し、最後の管理者保護を解除しない。
- 実CognitoでAdminUserGlobalSignOutを実行する。紛失端末のTOTP設定を運用者が回復し、次回ログインで再登録する。無認証の回復APIは用意しない。
- 本人のTOTP再登録を確認した後で再有効化する。`revoked_before` は消さない。古いaccess tokenとrefresh由来の古いauth_timeをアプリが拒否することを確認する。

管理画面からの停止・割当変更はA02で接続する。運用設定・AWS権限・復旧実機テストはF04の完了条件。

## 全端末のログイン失効

`POST /api/v1/session/revoke` はIdempotency-Keyを要求する。D1でcutoff・操作記録・監査・`auth_revocations` を同時保存した後、Cognito GlobalSignOutを最大5秒で試行する。失敗してもアプリの既存セッション遮断を維持し、failedと固定エラーコードを保存する。トークン本文は保存しない。

pending/processing/failedを運用者が確認し、対象subに対するAdminUserGlobalSignOutを実施する。再試行結果は作業記録と追加監査に残す。新規ログイン以外はcutoffを超えないため、同じ失効済みtokenによるAPI再送も401になる。JWTの署名・有効期限チェックだけではCognitoの失効を検知できないため、このアプリ側cutoffを必ず適用する。

## 参考と検証の境界

- [AWS TOTP MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
- [AWS access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [AWS GlobalSignOut](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GlobalSignOut.html)

JWTに独自のmfaCompleteを要求・信用しない。招待専用かつMFA必須の実Pool設定が前提。APIは検証済みsub、発行・認証時刻、現在のapp_usersと顧客割当を照合する。ブラウザもTOTP challengeを経ずに発行されたセッションを受け入れない。

自動E2Eは `tests/fixtures/` の別構成で匿名のSDK代替を使い、製品と同じHono API・D1 adapterへ接続する。テスト設定はserve専用でビルドを拒否する。通常のビルドや環境変数からテスト認証へ切り替える経路はない。
