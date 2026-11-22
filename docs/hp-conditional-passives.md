# HP条件付きパッシブ

2026-11-21。作業ブランチfeature/hp-conditional-passives。既存28タイプを維持し、追加はconditional_damage_multiplierの1タイプだけ（計29）。個別のcharacter.csv・skill.csv・passive.csvは変更しない。

## 調査結果と再利用

- conditional_stat_multiplierは既に実装済み。target_id=saはsp_atkに正規化され、valueで能力段階と独立した倍率を指定する。
- 従来のHP条件はself_hp_lte:N/Dとopponent_hp_lte:N/D。整数の交差積で以下（<=）を判定し、HP50%ちょうども含む。self_hp_lte:1/2はそのまま再利用できる。
- 従来はHPの完全一致比較がなく、self_hp_lte:1/1は「100%以下」のため満タン専用条件にはならない。既存形式へeqを追加し、self_hp_eq:1/1を正式な満タン条件とする。HPから1でも減れば不成立となる。
- element_damage_multiplierは属性条件のみで、HP条件を受け取らない。防御能力値を倍にする代用では、式の定数項や端数処理により被ダメージ0.5倍と一致しない。survive_onceもHP1耐え・回数管理の別効果。このため新規タイプを1つ追加する。

## 正式な設定例

同じパッシブの2枠に両方を設定する例。例を正式passive.csvへ自動追加・割当していない。

|列|1枠目：満タン時半減|2枠目：HP50%以下SA強化|
|---|---|---|
|passive_typeN|conditional_damage_multiplier|conditional_stat_multiplier|
|target_idN|all|sa|
|valueN|0.5|1.5|
|conditionN|self_hp_eq:1/1|self_hp_lte:1/2|

condition1にはself_hp_eq:1/1、condition2にはself_hp_lte:1/2を記入する。passive.csvの列構成は変更しない。使用しない3枠目は従来の未設定形式のままでよい。

HP条件はselfまたはopponent、比較演算子lteまたはeq、0以上1以下の整数比N/D（D>0）を受け付ける。status条件も従来どおり。生存HPに対して判定し、HP割合をパーセントへ丸めない。例として最大HP201ではHP100が50%以下、HP101は50%を超える。

## 新規CSV定義

|カラム|値|
|---|---|
|passive_type_id / handler|conditional_damage_multiplier|
|name|条件付き被ダメージ倍率|
|phase|incoming-damage|
|target_kind|attack_type|
|value_type|number|
|value_min / min_inclusive|0 / FALSE|
|value_max|空欄（正の倍率を設定可能）|
|condition_kind|stat_condition（既存の条件構文を共用）|

allで属性に関係なく物理・特殊の両攻撃を対象にする。既存のattack_type対象形式を使うためphysical／specialによる限定も可能。値はCSVから読み、0.5や1.5を戦闘コードに固定しない。0倍の無効化は別効果として既存の無効処理を維持する。

## 計算順・発動判定

基礎ダメージ→既存の属性一致補正と丸め→属性相性と切り捨て→防御・壁・従来の属性被ダメージ倍率・今回の条件付き倍率の積→既存の最終丸め、最低ダメージ、完全無効判定という既存経路へ追加した。丸め済みの最終ダメージを再び半分にする処理は追加しない。最終丸めは既存のroundHalfDown（0.5ちょうどは切り捨て）を使い、正のダメージは最低1、完全無効は0を維持する。

conditionMatchesをHP能力倍率と被ダメージ倍率で共有する。満タン判定は被ダメージ計算時の現在HPを読む。ターン開始時のHPをキャッシュしない。先行回復で満タンになった同じターンの攻撃も軽減し、先行HP費用で1減った場合は軽減しない。被弾後は通常へ戻り、回復して満タンへ戻れば再度有効となる。回数制限は設けない。

SAは既存effectiveStatの能力段階→条件付き能力倍率→既存の整数化という処理を再利用する。基礎能力やstagesを書き換えず、HPが50%を超えれば倍率が自動的に消える。能力段階の上昇・下降はそのまま残る。

新規被ダメージ倍率は既存の通常攻撃計算で適用する。デコイへの割当より前という従来パッシブ倍率の位置も維持する。毒などの継続ダメージ、反動・反撃などの別経路や乱数仕様は変更しない。ダメージ計算式、STAB値、属性相性、EN、行動順の仕様も変更しない。

## 予測・GOE

実戦・previewDamage・AIはcalculateDamage／effectiveStatと同じ条件判定を使う。予測によるHP・能力段階・状態・発動回数・乱数の変更はない。予測は現在状態に基づくため、未確定の相手行動による先行回復やHP費用は保証しない。実行時にはその時点のHPで再計算する。

GOEは既存の共通正規化を利用し、新タイプとall、条件self_hp_eq:1/1・self_hp_lte:1/2を選択できる。日本語の説明付き候補を追加し、他の有効な既存条件の自由入力も維持する。範囲外の比、分母0、未対応の比較記号などはconditionNのエラーとして検出する。保存・CSV出力・再読み込みで文字列と倍率を保持する。既存UIの配置・CSSは変更しない。

## テスト

- 新規HPテスト39件：100/99/50%、物理・特殊、全9属性、属性相性・壁・防御・属性パッシブとの積、被弾後・実回復後の再発動、最大HP奇数とHP1差、最低1・無効0、SA51/50/49%、SA段階±、HP費用による閾値跨ぎ、2効果の共存、既存opponent条件、入力異常、CSV倍率変更、AI・予測の非変更、同ターンの先行回復とHP費用を確認。
- GOEのNode追加テスト2件：正式条件候補・共通検証とCSV往復を確認。
- 全395件（既存354＋追加41）が成功、失敗0。
- Edge実操作：新タイプと2枠の例を設定し、不正条件の拒否、登録、CSV出力、再読み込みで正式条件文字列と倍率の保持を確認した。既存パッシブの作成・複製・不正設定検査・CSV往復の回帰も成功。
- 既存28タイプは全てカタログへ残り、既存の回帰テストを実行した。個別設定は作業開始時のSHA-256で保持確認する。

再実行：node --test。重点検証：node --test test/hp-conditional-passives.test.mjs test/editor.test.mjs。Edge：GO_PLAYWRIGHT_PATHを指定しnode tools/check-hp-passives.cjs。

## 変更ファイル

passive.js、battle-core.js、data/passive_type.csv、GO_Editor.html、test/hp-conditional-passives.test.mjs、test/passive28.test.mjs、test/data.test.mjs、test/editor.test.mjs、tools/check-hp-passives.cjs、tools/check-passive28.cjs、README.md、CHANGELOG.md、docs/passive-system.md、docs/passive-extension-28.md、本記録。

未解決の実装・テスト失敗なし。mainへのマージ・Pushは行わない。
