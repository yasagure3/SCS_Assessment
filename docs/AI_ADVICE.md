# 匿名文による AI 下書き

- 種別: 実装・検証ガイド

AIは未設定が製品の既定状態。事業者・モデル・送信条件はF04で選定する。本実装は外部サービスへ接続せず、PC内のキーを参照しない。未設定時は503と手動継続の案内を返す。fake adapterはビルド禁止の`tests/fixtures`構成だけで注入する。

送信欄は開くたび空で始まり、前後の空白を除いた2欄と公開マスターの3項目を全文表示する。確認は入力と診断revision・basisHashに結び付け、編集時に失効する。匿名欄は各2000 codepoints、5キー全体のcanonical JSONが8000 UTF-8 bytes以内。メール/URLの案内は補助であり、匿名化を自動認定しない。

サーバーはZodのstrict schemaで余分なbodyキーを拒否し、`{standardId,criterionId,officialRequirement,anonymousAnswer,anonymousGap}`だけを再構成する。SHA-256はキー名順のcanonical JSONから計算する。AI専用の契約は`src/shared/contracts/aiAdvice.ts`に分離した。出力もstrictなAdvice schema（合計12000 codepoints）で検査し、HTML・リンク・命令は文字列としてのみ表示する。

run予約と監査、共通operation_receiptsは同じD1 batchで保存する。生成のreceiptに保存するのはrunIdだけで、匿名入力は保存しない。同じキーは状態照会として既存runを返し、外部呼出しを再送しない。HTTP応答喪失でrunIdが未取得なら、保存した同じbodyとキーで照会できる。runIdが分かればGETで照会する。生成の失敗レスポンスには共通errorに`runId`を追加し、GETはfailed状態とerrorCodeを200で返す。staleの取得・新規採用は409。

呼出しは同じHTTP要求内で最大30秒。AbortSignalをadapterへ渡し、期限切れを確定してから中断を通知する。providerが中断時に失敗・成功を返す場合も、通知を無視して後から成功する場合も、runはAI_TIMEOUTのfailedとなり504を返す。開始から60秒以上のpending/runningも読み出し時にfailedへ遷移し、遅い成功を受け付けない。利用者ごと同時1件・直近1分5試行をDBの予約条件で制御し、429にRetry-After:60を付ける。生成中にbasisが変わっても、providerが終了または期限切れになるまでは同時実行枠を解放しない。

新しい試行は画面上の明示操作で新キーと再確認を要求する。生成だけでは診断revisionを変更しない。採用は下書きだけをCAS保存し、既存確定版を保持する。採用の通常成功・成功no-opは診断更新と共通のreceiptを保存する。再送時は現在の認可を確認してから正規化したrequestHashを照合し、同一body・mutationIdなら保存済み診断DTOを返す。後からbasisが変わっても現在の診断は書き換えず、異なるbodyで同じmutationIdを使えば409となる。未記録の採用には現在のrun・basis・revisionの検査を適用する。AI由来の助言は採用済み下書きまたは確定版がある場合に編集・確定できる。人の内容確認と確定が別途必要で、生成/採用だけでは顧客出力対象にならない。

検証は`test/worker/ai-advice.test.ts`、`src/front/components/AiDraftDialog.test.tsx`、`tests/e2e/advice-ai.spec.ts`。Workers試験は中断時の3動作と遅延成功、通常採用/no-opの再送、異body・新key・停止/割当解除/失効後の拒否を確認する。E2Eは匿名fixtureとfake providerで送信全文、通信断復旧、下書き採用、人の確定、未設定中の手入力保持を確認する。画面画像は`.local/e2e-ai-*.png`へ出力する。実事業者の品質・通信・契約は本番接続検証まで未検証。
