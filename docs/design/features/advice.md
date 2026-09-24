# 定型助言・AI案・人による確定

- 種別: 機能設計書
- 対象 UC: UC-005（US-008,009,010）
- 適用規則: BR-002,006,007,009,013,014

## 何を作るか

不足/判断保留の各基準について「不足点・実施手順・証跡例・完了確認方法」を提示し、担当者が編集して確定する。AIは任意の下書き補助であり、未設定でも定型助言と手入力が使える。

## 入出力と振る舞い

スケッチ「基準詳細・助言」。公式要求の引用元と当社の実施例を別枠で表示する。定型マスターは81基準すべてに対応を持つ。26要求事項の共通手順を土台に、各基準固有の確認条件を付ける。一般論だけの共通文を81行へ複製しない。工数・費用・特定製品の必須導入を公式要件として断定しない。

Advice型はDESIGN.md「診断documentの共通型」。gap/steps/evidenceExamples/completionCheckは確定時に各1件以上の非空内容が必要。下書きは未入力可。notesは補足。定型選択は下書きへコピー、保存済の確定版は残す。再確定時に新versionとbasisHash/確認者/時刻を保存する。

AI入力欄は毎回独立した空欄から開始し、元O〜R・証跡・顧客名を自動転記しない。担当者が匿名化した状況と不足点を入力→送信される公開要件＋2欄を全文表示→匿名化確認チェック→生成。メール/URL等の検知は補助、匿名化完了を自動判定しない。証跡本文の読込/送信経路を持たない。

## API

| API | request | data |
|---|---|---|
| GET /standards/:id/advice-templates | なし | 全81基準の発行template版/出典/内容 |
| PUT /assessments/:a/advice/:criterionId/draft | {expectedRevision,mutationId,content:Advice} | 更新後診断DTO |
| POST /assessments/:a/advice/:criterionId/confirm | {expectedRevision,mutationId,content:Advice,reviewed:true} | 更新後診断DTO |
| POST /assessments/:a/advice/:criterionId/ai-runs | {expectedRevision,basisHash,anonymousAnswer,anonymousGap,reviewedInputHash,anonymizationReviewed:true}＋Idempotency-Key | {runId,status,draft?,errorCode?} |
| GET /assessments/:a/ai-runs/:id | なし | 同run状態/構造化draft/入力hash/参照basisHash |
| POST /assessments/:a/advice/:criterionId/adopt-ai | {expectedRevision,mutationId,runId} | 更新後診断DTO（下書きだけ変更） |

provider送信DTOはサーバーが `{standardId,criterionId,officialRequirement,anonymousAnswer,anonymousGap}` の5キーだけで組み立てる。officialRequirementは公開マスターから取得。匿名欄各2000文字、combined8000bytes以内。顧客/案件/ファイルID、内部URL、raw answers、証跡本文、会話履歴を含めない。reviewedInputHashはこの正規化DTOのSHA-256と照合。余計なbodyキーを拒否し、入力や参照basisが変われば再確認が必要。

生成は同じHTTP要求内で最大30秒まで待ち、runを予約→呼出し→状態確定する。背景queueを前提にしない。成功はsucceeded、既にbasisが変わればstaleとして保存。通信断はGETで状況確認。実行開始から60秒を過ぎたpending/runningはfailedとし、同じkeyで外部呼出しを再送しない。新しい試行は利用者が新keyで行う。API未設定503、provider失敗502/timeout504、rate超過429。失敗でも手入力/定型は保持。

結果のJSON schema/文字数を検査し、HTML/外部リンク/操作命令は実行しない。ツール呼出しは許可しない。run取得・採用時は顧客/案件/基準の一致とbasisHash一致を再検査、staleなら409。採用は明示操作で下書きを更新し、確定を兼ねない。run生成だけで診断revisionを変えない。

採用応答の通信断・解析失敗・中継エラーは結果不明として扱い、採用開始時の本文・expectedRevision・mutationId/Idempotency-Keyを画面のメモリで保持する。「同じ採用の結果を確認」はその要求を再送し、新規採用とは分ける。再読込でrevision/basisが変わっても、現在の認可を再確認して保存済み成功receiptを返せる。未記録の要求には通常のrevision/basis検査を適用する。確定した拒否は結果不明と区別し、新規操作の制約を解除しない。結果不明の間は新規生成・採用・生成状態照会・モーダルを閉じる操作を抑止し、保持中の要求を失わない。保存済み成功が取得済みの診断より古ければ、画面には取得済みの新しい診断を維持する。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| Advice/確定/basisHash | domain | src/server/modules/assessment/domain/advice.ts |
| 生成Port/DTO allowlist | domain/usecase | src/server/modules/advice/domain/aiPort.ts、usecase/generateAdvice.ts |
| ai_runs/定型マスター/外部adapter | adapter | src/server/modules/advice/adapter/d1AdviceRepository.ts、aiProvider.ts、routes.ts |
| shared契約 | shared | src/shared/contracts/advice.ts |
| 送信全文確認/編集/確定 | front | src/front/components/AdviceEditor.tsx、AiDraftDialog.tsx |

