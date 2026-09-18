# SCS診断支援 技術検証

検証開始日: 2026-09-18。UIスケッチはユーザー確認済み。以下は本製造前の局所PoCであり、本番への接続・データ保存を行わない。

## 検証の前提

- 指定テンプレート: `skanehira/fullstack-worker-template`、取得済みコミット `fab841832525a39d13b0c259336fc4b28fc37f0a`。
- React / Hono / Workers / D1 / Drizzleを設計の出発点とする。クラウド保存条件・AI契約・利用規模は未決。本番接続は別途確定する。
- Excelの実データはローカルでのみ解析する。成果物・ログ・テストfixtureにP〜Rの原文を転載しない。
- 実行時間の結果は当該PCの局所測定であり、クラウドや利用者全体の性能保証ではない。

## PoC: Excelを解析し、安全な作業用Excelを生成する

**id**: excel-roundtrip
**risk**: high
**blocker**: true

<!-- POC_STATUS: id=excel-roundtrip, blocker=true, status=verified, confidence=0.91 -->

対象: JavaScriptによるxlsx解析と書出し。L列ID、K列レベル、結合セルを解決しO〜Rの原値を保持する。数式は評価しない。

成功基準:
1. 提供Excelが★3=81、○24、△24、✖28、未回答5、★4追加72として抽出される。
2. 未知/重複ID、不明記号、欠落基準、数式セルを合成fixtureで検知できる。未知/重複/不明記号/回答数式は確定不可。欠落は未回答として81分母を維持し要確認とする。
3. 原文と編集値を別に保持できる。匿名fixtureでID/出典行/O〜Rの異なる値・空欄・改行・結合境界の対応をassertする。数式風文字列をxlsxへ書き戻し、セルが数式にならない。
4. 採用ライブラリとブラウザ向け導入方式、制限（圧縮展開量・セル数・対応形式）を明示する。

計画: `poc/excel/` に再現コードと匿名fixtureを置き実行する。出力は集計・assert結果のみ。失敗時の候補は別xlsxパーサ又は隔離したバックエンド解析。成功したと偽って代替を採用しない。

## PoC: 日本語の全81基準をPDFへ出力する

**id**: japanese-pdf
**risk**: high
**blocker**: true

<!-- POC_STATUS: id=japanese-pdf, blocker=true, status=verified, confidence=0.94 -->

対象: ブラウザで使えるPDFライブラリ、日本語フォント、改ページ、同一スナップショットの集計。HTML印刷のみでPDF生成済みとはしない。

成功基準:
1. 匿名81基準、表紙/集計、項目別判定・長文助言を含む実PDFを生成する。
2. 日本語が抽出でき、81のIDと長文の先頭・途中・末尾が欠落しない。先頭・中間・最終ページと長文の改ページ部分を画像化して読めることを確認する。
3. 長文を複数ページに分割し、ページ外への文字欠落を防ぐ。
4. 使用フォントのライセンスと配布方法、ブラウザbundle可否を確認する。

計画: `poc/report/` に再現コード。データは`.local/criteria-demo.json`の公開要件と匿名例のみ。成果物はローカル保存する。候補はpdf-lib + fontkit +再配布可能日本語フォント。別方式は検証結果を示して選択する。

## PoC: 権限・更新整合・AI送信境界を実行確認する

**id**: domain-boundaries
**risk**: high
**blocker**: true

<!-- POC_STATUS: id=domain-boundaries, blocker=true, status=verified, confidence=0.96 -->

対象: 外部サービスに依存しない権限判定、世代を用いた競合検知、レポートsnapshot、AI送信DTOのallowlist。

成功基準:
1. 未認証/MFA未完了/無効利用者/顧客未割当を拒否し、管理者と割当担当者だけ通る。
2. 同じ世代から2更新した場合、後続の古い更新は409相当で拒否する。元回答は不変。
3. snapshot後に診断が変わってもsnapshot集計・確定助言・範囲・確認状態・課題情報は変わらない。未確定案を出力しない。確定済み助言は回答変更後、新規出力から除外し、再確定で復帰する。
4. AI送信は公開要件＋確認済み匿名化文だけ。証跡本文・内部URL・顧客名・元回答が混入しない。入力変更後の古い確認は無効。

計画: `poc/domain/` のNode標準test runnerで合成データのみを実行する。これをCognito実接続やD1実環境の検証と取り違えない。

## 本番接続前に別途必要な検証

<!-- POC_STATUS: id=cloud-integration, blocker=false, status=unresolved -->

Cognito招待/TOTP/回復/失効、D1 migrationと同時更新、非公開R2取得、契約したAI接続、上限時の性能・バックアップ復元は設定先が未定。ローカル設計を進められるが、実顧客データの投入・本番公開条件として残す。認証・ストレージ・AIはPortで分離し、未設定時は閉じた状態で動作させる。

## リスクの優先度と根拠

| 項目 | 影響/起こりやすさ | 対応 |
|---|---|---|
| 結合セル・★4混入・原値列の取り違え | 高/高 | 実Excelと列が異なる匿名fixtureを照合。行番号を維持 |
| 日本語PDFの本文欠落 | 高/中 | 実PDFのテキスト抽出と改ページ部分の画像確認 |
| 他顧客閲覧・旧版上書き・AI過剰送信 | 高/中 | 独立した権限/版/送信DTOと否定ケースのテスト |
| テンプレート認証設定の流用 | 高/高 | 現設定は自己登録可・TOTP無効。招待制・必須MFAへの変更を必須タスクにする |
| ファイルの破損/巨大展開 | 中/中 | xlsxと添付の種類・サイズ・展開量制限。実装時に境界検証 |
| クラウド保存地・保持条件 | 高/未定 | Q14により設計案提示後に確定。本番データは未投入 |
| AI回答の誤解釈 | 高/中 | 出典つき定型助言と人の確定を必須化。AIは任意利用 |
| 初期性能 | 中/未定 | 1診断81件の限定で検証。顧客数・人数確定後の負荷検証を出荷条件にする |

