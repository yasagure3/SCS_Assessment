# OpenAI 接続の設定と費用確認

Issue #47 はローカル fake HTTP と実 D1 の検証まで。実キーの読取り・登録、実 API 送信、クラウド変更・公開は実施していない。**このプロジェクトで利用可能な実モデルと実接続の成功は未検証**。以下の実環境手順は #27 で条件と実施権限を確認してから行う。

## 固定する接続条件

- Worker から `https://api.openai.com/v1/responses` にだけ送る。URL を設定する項目はない。リダイレクトも拒否する。
- モデルは `gpt-6-sol` だけ。標準処理 `service_tier: default`、`reasoning.effort: low`、`max_output_tokens: 2000`、`store: false`。ツール、検索、背景処理、会話 ID、前回 response ID を送らない。
- 顧客由来の入力は確認画面に出る 5 キーだけ。固定指示と JSON schema を含む HTTP JSON 全体を 20,000 UTF-8 bytes 以下にする。応答全体は 131,072 bytes 以下。拒否、未完了、ツール項目、不正な下書きは採用候補にしない。
- 生成の 30 秒期限、利用者ごと同時 1 件・毎分 5 回、顧客認可、同じ操作キーの再送防止は継続。AI 下書きは明示的な採用と人による確定を要する。

## 予算台帳と予約額

外部 HTTP の前に D1 `ai_budget_reservations` へ **1 回 10 米セント**を条件付き INSERT する。全利用者で共有し、UTC 月ごとの合計 2,000 セントまで。`trial` はさらに全期間の試験予約 500 セント・30 回の両方を満たす必要がある。現在の定額では 30 回＝300 セントで先に止まる。これは実課金額ではなく安全側の予約額である。

2026-09-25 の [公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-6-sol) は、標準・短文脈の 100 万トークン当たり入力 $2、キャッシュ書込み $2.50、出力 $10。キャッシュ書込み側を上限として、20,000 bytes を最大 20,000 入力トークン相当と見積もると $0.05、出力上限 2,000 トークンは $0.02、合計 $0.07。予約 $0.10 の差 $0.03 をメッセージ包装などの余裕とする。固定 JSON には指示・schema も含む。出力上限は可視文だけでなく推論等の生成トークンも含む（[API 契約](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)）。これは現在のテキスト専用・短文脈・標準処理に限定した保守的な見積もりで、課金実測の代わりではない。

モデル・単価・キャッシュ課金・入力サイズ・出力上限・処理条件を変更するときは、運用者がこの計算を再確認し、必要なら予約額と上限判定を migration を含めて変更する。値を自由入力する設定は設けない。

台帳は run ID ごとに一度だけ追記し、UPDATE/DELETE を拒否する。成功・拒否・HTTP エラー・タイムアウト・送信結果不明・送信前中断でも予約済み分を自動返還しない。キーも入力本文も HTTP 応答全体も台帳へ保存しない。`ai_runs` は既存の入力 hash と検証済み下書きだけを保持し、入力本文・プロンプト・API キーを保存しない。

同じ操作キーや古い run の照会は再送・追加予約を行わない。試験枠は日付、再起動、再デプロイ、無効化/再有効化でも復活しない。同じ D1 を引き継ぐこと。D1 の作り直しや古いバックアップへの復元は予約を失うため、生成を無効化し、費用・累計を照合してから復旧する。別 D1 や別アプリの支出はこの台帳には含まれない。専用 OpenAI プロジェクトとキーで運用する。

## 有効化前の確認（#27）

