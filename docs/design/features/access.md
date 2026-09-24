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
| GET /customers/:c/members | 管理者のみ | {customerId,revision,userIds}。編集開始時の版と全割当を取得 |
| POST /session/revoke | Idempotency-Key | {revokedAt} |

招待管理/ユーザー変更/割当変更はadminのみ。membersはcustomer revisionのCAS。scope外ID又は不存在ユーザーは422で保存しない。self session revokeは本人のみでrevoked_beforeを設定しCognito全セッション失効も試みる。provider失敗でもアプリ側遮断は維持し再試行状態を監査に残す。端末内ログアウトはtoken/SWR/フォームを破棄するローカル操作で他端末を止めない。

JWT検証の時計差許容は5秒とし、失効境界は `max(既存のrevoked_before, floor(アプリ現在時刻/1000)+5)` にする。検証と失効は同じ許容幅を参照し、失効時点ですでに許容された未来のauth_timeも含めて遮断する。比較は引き続き `auth_time <= revoked_before` で、iatだけ更新されたrefresh後tokenも拒否する。返却するrevokedAtはこの境界のUTC時刻。境界と同秒までの新規ログインも拒否されるため、失効直後の再ログインは数秒待ち、auth_timeが境界を越えた新しいセッションを取得する必要がある。provider失敗や時間経過で古いセッションが再有効化されることはない。

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

時計差の回帰試験はローカル署名JWTと実D1の製品APIで、auth_time/iatの現在比-1/0/+1/+5/+6秒とprovider成功/失敗を組み合わせる。許容された旧tokenはprovider呼出し中から401、10秒経過後の旧token・同auth_timeのrefresh後tokenも401、許容外+6秒は失効前から401とする。新規ログインのauth_timeが失効境界と等しい場合の401、境界を越える場合の200、時計が戻った場合に既存境界が後退しないことも確認する。

## A02 の実装上の決定

招待は同じメール（前後空白除去・小文字化）の予約を重複作成しない。`pending → processing → sent / failed` を記録する。Cognitoのメール専用Poolでは任意のusernameを使えないため、作成時にimmutableな `custom:app_user_id` へ予約ユーザーIDを設定する。`AdminCreateUser(SUPPRESS)` のsubをD1へ保存した後、同subに `AdminCreateUser(RESEND)` を実行する。送信先は明示された社内メールだけで、電話番号/SMSや顧客担当者欄を使用しない。[AWS AdminCreateUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html)

作成応答を受け取れなかった場合、明示retry時の `AdminGetUser` が返す予約属性とsubを確認してから回復する。メール一致だけで別アカウントへ関連付けない。同じsubの再発行では新しいアカウントを作らない。署名済みIAM transportとPool IDはcompositionから注入し、未設定時は503。A02では本番接続を有効にせず、別compositionの匿名fakeだけを使用する。F04でimmutable属性の追加、権限、実Poolの7日期限・MFA・回復を検証してtransportを接続する。

外部操作1回の上限は5秒。`attempt_id` と `processing_started_at` を予約時に保存し、同時retryはD1条件と共通operation ledgerで1回だけ獲得する。送信失敗の自動再試行はしない。`processing` の応答喪失・中断は5分経過後に管理者の明示retryだけを許可する（外部timeoutより十分長い待機）。既にメールが届いた可能性を画面・手順で伝える。古いattemptの結果は新attemptを上書きできない。仮パスワード、メール本文、TOTPはDBへ保存しない。

予約直後・処理獲得前の中断で残った `pending` も管理者の明示retryを許可する。ページ再読込で元の操作キーが失われても、招待一覧から同じ予約を回復できる。元のPOST再送と新しい明示retryが競合してもDBの状態条件で1回だけ獲得する。

招待処理の未設定は503 `SERVICE_UNAVAILABLE`、通常の失敗は502 `PROVIDER_FAILED`、5秒の上限到達は504 `PROVIDER_TIMEOUT` として記録・返却し、同じ操作キーの再送でも区別を保持する。初回POSTの再送は同じキーを使い、外部送信を繰り返さない。明示retryでAPIから確定した上記エラーを受けた後、管理者が再び再発行を選ぶと新しいキーで別attemptを開始する。通信切断や応答不明の場合は同じキーを保持し、結果確認の再送で二重送信を防ぐ。

`sent` の期限が現在時刻以下なら一覧に `expired` を返し、初回有効化を拒否する。初回有効化済みの利用者を招待期限で停止しない。期限切れを再発行すると同subの期限が7日後へ進む。未使用の招待も停止でき、再有効化は `invited` へ戻して初回ログイン・期限検査を維持する。