## 調査で確認した外部制約

- テンプレートの `terraform/modules/cognito/main.tf` は `allow_admin_create_user_only=false`、TOTPが無効。既存のJWT検証だけで本要件を満たしたとは扱わない。
- 必須TOTPにおける初期設定・チャレンジ・管理者招待の動作は [AWS公式資料](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html) を参照。管理者作成ユーザーのAPI認証フローとMFA_SETUPを用い、フロントが申告するMFA済フラグを信用しない。
- D1は1行2,000,000 bytes、1クエリ100 bind parametersという制限がある。[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)。81行の大きな複数値INSERTを無条件に1本にせず、保存単位を境界内に制限する。
- D1/R2のlocation hintは日本国内保存の保証ではない。国内限定の条件が後から付けば保管先を再評価する。[D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)、[R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)。
- 提供Excelは62,940 bytes、O〜R原値のUTF-8合計13,840 bytes、最大文字数はO=1/P=118/Q=490/R=419（内容をログに出さず測定）。上限値の設計根拠とし、他顧客ファイル全体の保証とはしない。

## PoC結果

### japanese-pdf — verified（confidence 0.94）

- 再現手順: `poc/report/README.md`。`node build.mjs` → `node test.mjs` → `python verify.py` の順に親担当が最終修正版を実行し、最新PDFと5ページ画像を確認した。
- browser/ESM/ES2022 bundleは外部importなし、1,379,013 bytes（gzip 551,850 bytes）。そのbundleをNodeで実行し、匿名81基準・37ページ・13,944,459 bytesのPDFを生成。長文6,443文字は4ページに分割され、当該PC測定18,376 ms。
- 全81 ID・全81基準本文・234フィールド全文・1,065描画行・38,928字形のページ境界・未確定助言の非掲載を検証。表紙、長文2ページ、中間、最終の5画像で日本語表示と欠落なしを確認。最新PDFのSHA-256は `cc38841aa5db1c018945b01b07822d514d595fd79450160276ccd77eed7c1517`。
- 採用: pdf-lib 1.17.1 + fontkit 1.1.1 + Noto Sans CJK JP Regular 2.004（OFL）。CFFのsubsetで表示不良があったため全量埋込み、`locl/ liga`を無効化して表示と文字抽出の両方を通した。○/△/✖は元の意味を保持する。
- 限界: 実ブラウザ内の生成・ダウンロード・Web Worker・低性能端末の測定は製造時に行う。約16.5MBのフォント配信と約14MBのPDFが必要。PDF/A・PDF/UA・任意字形を保証せず、未収録字形はエラー表示する。実顧客本文は使用していない。

### excel-roundtrip — verified（confidence 0.91）

- コード/手順: `poc/excel/README.md`。実ファイル検証は `node poc/excel/verify.cjs` に提供xlsxと公式xlsxのパスを引数指定。顧客ファイル不要の再現は `node poc/excel/verify-anonymous.cjs`（199 assertions）。実ファイル検証の結果: `.local/excel-result.json`。
- ExcelJS 4.4.0ブラウザ配布bundleで提供ファイルを解析し、★3=81（○24/△24/✖28/未回答5）・★4追加72を確認。O〜R原値324件、Kの結合元55行を照合。処理全体の当該PC測定は約2.6秒。
- 匿名fixture199 assertions成功。未知/重複/不明記号/回答数式/マスター本文変更を拒否。欠落の明示確認、原文と編集の分離、改行/空欄の保持、数式風文字列を文字列セルとして再読込できることを確認。
- 親担当によるブラウザ追加検証: `poc/excel/browser.html` をローカルHTTPで表示し、Chromium152の画面に `PASS — 199 assertions` を確認。実顧客ファイルはブラウザ試験へ投入していない。
- 採用根拠: ブラウザ側のdocument Workbook APIで取込/出力可能。導入時は遅延読込・専用Web Workerとする。サーバーでは送信された正規化JSONをマスターで再検証する。
- 限界: ZIP申告サイズ検査は実展開サイズ制御ではない。実装タスクで展開byte数上限・Worker終了・異常ファイル負荷を検証する。現PoCを悪意あるファイルへの耐性完了とは扱わない。Excelの元書式を再現する書戻しではなく、別の作業用Excelを生成する。

### domain-boundaries — verified（confidence 0.96）

- 実行: `node --test poc/domain/boundaries.test.mjs` — 当初24/24成功。設計レビューで文言/範囲/証跡確認を元に戻す3件を追加し、最終27/27成功。`python poc/domain/check_sqlite.py` — 実SQLiteで8/8成功。
- 独立レビュー結果: `.local/domain-result.json`。匿名データでの追加assert7件も成功。
- 確認: 未割当/無効利用者の拒否、古い版の上書き拒否、元回答維持、snapshotと編集元の分離、範囲/証跡/回答の変更に伴う助言再確認、未確定案の除外、AI入力のallowlistと再確認。
- 限界: 全APIと永続化は未実装。実Cognito/R2/remote D1への接続検証ではない。SQLite試験は単一接続で古い世代の更新を再現。AIの識別子自動検知は補助で、人による確認が必要。保存済レポートのUPDATE/DELETEを禁止する実装が別途必要。