## エッジケースの決定

自己評価が○でも任意の助言編集は可能。下書き変更だけでは既存の確定版を無効にしない。範囲・回答・関連証跡/確認が変わった場合はbasisHashが不一致となり、新規レポートから古い確定助言を除外。再確認した上で確定し直す。過去レポートは不変。OpenAI接続は既定無効とし、PC内の実キーを使わない。実接続の条件確認は#27に残す。

## OpenAI adapter と永続予算（#47）

`aiProvider.ts` は注入fetchを使い固定Responses URLへ送信する。5キーは境界で再構築し、固定指示とStructured Outputsの厳密JSON schemaを加える。`gpt-6-sol`だけ、標準処理・推論low・出力2000トークン・store:false。HTTP JSON全体20000bytes、応答全体131072bytesを上限にする。completedなassistantメッセージ1件だけを取り出し、reasoning項目は構造を確認して破棄する。拒否/ツール/未完了/過大/不正な応答は502、abortは504へ変換し、既存aiDraftSchemaも通す。上流の非200・429は既存502とし、応答本文を返さない。

Bindingsは`OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_MODE`。有効モードはtrial/monthlyのみ、未設定・不正値は503で無送信。通常ビルドにテストproviderを選択する設定は作らない。`d1AiBudget.ts`と追加migration `0009_ai_budget.sql`は外部HTTPの直前にrunごと10セントを原子的予約し、UTC月2000セント、trial累計500セントかつ30回を全利用者で共有する。試験枠は月替わり・再起動・再デプロイでリセットせず、monthlyは運用者が明示的に選ぶまで無効。台帳は追記だけとし失敗・送信結果不明も返還しない。予約額は実課金と区別する。既存run/receiptの再送や期限切れrunには新規予約を作らない。

予算拒否はrunをfailed/AI_BUDGET_LIMITとして保持し、POSTは429と日本語の手入力継続案内を返す。GETで生成状態を再確認しても同じ案内を表示する。キーや入力/HTTP応答本文は台帳・ログに残さず、runには既存仕様の検証済み下書きだけを残す。単価根拠、キー非表示登録、データ保存条件、hard limit遅延、匿名試験・手動継続・予算照会は [OPENAI_SETUP.md](../../operations/OPENAI_SETUP.md)。実モデル利用可否・実接続は未検証。

## テスト方針

単体: 81template対応、公式要求と実施例の区別、必須4要素、確定版併存、hashによる再確認。Workers結合: 余分な送信キー/証跡/原値混入拒否、run競合/期限/同key再送/別顧客run拒否、未設定・失敗時に手動継続。fake providerに渡ったオブジェクトを完全一致でassert。E2E golden path: 定型編集→確定、およびfake AIへ送信内容確認→下書き採用→人による確定。

OpenAIはHTTP境界のfakeを使い、実D1で同時要求・試験累計・新月・運用切替・非返還・古いrunを検証する。テスト外向き通信を遮断し、余分な入力キー、固定URL/処理条件、拒否・不完全・過大応答、abortを検査する。Frontは予算状態再確認、既存`tests/e2e/advice-ai.spec.ts`は採用/結果再確認に加えて予算上限→手入力継続を確認する。

| シナリオ | 優先度 | 検証 |
|---|---|---|
| 秘密/余分な入力を送らない・未設定/不正設定で閉鎖 | Critical | OpenAI Workers HTTP境界、既存allowlist/認可試験、公開build検査 |
| 全利用者の同時予算・累計非リセット・UTC月・同キー | Critical | 実D1の8利用者同時要求、run/receipt再送、旧run拒否 |
| 拒否/不完全/過大/不正出力・timeout/結果不明でも予約保持 | Critical | Workers fake HTTPと実D1台帳 |
| 予算案内・未設定時に手入力保持、採用/確定の分離 | Major | Frontと既存AI golden path E2E、640/1280px画像 |
| 実モデル利用可否・課金/出力品質・データ設定 | Critical・#27残 | 未実施。ローカルfakeを実接続成功と扱わない |
