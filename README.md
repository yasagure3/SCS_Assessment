# SCS Assessment

社内担当者が顧客のSCS ★3取得に向けた課題を可視化し、根拠・改善策・進捗を整理してPDFとExcelで報告する診断支援サービス。

2026年3月27日版のSCS ★3（26要求事項・81評価基準）を対象に、招待・MFA、Excel取込、判定、証跡、助言確定、改善課題、再診断、PDF・Excel出力を実装しています。★4は対象外です。正式な審査・取得判定を代行するものではありません。

## 利用の流れ

1. 管理者からの招待でパスワードと認証アプリを設定し、MFAを完了します。担当者には割り当てられた顧客だけが表示されます。
2. 顧客と案件を作成します。診断ダッシュボードで対象会社・拠点・部署・システムと診断日を保存します。範囲未定のまま下書き作成もできます。
3. Excel取込で元のxlsxを検査し、81基準と除外する★4件数を確認して取り込みます。元O〜Rを保持し、現在の回答とは区別します。回答編集済みの診断への再取込はできません。
4. 個別基準で判定理由と根拠を確認し、証跡を登録・確認します。定型助言を編集し、人が内容を確認して助言を確定します。AIが未設定でも手入力を利用できます。
5. 改善課題の担当・期日・完了条件を管理し、実施結果を確認します。証跡確認や課題完了で自己評価が自動的に○になることはありません。
6. 再診断比較から新しい診断時点を作ります。回答のコピーと課題の引継ぎを選べます。前回は保持され、コピーした証跡・助言・課題の確認はやり直します。
7. レポートで事前確認し、留意事項を確認して版を確定します。その後「PDFを生成」「Excelを生成」を選び、生成完了後の保存ボタンで端末へ保存します。**版の確定だけではファイルは保存されません。**

レポート確定には対象範囲4項目と診断日が必須です。不足項目がある場合、確定ボタン付近の「不足項目を入力する」から修正できます。未回答・証跡未確認が残っていても、その項目を明記して確定できます。未確定・再確認が必要な助言本文は出力されません。範囲や回答・証跡を変更した後は助言を再確認してください。

PDFと作業用Excelは同じ固定報告版から生成します。後日の編集で過去の報告版は変わらず、履歴から再出力できます。Excelは5シートの作業用ブックで、再取込用ではありません。同時編集の競合では未保存入力と最新値を比較し、再編集して保存します。

認証情報はメモリ内だけに保持します。継続操作中の期限切れはSDKで更新しますが、画面再読込後は再ログインが必要です。停止・割当解除・全端末失効は更新後のtokenにも適用します。

## 開発・検証

[ローカル開発手順](docs/DEVELOPMENT.md)に沿ってVite+を導入し、`vp install --frozen-lockfile`、ローカルD1 migration、`vp dev --port 5173 --strictPort`で起動します。Windowsは `scripts/vp.ps1` を使用します。

`vp test --run`、`vp exec vitest run -c vitest.workers.config.ts`、`vp check`、`vp build`、`vp exec playwright test` が全体の検証コマンドです。[全機能結合検証](docs/INTEGRATION_VERIFICATION.md)は招待から帳票の実保存まで匿名fixtureで通します。E2Eには `vp exec playwright install chromium` とPython・Popplerが必要です。Python依存は `tests/pdf/requirements.txt` で固定しています。既存Edgeで主要E2Eを実行する場合も、実ブラウザ200%確認には同梱Chromiumを使用します。

ローカルfixtureは本物のHono・D1/R2とテスト専用の外部連携境界を使います。実Cognitoの配信・MFA・回復は別途[認証運用手順](docs/AUTH_OPERATIONS.md)に沿って確認します。[匿名プレビュー環境の運用](docs/PREVIEW_OPERATIONS.md)を参照してください。CIは検証のみで、デプロイを実行しません。

## 設計資料

- [確認済みUIスケッチ](docs/design/UI_SKETCH.html) — HTMLとしてブラウザで表示
- [横断設計](docs/design/DESIGN.md) — 構成、データ、認証、API、運用判断
- [実装計画](docs/design/IMPLEMENTATION_PLAN.md) — 親9件・子18件のタスク案と完了条件
- [ユースケース](docs/design/USECASES.md) / [機能別設計](docs/design/features/)
- [要件の回答記録](docs/design/REQUIREMENTS_INTERVIEW.md) / [制度調査](docs/design/DISCOVERY.md)
- [PoCの結果と限界](docs/design/FEASIBILITY.md)

基盤は指定の [fullstack-worker-template](https://github.com/skanehira/fullstack-worker-template)。[出典](docs/TEMPLATE_ORIGIN.md)と各機能設計に、採用理由・制約・検証範囲を記録しています。

## 局所PoC

- [Excel](poc/excel/README.md): 81基準の取込、O〜R原値保持、匿名199 assertions、安全な作業用Excel
- [更新・権限境界](poc/domain/README.md): 競合、スナップショット、AI送信範囲
- [日本語PDF](poc/report/README.md): 81基準、長文の改ページ、全文抽出と画像確認

顧客の原本Excel・証跡本文・APIキーは収録しません。UIスケッチの項目別回答とPoCのfixtureは合成例です。生成PDF/依存物/ローカル検証記録はGit対象外です。
