# レポート確定とPDF・作業用Excel

- 種別: 機能設計書
- 対象 UC: UC-007（US-014,015,016）
- 適用規則: BR-002,004,007,008,009,013,015

## 何を作るか

経営層向けサマリーと全81基準の課題・対策を、同一の固定レポート版からPDFとExcelへ出力する。未回答/証跡未確認が残る場合も件数と該当項目を明記して確定できる（Q13）。

## 入出力と振る舞い

スケッチ「レポート」。プレビュー→未回答/証跡未登録・未確認・差戻し/助言未確定の確認→版を確定→PDF/Excelを保存。対象会社/拠点/部署/システム4欄と診断日が空なら確定不可。「なし」は担当者の判断を文字列で明記してよいが分母から除外しない。

snapshotは `{schemaVersion:1,rendererVersion,reportId,createdAt,createdBy,customer:{id,name},case:{id,name},assessment:{id,revision,standardId,diagnosisDate,scope,copiedFrom},standard:{publicationDate,sourceUrl,contentSha256,criteria},counts,categoryCounts,limitations,majorIssues,responses,evidence,tasks}`。responsesは原O〜R・編集回答・当該時点でbasisHash一致の確定助言だけを選択して構成する。adviceDraft/ai_runs本文は含めない。空欄理由はnone/unconfirmed/staleの区別を保存。確認者はIDと表示用の社内メールをsnapshotへ固定する。

limitationsは基準IDのリストを持つunanswered/notRegistered/unreviewed/rejected/unconfirmedAdvice/staleAdvice/draftPendingIds。draftPendingIdsには有効な確定版と新しい下書きが併存する項目も含め、previewで「確定済み版を出力。新しい下書きは含めない」と件数/IDを示す。snapshotはこのメタデータだけを保存し、未確定本文は保存しない。証跡集計はassessments.mdの定義を使用する。majorIssuesは最大5件、選択されていない場合は高優先課題→期限→criterion orderの順にサーバーが提示する。担当者は同じdiagnosis内の基準IDに差替え可。公式の合否や取得確率を表現しない。

snapshot.evidenceはEvidence型に `file:null|{id,originalName,mime,sizeBytes,sha256}` と `reviewers:{id,email}[]` を追加したReportEvidence配列。files/app_usersを認可の下で結合し、出力に必要なファイル名・確認者表示を確定時に固定する。R2 object_keyやダウンロード用tokenは含めない。再生成は現在のfiles名やユーザー名を取得し直さない。

### 出力構成

PDF: 表紙（顧客/範囲/日付/制度版/報告版）→4状態集計と主要課題→未回答・証跡確認等の留意事項→全81基準の公式文、現評価/理由/根拠/今後の作業/補足、証跡名と箇所/確認状態、確定助言4要素、担当/期限/進捗。ページ番号を振り、長文は見出し付きで継続。生成が失敗したら不完全なPDFを完成品として渡さない。

Excel: `サマリー`（版・範囲・集計・留意事項）、`評価基準`（ID/要求事項/分類/公式文/自己評価/理由/根拠/今後作業/補足/原O/原P/原Q/原R/確定助言/助言状態）、`証跡`（ID/基準ID/文書名/URL/箇所/ファイル名/確認状態/確認者/確認日）、`改善課題`（基準ID/課題/担当/期限/進捗/完了条件/結果/確認）、`未回答・未確認`。複数証跡・課題はそれぞれ別行。外部ファイルへのアクセスtoken/署名URLを埋め込まない。全自由記述はstring型セル、`=+-@`やタブで始まっても数式/リンクを作らない。作業用Excelの再取込は初回対象外と表紙に記載。

## API

| API | request | data |
|---|---|---|
| POST /assessments/:a/report-preview | {expectedRevision,majorIssueCriterionIds?:string[]} | {previewHash,revision,content,limitations,blockingErrors} |
| POST /assessments/:a/reports | {expectedRevision,previewHash,majorIssueCriterionIds,acknowledgedLimitationHash}＋Idempotency-Key | {reportId,snapshotSha256,snapshot}、201 |
| GET /assessments/:a/reports | cursor?,limit? | items:{id,assessmentRevision,createdAt,createdBy}[]、nextCursor |
| GET /reports/:id | なし | snapshotとSHA256 |

previewHashは診断revision、顧客/案件revisionと表示名、制度hash、選択主要課題、limitations、rendererVersionのcanonical hash。生成時刻/新reportIdはhashから除く。acknowledgedLimitationHashはそのlimitationsのcanonical hash、空の場合も必須。確定時に全条件を再計算し、不一致は409で再previewを促す。DBへの固定は診断・顧客・案件revisionを同時条件にしたINSERT SELECT＋receipt/監査batch。成功直後の読出しだけで旧previewを承認した扱いにしない。

