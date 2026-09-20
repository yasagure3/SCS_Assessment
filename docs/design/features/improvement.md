# 改善課題と再診断比較

- 種別: 機能設計書
- 対象 UC: UC-006（US-011,012,013）
- 適用規則: BR-002,005,009,010,011,013

## 何を作るか

対策の担当者・期限・進捗・完了確認を追跡し、前回を保った新しい診断時点を作成して比較する。作業の完了を○判定へ自動変換しない。

## 入出力と振る舞い

スケッチ「改善課題」「再診断比較」。Task型はDESIGN.md。title/ownerName/dueDate/completionCondition/criterionId必須。担当者は顧客の作業担当名も文字列入力可能で、アカウント発行/メール通知とは連動しない。優先度は担当者の業務判断。期日を過ぎたtodo/doing/awaiting_reviewを期限超過にする。

state遷移はtodo→doing→awaiting_review→done。作業者はtodo/doing/awaiting_reviewを変更でき、doneはレビューAPIでのみ設定。awaiting_reviewには非空resultと関連evidenceIdsを1件以上必要。確認者はcompletionConditionと証跡を確認してconfirmedかrejectedを保存し、rejectedはdoingへ戻す。確認者は兼任可。根拠を登録できない場合はdoneとせず結果欄へ事情を記す。

result/completionCondition/evidenceIds又は参照Evidenceの内容/確認変更は完了レビューを解除し、done/awaiting_reviewならdoingへ戻す。todo/doingは維持する。再提出は結果と証跡が揃ってから明示操作で行う。ownerName/dueDate/priorityだけなら確認を維持。いずれも自己評価は変更しない。課題側の変更だけでは助言basisHashは変えない。

## API

| API | request | data |
|---|---|---|
| POST /assessments/:a/tasks | {expectedRevision,mutationId,criterionId,title,ownerName,dueDate,priority,completionCondition} | 更新後診断DTO |
| PATCH /assessments/:a/tasks/:id | {expectedRevision,mutationId,title,ownerName,dueDate,priority,completionCondition,state,result,evidenceIds} | 更新後診断DTO |
| POST /assessments/:a/tasks/:id/review | {expectedRevision,mutationId,state:'confirmed'|'rejected',note} | 更新後診断DTO |
| POST /cases/:k/reassessments | {previousAssessmentId,expectedPreviousRevision,standardId,diagnosisDate,scope,copyResponses:boolean,copyTaskIds:string[]}＋Idempotency-Key | 新診断DTO、201 |
| GET /assessments/:a/comparison?previous=:id | なし | {current,previous,scopeChanges,standardChanged,rows,unmatchedIds} |

再診断は同一case内、★3既知版のみ作成可。previousはimmutable化しないが今回に取り込んだ内容はその時点のコピーなので、後の前回編集に追随しない。参照したprevious revisionを新documentに `copiedFrom:{assessmentId,revision}` として保存する（このメタデータはサーバー設定）。copyResponses=trueは編集回答とEvidenceをコピーし全reviewをunreviewed、助言は参考下書きへ移しconfirmedAdvice=null。originalはnull。コピーされた回答はmanualEdited=trueにしてExcelで無条件上書きできなくする。falseは未回答81・証跡なし・助言なしから開始。

助言のコピー優先順位は既存adviceDraftがあればその内容、なければconfirmedAdvice.content（staleも参考として可）、両方なければnull。すべて未確定の参考下書きであり、人の再確認を要する。adviceBasisVersionは新診断で1から開始し、basisHashを新たに生成する。

課題は選択したものだけ新idでコピーしstate=todo/review=unreviewed/result空。sourceTaskId/sourceAssessmentIdに直接コピー元を記録する（手動新規課題は両方null）。copyResponses=falseなら課題のevidenceIdsも空、trueならコピー先の新Evidence IDへ置換。copiedFromがある診断を比較するときは既定で保存済み前回revisionを用いる。任意の現時点との比較にはquery `previousRevision` を明示して対象版を表示する。

