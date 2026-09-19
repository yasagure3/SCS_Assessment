# Excel取込の検証

Issue #15。検証データは `poc/excel/master.json` の公開B〜Nマスターと匿名のO〜Rだけを使用する。提供された顧客Excelの回答本文はfixtureや成果物へ含めない。

## 再現

Windowsでは `scripts/vp.ps1` を使用する。別worktreeの場合は `VP_HOME` とVite+実行ファイルのPATHを設定する。

```powershell
./scripts/vp.ps1 test --run
./scripts/vp.ps1 exec vitest run -c vitest.workers.config.ts test/worker/imports.test.ts
./scripts/vp.ps1 check
./scripts/vp.ps1 build
$env:E2E_PORT = '5213'
$env:E2E_CHANNEL = 'msedge'
./scripts/vp.ps1 exec playwright test tests/e2e/imports.spec.ts
```

ExcelJS 4.4.0とfflate 0.8.3はproduction依存を固定した。ExcelJSはファイル選択後、専用Worker内だけで遅延読込する。公開マスターは認証済み `GET /api/v1/standards/:id/import-master` から取得する。`masterContentSha256` は当該固定版の公開マスター全体のcanonical SHA-256であり、ブラウザは存在する各IDのB〜Nをその正本と照合する。欠落IDは確定時に明示確認する。クライアントhashは原本真正性の保証には使わない。

開発サーバーの `optimizeDeps.include` にExcelJS/fflateを列挙する。Worker内の依存が初回ファイル選択時に発見されると、Viteの追加最適化が古い依存URLに504を返し、ページを再読み込みすることを失敗traceで確認した。この設定は起動時の依存最適化を先に済ませるもので、ExcelJSのブラウザへの読込はファイル選択後のまま。再現検証は `.local/e2e-vite-cache` のない状態から行う。

## 検査内容

- 匿名xlsxは★3 81件（○24/△24/✖28/未回答5）と★4 72件。実際のK結合セルを含み、O/P/Q/Rの互いに異なる文字列・空白・改行・シート名・行番号を登録後の原値と全件比較する。
- O/P/Q/Rの書式付き文字列は匿名xlsxへの書出し・再読込を通し、文字装飾を除く全文・空白・改行・Unicode文字を通常文字列と同じ原値として保持する。数値・boolean・数式・ハイパーリンクの拒否は維持する。
- 型・未知/重複ID・見出し・公開B〜Nの文言差異・数式・版・改ざんJSON・原文と編集コピーを合わせた1MiB超過を拒否する。×/✕の正規化は確認画面に表示する。
- 実D1でpreviewの無更新、missing ID完全一致、同じ操作の並行再送、異なる操作のCAS競合、編集済診断拒否、他顧客拒否、途中失敗による文書/履歴/台帳/監査の全rollbackを検査する。
- ZIP中央ディレクトリとlocal header、CRC、重複名、暗号化、ZIP64、マクロ・外部参照を検査する。XML数値文字参照も検査対象。全entryを512 byte単位の圧縮入力で展開し、ExcelJSが使わないentryも実出力byte数に含める。1entry 10MiB/合計50MiB超過でその場で停止する。
- 部品名を上書きするUnicode Path追加フィールドはcentral/local両方で拒否する。既存の独立レビューで用いた関係部品・マクロ・外部リンク・埋込みの4系統をそのまま拒否期待へ移し、正常xlsxの対照も維持する。JSZipが正規化して別名にする相対要素・空の中間要素も拒否する。
- 10秒期限・取消・成功・失敗のいずれでもWorkerを終了し、handlers/timerを解除する。画面離脱時も終了する。取消後の遅延結果は世代番号で破棄する。

## ブラウザ計測の読み方

`tests/e2e/imports.spec.ts` は `.local/import-browser-metrics.json` とPlaywright添付JSONへ測定結果を保存する。ZIP試験は11MiBのentryの申告展開長を1 byteに偽装するケースと、対象外entry 6件×9MiBの合計上限ケースを使用する。ZIPの時間はファイル選択からエラー表示までの経過時間。

取消・timeoutは実際に8MiBの配列を確保してループする専用Workerを使用し、製品のWorker controllerから終了する。専用Worker targetが残っていないこともassertする。CDP `Runtime.getHeapUsage` の値はGC後の**親ページのheap**であり、専用Workerのpeakメモリ/RSSを表すものではない。OSへのメモリ返却時点や他の端末での上限性能までは保証しない。

スクリーンショットは `.local/e2e-import-select.png`、`.local/e2e-import-preview.png`、`.local/e2e-import-preview-narrow.png`。狭い画面の横はみ出しをassertする。

## ローカル実測（2026-09-19）

Windows、Playwrightのmsedge指定、UAのChromium版153.0.8010.12でキャッシュを退避して起動した。Front68件、Workers96件、Edgeの全8シナリオ、ビルドと本番fixture除外検査が成功した。初回依存最適化による失敗を上記設定で解消した後の測定値である。

| 検証 | 結果 |
| --- | --- |
| 申告1byte・実展開11MiBのentry拒否 | 487ms |
| 対象外entryを含む合計54MiB拒否 | 2,613ms |
| 実Worker取消 | 162.9ms、終了1回 |
| 実Workerの10秒期限 | 10,002.5ms、終了1回 |
| 終了後の専用Worker target | 0件 |
| GC後の親ページusedSize（前→後） | 12,038,152→12,088,004 bytes |
| GC後の親ページbackingStorageSize（前→後） | 7,197,532→7,202,923 bytes |

専用Workerには8MiBを実確保させた。上記メモリ値は親ページだけの観測であり、Workerのpeak/RSSやOSへの返却量の測定値ではない。選択・プレビュー・狭幅の3画像を開いて確認した。

## 互換性修正後の確認（2026-09-20）

提供された元Excelをローカルで読み、製品のZIP検査と解析関数を通した。★3の81行、★4除外72行、○24/△24/✖28/未回答5を確認し、O〜R全324セルをExcelJSで読み出した文字内容と完全一致で比較した。Q22の書式付き文字列も保持する。実データ本文はログ・fixture・リポジトリへ保存せず、外部にも送信していない。

修正後の全体検証はFront75件・Workers96件・初期管理者準備3件・Edge E2E8件が成功した。匿名xlsxのO〜Rに書式付き文字列を含めたgolden pathも成功した。型/lint/整形・build・本番fixture除外・migration・占有ポート拒否を確認し、3画像を開いて確認した。独立r2レビューで前回high2件の解消を確認し、medium2件を `docs/pending-review/issue-15.html` に保留した。

同環境の再測定では、entry上限拒否993ms、合計上限拒否2,581ms、取消159.1ms、10秒期限10,013ms、残存Worker0件。GC後の親ページusedSizeは12,028,308→12,078,160 bytes、backingStorageSizeは7,197,531→7,202,922 bytesだった。専用Workerのpeak/RSSを測った値ではない。最新mainとの統合後にも全体検証を行う。

担当者管理・証跡管理を含むmain（96437c2）との統合後は、Front99件・Workers125件・初期準備3件・Edge E2E20件と全チェックが成功した。保存済み操作の再送は診断IDを受けて現在認可を確認する共通Repositoryへ統一した。Excelプレビューは読取用POSTとして共有送信処理に明示し、更新用mutationIdを追加しない。E2Eでプレビュー/確定の送信キー全体と保存原文を完全一致で検証した。