R01の実装詳細: `content` はsnapshotから `reportId/createdAt/createdBy` を除いた内容。previewHashにはこのcontent全体と顧客/案件revisionを用い、上記の条件に加えてファイル表示名・確認者メールの変更も次の確定要求で検出する。留意事項確認hashはクライアントでキー順を正規化したSHA-256を計算し、サーバーで再計算する。初期rendererVersionは `scs-report-1`。responsesの `adviceState` は `current/none/unconfirmed/stale`、有効なconfirmedAdviceの `reviewer` とtasksの `reviewer` に `{id,email}` を固定する。無効な確定助言と下書きの本文は含めない。

主要課題の初期提案は未完了課題を優先度（high/normal/low）→期日→基準順に並べ、同じ基準の重複を除いて最大5件を選ぶ。利用者が空配列を選んだ場合は主要課題なしとして扱う。履歴はcreatedAt/id降順、cursorは同一診断かつ現在の顧客権限で再検証する。確定結果が通信断などで不明な間は確認済みの入力を固定して同じ操作キーで再試行し、明示的な409後は主要課題の選択を保って再previewする。

PDF/ExcelのbytesはブラウザWorkerでsnapshotから作りローカル保存。サーバーで毎回最新版を引いて出力しない。snapshotは更新/削除APIなし、DB triggerでも禁止。古いreportも同じ内容で再生成できるが、renderer改訂による版面差が出る場合は元rendererVersionと現版を明示。バイト単位で同一という保証はしない。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| 固定内容/留意事項/集計/助言選別 | domain | src/server/modules/reports/domain/reportSnapshot.ts |
| reportsとreceipt/監査 | usecase/adapter | src/server/modules/reports/usecase/finalizeReport.ts、adapter/d1ReportRepository.ts、routes.ts |
| DTO | shared | src/shared/contracts/reports.ts |
| PDF/Excel生成 | front worker | src/front/workers/report.worker.ts、reportPdf.ts、reportExcel.ts |
| preview/履歴/保存UI | front | src/front/pages/ReportsPage.tsx |

## エッジケースの決定

欠字・サイズ超過・timeout・取消時はsnapshotを保持し再試行可。プレビューから変更が入れば再確認。未確定助言は本文に載せないが、その理由を一覧に残す。古いreportを再出力する際も現在の顧客権限を確認。フォントは同一origin、OFL同梱、全量埋込みの約14MBをUIで見込む。生成中の画面操作を妨げず、進捗と取消を表示する。

## テスト方針

F03の入力案内: 確定ボタンの直前に不足している範囲・診断日と入力先を表示する。入力先は診断ダッシュボードの `#assessment-scope` で、遷移後は対象セクションへ焦点とスクロールを移す。無効ボタンは背景色・文字色で区別し、不足項目はその説明として関連付ける。必須条件を緩和しない。版の確定後は、生成ボタン→完了後の保存ボタンという順序と、確定だけでは端末に保存されないことを表示する。

単体: 81/分類一致、範囲必須、未回答出力可、助言の未確定/stale除外。Workers結合: CAS、名前変更競合、snapshot UPDATE/DELETE拒否、後の編集が旧reportに不反映、権限。出力: PoCの長文/全81本文/文字列セル/同snapshot集計を移植し全文抽出と画像確認。E2E golden path: 留意事項付き確定→PDFとExcelを取得→同reportId/件数を照合、旧版再出力。

R01単独のE2Eは `tests/e2e/report-snapshot.spec.ts`。匿名fixtureで留意事項付きの版確定→回答/顧客名の編集→同じreportIdの旧内容再取得を検証し、1440px/640pxの画面画像を保存する。PDF/Excel取得の検証はR02/R03で同じsnapshotを利用して追加する。

R02の実装詳細: PDF本文の構成と折返しを `reportPdfContent.ts`、描画を `reportPdf.ts`、Workerの起動・120秒停止・取消を `reportClient.ts`、保存操作を `ReportPdfExport.tsx` に分離する。各基準は新しいページで開始し、長文が続くページには項目ID付きの継続見出しを置く。自由記述の改行は維持し、タブは版面上4空白で表示する。評価状態の不足記号は日本語フォントに収録された「×」で表示する。未収録の自由記述文字はコードポイントを添えて失敗表示し、文字を黙って置換しない。

フォントは `public/fonts/` の同一origin配信、起動時に固定SHA-256を検証し、外部originへのredirectは拒否する。Noto Sans CJK JP 2.004のOFL・NOTICEとPDF依存ライセンスを同梱する。PDF生成中に別の報告版を開いたり画面を離れた場合もWorkerを終了し、不完全なbytesを保存操作へ渡さない。

