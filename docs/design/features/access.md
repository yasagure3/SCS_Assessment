# 招待・ログイン・MFA・社内権限

- 種別: 機能設計書
- 対象 UC: UC-008（US-017）
- 適用規則: BR-004,011,013,014

## 何を作るか

管理者が招待した社内利用者だけが、パスワードとTOTP認証後に許可顧客へアクセスできる。管理者全顧客/staff割当顧客というQ11の設計前提を採用する。認証・失効の共通ルールはDESIGN.md「認証と認可」が正本。

## 入出力と振る舞い

スケッチ「ログイン・MFA」「設定」。管理者は社内メール/role/顧客割当を入力し、招待発行ボタンでメール送信を実行する。メール送信は製品機能の仕様であり、設計作成中に実在社員へ送信する許可を意味しない。未招待者の自己登録画面は置かない。

初回は仮パスワード→新パスワード→TOTP登録→TOTP検証のCognito challengeを完了。通常はメール/パスワード→TOTP。SDK sessionはメモリだけに保持。エラー時は資格情報をログに出さず、同じチャレンジの再試行又は初期ログインへ戻す。秘密鍵/QR/TOTPは保存/送信ログへ残さない。

招待の有効期間は7日を初期設定としCognito temporary password validityと一致させる。DBのapp_usersはinvited、Cognito subが確定し有効な初回ログインtokenを検証した時点でactiveへ。メール一致だけで既存別subへ紐付けない。Cognito AdminCreateUserの結果subを予約ユーザーへ結び付ける。再発行は同じsubの招待状態を更新し、二重アカウントを作らない。

## API

| API | request | data |
|---|---|---|
| GET /me | Bearer access token | {id,email,role,customerIds,status}。初回のinvited→active処理を含む |
| GET /users | cursor?,limit?（管理者のみ） | users/id/email/role/status/revision |
| GET /users/invitations | cursor?,limit?（管理者のみ） | 招待状態/期限、nextCursor |
| POST /users/invitations | {email,role,customerIds}＋Idempotency-Key | {invitationId,status,expiresAt}、201 |
| POST /users/invitations/:id/retry | Idempotency-Key | 同招待の再発行状態 |
| PATCH /users/:id | {expectedRevision,mutationId,role,status:'active'|'suspended'} | 更新user/revision |
| PUT /customers/:c/members | {expectedRevision,mutationId,userIds} | {customerId,revision,userIds} |
| POST /session/revoke | Idempotency-Key | {revokedAt} |

招待管理/ユーザー変更/割当変更はadminのみ。membersはcustomer revisionのCAS。scope外ID又は不存在ユーザーは422で保存しない。self session revokeは本人のみでrevoked_beforeを設定しCognito全セッション失効も試みる。provider失敗でもアプリ側遮断は維持し再試行状態を監査に残す。端末内ログアウトはtoken/SWR/フォームを破棄するローカル操作で他端末を止めない。

初期管理者は公開APIで作らず、運用者用bootstrap手順でCognito招待とapp_usersを一度だけ作る。最後のactive adminの停止/降格は409 LAST_ADMIN。停止後の再有効化は管理者操作で可能だが、回復時はrevoked_beforeを維持する。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| token/Principal/Authorization Port | domain/usecase | src/server/modules/auth/domain/verifyAccessToken.ts、authorize.ts、usecase/manageAccess.ts |
| app_users/memberships/invitations | adapter | src/server/modules/auth/adapter/d1AccessRepository.ts、cognitoAdmin.ts、routes.ts |
| 共通認証middleware | adapter | src/server/modules/auth/adapter/authenticate.ts |
| MFA challenge/ログイン | front | src/front/pages/LoginPage.tsx、src/front/auth/cognitoSession.ts |
| 招待/割当UI | front | src/front/pages/SettingsPage.tsx |
| 招待/TOTP設定 | infrastructure | terraform/modules/cognito/main.tf、scripts/bootstrap-admin.* |

## エッジケースの決定

存在しないメールのログイン可否を細かく返さない。招待期限切れはadmin再発行へ。MFA端末紛失は本人確認した運用者が停止→全失効→TOTP回復→再有効化する手順書を用意する。回復用の無認証APIは作らない。認証基盤障害時に認証を省略しない。provider操作とD1は状態遷移を残して整合を回復し、メール再送は利用者の明示retryのみ。

## テスト方針

単体/Workers結合: JWT各claim/署名/期限/失効、未割当/停止/最後のadmin、割当CAS、招待重複/部分失敗/再発行。FrontはfakeのNEW_PASSWORD_REQUIRED/MFA_SETUP/TOTP challenge。E2E golden path: テスト招待→MFA→割当顧客だけ表示→停止で既存tokenも拒否。本番出荷前に実Cognitoで同フローと端末紛失回復を確認し、moto成功を代替にしない。
