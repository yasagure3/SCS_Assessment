# Excel取込・書出し PoC

2026-09-18。局所技術検証であり、製品へ組み込む前の最小コード。原本は読取のみで、顧客回答・証跡・内部URLは出力しない。保存されるfixtureは公開要件と匿名文言のみ。

## 再現

1. このフォルダーの `bootstrap.ps1` をPowerShellで実行する。ExcelJS 4.4.0のブラウザbundleとMITライセンスを `vendor/` に取得し、bundleのSHA-256を検証する。ダウンロードが制限される環境では許可が必要。
2. リポジトリルートで次を実行する。顧客原本は引数で明示し、リポジトリ内に保存しない。公式マスター引数の省略時は `.reference/scs-official-20260327.xlsx` を使う。

```powershell
node poc/excel/verify.cjs '提供Excelの絶対パス.xlsx' '公式マスターの絶対パス.xlsx'
```

原本を使わず公開マスターと合成回答だけで199 assertionsを再実行する場合:

```powershell
node poc/excel/verify-anonymous.cjs
```

公式マスター: [IPA 2026-03-27 Excel](https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/20260327001-c.xlsx)。公式由来B〜Nの値を `master.json` に生成する。O〜Rは生成マスターへ入らない。

結果は `.local/excel-result.json`。匿名検証ブックは `out/anonymous-import.xlsx`、文字列安全性の検証ブックは `out/safe-text-roundtrip.xlsx`。`vendor/` と `out/` はこのフォルダーの `.gitignore` で除外する。

`browser.html` をこのフォルダーが見えるローカルHTTPサーバーから開くと、同じbundle、core、199 assertionをブラウザでも実行する。必要な通信は同一オリジンの公開マスター/スクリプト読込だけ。ファイル選択やAI呼出しは行わない。

## 観測結果

- 提供Excel: ★3 81基準、○24・△24・✖28・未回答5、★4追加72基準。
- ★3のO/P/Q/Rについて324件の原値照合。値だけでなくセル座標と結合元を保持。P〜Rの本文をログ・fixtureに出力していない。
- K列の55行で結合元の参照を確認。公開B〜Nの内容/所属レベルを公式マスターと突合。
- 匿名fixtureで199 assertionを通過。未知/重複/不正ID、不明回答記号、欠列、公式本文改変、K所属レベル改変、L数式およびO〜R各列の数式を拒否。
- 欠落は未回答で81分母を維持。明示的な欠落確認をしない限り確定不可。他のエラーを確認操作で迂回できない。
- 改行、空文字、結合された回答、rawと編集値の分離を検証。
- `=`, `+`, `-`, `@`, タブで始まる数式風文字列を文字列セルとしてxlsxに保存し、再読込して数式セルになっていないことと文字列の完全一致を確認。元回答と編集値は別列。

## ブラウザへ組み込む方式

ExcelJSのdocument Workbook APIだけを使用し、`File.arrayBuffer()` → `Workbook.xlsx.load()`、`Workbook.xlsx.writeBuffer()` → Blob保存とする。今回のNode検証もNode専用ExcelJS APIではなく、ブラウザ配布bundleを実行した。アプリでは固定versionをpackage managerで管理し、取込操作時に遅延読込して専用Web Workerで実行する。PoCの `core.js` はNode/DOM/ネットワークに依存しない。

ExcelJSの[公式ブラウザ説明](https://github.com/exceljs/exceljs/blob/v4.4.0/README.md#browser)ではdocument方式が対象で、streaming reader/writerは対象外。[結合セル](https://github.com/exceljs/exceljs/blob/v4.4.0/README.md#merged-cells)のmaster参照を利用し、[数式](https://github.com/exceljs/exceljs/blob/v4.4.0/README.md#formula-value)の計算は行わない。ライセンスは[MIT](https://github.com/exceljs/exceljs/blob/v4.4.0/LICENSE)。

## 上限と未検証範囲

PoCはxlsxのみ。xls/xlsm、マクロ、暗号化、ZIP64は対象外。現行公式様式以外は列名/公開本文の照合エラーとして止める。Excelに見える表示文字だけではなく、元型/値を保持する。

暫定上限はファイル10MiB、ZIPエントリ500、申告展開合計50MiB/各10MiB、5シート、各2,000行×64列、非空100,000セル。ZIPのエントリサイズをパース前に検査するが、**ZIP内の申告値が偽装された場合の実際の展開量制御は未実装**。行・列・セル数の確認もExcelJSで読んだ後なので、初期確保の防御にはならない。本製品では実際に展開したbyte数を止められる前段処理、Workerの時間上限と強制終了、異常ファイルでのブラウザメモリ実測を追加する。このPoCを悪意あるファイルへの耐性検証とみなさない。

公式version切替、規模上限、ファイル選択UI、ブラウザ差、日時/エラー/リッチテキストの多様なfixture、アクセシビリティは本製造の追加検証対象。作業用Excelを別生成する方式で、元様式の書式を完全再現する機能は検証対象外。原文ファイル自体を改変しない。

## 計画のカバレッジ

FEASIBILITYの4成功基準は、実ファイル抽出、匿名の異常系、文字列の安全な出力、導入方式/制限をカバーする。欠落の確認操作、原値の型/改行/結合元、公式B〜N一致も追加した。本番利用の前提となるZIP資源制限とWorker実装は、次工程の受入条件として明示して残す。
