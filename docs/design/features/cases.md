# 顧客・診断案件

- 種別: 機能設計書
- 対象 UC: UC-001（US-001,002）
- 適用規則: BR-001,004,009,015

## 何を作るか

許可された顧客と支援案件を一覧し、案件ごとに診断時点を作る。名称と制度版だけで下書きを開始でき、報告前に対象範囲と診断日を補う。範囲は診断ごとに保持する。

## 入出力と振る舞い

スケッチ「顧客・案件」「対象範囲」を実装。顧客検索→案件追加→初期診断のダッシュボードが基本動線。顧客名・案件名はtrim後1〜200文字、空欄不可。同名を許容しIDで区別。会社/拠点/部署/システムは自由記述の4欄で、不明な欄は下書きでは空文字を許す。診断日はnullable ISO日付、未来日は確認表示して保存可。

新規顧客では作成者の割当を同時保存する。案件作成で★3マスターの81未回答を持つrevision=1の診断を1件作る。範囲変更は全基準のbasisHashを再計算し、確定助言を再確認対象にする。診断日は集計値に影響しない。

## API

接頭辞・認可・共通envelope/CASはDESIGN.md「API 一覧」「横断規約」参照。

| API | request | data/結果 |
|---|---|---|
| GET /customers | q?,cursor?,limit? | items:{id,name,revision,archivedAt}[]、nextCursor |
| POST /customers | {name}＋Idempotency-Key | 作成顧客、201 |
| PATCH /customers/:c | {expectedRevision,mutationId,name?,archived:boolean?} | 更新顧客/新revision |
| GET /customers/:c/cases | q?,cursor?,limit? | 案件一覧、nextCursor |
| POST /customers/:c/cases | {name,standardId,diagnosisDate?,scope?}＋Idempotency-Key | {case,assessmentId,assessmentRevision:1}、201 |
| PATCH /cases/:k | {expectedRevision,mutationId,name?,archived:boolean?} | 案件/新revision |
| GET /cases/:k/assessments | cursor?,limit? | items:{id,standardId,diagnosisDate,revision,previousAssessmentId}[] |
| PATCH /assessments/:a/scope | {expectedRevision,mutationId,scope,diagnosisDate} | 診断全体/新revision |

任意キー`archived`の記法はboolean型の省略可能フィールド。標準idが初回対応版以外なら422。顧客/案件のarchive後は既存診断・既存レポートを読めるが、その配下の新規作成/編集/新規レポート確定は409 ARCHIVED。管理者又は権限を持つ担当者がarchiveを解除して編集を再開できる。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| customers/cases/初期assessmentsの一括保存 | adapter | src/server/modules/cases/adapter/d1CaseRepository.ts |
| 作成/範囲更新と権限Port | usecase/domain | src/server/modules/cases/usecase/manageCases.ts、domain/case.ts |
| API DTO/route | shared/adapter | src/shared/contracts/cases.ts、src/server/modules/cases/adapter/routes.ts |
| 一覧/フォーム/SWR | front | src/front/pages/CustomersPage.tsx、CasePage.tsx |

テーブル定義・版と監査はDESIGN.md「データスキーマ」「トランザクション境界」を参照。

## エッジケースの決定

0件時は新規顧客ボタン。検索0件時は条件解除。顧客の変更/移動機能は初回なし。別顧客IDの注入は404、入力値からcustomer_idを設定しない。作成の応答不明は同じkeyで再試行し重複を作らない。保存失敗/409時はフォームを保持する。

## テスト方針

単体: 必須/長さ/日付/範囲hash。Workers結合: 顧客作成と割当・案件と81回答の全rollback、二重作成、顧客境界、archive、CAS。Front: 入力保持・エラー表示。E2E golden path: 顧客追加→案件と範囲保存→未回答81件のダッシュボード。
