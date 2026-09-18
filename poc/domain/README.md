# 権限・更新・出力・AI境界PoC

実行: `node --test poc/domain/boundaries.test.mjs` と `python poc/domain/check_sqlite.py`。
標準ライブラリのみ。合成fixture以外の顧客データ・外部APIを使わない。

27件のNodeテストはドメイン関数の検証。回答・範囲・証跡確認を元の値へ戻しても古い助言の確認が復活しない3件を含む。SQLスクリプトは実SQLiteでCAS更新・原版維持・失敗時の原子性を確認する。CognitoのMFA完了の証明やD1接続自体を検証したものではない。APIからmfaCompleteを受け取る設計にしてはいけない。本番では必須MFAのCognitoが発行するトークンを検証し、利用者の有効性・顧客割当をサーバーで読む。

AIの識別子検出は補助であり匿名性を保証しない。人が送信全文を確認することが前提。APIは公開マスターから要件を組み立て、匿名化入力以外の案件データをAIアダプターへ渡さない。
