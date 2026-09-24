# 証跡の登録と確認

- 種別: 機能設計書
- 対象 UC: UC-004（US-006,007）
- 適用規則: BR-004,005,006,009,013,014

## 何を作るか

文書名・参照URL・該当箇所・ファイルと、基準ごとの確認を保持する。添付した事実を確認済みにせず、別顧客のファイルは取得できないようにする。

## 入出力と振る舞い

スケッチ「証跡」「基準詳細」。name必須、criterionIdsは1〜81。url/fileIdは任意で、文書名のみでも登録可。locationは章/ページ/設定箇所を自由記述。レビューは基準ごとにunreviewed/confirmed/rejected＋note。confirmed/rejectedはnote必須、by/at/subjectHashはサーバー設定。内容確認者は同一担当者が兼任可能。

name/url/location/criterionIdsの編集時は影響基準のレビューをunreviewedへ戻す。criterionIdsから外した基準を持つTaskのevidenceIdsからもそのEvidence IDを同じ更新で解除し、完了レビューの解除規則を適用する。fileIdの差替えは既存Evidenceを編集せず、新しいEvidence追加→旧関連の解除。確認は自己評価を変更しない。Evidenceや確認の変更で関連する助言を再確認対象にする。

## API

| API | request | data |
|---|---|---|
| POST /cases/:k/files | binary body、Idempotency-Key、X-File-Name（URI encode）、X-Content-SHA256、Content-Type | {fileId,status,sizeBytes,sha256}、201/失敗code |
| GET /files/:id | なし | {id,name,mime,sizeBytes,sha256,status,createdAt} |
| GET /files/:id/content | なし | binary attachment（共通JSON envelope対象外） |
| POST /assessments/:a/evidence | {expectedRevision,mutationId,criterionIds,name,url,location,fileId} | 更新後診断DTO |
| PATCH /assessments/:a/evidence/:id | {expectedRevision,mutationId,criterionIds,name,url,location} | 更新後診断DTO |
| DELETE /assessments/:a/evidence/:id | {expectedRevision,mutationId} | 更新後診断DTO |
| POST /assessments/:a/evidence/:id/reviews/:criterionId | {expectedRevision,mutationId,state,note} | 更新後診断DTO |

filesはuploading予約→実形式/byte検査→非公開R2へstream→server SHAと指定hash照合→ready。部分失敗はrejected、ダウンロード不可。10MiBを超えたらstreamを止め413。SHA/形式違い422。重複keyはメタデータとhashの一致時のみ既存状態を返す。未完了状態の再実行は成功版を上書きせず、利用者が新keyで再選択できる。未参照objectの自動削除は保持条件決定後。

fileとassessmentのcaseId/customerId一致、file.status=ready、レビュー対象がcriterionIds内であることをサーバー検査。ファイルIDだけでR2キーを推測させない。downloadは毎回認可、Content-Disposition:attachment、nosniff、no-store。URLはhttp/httpsのみで自動fetchしない。

ブラウザのファイル操作は、開始時のログイン世代と取消signalを完了まで保持する。uploadのファイル読込み・SHA計算・送信応答とJSON本文、downloadのメタデータ応答とJSON本文・内容応答とBlob本文、それぞれの待機後に検査する。後続HTTPの開始とブラウザ保存、ready結果を呼出元へ返す直前にも検査し、ログアウトまたは同一／別利用者への再ログイン後は旧操作を中断する。後続HTTP直前の検査から共通HTTP処理の世代捕捉までは同じ同期呼出しで行い、非同期待機を挟まない。通常のtoken更新は世代を変えず、同じ本文・操作キーの再送とサーバー認可を維持する。

添付コンポーネントと証跡画面は、自分が開始した処理の世代とAbortControllerを完了反映時にも検査する。画面離脱時はそのcontrollerをabortし、遅れて届いた成功・失敗を次の画面へ反映しない。手動取消の再選択案内は維持する。送信済みの要求をサーバー側で取り消したとは扱わず、旧操作の後続送信・端末保存・完了反映を止める。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| filesとR2の状態管理 | usecase/adapter | src/server/modules/evidence/usecase/uploadEvidence.ts、adapter/r2EvidenceStore.ts、adapter/d1FileRepository.ts |
| Evidence/Reviewとhash | domain | src/server/modules/assessment/domain/evidence.ts |
| DTO/routes | shared/adapter | src/shared/contracts/evidence.ts、src/server/modules/evidence/adapter/routes.ts |
| 登録/確認UI | front | src/front/pages/EvidencePage.tsx、components/EvidenceForm.tsx |

ファイルPortにはput/get/headだけを設け、任意URL取得/AIへの転送APIを作らない。スキーマ/上限はDESIGN.md。

## エッジケースの決定

Office形式はZIP制限・macro/暗号化/外部参照拒否、TXTはUTF8でNULなし。PDF/画像/Officeはアプリで内容実行や埋込みpreviewをしない。関連解除時にTask.evidenceIdsを同じ更新で外し、そのTaskの完了確認をunreviewedへ戻す。stateがdone/awaiting_reviewならdoingへ戻し、todo/doingは維持する。証跡内容・確認の変更でも参照Taskへ同じ規則を適用する。再提出は結果と証跡が揃ってから明示操作で行う。全履歴と旧reportはそのまま。URL開きは利用者の明示操作のみ、noopener/noreferrer。

## テスト方針

Workers結合: 別顧客/別案件/未ready拒否、偽装・超過・中断、再送、SHA検証、URL自動fetchなし、レビュー/関連解除/CAS。単体: 証跡変更のレビューと助言無効化。E2E golden path: 文書登録＋匿名PDF添付→認可download→基準の確認→自己評価は変わらない。

`fileClientGeneration.test.ts`は実fileClientと共通sessionFetchを接続し、upload/downloadの各待機境界・SDK更新とsession公開待ちで、通常更新／ログアウト／同一利用者再ログイン／別利用者再ログイン／取消を比較する。送信本文・操作キー・tokenの全要求列、ready結果と実際の保存内容を照合する。認可エラー本文が遅れた場合の破棄、添付の遅延完了と画面離脱時の取消もFront試験で固定する。