1. 専用プロジェクトの組織、担当者、支払方法、保存条件、モデル利用可否を確認する。`gpt-6-sol` が利用不可なら別モデルへ勝手に置換せず、無効のまま条件を見直す。
2. プロジェクトのデータ共有・学習への提供設定を確認し、必要な契約と保存条件を確定する。`store: false` は保存ゼロの保証ではない。標準では abuse monitoring の保存があり、例外もある。Zero Data Retention 等の適用可否はプロジェクトで確認する（[データ制御](https://developers.openai.com/api/docs/guides/your-data)）。
3. OpenAI 側のプロジェクト hard spend limit を初回試験 $5、運用時 $20/月に設定し、通知先とアラートも確認する。組織上限も確認する。アラートだけでは通信を止めない。hard limit の反映は即時でなく、計上額が上限を少し超える可能性があるため D1 の先行予約を併用する（[費用上限](https://developers.openai.com/api/docs/guides/spend-limits)）。
4. Worker と同じ対象 D1 へ `0009_ai_budget.sql` を適用し、台帳を確認する。既存 migration を書き換えない。バックアップ・復元手順は #27 で確認する。
5. API キーは専用プロジェクトの必要最小権限にする。Worker secrets にだけ登録し、VITE 変数、静的 assets、Git、ログ、チャット、コマンド引数へ載せない。

## キーを表示しない登録と無効化

ローカルの設定例は `.dev.vars.example`。既定は `OPENAI_MODE=disabled`、キー空欄。キーだけを登録しても有効にはならない。不正値・未設定・未対応モデルも 503 となり外部へ送信しない。

承認された対象 Worker の設定ファイルを選び、以下の対話プロンプトへ秘密管理元から値を入力する。キーをファイルから自動読込みしたり、コマンド引数に書かない。ターミナル記録・画面共有を止め、登録後は値を表示して確認せず、bindings 名と操作結果を確認する。

```powershell
# <対象設定> は #27 で確認した Worker の設定ファイル。以下は手順例であり未実行。
./scripts/vp.ps1 exec wrangler secret put OPENAI_API_KEY --config <対象設定>
./scripts/vp.ps1 exec wrangler secret put OPENAI_MODEL --config <対象設定>
# モデルの入力値は gpt-6-sol
./scripts/vp.ps1 exec wrangler secret put OPENAI_MODE --config <対象設定>
# 全確認の完了後、最後に trial と入力して初回匿名試験を有効化する。
```

無効化は同じ `secret put OPENAI_MODE` で `disabled` を入力する。不要なキーは `wrangler secret delete OPENAI_API_KEY --config <対象設定>` で削除し、OpenAI 側でも失効する。無効化前に開始した通信の完了や予約を取り消すものではない。月次運用へは試験結果・単価・費用設定を確認してから運用者が明示的に `OPENAI_MODE=monthly` へ切り替える。月が変わっても自動切替しない。月次から試験へ戻しても既存の試験累計を使う。

## 匿名試験と失敗時の継続

実接続試験は #27 で匿名の架空データ 1 件から開始する。画面の送信全文が公開要件と匿名状況・不足点だけであること、未採用の間は診断を変更しないこと、手動採用と確定が別操作であることを確認する。実顧客データ・証跡本文は使わない。試験後に台帳と OpenAI Usage の実課金を別々に記録し、想定の処理条件・単価を確認する。実出力品質や 2,000 トークンでの完了率も未検証である。

予算上限は 429 と日本語案内で停止する。上限解除のために台帳を削除しない。OpenAI 側の 429、その他 HTTP エラー、拒否・不正出力は安全な既存エラー、30 秒中断は timeout となる。秘密や応答本文を UI/ログへ返さない。自動再試行はしない。通信断は同じ生成の状態を確認する。失敗時はダイアログを閉じ、保持されている手入力・定型助言を続けられる。

## 予算確認

対象 D1 の管理画面、または承認済み対象へ `wrangler d1 execute <DB名> --remote --command <SQL>` で次を確認する。SQL は本文やキーを取得しない。ローカル検証では `--local` を使う。

```sql
SELECT utc_month, COUNT(*) AS reserved_calls,
       SUM(reserved_cents) AS reserved_usd_cents
FROM ai_budget_reservations GROUP BY utc_month ORDER BY utc_month;

SELECT COUNT(*) AS trial_calls, COALESCE(SUM(reserved_cents), 0) AS trial_usd_cents
FROM ai_budget_reservations WHERE mode = 'trial';
```

アプリ予約額と OpenAI 側の請求・利用明細を混同しない。失敗分が予約に残るのは仕様。差額を見て自動返還・自動再送しない。

## ローカル検証

Workers テストはキーを空に上書きし、外向き fetch をローカル拒否サービスへ接続する。テストの接続候補には fake HTTP を DI し、実 API を呼べない。E2E はテスト専用 composition の fake provider だけを使う。通常 build に fake provider や fixture endpoint を含めず、`scripts/check-production-build.mjs` で公開 assets のキー名・キー形式とテストコードの混入を検査する。検査器自体は `tests/scripts/production-build.check.mjs` の陽性・陰性対照で確認する。