R02のE2Eは `tests/e2e/report-pdf.spec.ts`。生成PDFを `tests/pdf/verify_report.py` で独立に抽出・フォント全量hash検査・改ページ画像化する。実行環境にはPythonのpdfplumber/pypdfとPopplerが必要。必要なら `PDF_QA_PYTHON` と `PDF_QA_POPPLER` に実行ファイルのパスを指定する。匿名成果物は `.local/pdf-qa/` のみへ保存。生成時間/ファイルサイズはブラウザで取得し、`reportHeap.ts` で実際のPDF Worker targetのCDP `Runtime.getHeapUsage` を100ms間隔で要求してusedSize/totalSize/embedderHeapUsedSize/backingStorageSizeと採取時刻を記録する。繁忙時の応答遅延・終了時の取りこぼしを含むサンプルのピークであり、プロセス全体のRSSやメモリ上限ではない。Python QAのtracemalloc最大値も別の測定として記録する。

R03の実装詳細: `reportExcel.ts` はExcelJSを遅延読込し、上記の列順で5シートを作る。サマリーは「項目/内容/○/△/×/未回答/合計」の列を持ち、報告版ID、範囲、制度版、保存時と今回の描画版、全体・分類別集計、主要課題、留意事項を固定内容から記載する。評価基準の要求事項列は要求事項ID。確定助言は4要素・補足・固定確認者・確認日・確認版を改行区切りで記載し、current以外の助言本文と下書きは列挙しない。証跡は証跡ID×関連基準IDごとに1行とし、その基準の確認状態・固定確認者を記載する。改善課題の確認列は状態・固定確認者・確認日・メモを改行区切りで記載する。「未回答・未確認」は種別/基準ID/公式文の列で7種類のlimitationsを全件記載する。

全自由記述、原O〜R、日付、ID、空文字は文字列セルとし、原文の空白・タブ・改行を変更しない。数式やリンクオブジェクトを作らず、集計値だけ数値セルにする。アクセス情報対策はURL専用欄に適用する。証跡URLと制度資料URLにuserinfo、またはquery/fragmentのtoken/signature/credential/password/secret/authorizationやauth/sig/key/code系パラメータを検出した場合、URL全体を「アクセス情報を含むURLのため省略」に置換する。通常の `?id=42#page=3` などの文書IDやページ指定は文字列のまま保持する。独自の認証方式の秘密性を文字列だけから完全には判定できないため、ファイルの取得APIを呼ばず、snapshotにない署名URL/tokenを取得・付加しない。URL欄の省略方針は保存UIとサマリーに表示する。原O〜Rや回答・助言の自由記述はこの処理の対象外で、原文保存契約を維持する。

`report.worker.ts` の `{snapshot}` は既存PDF互換、`{snapshot,format:"excel"}` はExcel分岐でフォントを取得しない。`reportClient.ts` は両出力を120秒で停止し、取消・画面離脱時にはWorkerを終了する。`ReportExcelExport.tsx` を既存レポート画面へ接続し、同じ選択報告版のsnapshotをPDF/Excelへ渡す。完成bytesだけを保存可能とし、失敗時は固定版を保持して再試行する。作業用ブックの再取込対象外を保存UIとサマリー先頭に明記する。

R03境界値の保存: 全文字列セルの共通書出しで、literal `_xHHHH_` の先頭underscore（重なる表記も含む）を `_x005F_` へ、CRとXMLで保存できない制御文字等をST_Xstringへ符号化する。LFとタブはそのまま保持する。これはブック内の符号化であり、Excel/独立読込後の値は原文と完全一致する。独立XML QAはXMLエンティティ展開後にST_Xstringを1回だけ復号し、literal表記を再帰的に解釈しない。顧客/案件/範囲、回答と原O〜R、助言、証跡、課題の各自由記述族を同じroundtripマトリクスで保護する。URLの認証パラメータはcamelCase・大文字略語の境界、snake_case/kebab-case等の区切りを正規化し、apiKey/APIKEY/apikey、authCode/AUTHCODE/authcode、accessKey等の既知表記をquery/fragmentの両方で検出する。通常の文書ID/ページ指定を保持する対照も維持する。

R03の検証方針: Workers `test/worker/report-excel.test.ts` で5シート・全81ID/本文・原O〜R・確定助言・証跡/課題・留意事項の実xlsx再読込を完全照合し、式風先頭文字・空文字・改行のString型、非現行助言/認証パラメータ/外部関係の除外を検査する。Frontで失敗後の同版再試行、進捗、取消/timeout、離脱時停止と保存結果を検査する。golden pathは `tests/e2e/report-excel.spec.ts` の1本で、匿名ローカルAPIによる確定→同reportIdのExcel/PDF保存→診断と顧客編集→旧版Excel再保存。`tests/excel/verify_report.py` がExcelJSから独立したPython標準のZIP/XML読込で5シートをsnapshotと照合し、pdfplumberで同時取得PDFのreportId/集計一致を検査する。Pythonは `EXCEL_QA_PYTHON`、未設定時は `PDF_QA_PYTHON`、さらに未設定時は `python`。匿名成果物・1440px/640px画像は `.local/excel-qa/`。本番接続や実顧客ファイルは使用しない。
