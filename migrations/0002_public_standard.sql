-- Fixed public standard; regenerating must not change an already released migration.
INSERT INTO standards SELECT 'scs-20260327-star3','2026-03-27','3','https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/20260327001-c.xlsx','d4c27aa4bfed5521a98ff9ce8c042743e4204e4b8310ceb3df0c54eabfdc8dd1','5992d0dc0ee096a81d8895aa9703cd22f4148dda7e3f7f880ba2633dc2cca7c0','81',NULL WHERE NOT EXISTS(SELECT 1 FROM standards WHERE id='scs-20260327-star3');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-2-1-1','1-2-1','ガバナンスの整備','1','セキュリティ推進活動を担当する部署、役員及び従業員を決定し、責任及び権限を割り当てること。','・セキュリティを統括する役員(例えば、CISOを設置する会社の場合は、当該CISO)及びセキュリティ担当部署の役割・責任を定めること。','6' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-2-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-2-1-2','1-2-1','ガバナンスの整備','2','セキュリティ推進活動を担当する部署、役員及び従業員を決定し、責任及び権限を割り当てること。','・平時のセキュリティ推進活動に必要な役員(例えば、CISOを設置する会社の場合は、当該CISO)及びセキュリティ担当部署の連絡先リストを定めること。','7' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-2-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-2-1-3','1-2-1','ガバナンスの整備','3','セキュリティ推進活動を担当する部署、役員及び従業員を決定し、責任及び権限を割り当てること。','・年1回以上の頻度でNo.1-2-1-1及びNo.1-2-1-2にて定めた平時の体制について点検すること。','8' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-2-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-2-3-1','1-2-3','ガバナンスの整備','4','守秘義務のルールを策定し、遵守させること。','・役員、従業員、派遣社員及び受入出向者を対象に、自社の守秘義務のルールを定めること。','12' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-2-3-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-2-3-2','1-2-3','ガバナンスの整備','5','守秘義務のルールを策定し、遵守させること。','・入社時又は社外要員の受入れ時に守秘義務のルールを説明すること。','13' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-2-3-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-3-1-1','1-3-1','ガバナンスの整備','6','自社のセキュリティ対応方針を策定し、周知すること。　','・自社のセキュリティ対応方針を定めること。','16' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-3-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-3-1-2','1-3-1','ガバナンスの整備','7','自社のセキュリティ対応方針を策定し、周知すること。　','・定常的に役員、従業員、派遣社員及び受入出向者が最新のセキュリティ対応方針を参照できるようにすること。','17' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-3-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','1-3-1-3','1-3-1','ガバナンスの整備','8','自社のセキュリティ対応方針を策定し、周知すること。　','・セキュリティ対応方針の改正時に、当該改正内容を役員、従業員、派遣社員及び受入出向者に周知すること。','18' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='1-3-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','2-1-1-1','2-1-1','取引先管理','9','取引先と自社とのビジネス又はシステム上の関係を把握すること。','・自社以外の組織(顧客・子会社・関係会社・クラウドサービス提供者を含む取引先)が管理・提供し、自社の資産が接続しているシステムを把握するための仕組みを整備すること。','22' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='2-1-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','2-1-1-2','2-1-1','取引先管理','10','取引先と自社とのビジネス又はシステム上の関係を把握すること。','・年1回以上の頻度でNo.2-1-1-1において把握した情報の内容を点検すること。','23' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='2-1-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','2-1-2-1','2-1-2','取引先管理','11','自社の機密情報の取扱い方法を、共有先との間で明確にすること。','・自社の機密情報を共有する子会社又は取引先との間で、業務開始前に機密情報の取扱いについて、以下の事項を取り決めること。
- 機密情報の定義
- 機密情報の利用制限、保管方法、複製可否及び第三者への提供可否
- 機密情報の返還又は廃棄','25' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='2-1-2-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','2-1-4-1','2-1-4','取引先管理','12','セキュリティインシデント発生時の他社との役割及び責任を明確にすること。','・自社の機密情報を共有する子会社又は取引先との間で、セキュリティインシデント発生時の自社と子会社又は取引先の役割及び責任を定めること。','27' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='2-1-4-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-1-1','3-1-1','リスクの特定','13','情報機器、OS及びソフトウェアに関する情報を把握すること。　','・パソコン及びシンクライアントの製造元、OS及び台数を把握するための仕組みを整備すること。','29' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-1-2','3-1-1','リスクの特定','14','情報機器、OS及びソフトウェアに関する情報を把握すること。　','・サーバ、仮想サーバ及びハイパーバイザの製造元、OS及び台数を把握するための仕組みを整備すること。','30' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-1-3','3-1-1','リスクの特定','15','情報機器、OS及びソフトウェアに関する情報を把握すること。　','・情報機器、OS及びソフトウェアについて、導入、設置、ネットワーク接続及びセキュリティパッチ適用のルールを含む管理ルールを定めること。','31' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-1-4','3-1-1','リスクの特定','16','情報機器、OS及びソフトウェアに関する情報を把握すること。　','・年1回以上の頻度でNo.3-1-1-3で定めた管理ルールの遵守状況について点検すること。','32' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-1-4');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-2-1','3-1-2','リスクの特定','17','ネットワークに関する情報を把握するための仕組みを整備すること。','・ネットワークを把握するための仕組みを整備すること。その際、把握すべき情報の中に各ネットワークの所在地及び用途に関する情報を含めること。','36' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-2-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-2-2','3-1-2','リスクの特定','18','ネットワークに関する情報を把握するための仕組みを整備すること。','・ネットワーク機器を把握するための仕組みを整備すること。その際、把握すべき情報の中に各機器の製造元、モデル及び保守事業者に関する情報を含めること。','37' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-2-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-3-1','3-1-3','リスクの特定','19','自社の機密情報を扱う外部情報サービスを管理すること。','外部情報サービスを利用する際のセキュリティ要件を定めたうえで、外部情報サービスの利用時に当該要件を満たしているかサービス内容を確認すること。','40' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-3-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-3-2','3-1-3','リスクの特定','20','自社の機密情報を扱う外部情報サービスを管理すること。','・外部情報サービスの提供事業者と機密情報の取扱いについて合意を取り交わすこと。','41' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-3-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-4-1','3-1-4','リスクの特定','21','機密区分に応じた情報の管理ルールを定め、それに基づく管理を行うこと。','・自社の保有する情報を対象に、以下の内容を含む管理ルールを定めること。
- 機密の特定
- 機密区分のレベル判定及び表示
- 区分に応じた取扱方法
- 取扱エリアの区分及び制限','42' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-4-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-4-2','3-1-4','リスクの特定','22','機密区分に応じた情報の管理ルールを定め、それに基づく管理を行うこと。','・年1回以上の頻度でNo.3-1-4-1で定めた管理ルールの内容について点検すること。','43' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-4-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','3-1-4-3','3-1-4','リスクの特定','23','機密区分に応じた情報の管理ルールを定め、それに基づく管理を行うこと。','・重要な機密情報並びに当該情報ごとの管理者名、部署名、保管場所、保管期限、開示先及び管理者の連絡先を把握するための仕組みを整備すること。','44' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='3-1-4-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-1-1','4-1-1','攻撃等の防御','24','ユーザIDの発行・変更・削除の手続を定めること。','・自社の役員、従業員、派遣社員及び受入出向者に対するユーザIDの付与・変更・削除は申請・承認制にすること。','58' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-1-2','4-1-1','攻撃等の防御','25','ユーザIDの発行・変更・削除の手続を定めること。','・ユーザIDの共有について、以下のいずれかを適用すること。
- ユーザIDを共有しない。
- やむを得ず共有IDが必要な場合(例えば、システムの仕様により、使用人数分のユーザIDを発行することができない場合)は、共有IDを利用したユーザを特定できるようにする。','59' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-1-3','4-1-1','攻撃等の防御','26','ユーザIDの発行・変更・削除の手続を定めること。','・ユーザIDが不要になった場合(例えば、ユーザが組織を退職した場合又はユーザIDが一定期間使用されなかった場合)、速やかにユーザIDを削除又は無効化すること。','60' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-1-4','4-1-1','攻撃等の防御','27','ユーザIDの発行・変更・削除の手続を定めること。','ユーザIDに付与したアクセス権が不要になった場合(例えば、ユーザの業務上の役割が変わった場合)は、当該権限を速やかに削除又は無効化すること。','61' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-1-4');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-1','4-1-2','攻撃等の防御','28','管理者IDの発行・変更・削除の手続を定めること。','・すべてのサーバ及びネットワーク機器について、システム管理者及び責任者を定めること。','62' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-2','4-1-2','攻撃等の防御','29','管理者IDの発行・変更・削除の手続を定めること。','・管理者権限を付与する役員、従業員、派遣社員及び受入出向者を限定したうえで、管理者IDについて以下のいずれかを適用すること。
- 管理者IDを共有しない。
- やむを得ず管理者IDの共有が必要な場合(例えば、システムの仕様により、使用人数分のIDを発行することができない場合)は、共有の管理者IDを利用したユーザを特定できるようにすること。','63' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-3','4-1-2','攻撃等の防御','30','管理者IDの発行・変更・削除の手続を定めること。','・各管理者IDに対して当該IDの用途に応じた必要最低限の権限のみを付与すること。','64' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-4','4-1-2','攻撃等の防御','31','管理者IDの発行・変更・削除の手続を定めること。','・開発環境を利用する役員、従業員、派遣社員及び受入出向者が本番環境において、開発環境における管理者権限で操作できないようにすること。','65' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-4');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-5','4-1-2','攻撃等の防御','32','管理者IDの発行・変更・削除の手続を定めること。','・組織内でどの役員、従業員、派遣社員及び受入出向者が管理者IDを持っているかを把握するための仕組みを整備すること。','66' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-5');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-6','4-1-2','攻撃等の防御','33','管理者IDの発行・変更・削除の手続を定めること。','・管理者IDが不要になった場合(例えば、管理者が組織を退職した場合及び管理者IDが一定期間使用されなかった場合)、速やかに管理者IDを削除又は無効化すること。','67' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-6');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-7','4-1-2','攻撃等の防御','34','管理者IDの発行・変更・削除の手続を定めること。','・管理者IDの付与・変更・削除は申請・承認制にすること。','68' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-7');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-2-8','4-1-2','攻撃等の防御','35','管理者IDの発行・変更・削除の手続を定めること。','・管理者IDの付与・変更・削除並びにサーバ及びネットワーク機器の設定内容の変更を行う権限を業務上必要な役員、従業員、派遣社員及び受入出向者に限定すること。','69' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-2-8');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-3-1','4-1-3','攻撃等の防御','36','システム及び情報の重要度に応じて認証の強度及び実装方法を決定すること。','・すべてのユーザID及び管理者IDについて、システム及び情報機器へのアクセスを許可する前に、ユーザIDごとに設定されている認証情報(パスワード等)でユーザを認証すること。','70' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-3-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-3-2','4-1-3','攻撃等の防御','37','システム及び情報の重要度に応じて認証の強度及び実装方法を決定すること。','・重要な機密情報を取り扱うクラウドサービスにおいて、ユーザ及び管理者がサービスにアクセスする場合は、常にNo.4-1-3-3で示す認証要素を利用した多要素認証を使用すること。','71' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-3-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-3-3','4-1-3','攻撃等の防御','38','システム及び情報の重要度に応じて認証の強度及び実装方法を決定すること。','・多要素認証の使用に当たっては、以下のいずれかの要素から2種類以上を選択し、利用すること。
- 知識情報(例：ID・パスワード)
- 所有情報(例：ワンタイムパスワード※又は証明書)
- 生体情報(例：指紋、顔、虹彩又は静脈)
- その他の情報(例：IPアドレス)

