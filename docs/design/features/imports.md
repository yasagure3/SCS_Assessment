# Excel取込

- 種別: 機能設計書
- 対象 UC: UC-002（US-003）
- 適用規則: BR-001,003,009,012,013

## 何を作るか

一次スクリーニングExcelのL列ID、K列レベル、O自己評価/P理由/Q根拠および実施する事/R補足情報を検査し、元のセル文字列と出典行を保持して81回答を一括登録する。実ファイルの解析はブラウザ内、APIへは正規化JSONを送る。

## 入出力と振る舞い

スケッチ「Excel取込」。選択→Worker検査→列対応/81基準と★4除外件数/エラー一覧→欠落の明示確認→確定。取込対象はimportInfo=nullかつ全manualEdited=false。証跡/課題が既にあるだけでは拒否しないが回答変更に応じた助言再確認が発生する。

制度版の公開B〜N値、見出し、LのIDとKの結合元を照合する。文言差異を勝手に既知版へ丸めない。★3の回答記号は原本○/△/✖、空欄。`×`/`✕`はpreviewで置換内容を明示した上でnoに正規化可。その他は422。原値は空白・改行・記号を含め保持し、判定用のtrim値と分離する。文字列セルのみを回答として採用し、数値/boolean/数式は型エラー。L又はO〜Rに数式があれば評価せず拒否する。参照マスターの数式も許さない。

初期編集値はstatus←O、reason←P、basis←Q、plannedWork←空、supplement←R。Qに未来作業が混ざる注意を表示し、人がbasis/plannedWorkを分離する。欠落した★3 IDはoriginal=nullの未回答として追加。★4は件数のみ記録し回答原文を保存しない。インポート後の分類/状態集計はサーバー計算。

## API

共通契約はDESIGN.md「横断規約」。normalizedには `{standardId,fileName,clientFileSha256,masterContentSha256,star4Excluded,rows:[{criterionId,sheet,row,O,P,Q,R}]}`。masterContentSha256はブラウザで検査した公開領域のhashだが、クライアントの自己申告が原本真正性を保証するわけではない。APIは公式マスターを常に正本とする。

| API | request | data |
|---|---|---|
| POST /assessments/:a/imports/preview | {expectedRevision,normalized} | {revision,normalizedSha256,counts,missingIds,warnings,errors,canCommit} |
| POST /assessments/:a/imports | {expectedRevision,mutationId,normalized,normalizedSha256,acknowledgedMissingIds} | {assessment,counts} |

previewはDBを変更しない。確定時に正規化、ID集合、列型、サイズ、版、空案件条件、missingIds完全一致を再検査し、server計算のnormalizedSha256と照合。preview応答のcanCommitを信頼して検査を省略しない。原本ファイルのhashは出典メモ、server hashは送信内容の同一性確認。未知ID/重複/回答数式/範囲外行番号/版違いは422、上限413、編集済/競合は409。失敗は部分反映しない。

## 実装の配置

| 処理 | 層 | 実装先ファイル |
|---|---|---|
| ZIP事前検査・実展開量制限・ExcelJS | front worker | src/front/workers/excel.worker.ts、xlsxLimits.ts |
| 正規化DTO | shared | src/shared/contracts/imports.ts |
| 正規化/ID照合/状態変換 | domain | src/server/modules/assessment/domain/importAssessment.ts |
| assessments/履歴への一括CAS | usecase/adapter | src/server/modules/assessment/usecase/commitImport.ts、adapter/routes.ts |
| previewとエラー行表示 | front | src/front/pages/ImportPage.tsx |

再現基盤はpoc/excel/。永続化Portは基盤のassessment repositoryを使用する。

## エッジケースの決定

原本Excelはアップロード保存しない。ファイル名からパスを除く。ZIPの申告サイズだけに頼らず実展開byte数を監視し、対象外entryも上限計数する。巨大/暗号化/マクロ/ZIP64/外部参照付き文書は拒否。対応外の整形は自動修正せず具体的なシート/行/列を案内する。中止/10秒timeoutでWorkerを終了して旧診断を保つ。作業用Excelは初回取込フォーマットではない旨をUIに表示する。

## テスト方針

単体/結合: PoC199assertionsを移植、列が互いに異なるfixtureで原文対応を検査、欠落/重複/未知/数式/版違い/改行を検証。ZIP偽装申告サイズと実展開上限、10秒停止、メモリ解放はブラウザ試験。APIは改ざんJSON/同時編集/再送/部分保存なし。E2E golden path: 匿名xlsx選択→24/24/28/5確認→取込→原O〜R照合。
