# 改善課題: 結果不明の応答からの再送

- 種別: 追加修正・検証記録
- 対象: Issue #20、2026-09-20 に承認された追加修正サイクル
- 既存 WIP: `196934fae42974210f46cd4dee44185fdca79377`
- 前回の記録: [残存指摘と追加修正案](issue-20-escalation.md)。前回のレビュー・検証結果はこの記録で置き換えない。

保存が成功した後に応答だけが中継サーバーの HTML 502 に置き換わり、GET で最新の診断を取得すると、同一要求の再送が無効になる問題を修正した。`TaskForm` は送信時に検証した要求との一致を保持し、`fetcher.ts` の `isUnknownWriteOutcome` で応答の結果が確定しているかを判断する。`useWrite` の操作 ID 管理は変更しない。

| 応答 | 同一の送信済み要求についての扱い |
|---|---|
| TypeError、JSON 読み取り失敗 | 結果不明。同一 body・同一 mutationId による利用者の再送を許可する |
| 5xx（構造化された INTERNAL_ERROR を含む） | 保存後に発生する可能性があるため結果不明として扱う |
| API エラーの code・message・requestId が欠落、空白、型不正 | 結果不明として扱う。requestId だけでは業務拒否の根拠にしない |
| 401・403・404・409、又は明示的な CONFLICT・IDEMPOTENCY_CONFLICT | 結果不明としての検査省略を適用しない |
| 完全な API エラー形式を持つその他の 4xx | 業務拒否として通常の入力・状態検査を適用する |

再送時に省くのは、検証済みの同じ要求を最新 document へ新しい操作として再適用する検査だけである。入力を編集すると通常検証に戻る。入力を元に戻し、送信内容が一致すれば保持した操作 ID で再送できる。閲覧専用、送信中、入力 schema、課題の存在、現在の document の 1MiB 制約は維持する。再送のたびに API が認可を確認し、保存結果の再生を共通台帳で判断する。自動再送は行わない。

## 実行結果

製品修正前に前回 reviewer の再現コードを変更せず実行し、HTML 502 の 9 条件中 6 件の失敗を再現した。同時実行した既存の TypeError 回帰 25 件は成功。正式回帰を両応答へ拡張した段階では 50 件中 13 件が失敗し、その後に製品を修正した。

追加・100 件目追加・1MiB ちょうどの追加・完了報告・完了済み課題の結果変更・上限付近の編集・完了確認・差戻し・上限付近の完了確認を、TypeError と HTML 502 の両方で検証した。入力変更と取消、閲覧専用、認可拒否、確定した業務拒否の対照を含む。`fetcher.test.ts` は不完全な JSON と正しい拒否応答、保護する HTTP status と明示的な競合 code を検証する。

| 実コマンド（`scripts/vp.ps1` 経由） | 結果 |
|---|---|
| `vp test --run src/front/lib/fetcher.test.ts src/test/taskResponseRecovery.test.tsx src/test/taskBoundary.test.tsx src/front/components/TaskForm.test.tsx src/front/pages/TasksPage.test.tsx src/front/pages/CachedAccess.test.tsx src/test/review20-gateway.test.tsx` | 7 files / 110 passed。うち変更していない一時 reviewer probe が 9 件、正式 suite が 101 件 |
| `vp exec vitest run -c vitest.workers.config.ts test/worker/tasks.test.ts test/worker/evidence.test.ts` | 2 files / 30 passed |
| `vp check` | 成功。型・lint・整形のエラーなし |
| `vp build` | 成功。既存の 500kB 超チャンク警告あり |

一時 probe は実行後に保存元との SHA-256 一致を確認して実行先から除去した。正本は親 workspace の `.local/review-20-r2-gateway.test.tsx.txt`。正式回帰の正本は `src/test/taskResponseRecovery.test.tsx`。新サイクルのログは親 workspace の `.local/issue-20-resume-*.log` に分離した。Workers は既存の sandbox による entrypoint 静的解析警告を出したが、30 件の実試験はすべて実行された。

親タスクによる追加修正後の全体検証も完了した。Front197件、Workers145件、bootstrap3件、Edge21件、check/build、製品へのfixture混入防止、ローカルmigration、使用中ポート拒否がすべて成功。追加・編集の通常幅/640px、確認・完了の6枚を親と独立レビュワーが画像として確認した。

新サイクルの独立レビューr1は指摘0件。Front146件（正式101件、旧再現9件、新しい応答対照36件）とWorkers30件を独立実行し、API形式が不完全な422、構造化500、不正JSONの200、確定した422拒否との違いを全9操作で確認した。ログは親workspaceの `.local/review-20-resume-r1-*.log`、構造化結果は `.local/review-20-resume-r1.json`。最新版mainとの統合検証は次段階として別に記録する。実顧客データ・外部 AI・本番リソースは使用していない。

## main 統合後の最終検証

main `b189a7c4ec7b19128fa6e8423014408d0a6e750d` の定型助言と非公開ファイル添付を統合した。CSS末尾の追加競合は両機能の定義を保持して解消し、APIのfile routeはJSON body制限より前に残した。

`scripts/verify-local.ps1 -Port 5234 -Channel msedge` はexit0。Front208件、Workers172件、bootstrap3件、Edge23件、check/build、fixture混入防止、local migration、portguardがすべて成功。新しく生成した課題追加640px・課題編集通常幅・確定助言の画像も親が確認した。生ログは親workspaceの `.local/issue-20-integrated-all.log`。本番接続は行っていない。
