# SCS Assessment 実装計画

2026-09-18。登録先は [yasagure3/SCS_Assessment](https://github.com/yasagure3/SCS_Assessment)。**設計書をmainへ反映済み。親9件・子18件のIssueと親子関係を登録・検証済み。実装ブランチ `feat/star3-assessment` でF01を進行中。**

スケッチ確認と3件の局所PoCを終え、8機能の設計チェックはhigh 0。設計と本タスク群の独立レビューはhigh 0で完了した。設計の正本は[DESIGN.md](DESIGN.md)と[機能設計](features/)、確認記録は[REVIEW.md](REVIEW.md)。

## 実装順序

1. F01/F02: テンプレート、検証環境、保存・履歴・競合制御。
2. A01/C01/D01: MFA、顧客・案件、現状と編集。A02の管理画面を追加。
3. I01/E01/E02/V01/V02: Excel取込、証跡、具体的助言と匿名化AI経路。
4. T01/T02: 改善追跡と再診断。
5. R01/R02/R03: 固定レポート、PDF、作業用Excel。
6. F03: 全動線・UI・出力を匿名データで結合検証。
7. F04: 保存/運用条件のユーザー確定後、実環境接続・復元・性能を検証し本番公開を判断。

F04は初期needs-human、ほかの子はreadyと依存関係を付ける。readyでも未完了の依存があれば着手しない。F01はアプリコマンドを実測確定するタスクで、現時点の実行成功を意味しない。本番条件が未定でもF01〜F03はローカル/匿名データで進められる。

## タスク一覧

| ID | 作業 | 親 | 依存 |
|---|---|---|---|
| F01 | 指定テンプレートとローカル検証環境を整備する | 基盤 | なし |
| F02 | 診断データの保存・履歴・競合制御を実装する | 基盤 | F01 |
| A01 | 招待限定のログイン・必須MFAとAPI認可を実装する | UC-008 | F02 |
| C01 | 顧客・案件・診断範囲の管理を実装する | UC-001 | A01 |
| D01 | 現状ダッシュボードと評価基準の編集を実装する | UC-003 | C01 |
| I01 | Excelの検査・プレビュー・一括取込を実装する | UC-002 | D01 |
| E01 | 証跡の参照情報と基準ごとの確認を実装する | UC-004 | D01 |
| E02 | 非公開の証跡アップロードとダウンロードを実装する | UC-004 | E01 |
| V01 | 全81基準の定型助言と編集・確定を実装する | UC-005 | D01, E01 |
| V02 | 匿名化確認を経たAI下書きの生成経路を実装する | UC-005 | V01 |
| T01 | 改善課題の担当・期限・進捗と完了確認を実装する | UC-006 | D01, E01 |
| T02 | 前回を保持した再診断と差分比較を実装する | UC-006 | T01, V01 |
| R01 | レポートの事前確認と不変スナップショットを実装する | UC-007 | V01, T01, E02 |
| R02 | 日本語PDFを全81基準の固定レポートから生成する | UC-007 | R01 |
| R03 | PDFと同じ固定版から作業用Excelを生成する | UC-007 | R01, R02, I01 |
| A02 | 社内招待・役割・顧客割当の管理画面を実装する | UC-008 | A01, C01 |
| F03 | 全機能の業務動線とアクセシビリティを結合検証する | 基盤 | A02, I01, E02, V02, T02, R02, R03 |
| F04 | 本番構成を確定して認証・保管・AI・復元を検証する | 基盤 | F03 |

## GitHubへの登録方法

UC-001〜008の見出しをそのまま親タイトルにし、基盤親を1件追加する。各子は対応UCのsub-issueへ紐付ける。作成前に既存issueを全状態で照合して重複を避ける。下記のDRAFT参照は登録時に実issue番号へ解決し、`Depends on #番号`に置換する。番号が解決しない本文は送信しない。設計をcommit/pushしてから参照可能な状態で登録する。

## 子タスクの本文

以下は登録時の本文の正本。実IssueではDRAFT参照を番号へ解決済み。親は #1〜#9、子は一覧の順で #10〜#24、A02が #25、F03が #26、F04が #27。進捗は [GitHub Issues](https://github.com/yasagure3/SCS_Assessment/issues) で管理する。

### F01: 指定テンプレートとローカル検証環境を整備する

#### ゴール
対応 UC: 基盤

固定コミットのテンプレートをルートへ展開し、アプリ起動・テスト・CIを実行できるようにする。既存docs/PoCを保持する。

#### 設計
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: package.json/lock、srcのテンプレート骨格、wrangler設定、Vite/Workers/Playwright設定、.github/workflows、最小shell/router/ErrorBoundary/loading、非秘密env例、.gitignore、worktree手順。実装基盤の範囲だけを移植し、Stripe例と自己登録への導線は除外する。

#### DoD
- 新規checkoutで vp install --frozen-lockfile → vp check → vp build → vp test --run → vp exec vitest run -c vitest.workers.config.ts が成功。存在チェックでなくテンプレートのテストを実行する。
- E2E_PORTを別ポートに設定し vp exec playwright test tests/e2e/smoke.spec.ts が成功。別worktreeの起動済みポートでは失敗することを確認。
- DESIGN.md「開発・検証コマンド」を実測したVite+導入・local DB・起動・Playwright準備/実行・worktree手順で確定する。assets.directoryがdist/clientで、production bundleにlocal秘密やテスト用ログインが入らない。

#### 非スコープ
本番リソース作成、デプロイ、実顧客seed。

#### 依存
依存なし

### F02: 診断データの保存・履歴・競合制御を実装する

#### ゴール
対応 UC: 基盤

共通schemaと81基準seed、原子的な診断更新、監査、共通冪等台帳を使えるようにする。

#### 設計
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: src/server/db/schema.ts、migrations、公開standards/criteria seed、assessment domain/repository PortとD1 adapter、operation_receipts、audit_events、共有DTO基盤。関係するrouteは各機能が追加する。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/foundation.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 空DBにmigrationと公開seedを適用し、再適用で破損しない。固定81基準とsource hashを照合。
- 同revisionの並行更新は一方だけ成功。同keyの通常更新/no-opを並行実行して二重成功や異body受理がない。途中失敗は本体/履歴/receipt/監査が全rollback。
- 原値・固定版・snapshotのUPDATE/DELETE拒否、1MiB/1.5MiB上限、adviceBasisVersion、成功no-op再送、他顧客関連ID拒否をassert。

#### 非スコープ
各機能の画面、実remote D1での接続検証。

#### 依存
Depends on DRAFT:F01

### A01: 招待限定のログイン・必須MFAとAPI認可を実装する

#### ゴール
対応 UC: UC-008: 招待と多要素認証で利用する

社内ユーザーがMFAを完了して自分の顧客だけにアクセスでき、停止/失効をAPIで拒否できるようにする。

#### 設計
docs/design/features/access.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: auth domain/middleware/Principal Port、Cognito設定ON/TOTP/自己登録禁止、LoginPageとcognitoSession、GET /me、POST /session/revoke、bootstrap-adminと回復手順。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/authentication.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/authentication.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 署名・必須claims・期限・revoked_before、invited初回有効化、active/割当/管理者の許可と拒否を検証。クライアントmfaCompleteを信用しない。
- fakeの初回パスワード変更→MFA_SETUP→TOTP→GET /meと最小保護画面までを通し、停止後は既存tokenを拒否。顧客一覧UIはC01で接続する。tokenのlocalStorage保存なし。

#### 非スコープ
招待/割当管理画面（A02）、本番Cognitoへの接続（F04）。

#### 依存
Depends on DRAFT:F02

### C01: 顧客・案件・診断範囲の管理を実装する

#### ゴール
対応 UC: UC-001: 顧客と診断案件を管理する

許可顧客を管理し、案件と81未回答の診断を作成・表示できるようにする。

#### 設計
docs/design/features/cases.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: cases機能設計のdomain/usecase/repository/routes/shared契約、CustomersPage、CasePage、scopeフォーム。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/cases.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/cases.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 新規顧客＋作成者割当、案件＋81回答が同時保存される。二重作成再送・rollback・archive・別顧客拒否を検証。
- 範囲未記入の下書き保存、範囲変更による全基準の再確認、CAS競合時の入力保持を確認。

#### 非スコープ
既存顧客間の案件移動、物理削除。

#### 依存
Depends on DRAFT:A01

### D01: 現状ダッシュボードと評価基準の編集を実装する

#### ゴール
対応 UC: UC-003: 現状と個別評価を確認する

81基準の状態/分類を集計し、公式文と原回答を照合しながら編集できるようにする。

#### 設計
docs/design/features/assessments.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: assessments機能設計の集計/編集domain・GET標準/診断・PATCH回答、DashboardPage、CriteriaPage、CriterionPage、shared契約。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/assessments.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/assessments.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 81分母・4状態・分類合計・未確認の○を検証。△に点数を付けず、未回答を他状態に変換しない。
- 原O〜R不変、手動初回保存/成功no-op、回答を元に戻しても古い助言が有効化しないことと409時の差分表示を確認。

#### 非スコープ
公式合否/取得確率、N/A認定。

#### 依存
Depends on DRAFT:C01

### I01: Excelの検査・プレビュー・一括取込を実装する

#### ゴール
対応 UC: UC-002: Excelを検査して取り込む

対応xlsxからO〜Rを正しく読み、確認した81回答を原値ごと一括登録できるようにする。

#### 設計
docs/design/features/imports.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: imports機能設計全体、ExcelJS遅延Worker、ZIP実展開上限、shared契約、preview/commit API、ImportPage。poc/excelから必要な検証を移植。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/imports.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/imports.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 匿名xlsxの24/24/28/5、原O〜Rと出典行、欠落の明示承認、未知/重複/数式/版違い拒否をassert。
- サーバーへ改ざんJSONを直送しても拒否。旧revision/編集済診断/二重確定で部分保存なし。
- ZIP申告サイズ偽装、実展開byte上限、Worker10秒停止/取消をブラウザで検証し、当該環境の時間/メモリ結果を記録。

#### 非スコープ
再取込merge、xls/xlsm、元Excel書式を保持した書戻し。

#### 依存
Depends on DRAFT:D01

### E01: 証跡の参照情報と基準ごとの確認を実装する

#### ゴール
対応 UC: UC-004: 証跡を登録して確認する

文書名/URL/箇所を基準に結び、確認者・時刻・確認結果を保持できるようにする。

#### 設計
docs/design/features/evidence.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: Evidence/Review domain、証跡CRUD/review API、shared契約、EvidencePage/EvidenceForm。ファイルなしの縦動線を完成。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/evidence.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/evidence-metadata.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- URL自動fetchなし、別案件ID拒否、基準別確認、編集/関連解除時のレビュー・助言再確認を確認。自己評価は変更しない。
- 関係Taskがあるfixtureで最終証跡/criterion関連解除後の完了確認解除とdoing遷移を検証。todoは維持。

#### 非スコープ
binary uploadとR2取得（E02）。

#### 依存
Depends on DRAFT:D01

### E02: 非公開の証跡アップロードとダウンロードを実装する

#### ゴール
対応 UC: UC-004: 証跡を登録して確認する

必要な証跡ファイルを非公開で保存し、認可した利用者だけが取得できるようにする。

#### 設計
docs/design/features/evidence.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: files schema利用、upload usecase、R2/File Portとadapter、files API、EvidenceFormの添付UI。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/files.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/evidence-files.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 許可形式/10MiB/実署名/ZIP/暗号化・macro拒否、SHA一致、中断・重複key・未ready参照拒否を検証。
- 別顧客/別案件のID直指定と停止ユーザーdownloadを拒否し、attachment/nosniff/no-storeを確認。証跡本文をAI adapterへ渡す経路なし。

#### 非スコープ
本番R2作成、証跡本文のAI送信、ブラウザ内Office/PDF実行。

#### 依存
Depends on DRAFT:E01

### V01: 全81基準の定型助言と編集・確定を実装する

#### ゴール
対応 UC: UC-005: 助言案を作成して確定する

各基準に具体的な実施手順/証跡例/完了確認を表示し、担当者が編集・確定できるようにする。

#### 設計
docs/design/features/advice.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: 81基準別advice_templates seed（26共通手順＋基準固有条件）、Advice domain/routes/DTO、AdviceEditor。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/advice.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/advice-manual.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 全81基準の助言に公式出典と不足点/手順/証跡例/完了確認を持ち、公式必須条件と当社提案を区別。内容を基準本文と照合し、その結果をdocsへ記録。
- 下書きと確定版の併存、basisVersion変更/元の値へ戻した場合の再確認、scope/evidence変更、task進捗だけなら確定版維持をassert。

#### 非スコープ
AI provider接続、未確定案の自動送信。

#### 依存
Depends on DRAFT:D01
Depends on DRAFT:E01

### V02: 匿名化確認を経たAI下書きの生成経路を実装する

#### ゴール
対応 UC: UC-005: 助言案を作成して確定する

送信全文を確認した匿名文だけでAI下書きを作り、人の採用/確定へ渡せるようにする。

#### 設計
docs/design/features/advice.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: AiPort、ai_runs repository、allowlist DTO、run生成/照会/採用 API、AiDraftDialog、未設定/fake adapter。provider実装は選定後F04。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/ai-advice.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/advice-ai.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- fake provider受信payloadを5キーで完全一致assert。原O〜R/証跡/顧客名/内部URL/余分キーを自動混入しない。入力変更後の確認失効、未設定・timeout・同keyの二重送信防止を検証。
- 参照basisが変わったrunや別顧客runを採用できず、生成/採用だけで顧客出力に入らない。失敗中も手入力を保持。

#### 非スコープ
実AIへの送信、事業者/モデルの無断選定。

#### 依存
Depends on DRAFT:V01

### T01: 改善課題の担当・期限・進捗と完了確認を実装する

#### ゴール
対応 UC: UC-006: 改善課題と再診断を管理する

対策作業の状況と完了確認を管理し、自己評価と分けて追跡できるようにする。

#### 設計
docs/design/features/improvement.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: Task domain、追加/編集/レビューAPI、shared契約、TasksPage。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/tasks.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/tasks.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- JST期日境界、空担当/不正日付拒否、非空結果＋証跡の完了報告、confirmed/rejected遷移を検証。
- 証跡/完了条件/結果変更時に確認解除し、taskだけの完了で○にならない。担当名入力でアカウント/メールを作らない。

#### 非スコープ
自動通知、顧客用アカウント。

#### 依存
Depends on DRAFT:D01
Depends on DRAFT:E01

### T02: 前回を保持した再診断と差分比較を実装する

#### ゴール
対応 UC: UC-006: 改善課題と再診断を管理する

新しい診断時点を作成し、前回revisionと現在の状態・課題の差を確認できるようにする。

#### 設計
docs/design/features/improvement.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: reassessment domain/usecase/API、copy DTO、ComparisonPage。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/reassessment.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/reassessment.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- コピー元更新409、旧診断の不変、原回答null/確認解除/助言コピー順/Task新IDとsource参照/証跡ID再割当を確認。
- 直接前回の課題対応と非直接前回の対応なし表示、scope/版違い注記、別case拒否、△に改善の序列を付けない差分をassert。

#### 非スコープ
★4/異版への自動移行、再取込merge。

#### 依存
Depends on DRAFT:T01
Depends on DRAFT:V01

### R01: レポートの事前確認と不変スナップショットを実装する

#### ゴール
対応 UC: UC-007: レポートを確定して出力する

未回答や未確認を明記し、顧客へ報告する内容を固定版として保存・再取得できるようにする。

#### 設計
docs/design/features/reports.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: ReportSnapshot domain、preview/finalize/list/get API、ReportEvidence固定、ReportsPage、shared契約。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/reports.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/report-snapshot.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 範囲/診断日必須、未回答あり出力可、全81/分類一致、current確定版だけを選びdraftPending/staleを明示。
- 顧客/案件名を含むpreview競合、全batch原子性、重複確定、snapshotのUPDATE/DELETE拒否、後の編集/名前変更が旧snapshotに不反映をassert。

#### 非スコープ
PDF/Excel bytes生成（R02/R03）。

#### 依存
Depends on DRAFT:V01
Depends on DRAFT:T01
Depends on DRAFT:E02

### R02: 日本語PDFを全81基準の固定レポートから生成する

#### ゴール
対応 UC: UC-007: レポートを確定して出力する

サマリーと全項目の課題・対策を、長文を欠落させずPDFへ保存できるようにする。

#### 設計
docs/design/features/reports.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: report.worker.ts/reportPdf.ts、same-origin Noto/OFL/NOTICE、PDF進捗/取消/保存UI。poc/reportの日本語検証を移植。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/report-pdf.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/report-pdf.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 固定snapshotの全81 ID/公式文/確定助言全文、6443字以上の長文、未確定案非掲載を抽出検証。表紙・長文改ページ・中間・最終を画像化して目視し記録。
- 同一origin font、subset:false/locl・liga:false、未収録字形エラー、120秒timeout/取消/同snapshot再生成をブラウザで確認。時間・メモリ・PDFサイズを記録。

#### 非スコープ
PDF/A・PDF/UA保証、スナップショット以外の最新データ取得。

#### 依存
Depends on DRAFT:R01

### R03: PDFと同じ固定版から作業用Excelを生成する

#### ゴール
対応 UC: UC-007: レポートを確定して出力する

判定・根拠・対策・証跡・課題を基準IDで追跡できる作業ブックとして出力する。

#### 設計
docs/design/features/reports.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: reportExcel.ts/report.worker.tsのExcel分岐、5シート、保存UI。共有Worker契約の変更はR02と競合しないよう調整。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/report-excel.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/report-excel.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 5シートの列順/全81ID/原O〜R/確定助言/証跡名/課題を再読込し、snapshot集計と完全一致。PDFにも同じreportIdを渡す。
- 数式風文字列 = + - @ タブ、改行・空欄をstring型で保存し、式/外部リンク/アクセスtokenなし。未確定案は除外、再取込対象外を明記。

#### 非スコープ
公式Excelの書式再現、作業ブックの再取込。

#### 依存
Depends on DRAFT:R01
Depends on DRAFT:R02
Depends on DRAFT:I01

### A02: 社内招待・役割・顧客割当の管理画面を実装する

#### ゴール
対応 UC: UC-008: 招待と多要素認証で利用する

管理者が招待・再発行・停止・割当を管理し、変更を既存セッションにも反映できるようにする。

#### 設計
docs/design/features/access.md 参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: Cognito管理Port/adapter、invitations/users/member API、SettingsPage、招待7日期限/回復手順。 当該画面のrouter登録・ナビ接続・入力/読込/失敗表示も本タスクが担当し、先行E2Eを単独で実行可能にする。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/access-management.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/access-management.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- admin限定、招待重複/期限切れ/部分失敗・明示retry、同sub再発行、最後のadmin保護、customer revision CASを検証。
- 停止/割当解除後は既存tokenのデータ要求を拒否。顧客担当者名だけでメールしない。fake送信先と回数をassert。

#### 非スコープ
実社員への招待送信、本番回復試験（F04）。

#### 依存
Depends on DRAFT:A01
Depends on DRAFT:C01

### F03: 全機能の業務動線とアクセシビリティを結合検証する

#### ゴール
対応 UC: 基盤

匿名の診断を取込から再診断・帳票出力まで通し、初回リリースの動作を確認できるようにする。

#### 設計
docs/design/USECASES.md全8ユースケースと各featuresのテスト方針も参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。

作業範囲: 先行タスクで接続済みのshell/router/各画面の全体動線検証・不具合修正、tests/e2e/journey.spec.ts、keyboard/focus/拡大確認、CI統合、製品README。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- `vp exec vitest run -c vitest.workers.config.ts test/worker/integration.test.ts` が成功。対象の振る舞いをassertし、テスト未検出を成功にしない。
- `vp exec playwright test tests/e2e/journey.spec.ts` が成功。ローカルの匿名fixture/fake連携を使用する。
- `vp test --run`、`vp check`、`vp build` が成功。Frontの入力/失敗動作は当該機能のテストで検証する。
- 招待/MFA→顧客→取込→判定/証跡→確定助言→課題→再診断→PDF/Excelを匿名fixtureで完走。snapshot両出力一致と旧版保持をassert。
- vp check、vp build、全Front/Workersテスト、vp exec playwright test が成功。操作不能な空状態/エラー/409、keyboard/200%拡大、外部送信未設定時を確認し結果を記録。

#### 非スコープ
実顧客データの投入、本番公開。

#### 依存
Depends on DRAFT:A02
Depends on DRAFT:I01
Depends on DRAFT:E02
Depends on DRAFT:V02
Depends on DRAFT:T02
Depends on DRAFT:R02
Depends on DRAFT:R03

### F04: 本番構成を確定して認証・保管・AI・復元を検証する

#### ゴール
対応 UC: 基盤

ユーザーが保存/運用条件を確定した後、実環境の認証・保管・AI接続・復元・性能を検証して出荷判断できるようにする。

#### 設計
docs/design/features/access.md、evidence.md、advice.md、imports.md、reports.md（すべてdocs/design/features/配下）、docs/design/FEASIBILITY.md参照。
docs/design/DESIGN.md「アーキテクチャと技術選定」「データスキーマ」「横断規約」「開発・検証コマンド」「既知の制約」参照。同書「インフラ」「未解決の論点」も参照。

作業範囲: 選定済みprovider adapter、環境別IaC/秘密/スキャン・保持/バックアップ設定、接続検証suiteと運用runbook、NOTICE、検証記録。

#### DoD
アプリ検証コマンドはF01で実測確定したDESIGN.mdを前提にする。まだ存在しない試験は本タスクで追加し、未実装でも通る確認に置き換えない。

- 前提: 保存国/クラウド、保持・削除/バックアップ、AI事業者/モデル/契約、人数/顧客数/復旧目標と試験上限をユーザーが確定。未確定のまま外部リソース作成/実送信しない。
- DESIGN.md「インフラ」のcloud-integration項目を、選定先の匿名専用検証環境で実行。実Cognito招待/TOTP/回復/失効、remote D1同時CAS/rollback/復元、非公開R2/他顧客拒否、AI実payloadの5キー一致、上限端末/規模のExcel/PDFを確認。
- 環境と実測コマンド・結果・合格基準・残課題をdocs/operations/RELEASE_CHECK.mdに保存し、未実施/基準未達ならcloseしない。機械試験は vp exec playwright test tests/e2e/live-auth.spec.ts と vp exec vitest run -c vitest.live.config.ts を本タスクで追加・実測する。
- デプロイ内容と検証結果を提示して本番公開の判断を得る。承認前に公開操作を行わない。

#### 非スコープ
条件を推測した本番公開、未承認の実顧客データ/本文の外部送信。

#### 依存
Depends on DRAFT:F03
