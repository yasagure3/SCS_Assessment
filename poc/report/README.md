# 日本語81基準 PDF PoC

`pdf-lib 1.17.1` + `@pdf-lib/fontkit 1.1.1` + `Noto Sans CJK JP Regular 2.004` を使い、ブラウザ向けJavaScript bundleから実PDFを生成する局所検証。HTML印刷ではない。

## 再現

Node.js 22以降、Python 3.11以降 + `pdfplumber`、Popplerの`pdftoppm`を用意する。

```powershell
Set-Location poc/report
./bootstrap.ps1
node build.mjs
node test.mjs
python verify.py
```

`bootstrap.ps1`はpackage-lock.json固定の依存を`npm ci --ignore-scripts`で取得する。フォントとOFLは固定タグ`Sans2.004`から取得し、SHA-256を検証する。ネットワークが制限される環境では、その取得とネイティブesbuildの実行に許可が必要となる場合がある。

このPCで使用した実行系:

- Node: `C:/Users/gakiyama/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`
- Python: `C:/Users/gakiyama/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`（日本語出力には`-X utf8`）
- Poppler: `C:/Users/gakiyama/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe`

## 検証対象

- `fixture.json`には公開要件と合成した自己評価記号だけを収録。顧客の理由・証跡・補足情報、氏名、内部URLを含まない。`.local`や提供Excelなしで再現できる。
- `report.mjs`: スナップショットをclone/freezeし、表紙集計・未回答一覧・証跡未確認一覧・全81基準の公式文言・架空の確定助言を生成。未確定助言は出力しない。
- `build.mjs`: `platform: browser` / ESM / ES2022で実bundleを作り、外部import有無と圧縮前後のサイズを記録。
- `test.mjs`: 同じbundleをNodeで実行する。24/24/28/5の集計、スナップショット後の元データ変更の不反映、81基準、長文6,443字の複数ページ分割、描画座標範囲を検証。
- `verify.py`: 完成PDFを独立したpdfplumberで解析。全81 ID、全81基準本文、234フィールド全文、描画行の抽出、全字形の座標、未確定案非掲載を検査。表紙・中間・最終・長文継続ページをPNGへレンダリングする。
- 最後に`output/page-*.png`を目視で確認する。文字抽出成功だけでは合格にしない。

## フォントとライセンス

- [Noto CJK公式配布](https://github.com/notofonts/noto-cjk/tree/Sans2.004)、フォント原本16,467,736 bytes。
- [固定版OFL](https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE)を`fonts/OFL.txt`に保存。フォント本体とライセンスを同梱し、アプリの同一オリジンから配布する。生成時に外部CDNへ顧客データを送る必要はない。
- [pdf-lib公式](https://pdf-lib.js.org/)はブラウザとカスタムフォント埋込みをサポート。MIT原文を`licenses/pdf-lib-MIT.txt`に保存。
- [fontkit公式](https://github.com/Hopding/fontkit)はブラウザ利用とMITを表明。配布パッケージREADMEのライセンス表記を`licenses/fontkit-README.md`に保存。npm配布には独立LICENSEファイルがないため、実製品配布時には依存全体のNOTICE・著作権表記を整備する。

## 検出した不具合と採用条件

1. **CFFフォントのsubset:trueは不採用**。216,737 bytesの38ページPDFは全文抽出を通ったが、Popplerレンダリングで日本語が四角になった。
2. **subset:false**では日本語表示が正常になった。13,946,231 bytes、生成22,439 ms（このPCの1回の実測）。ただし数字のlocl置換がToUnicodeに載らず抽出が失敗した。
3. `subset:false, features:{locl:false,liga:false}`を採用。最終版は全81基準本文・234フィールドの全文抽出を通過した。先頭・長文の改ページ前後・中間・最終の5ページをPNGで目視し、日本語、数字、判定表記、末尾81番目まで読めることを確認した。

## 最終検証結果（2026-09-18）

判定：**verified（局所PoC）**。信頼度：**0.94 / 1.00**。この数値は下記の限定した再現条件に対する技術判断であり、本番品質や制度適合率を表さない。

- PDF：37ページ、13,944,459 bytes、生成18,376 ms（このPCで1回の測定）。
- bundle：1,379,013 bytes、gzip 551,850 bytes、ブラウザ対象ESM、外部importなし。このbundleをNodeで実行してPDFを生成した。
- 集計：81基準、○24・△24・✖28・未回答5。判定の意味は○「満たしている」、△「判断微妙」、✖「不足」。
- 全81 ID・全81基準本文・234フィールド全文・1,065行の抽出チェック合格。未確定助言の非掲載を確認。
- 長文6,443字は3～6ページに分割され、全文一致を確認。描画1,007行と独立抽出38,928字形の座標チェック合格。
- PNG目視：1・3・4・19・37ページ。日本語の四角化、本文の重なり、ページ外への欠落なし。
- SHA-256：`cc38841aa5db1c018945b01b07822d514d595fd79450160276ccd77eed7c1517`。

根拠は`output/bundle-result.json`、`generation-result.json`、`extraction-result.json`と最新PDF・PNG。再実行時も`build → test → verify → 画像確認`を一連で実行し、最新PDFのSHA-256と突き合わせる。

## 残る制約

- ブラウザ対象のbundle生成とその実行を検証するPoCであり、実ブラウザのダウンロードUI、Web Worker、メモリ消費、主要ブラウザ横断、低性能端末は未検証。
- フォント全量埋込みによる約14MB PDFと約16.5MBフォント配信が発生する。生成は遅延読込み＋Web Workerへ移し、キャンセル/進捗表示を製造段階で検証する。
- PDF/UA、PDF/A、複雑な異体字・絵文字・RTL、禁則処理の完全性、任意入力の最大長は未保証。未収録字形はエラーとして検知する。
- 改ページで本文は継続されるが、寡婦行・孤立見出しの調整や個社向け版面最適化は製造段階で行う。
- このPoCはクラウド・顧客原文・証跡ファイル本文・AIサービスへ接続しない。
