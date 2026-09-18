# SCS Assessment

社内担当者が顧客のSCS ★3取得に向けた課題を可視化し、根拠・改善策・進捗を整理してPDFとExcelで報告する診断支援サービス。

現在は**ローカル実装の段階**です。レビュー済み設計と親9件・子18件の[実装Issue](https://github.com/yasagure3/SCS_Assessment/issues)を登録し、`feat/star3-assessment` で開発しています。クラウド公開はまだ行っていません。初回は★3、★4は次段階を予定します。正式な審査・取得判定を代行するものではありません。

## 設計資料

- [確認済みUIスケッチ](docs/design/UI_SKETCH.html) — HTMLとしてブラウザで表示
- [横断設計](docs/design/DESIGN.md) — 構成、データ、認証、API、運用判断
- [実装計画](docs/design/IMPLEMENTATION_PLAN.md) — 親9件・子18件のタスク案と完了条件
- [ユースケース](docs/design/USECASES.md) / [機能別設計](docs/design/features/)
- [要件の回答記録](docs/design/REQUIREMENTS_INTERVIEW.md) / [制度調査](docs/design/DISCOVERY.md)
- [PoCの結果と限界](docs/design/FEASIBILITY.md)

基盤は指定の [fullstack-worker-template](https://github.com/skanehira/fullstack-worker-template)。[ローカル開発手順](docs/DEVELOPMENT.md)と[出典](docs/TEMPLATE_ORIGIN.md)を参照してください。基盤の検証はF01で進行中です。

## 局所PoC

- [Excel](poc/excel/README.md): 81基準の取込、O〜R原値保持、匿名199 assertions、安全な作業用Excel
- [更新・権限境界](poc/domain/README.md): 競合、スナップショット、AI送信範囲
- [日本語PDF](poc/report/README.md): 81基準、長文の改ページ、全文抽出と画像確認

顧客の原本Excel・証跡本文・APIキーは収録しません。UIスケッチの項目別回答とPoCのfixtureは合成例です。生成PDF/依存物/ローカル検証記録はGit対象外です。
