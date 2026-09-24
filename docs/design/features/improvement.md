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

## 再診断と比較の実装（T02）

診断メニューの「再診断比較」から `/assessments/:assessmentId/comparison` を開く。同一案件の候補一覧はcursorでページ移動できる。前回がない場合は選択案内と、この診断をコピー元にする作成フォームを表示する。作成時は診断日・範囲・回答コピーの有無・引き継ぐ課題を入力し、新診断の比較画面へ移動する。診断日は空欄（null）も許可し、初期値は未入力、範囲はコピー元、回答コピーはON、課題選択は空から開始する。異版からの自動移行は行わず、作成元と作成先はいずれも既知の `scs-20260327-star3` に限定する。

コピー計画の純粋関数は `src/shared/reassessmentCopy.ts` に置き、domainがbasisHashを計算する。画面も同じ計画からUTF-8 byte数を算出し、1MiB超過を作成前に表示する。新規の診断・Evidence・Task IDはサーバーが生成する。D1の条件付きreceipt予約にコピー元revision・同一案件・最新権限・親の非保管状態・readyファイル参照を含め、本体・履歴trigger・監査と一括保存する。コピー元が途中で変わった場合も予約は0行となり409で終了する。

比較DTOの `current` / `previous` は比較に使った診断record（revisionとdocumentを含む）、`scopeChanges` は `{field,before,after}[]`、`unmatchedIds` は `{previous:string[],current:string[]}` とする。各rowに基準ID・前後の状態・changed・回答文の差分と課題比較を含む。課題の `mode:matched` は `matched`（before/after/changed）、`notCarried`、`added` へ分け、`mode:unmatched` は `previous` / `current` の両一覧を保持する。課題・証跡のID再採番だけでは進捗の変更と数えず、対応する内容で比較する。コピー元でない診断の課題には対応付けを推測しない。

画面は取得した2つのrevisionを表示し、明示的な比較操作までその組を保持する。比較画面を開き直した際は取得を行い、直前の編集後に古いキャッシュを固定しない。再マウント直後はキャッシュの `isValidating:false` が返る場合があるため、その値を取得完了の根拠にせず、その画面での通信成功コールバックだけで最初の比較結果を確定する。確定前は読込表示とし、以降の背景再取得は表示中の組を変更しない。コピー元409では入力を保持し、選択時と最新の回答・範囲・課題・証跡・参考助言の差分を示して、利用者が最新のコピー元を選び直す。通信不明時は同一bodyと同一Idempotency-Keyで再試行する。

`test/worker/reassessment.test.ts` が旧診断不変、コピーの初期化と助言優先順、ID再採番、保存revision比較、直接/非直接の課題対応、異版注記の比較データ、認可、競合、同時再送、一括rollbackを検証する。フォーム/比較コンポーネント/ページのFront試験で入力保持・409・読込失敗/再試行・1MiB境界を確認する。`tests/e2e/reassessment.spec.ts` は既存の匿名ローカルfixtureだけを使い、課題作成→完了報告→確認→再診断→状態変更比較を通す。通常幅と640pxの画像を `.local/e2e-reassessment-*.png` に保存する。実顧客・実AI・本番クラウドは使用しない。

コピー元409の差分表示は `ReassessmentSourceDiff.tsx` で構造比較と表示を分離する。助言はコピーに使う下書き/確定助言の区別・出所・テンプレート参照・各フィールド・配列要素境界を保持する。証跡と課題はIDごとに対応し、添付ファイルID、関連証跡の名称とID、コピー元参照、確認者/日時/対象識別子まで前後値を表示する。改行を含む入力の結合で差分を消さず、手順と証跡例には項目名と番号付きリストを付ける。`ReassessmentConflict.test.tsx` はレビューで使用した29ケースのfixture・陽性/陰性対照を維持し、配列内改行、参照の変更、追加/削除、確認情報、キー順のみの変更も検証する。