※利用者のメールアドレス、電話番号等に対してワンタイムパスワードを送信して利用者に入力させる方法及びスマートフォンへの認証要求を利用した認証方式を含む。','72' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-3-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-3-4','4-1-3','攻撃等の防御','39','システム及び情報の重要度に応じて認証の強度及び実装方法を決定すること。','・多要素認証の知識情報として用いるパスワードは、8文字以上とすること。','73' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-3-4');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-4-1','4-1-4','攻撃等の防御','40','パソコン及びスマートデバイスにはロック制御を行うこと。','・パソコンへのログオン及びスマートデバイスのロック解除にあたって、以下のいずれかを適用すること。
- 試行回数を調整し、試行が失敗するたびに試行間隔が長くなるようにする。
- 試行が少なくとも10回以上失敗すると端末をロックする。
- 上記で示す要件のいずれも設定することができない場合、No.4-1-5で求められるよりも強度の高いパスワードを用いる等の代替策を用いること。','75' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-4-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-4-2','4-1-4','攻撃等の防御','41','パソコン及びスマートデバイスにはロック制御を行うこと。','・パソコンへのログオン及びスマートデバイスのロック解除を行う場合、最低でも6文字以上のパスワード又はPINを利用すること。','76' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-4-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-5-1','4-1-5','攻撃等の防御','42','パスワード設定に関するルールを定め、周知すること。','・パソコン、サーバ、スマートデバイス及びクラウドサービスの利用者又は管理者は、それらにおけるデフォルトパスワードを変更するよう社内ルールを定めること。','77' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-5-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-5-2','4-1-5','攻撃等の防御','43','パスワード設定に関するルールを定め、周知すること。','・ユーザ認証にパスワードを利用する場合、推測されやすい単語の設定を禁止するよう社内ルールを定めること。','78' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-5-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-5-3','4-1-5','攻撃等の防御','44','パスワード設定に関するルールを定め、周知すること。','・ユーザ認証にパスワードを利用する場合、以下のいずれかの保護対策を講じるよう社内ルールを定めること。
- No.4-1-3-3で示す認証要素を利用した多要素認証を使用するか、又は試行が少なくとも10回失敗した場合にアカウントロックするように制限したうえで、パスワードの長さを8文字以上とする。
- 上記のとおり多要素認証又は試行回数の制限を実施できない場合、パスワードの長さは、英大文字小文字、数字を含めた10文字以上とする。','79' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-5-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-5-4','4-1-5','攻撃等の防御','45','パスワード設定に関するルールを定め、周知すること。','・ユーザ認証にパスワードを利用する場合、情報機器及びサービス間でのパスワードを使い回さないよう社内ルールを定めること。','80' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-5-4');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-5-5','4-1-5','攻撃等の防御','46','パスワード設定に関するルールを定め、周知すること。','No.4-1-5-1からNo.4-1-5-4までで定めたパスワード設定に関するルールについて、役員、従業員、派遣社員及び受入出向者を対象に周知すること。','81' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-5-5');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-6-1','4-1-6','攻撃等の防御','47','パスワードの管理に関するルールを定め、周知すること。','・紙媒体への記載及び施錠保管、パスワード管理アプリの利用等により、パスワードを安全に保管するよう社内ルールを定めること。','82' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-6-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-6-2','4-1-6','攻撃等の防御','48','パスワードの管理に関するルールを定め、周知すること。','・パスワードの漏洩が判明した場合、又はその疑いがある場合に速やかにパスワードを変更するための手順を定めること。','83' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-6-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-6-3','4-1-6','攻撃等の防御','49','パスワードの管理に関するルールを定め、周知すること。','・No.4-1-6-1及びNo.4-1-6-2で定めたパスワードの管理に関するルールについて、役員、従業員、派遣社員及び受入出向者を対象に周知すること。','84' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-6-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-1-7-1','4-1-7','攻撃等の防御','50','アクセス権の管理ルールを定めること。','・業務で利用するシステム及びパソコンへのログオン時のユーザのアクセス権並びに機密上の配慮が必要な場所及び部屋への入室について、以下の内容の管理ルールを定めること。
- アクセス権の発行・変更・削除は申請・承認制であること。
- 与える入室許可・アクセス権の範囲は必要な範囲に限定すること。
- 入室権限及びアクセス権の棚卸について定めていること。
- 与えた入室許可・アクセス権の申請書又は台帳を管理していること。','85' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-1-7-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-2-2-1','4-2-2','攻撃等の防御','51','セキュリティインシデント発生時の対応に関する教育・訓練を行うこと。','・役員、従業員、派遣社員及び受入出向者を対象に、新規受入れ時、かつ、年1回以上の頻度で、セキュリティインシデント発生時の対応について、教育資料の配布・掲示に加え、e ラーニング又は集合教育による教育・訓練を実施すること。','103' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-2-2-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-2-2-2','4-2-2','攻撃等の防御','52','セキュリティインシデント発生時の対応に関する教育・訓練を行うこと。','・No.4-2-2-1で実施した教育・訓練の実施内容、実施方法、実施時期及び受講状況を記録し、保管すること。','104' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-2-2-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-2-2-3','4-2-2','攻撃等の防御','53','セキュリティインシデント発生時の対応に関する教育・訓練を行うこと。','・年１回以上の頻度でセキュリティインシデント発生時の対応に関する教育・訓練の実施内容について点検すること。','105' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-2-2-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-3-4-1','4-3-4','攻撃等の防御','54','適切なバックアップを行うこと。','・取得対象、取得頻度及び保管期間を定めて自社で取り扱うデータのバックアップを取得すること。','110' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-3-4-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-3-4-2','4-3-4','攻撃等の防御','55','適切なバックアップを行うこと。','・重要な機密情報については、No.4-3-4-1におけるバックアップに加えて、遠隔地バックアップを実施すること。','111' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-3-4-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-3-4-3','4-3-4','攻撃等の防御','56','適切なバックアップを行うこと。','・バックアップ対象ごとにリストア手順書を整備すること。','112' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-3-4-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-1-1','4-4-1','攻撃等の防御','57','情報機器、OS及びソフトウェアの安全な構成を確立し、維持すること。','・パソコン、サーバ及びスマートデバイスで利用を許可していないソフトウェアをすべて削除若しくは無効化するか、又は利用を許可するソフトウェア以外を自由にインストールできないようにすること。','113' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-1-2','4-4-1','攻撃等の防御','58','情報機器、OS及びソフトウェアの安全な構成を確立し、維持すること。','・外部記録媒体を使用する端末について自動実行(auto-run)又は自動再生(auto-play)を無効化すること。','114' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-1-3','4-4-1','攻撃等の防御','59','情報機器、OS及びソフトウェアの安全な構成を確立し、維持すること。','・サーバ及びネットワーク機器の設定変更を申請・承認制にすること。','115' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-4-1','4-4-4','攻撃等の防御','60','情報機器、OS及びソフトウェアへのセキュリティパッチ及びアップデートの適用に係る手続を定めること。','・システム、情報機器及びソフトウェアは以下の状態とすること。
- ライセンスが付与され、サポートされている。
- サポートが終了した場合に削除されるか、又はインターネットとの全てのトラフィックを遮断することで適用範囲から削除される。
- 可能であれば、自動アップデートが有効化されている。','123' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-4-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-4-2','4-4-4','攻撃等の防御','61','情報機器、OS及びソフトウェアへのセキュリティパッチ及びアップデートの適用に係る手続を定めること。','・利用している機能又は設定に関して、以下のいずれかに該当するアップデートプログラムがリリースされてから14日以内に、アップデートすること。
- 当該アップデートが、ベンダーにより「重大」(Critical)又は 「高リスク」(High Risk)と説明される脆弱性を修正するものである。
- 当該アップデートが、CVSSの基本値が7.0以上の脆弱性を修正するものである。
- 当該アップデートが修正する脆弱性のレベルの詳細がベンダーから提供されていない。 
・やむを得ず上記のとおりアップデートができない場合(例えば、動作検証に一定期間を要し、期限内にアップデートが完了しない場合)は、アップデート適用までの間、以下のいずれかにより脆弱性悪用のリスクを低減する対策を実施すること。
- 脆弱性悪用の対象となる機能を無効化すること。
- ベンダーが推奨する回避策を実施すること。
- 対象となる情報機器を適用範囲内のネットワークから分離すること。
- 対象となる情報機器と適用範囲内のネットワークとの通信を監視し、当該脆弱性を悪用する不正な通信を遮断する機器又はソフトウェアを導入すること。