招待時の初期割当は予約と同じbatchで追加し、対象customerのrevisionを進める。割当置換はGETで取得した全userIdsを保持し、表示中の利用者ページ外の割当を消さない。顧客/ユーザーの不存在、保管顧客への初期割当、停止利用者への割当は保存しない。権限・CAS・最後のadmin条件はreceipt予約と同じbatch内で再検査する。招待一覧と利用者一覧はID順カーソルで50件（最大100件）。

設定画面内の顧客・利用者・招待のページ切替では、招待メール・役割・全ページの顧客選択を保持する。顧客の割当下書きと基準revisionは顧客ごとに保持し、顧客切替後に戻った場合も編集途中の選択を維持する。利用者の役割編集もページ取得中に破棄しない。未編集フォームだけを新しいサーバーのrevisionへ追随させ、編集済みフォームは競合を明示して再読込を求める。

### 継続操作中の期限切れ（F03）

APIが401で認証を拒否したときは、Cognito SDKのメモリ内sessionを取得し直す。新しいaccess tokenが得られた場合だけ、同じ本文・Idempotency-Keyで1回再試行する。403/404、通信結果不明、更新tokenがない場合は自動再送しない。並行した401のSDK更新を共有し、成功したsessionをSWRへ反映する。SDK取得も同時実行をまとめ、ログアウト時の世代検査で古い非同期結果を破棄する。

HTTP要求の開始時にログイン世代を捕捉し、初回HTTP応答後、SDK取得後のsession公開前、公開完了後の再送前に同じ世代であることを確認する。世代が変わった旧要求は元の401を返し、新しいログインのtokenで再送しない。同じメールでの再ログインも別世代とし、通常のtoken更新だけを同世代として扱う。共有SDK更新は世代に紐付け、古い更新の完了が新世代の更新待ちを解除しない。

token更新中も同じリソースのフォームを保持する。SWRの保持値には取得pathを付け、別顧客・別診断に遷移した場合は以前の値を表示しない。認証・認可の再確認が401/403/404なら既存の遮断とキャッシュ非表示を維持する。refresh後もCognitoのauth_timeは変わらないため、全端末失効を回復する経路にはしない。トークン・refresh tokenをlocalStorage/sessionStorage/cookieへ保存する処理は追加しない。

`sessionFetch.test.ts`は更新、同一要求の再送、並行更新の共有、拒否の維持をDI境界で検証する。`api.test.tsx`はRequireAuthと設定画面で共用する/meキャッシュ、更新中の未保存入力、別pathと認可失敗の非表示を確認する。`journey.spec.ts`は実画面で期限切れの読込・保存、全端末失効後の拒否、再読込後の再ログインを匿名SDK境界と製品APIで確認する。

`sessionFetchGeneration.test.ts`はGET・JSON更新・バイナリ送信の各族で、HTTP・SDK・session公開の待機中にログアウト／同一利用者再ログイン／別利用者再ログインした旧要求が再送されないことと、世代が変わらない通常更新の成功を対照にする。旧SDK更新と新SDK更新が重なる場合の共有・解除も検証する。Cognito境界の試験では、MFA完了だけで世代が変わらず、ログアウトと同一メールの新規ログインで世代が変わることを確認する。

### 試験の範囲

| 利用者シナリオ | 優先度 | 根拠 |
|---|---|---|
| admin限定・割当解除・停止と回復後の旧token遮断 | Critical | access-management Workers実D1試験、既存署名JWT失効試験 |
| 重複・部分失敗・同sub再発行・同時retry・期限境界・全体キー台帳 | Critical | access-management Workers試験 |
| 応答喪失の予約一致確認・別予約拒否・未設定時閉鎖 | Critical | cognitoAdmin transport単体試験 |
| フォームの入力保持・二重押下抑止・明示CAS再編集 | Major | AccessForms Front試験 |
| 設定画面のページ往復・顧客別下書き・確定失敗と通信不明の操作キー | Major | access-management-regressions Edge E2E（実SettingsPage・匿名API fixture） |
| 初回・retry・同キー再送の503/502/504契約 | Critical | access-management-errors Workers実D1試験（注入transport、実際の5秒上限） |
| 管理者の招待→初回パスワード/TOTP→割当顧客→停止 | Critical | access-management Edge E2E（匿名fake） |
| 実Cognito IAM/配信/immutable属性/MFA回復 | Critical・F04残 | ローカルfakeを本番合格の代替にしない |