rowsはcriterionId対応でbeforeStatus/afterStatus/changed、回答文・課題進捗の差分。直接コピー元との課題比較はsourceAssessmentId/sourceTaskIdで対応付け、未引継ぎ/新規課題を別表示。直接のコピー元でない診断を選んだときは基準回答だけを比較し、課題は「対応付けなし」として両一覧を表示する。状態に序列を与えず「✖→△」などをそのまま表示する。制度やscopeが異なる場合は注記し、IDが対応しないものはunmatchedIdsへ。★4等未対応版を新規作成する操作は422。別顧客/別case比較は404。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| Task遷移/比較/コピー | domain | src/server/modules/assessment/domain/tasks.ts、reassessment.ts |
| assessmentsと履歴を一括作成 | usecase/adapter | src/server/modules/assessment/usecase/reassess.ts、adapter/d1AssessmentRepository.ts |
| DTO/routes | shared/adapter | src/shared/contracts/improvement.ts、src/server/modules/assessment/adapter/routes.ts |
| 一覧/編集/比較UI | front | src/front/pages/TasksPage.tsx、ComparisonPage.tsx |

## エッジケースの決定

不正日付・空担当・無関係な証跡・100件超過は422。既存課題の削除は初回なし、誤登録はtitle/resultで説明して履歴を保つ。コピー元が更新されれば409でやり直す。前回なしは比較対象の選択/再診断導線。比較する2revisionを画面ヘッダーに表示して表示中の変化に引きずられない。

## テスト方針

単体: 遷移・期限境界・確認解除・状態比較。Workers結合: 完了条件未達拒否、○に変化しない、コピー元不変、原値と確認の扱い、ID再割当、別case拒否、原子的コピーと409。E2E golden path: 課題作成→完了報告→確認→再診断→状態変更比較。

## 課題管理の実装と検証（T01）

`/assessments/:assessmentId/tasks` を診断メニューから開く。追加、編集・完了報告、完了確認を別操作にし、確認画面には完了条件・結果・関連証跡を表示する。再診断と比較はT02で接続する。

- APIの実パスは `/api/v1` 配下。追加はmutation契約を使用し、サーバーが課題ID・確認者・確認日時・確認対象hashを設定する。PATCHの `state:done` は既存doneの維持時だけ許可する（担当・期日・優先度の変更用）。doneへの遷移はreview APIだけで行う。
- 完了確認の対象hashは課題ID・基準ID・完了条件・結果・関連証跡の内容と当該基準の証跡確認で構成する。確認メモは2000文字以内、空欄も可。担当・期日・優先度・課題名は確認対象を変えない。結果・条件・証跡の変更を含む保存で、既存done/awaiting_reviewはdoingとなり、再提出を別操作で行う。
- 更新は共通のD1 CAS・冪等台帳・不変履歴・監査を使用する。古いrevisionは課題状態の検査より先に409とし、証跡変更で確認が解除された場合も入力を残して最新値との比較を表示する。ネットワーク不明時は同一body/同一mutationIdで再試行する。画面は送信時に検証済みの直前要求を識別し、応答喪失後のGETが保存済み最新値を返した場合も、同じ要求を最新documentへの新規追加・状態遷移として再検査しない。入力を編集すると新しい要求として通常の検証に戻り、閲覧専用・認可エラー・競合による制限は再送時も維持する。
- 画面は保存結果の集約サイズを共通の純粋遷移で算出する。確認メタデータによる増分と確認解除による縮小を含め、1MiBを超える操作を保存前に止める。100件上限、必須担当・実在日付・結果と証跡の要件もAPIで検査する。

重点検証は状態と根拠の独立性、確認解除、認可、競合・再送、境界に置く。`test/worker/tasks.test.ts` と既存 `evidence.test.ts` でAPI・証跡変更の連動、`TaskForm.test.tsx` / `TasksPage.test.tsx` で入力・pending・読込/保存失敗・409、`src/test/taskBoundary.test.tsx` で1MiBちょうどと1byte超過を確認する。`tests/e2e/tasks.spec.ts` は匿名fixtureで課題作成→証跡登録→完了報告→確認と原文・自己評価の維持を通し、通常/640px幅の画像を `.local/e2e-tasks-*.png` に保存する。実顧客・実AI・本番クラウドは使用しない。

`src/test/taskResponseRecovery.test.tsx` は製品の送信hookを通し、保存成功→応答喪失→GETで最新値取得→同一body/操作IDの再送を検証する。追加・100件目・1MiBちょうど・完了報告・doneの結果変更・confirmed/rejectedに加え、編集後の新要求、編集取消後の再送、閲覧専用と権限拒否を含む。
