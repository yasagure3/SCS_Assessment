# Issue 17: 非公開の証跡ファイル

対象は `features/evidence.md` のファイルAPIと添付UI。実顧客データ、実クラウド、AI呼出しを使用しない。

## 契約と実装判断

- 共通 `operation_receipts` に actor/key と案件・名前・MIME・指定SHAを予約し、同じbatchで uploading 行と監査を作成する。同keyの一致再送は現在の既存状態、不一致は409。uploading/rejectedの再送は保存をやり直さず、新しい選択のkeyで再実行する。
- 予約は0byteを表すため migration 0006 で files の0byteを許可する。ただし ready は1byte以上。同テーブルの既存行・外部キーは維持する。
- 入力ストリームを最大10MiBまで読み、超過時はcancelする。形式検査とSHA検査後、検証済みの最大10MiBをR2へstreamで保存する。R2のSHA検査とheadのsize/SHA確認後のみreadyにする。中断・保存失敗はrejected。分散transactionは組まない。
- PDF/PNG/JPEGは拡張子、MIME、実署名を照合する。TXTはfatal UTF8/NUL検査とHTML/SVG偽装拒否。OfficeはZIP64・暗号化・多巻・重複/不正パス・ヘッダ不一致・CRC/実展開長不一致を拒否し、500 entries / 1 entry 10MiB / 実展開合計50MiBを上限とする。DOCX/XLSXの主partとcontent typeを検査し、macro・外部参照・埋込objectを拒否する。UTF8/UTF16 XMLを検査する。ブラウザのOffice/PDF実行やpreviewは作らない。
- ZIP検査は先行Issue15の匿名回帰済み実装を添付用に適応した。添付にはExcel取込の行数/セル数制限を適用しない。Unicode path extra fieldは中央/ローカル双方で拒否し、別名で解釈される入力を受理しない。
- R2 put/head/getの例外は `FILE_STORAGE_FAILED` / HTTP 502。形式・SHA不一致と入力stream中断の422、上限超過の413とは分離する。put/head失敗時は予約をrejectedにし、get失敗では既存readyを変えない。失敗した同keyは再書込せず、取得は毎回認可する。
- ファイル本文Portはput/get/headだけ。URL fetchとAI転送の依存を持たない。object keyはサーバー採番して公開DTOに含めない。
- 取得はmetadata/contentそれぞれでactive利用者と顧客割当を再検査する。保管済み案件は新規upload禁止、既存ファイルの認可済み取得は可能。証跡への関連付けは既存CASの同顧客/同案件/ready条件を再利用する。
- downloadはattachment / nosniff / no-store。ブラウザではBearer付きfetch結果をBlobとして利用者の明示操作で保存する。tokenをURLに入れない。
- 添付未完了時は証跡保存を無効化する。network不明時は同keyを保持、確認済み失敗・uploading/rejected・取消は再選択を案内する。添付の差替えは新規証跡追加→旧関連解除。添付と内容確認は別状態。

## 検証方針とカバレッジ

| 利用者の動作/条件 | 主な検証 | 重要度 |
|---|---|---|
| 許可形式を保存して同じbytesを取得 | Workers + local D1/R2 | Critical |
| 上限ちょうど/超過/中断・未ready取得 | Workers APIとFile Port失敗注入 | Critical |
| 再送・同key異内容・処理中再送 | 共通台帳を含むWorkers結合 | Critical |
| 別顧客・割当解除・停止・保管 | Workers + 既存evidence結合 | Critical |
| MIME/署名/SHA/ZIP/暗号化/macro/外部参照 | Workers匿名fixture | Critical |
| 入力保持・取消・再選択・保存抑止 | Frontコンポーネント | Major |
| 匿名PDF添付→download→内容確認、回答不変 | Playwright golden path | Critical |
| 640px表示と失敗画面 | Playwright PNG/overflow検査 | Major |

TDD: 最初のAPI試験は404→201のREDを観測後に実装。形式受理/PDF/画像・TXT偽装で4件のREDを観測後に実装。添付UI import未実装と確定拒否後の再選択でREDを観測後に実装。既存境界の認可/中断追加はcharacterizationとして扱う。試験の期待値緩和やskipは行わない。

## 実行記録

WindowsではrootのVP_HOMEとvp-nativeをPATHへ渡し、全コマンドは `scripts/vp.ps1` を使用する。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/files.test.ts`: files 15件成功。既存evidenceと合わせて25件成功。Office正常/拒否、実展開合計、先行Issue15の4種ファイル名metadata回帰を含む。
- `vp test --run src/front/components/FileAttachment.test.tsx src/front/pages/EvidencePage.test.tsx`: Front全体17 files / 67 tests成功。添付単体5件とfileClient認可転送2件を含む。fileClientは既存実装のcharacterization。
- `vp check --fix`: 最終139 files成功、警告/型/lintエラーなし。
- `vp build`: client/Worker両ビルド成功。
- `vp exec playwright test tests/e2e/evidence-files.spec.ts`: 通常sandboxではWrangler registry作成のEPERMで起動前停止後、親の昇格全体ゲートでE2E18件成功（port5230）。PNG3枚を親と独立レビュワーが目視確認済み。この全体ゲートは下記provider分類修正前の記録。

remote R2/本番設定/マルウェアスキャン/大量同時送信の実測は本Issueで完了扱いにしない。匿名fixtureとローカルbindingのみで検証する。本番出荷ゲートはDESIGN.mdのcloud-integrationに従う。

## r1 high 指摘の修正（唯一のfix round）

- `.local/review17.test.ts` の独立probeを変更せず再実行し、put/head=422・get=500による3失敗と状態/認可の7成功を再現した。
- put/head/getの3例を `test/worker/files.test.ts` のparameterized結合試験へ昇格し、正確な502 envelope、失敗後metadata、同key再送による再書込なし、停止拒否、復旧後の正常bytesと旧終端状態保持をassertする。ローカルD1/R2を使用し対象Portメソッドの例外だけを注入する。
- 正式試験のREDは3つのHTTP分類と、既存partial-storage期待codeの4件。既存期待値は誤ったFILE_UPLOAD_FAILEDから設計のFILE_STORAGE_FAILEDへ更新し、検査の削除・緩和はしていない。入力stream中断の422/FILE_UPLOAD_FAILEDは従来どおり成功している。
- 修正後: 正式Workers 25/25、変更していない独立probe 10/10、check（139 files、警告なし）、client/Worker build、diff-check成功。Front/画面の変更はない。
- 修正前の親全体ゲートはFront67、Workers121、bootstrap3、E2E18成功。修正後の全体再検証は親が行う。r1 medium 2件（UI依存注入・エラーメッセージ部分一致assert）は本fix対象外で、親の保留リストに引き継ぐ。
修正後の親全体ゲート（port5230）はFront67、Workers124、bootstrap3、Edge E2E18件が成功。型・lint・format、client/Worker build、production fixture除外、local migration、occupied-port guardも成功した（root .local/issue-17-all.log）。

最新main（Excel取込I01・助言V01）との統合後はFront110、Workers152、bootstrap3、Edge E2E22件が成功。全静的検証・build・fixture除外・local migration・port guardも成功。統合時の共通413定義は重複を除き、ファイルとJSON双方に適用できる既存の共通メッセージを保持した。独立r2はhigh0、put/head/getの3変異を検出し製品コードの復元を確認した。
