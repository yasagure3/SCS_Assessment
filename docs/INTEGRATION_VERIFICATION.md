# 全機能結合検証

匿名fixtureとローカルD1/R2、Cognito SDKのテスト専用境界を使用する。顧客原本・クラウドの秘密情報は使わない。

## 追加前の方針とカバレッジ

既存の機能別試験は削除・skip・緩和しない。細かな入力失敗は既存Front/Workers試験を維持し、新規E2Eは全機能を渡る業務動線に集中する。

| シナリオ | 優先度 | 既存の確認 | 今回補う確認 |
|---|---|---|---|
| 招待/MFAから帳票まで | Critical | 機能別E2E | journey.spec.tsで画面間を通した一連の操作 |
| 取込原値・証跡・助言・課題・再診断・固定版 | Critical | 各Workers試験 | integration.test.tsで実D1を使った連鎖と旧版保持 |
| 長時間のtoken期限切れ | Critical | 署名/失効単体試験 | SDK更新後のAPI再試行、失効/停止の負対照 |
| 範囲未入力の確定ボタン | Major | disabledのみ | 不足欄の近接表示、入力先、生成と保存の案内 |
| キーボード・200% | Major | 機能別CSS zoom | 実ブラウザzoomと倍率記録、焦点・主要操作・幅 |
| 未設定AI、空状態、競合、失敗回復 | Major | Front/機能別E2E | 結合動線上の保持・復帰 |

## 検証コマンド

`vp test --run`、`vp exec vitest run -c vitest.workers.config.ts`、`vp check`、`vp build`、`vp exec playwright test` を実行する。新規試験は `vp exec vitest run -c vitest.workers.config.ts test/worker/integration.test.ts`、`vp exec playwright test tests/e2e/journey.spec.ts` で個別実行できる。

PDF/Excel QAにはPythonのpdfplumber/pypdfとPopplerが必要。`PDF_QA_PYTHON`、`PDF_QA_POPPLER`を必要に応じて設定する。実ブラウザ200%試験にはPlaywright同梱Chromiumを用い、通常利用者のprofileを変更しない。既存のCSS zoom試験とは区別する。

スクリーンショット・帳票・測定結果は `.local/` に保存する。ローカルfakeの成功は実Cognito配信・MFA回復・本番運用の合格根拠にはしない。
