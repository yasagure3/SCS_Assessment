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
