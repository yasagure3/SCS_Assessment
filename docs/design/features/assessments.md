# 現状集計と評価基準詳細

- 種別: 機能設計書
- 対象 UC: UC-003（US-004,005）
- 適用規則: BR-001,002,003,005,009,013,015

## 何を作るか

81基準を同じ計算で集計し、状態・分類から不足と判断保留を探せるようにする。元Excelと現在の回答を並べ、編集が集計と助言確認状態へ正しく反映される。

## 入出力と振る舞い

スケッチ「現状」「81評価基準」「基準詳細」。状態は○満たしている/△判断微妙/✖不足/未回答。率を示す場合は「自己評価○の割合」と明記し分母81。△は0.5点にせず取得見込み点を表示しない。分類ごとの4状態件数は全体と整合させる。

フィルターはcategory/status/evidenceState/text。検索は取得済み81件の公式文・基準ID・編集文をブラウザ内で行い、検索語をログに残さない。詳細では公式原文、原O/P/Q/R、編集欄status/reason/basis/plannedWork/supplement、証跡、助言への導線を表示。元値を直接編集する操作はない。

証跡の集計定義: `notRegistered`=関連Evidenceが0、`unreviewed`=関連Evidenceの当該基準レビューにunreviewedが1件以上、`rejected`=rejectedが1件以上、`allConfirmed`=1件以上あり全件confirmed。unreviewedとrejectedは重複し得るため足して81とはしない。各リストと件数を併記。未確認の○はyesかつnotRegistered/unreviewed/rejectedのいずれか。文書確認だけで基準充足を自動判定しない。

## API

| API | request | data |
|---|---|---|
| GET /standards/:id | なし | 版メタデータと81criteria（officialText/category/orderNo/requirementId） |
| GET /assessments/:a | なし | {id,caseId,customerId,standardId,revision,document,counts,categoryCounts,evidenceSummary,adviceSummary} |
| PATCH /assessments/:a/responses/:criterionId | {expectedRevision,mutationId,status,reason,basis,plannedWork,supplement} | 更新後の同じ診断DTO |

countsは `{yes,uncertain,no,unanswered,total:81}`。adviceSummaryはcurrentConfirmed/draftOnly/stale/noneの排他的4状態。currentConfirmedがあるとき新規draftが併存してもcurrentConfirmedとして数え、draftPendingは別件数。入力にoriginal/confirmedAdvice等を混ぜると422。編集で値が同じならno-opとして現revisionを返し、成功receiptを保存する（DESIGN.md「トランザクション境界」）。取込未実施の手動保存はmanualEdited=trueにするため初回のみ新revision。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| 集計/編集/basisHash | domain | src/server/modules/assessment/domain/assessment.ts、summarize.ts |
| assessments/criteria取得、CAS | usecase/adapter | src/server/modules/assessment/usecase/reviewAssessment.ts、adapter/d1AssessmentRepository.ts |
| DTO/routes | shared/adapter | src/shared/contracts/assessments.ts、src/server/modules/assessment/adapter/routes.ts |
| 表示と編集 | front | src/front/pages/DashboardPage.tsx、CriteriaPage.tsx、CriterionPage.tsx |

スキーマと不変条件はDESIGN.md参照。basisHashの再計算を各routeに複製せず共通domain処理へ集約する。

## エッジケースの決定

新規は未回答81、原文なしを明示。0検索結果は解除導線。対象外という第5状態は初回に追加せず補足へ理由を書く。保存成功後はSWRを同一revision DTOで更新。409では自分の未保存文と最新の保存値を並べる。再読み込みを選ぶまで入力を捨てない。

## テスト方針

単体: 4状態/分類/証跡集計、○未確認、△の扱い、再確認hash対象と対象外、no-op。Workers結合: 全81ID不変、原値編集拒否、顧客境界、旧revision拒否。Front: フィルターと競合表示。E2E golden path: 不足で絞込→基準編集→件数反映と原文維持。

## 実装時の具体化（D01）

- 画面URLは `/assessments/:assessmentId`、`/assessments/:assessmentId/criteria`、`/assessments/:assessmentId/criteria/:criterionId`。ダッシュボードの状態・証跡件数から一覧の条件を引き継ぐ。語句検索はブラウザ内の状態だけに保持しURLへ入れない。
- `evidenceSummary` の各状態と `unconfirmedYes` は `{count, criterionIds}`。一覧・ダッシュボードは同じサーバー集計結果を使う。`categoryCounts` は公式基準の順序で分類ごとの `{category, yes, uncertain, no, unanswered, total}` を返す。
- `draftPending` は `adviceDraft` が存在する基準数。現在有効な確定助言と案が併存すると `currentConfirmed` と `draftPending` にそれぞれ数える。古い確定助言と案の併存は `stale` と `draftPending`。
- 取込済み回答を同じ値で保存した場合は `manualEdited` を変更せず成功no-opとする。未取込の初回手動保存のみ、値が空欄でも `manualEdited=true` の新revisionを作る。
- 詳細の証跡・助言への導線は同じ画面の参照セクションへ接続する。証跡の編集、助言の作成・確定操作は各後続機能で実装する。公式文・原O〜R・現在の回答を別のラベルで表示する。
- 409時は5編集項目の自分の入力・最新保存値・変更有無を比較表で表示する。入力保持と保存値への置換を明示的に選べる。認可エラーでは依存APIのどれが拒否されてもキャッシュ済みの回答・顧客名・案件名を表示しない。

### 検証の重点とシナリオ対応

| 優先度 | ユーザーシナリオ | 検証箇所 |
| --- | --- | --- |
| Critical | 原O〜Rと81IDを保持し、回答の巻戻しで旧助言を再有効化しない | Workers assessments |
| Critical | 他顧客の読書きを拒否し、取得後に権限が失われてもキャッシュを隠す | Workers assessments / Front CachedAccess |
| Major | 初回手動保存、取込済み無変更、成功no-op再送、旧revisionの409 | Workers assessments |
| Major | 4状態・分類合計・重複証跡・未確認の○・助言の優先順位 | Workers assessments |
| Major | 複数条件検索、0件解除、入力制限、1MiB上限、409差分と入力保持 | Front CriteriaList / ResponseForm |
| Major | 不足で絞込→原回答と照合→保存→競合解消→件数反映 | E2E assessments（匿名ローカルfixture） |

集計境界はWorkersとFrontへ厚く、E2Eは上記1本の主要フローに限定する。外部の実Cognito・AI・実顧客データは使用しない。

### 保存結果と業務エラーの復帰

対象範囲PATCHも回答PATCHと同じ集計付き診断DTOを返し、その成功応答でSWRを更新する。保存後の追加GETが失敗しても、保存済みrevision/document/助言集計を古い値へ戻さない。

409のうち`CONFLICT`だけを版競合として比較・再編集の対象にする。`ARCHIVED`では顧客・案件と診断を再取得し、保管中は閲覧専用表示にする。保管解除後は診断revisionが同じでも未保存入力を保って保存を再開できる。`IDEMPOTENCY_CONFLICT`は既に別操作で使用されたキーなので、入力を残し利用者が再度保存したときに新しい操作IDを採番する。通信結果が不明な失敗は同じ操作IDを保持し、成功処理の重複を防ぐ。いずれも自動再送はしない。

回帰は`AssessmentSaving.test.tsx`で範囲・回答の両保存を対象に、保存後GET失敗と4種の失敗復帰を確認する。Workersの`assessments.test.ts`では範囲PATCHの応答全体が同revisionのGET DTOと一致することも検証する。