[対象]
-会社支給のパソコンの OS、ブラウザ及びOffice ソフト 
-サーバの OS及びミドルウェア 
-会社支給のスマートデバイスのOS及びアプリ 
-インターネットとの境界に設置されているネットワーク機器のOS及びファームウェア','124' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-4-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-5-1','4-4-5','攻撃等の防御','62','システムをマルウェア感染から保護すること。','・ネットワークに接続しているすべてのパソコン及びサーバに、マルウェア対策ソフトウェアを導入すること。
','126' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-5-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-5-2','4-4-5','攻撃等の防御','63','システムをマルウェア感染から保護すること。','・パソコン及びサーバごとにマルウェア対策ソフトのスキャン範囲及び頻度を定め、スキャンを実行すること。','127' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-5-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-4-5-3','4-4-5','攻撃等の防御','64','システムをマルウェア感染から保護すること。','・マルウェア対策ソフトウェアのパターンファイルを、ベンダーの推奨に従ってアップデートすること。','128' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-4-5-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-5-1-1','4-5-1','攻撃等の防御','65','ネットワークを適切に分離し、境界部分を防護すること。','・全てのファイアウォール(又はファイアウォール機能を持つネットワーク機器)及びルータについて、デフォルトの管理パスワードを強固で一意のパスワードに変更する、又はリモートアクセスを完全に無効化すること。','131' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-5-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-5-1-2','4-5-1','攻撃等の防御','66','ネットワークを適切に分離し、境界部分を防護すること。','・ファイアウォール(又はファイアウォール機能を持つネットワーク機器)及びルータのパスワードを変更する手順を定めること。
','132' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-5-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-5-1-3','4-5-1','攻撃等の防御','67','ネットワークを適切に分離し、境界部分を防護すること。','・ファイアウォール(又はファイアウォール機能を持つネットワーク機器)及びルータに係る認証は、No.4-1-5で定めるパスワード設定等に関する評価基準を満たすこと。','133' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-5-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-5-1-4','4-5-1','攻撃等の防御','68','ネットワークを適切に分離し、境界部分を防護すること。','・全てのファイアウォール(又はファイアウォール機能を持つネットワーク機器)について、認証されていないインバウンド通信を遮断すること。','134' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-5-1-4');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-5-1-5','4-5-1','攻撃等の防御','69','ネットワークを適切に分離し、境界部分を防護すること。','・全てのファイアウォール(又はファイアウォール機能を持つネットワーク機器)について、インバウンド通信に関するファイアウォール・ルールが定められていること。','135' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-5-1-5');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-5-1-6','4-5-1','攻撃等の防御','70','ネットワークを適切に分離し、境界部分を防護すること。','・全てのファイアウォール(又はファイアウォール機能を持つネットワーク機器)について、不要になったファイアウォール・ルールを速やかに削除又は無効化すること。
','136' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-5-1-6');
INSERT INTO criteria SELECT 'scs-20260327-star3','4-5-1-7','4-5-1','攻撃等の防御','71','ネットワークを適切に分離し、境界部分を防護すること。','・ファイアウォール・ルールの変更をインターネット経由で行う場合、No.4-1-3-3で示す認証要素を利用した多要素認証を適用するか、又は信頼できるIPアドレスにアクセスを制限すること。','137' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='4-5-1-7');
INSERT INTO criteria SELECT 'scs-20260327-star3','5-1-1-1','5-1-1','攻撃等の検知','72','ネットワーク上の適切な場所でネットワーク接続及びデータ転送を監視すること。','・社内外ネットワークの境界又は端末において、インターネットから社内への通信及び社内から不正なサーバへの通信の双方について、不正アクセスをリアルタイム検知・遮断する仕組みを導入すること。','140' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='5-1-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','5-1-1-2','5-1-1','攻撃等の検知','73','ネットワーク上の適切な場所でネットワーク接続及びデータ転送を監視すること。','・ネットワーク機器のログ及びアラートを分析し、セキュリティ担当部署の担当者又は管理者により不審な事象が発見された場合に、それがセキュリティインシデントに該当するかが判断されること。','141' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='5-1-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','5-1-1-3','5-1-1','攻撃等の検知','74','ネットワーク上の適切な場所でネットワーク接続及びデータ転送を監視すること。','・No.5-1-1-1で設置したネットワーク機器又はサービスについて、以下の要件を満たす異常時に通知する仕組みを導入すること。
-アラートが速やかに発報されること。
-インシデントの速報レポートが作成され、通知されること。','142' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='5-1-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','6-1-1-1','6-1-1','インシデントへの対応','75','セキュリティインシデントへの対応手順、対応体制等を定めること。','・以下の手順を含んだセキュリティインシデントへの対応手順を定めること。
①発見報告、 ②初動、③調査・対応、④復旧、⑤最終報告
','148' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='6-1-1-1');
INSERT INTO criteria SELECT 'scs-20260327-star3','6-1-1-2','6-1-1','インシデントへの対応','76','セキュリティインシデントへの対応手順、対応体制等を定めること。','・セキュリティインシデント発生時における社内外組織(関係当局及び所管省庁を含む。)の連絡先及び報告・情報共有ルートを定めること。','149' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='6-1-1-2');
INSERT INTO criteria SELECT 'scs-20260327-star3','6-1-1-3','6-1-1','インシデントへの対応','77','セキュリティインシデントへの対応手順、対応体制等を定めること。','・セキュリティインシデント発生時におけるセキュリティを統括する役員(例えば、CISOを設置する会社の場合は、当該CISO)及びセキュリティ担当部署の役割・責任を定めること。','150' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='6-1-1-3');
INSERT INTO criteria SELECT 'scs-20260327-star3','6-1-1-4','6-1-1','インシデントへの対応','78','セキュリティインシデントへの対応手順、対応体制等を定めること。','・年1回以上の頻度でNo.6-1-1-2及びNo.6-1-1-3にて定めたセキュリティインシデント発生時の体制について点検すること。','151' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='6-1-1-4');
INSERT INTO criteria SELECT 'scs-20260327-star3','6-1-1-5','6-1-1','インシデントへの対応','79','セキュリティインシデントへの対応手順、対応体制等を定めること。','・セキュリティインシデントの報告フォーマットを整備すること。','152' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='6-1-1-5');
INSERT INTO criteria SELECT 'scs-20260327-star3','6-1-1-6','6-1-1','インシデントへの対応','80','セキュリティインシデントへの対応手順、対応体制等を定めること。','・年１回以上及び社内外で重大なセキュリティインシデントが発生した際に、インシデント事例及びその対応策を社内部署へ共有していること。','153' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='6-1-1-6');
INSERT INTO criteria SELECT 'scs-20260327-star3','7-1-1-1','7-1-1','インシデントからの復旧','81','事業上重要なシステムについて、事業継続の要件に沿う復旧に必要な準備を行うこと。','・事業継続上重要なシステムについて、サイバー攻撃を念頭に、業務の目標復旧レベルを定めたうえで、当該レベルまで業務を回復するために必要な対策を、以下の例を参考として整備すること。
[復旧のための対策(例)]
- システムによる業務継続(例:予備機、クラウド環境等により待機系を整備する。)
- 人手による業務継続(例:電話、FAX等による連絡又は業務の実施に備え、影響のある取引先の連絡先及び複数の連絡手段を整備する。)','154' WHERE NOT EXISTS(SELECT 1 FROM criteria WHERE standard_id='scs-20260327-star3' AND criterion_id='7-1-1-1');
UPDATE standards SET sealed_at='2026-09-18T00:00:00.000Z' WHERE id='scs-20260327-star3' AND sealed_at IS NULL;
