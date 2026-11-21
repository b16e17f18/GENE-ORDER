# パッシブ28タイプ拡張

2026-11-21。作業ブランチfeature/passive-types-28。ゲームUIのレイアウト・バージョン・ダメージ式・通常急所／ダメージ乱数は変更しない。

## 正本と範囲

ユーザーが配置済みのdata/passive_type.csv（既存16＋追加12＝28行）を正式な定義元として採用し、作業開始時の全セル・全バイトを保持した。添付で呼ばれるpassive_type(3).csvに相当する現物はこのファイルである。個別効果はpassive.csvの最大3枠を正規化し、種別IDだけでなくhandler・phase・target_kind・condition_kind・値の範囲を共有検証する。同じhandlerに別IDを割り当てるCSV追加だけで再利用できることも検証した。

ユーザー確認により、character_026（XZY-O2）の4技をskill_069・skill_071・skill_070・skill_007へ揃え、5件目が後続列をずらしていた部分を修正した。能力値は変更しない。個別passive.csvと画像042/043は作業開始時のバイト列のまま保持し、今回のコミットへ含めない。現在編集中のバイオエンジン（passive_026）は効果未設定のまま。内容を生成せず診断でpendingとして区別する。これは共通タイプの未実装とは別である。

## タイプ別の対応表

全タイプのCSV読み込み・正規化と、既存／追加の回帰テストが成功している。各行の修正ファイルは中心となるファイルを示す。GOEの全28タイプ対応とデータ読み込み検査は全行共通。

|passive_type|実装前|実装後|中心ファイル|テスト結果|未解決事項|
|---|---|---|---|---|---|
|starting_en|実装済み|維持|passive.js|既存回帰成功|なし|
|element_immunity|実装済み|維持|passive.js|既存回帰成功|なし|
|element_damage_multiplier|実装済み|維持|passive.js|既存回帰成功|なし|
|element_power_multiplier|実装済み|維持|passive.js|既存回帰成功|なし|
|on_use_element_stat_stage|実装済み|維持|passive.js|既存回帰成功|なし|
|turn_end_stat_stage|実装済み|維持|passive.js|既存回帰成功|なし|
|on_hit_element_stat_stage|実装済み|維持|passive.js|既存回帰成功|なし|
|on_entry_enemy_stat_stage|実装済み|維持|passive.js, battle-core.js|既存回帰成功|なし|
|on_dodge_action_stat_stage|実装済み|維持|passive.js|既存回帰成功|なし|
|on_evade_stat_stage|実装済み|維持|passive.js|既存回帰成功|なし|
|conditional_stat_multiplier|実装済み|維持|passive.js|既存回帰成功|なし|
|priority_move_hp_cost|実装済み|維持|passive.js|既存回帰成功|なし|
|hostile_status_move_immunity|実装済み|維持|passive.js|既存回帰成功|なし|
|on_hit_inflict_status|実装済み|維持|passive.js|既存回帰成功|なし|
|debuff_immunity|実装済み（旧対象形式のみ）|個別・allへ拡張|passive.js|既存回帰成功・6対象追加検証|なし|
|survive_once|実装済み|維持|passive.js|既存回帰成功|なし|
|on_entry_stat_stage|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|on_entry_enemy_en_drain|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|status_damage_immunity|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|on_status_stat_stage|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|contact_damage_reflect|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|on_ko_en_restore|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|damage_lifesteal|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|critical_immunity|未実装（MHB由来の類似処理あり）|定義・判定API対応（急所加算なし）|passive.js, GO_Editor.html|追加検証成功|現行GOに急所判定がないため発動機会なし|
|effect_chance_multiplier|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|on_switch_out_stat_stage|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|status_immunity|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|
|heal_block|未実装（MHB由来の類似処理あり）|実装済み|passive.js, battle-core.js|追加検証成功|なし|

## MHBとの比較と再利用

MHBのGitHub版[passive.js](https://github.com/b16e17f18/MHB/blob/main/passive.js)、battle-core.js、app.js、data/passive.csvを読み取り専用で確認した。黒狼鳥の眼光はpassive_017のheal_block/hp/0である。

- 回復封印はisImmediateHpHealingStatusMoveの分類を再利用し、GOのphaseに接続した。非攻撃技でheal/hpの通常効果を持つ技を封印し、吸収攻撃・自然回復・パッシブの自動回復・直接EN回復は除外する。選択可否と実行直前の両方で確認し、後から相手が登場した時もHP/EN費用を払わず理由をログに出す。所持者が離脱・戦闘不能なら解除される。
- MHBのdamageDrainPercentFromPassiveと同様、吸収の基準は本体の実HP減少量。MHBの25（百分率）に相当するGOのvalueは0.25（割合）であり、旧データを暗黙に百分率換算しない。実ダメージ×割合を切り捨て、最大HPで制限する。
- 状態異常無効・能力低下無効の区分はMHBのfindBlockingEffectPassiveに準拠し、GOの正式状態異常IDと能力段階へ適合した。MHB側の状態ID集合をGOへコピーせず、GOの正式effect.csvから対象を得る。
- 効果確率はMHBのeffectChanceWithPassiveと同じく既存確率への倍率、上限100%。GOのvalueは倍率そのもの（例1.25）で、MHBの125をそのまま使うものではない。通常効果と戦闘効果を共通処理し、既存rollChanceを利用する。パッシブ自身の毒汗等の確率は技の追加効果ではないため変更しない。
- MHBにはen_down_immunityの旧処理もあるが、現行GOの正式28タイプに含まれない。今回このタイプを追加したり、登場時EN減少に未定義の無効ルールを設けたりしていない。

## 対象・値・条件

- 能力はpa/pd/sa/sd/spと正式ID、PA/PD/SA/SD/SPを受け付ける。debuff_immunityは旧pd_down等も維持し、allは5能力の低下に対応する。相手由来のみ防ぎ、自分や同陣営の技・パッシブによる低下は防がない。有効量>0（通常1）というGO従来の判定を維持する。
- status_immunityとstatus_damage_immunityはpoison/burn/paralysis/frostbite/sleepまたはall。前者は付与自体を防ぎ、後者は状態・能力補正・持続消費を維持して継続ダメージだけ防ぐ。bindは状態異常枠ではないためallによる継続ダメージ無効の対象外。これらの新しい免疫フラグ、heal_block、critical_immunityはCSVで許されるvalue=0でも定義の存在を利用する。
- on_status_stat_stageはconditionNへ正式状態異常IDまたはallを指定する。ユーザー回答どおり、新規付与だけでなく再付与・残り期間更新でも発動する。免疫で付与されなかった場合は発動しない。
- contact_damage_reflect／damage_lifestealのtargetはphysical/special/all。新しい接触・非接触の分類を推測で追加しない。反射は反射側の最大HP×CSV割合を切り捨てる（1未満は0）。本体HPへの直接被弾時だけ発動し、デコイ・回避・無効は対象外。反射ダメージから再び被弾パッシブを呼ばず、連鎖させない。MHBの反撃およびGO既存被弾パッシブに合わせ、被弾側が戦闘不能なら反射しない。
- ENは既存のchangeEnergyで0〜MAX_ENERGYへ制限する。登場時相手EN減少は吸収ではなく、使用者のENは増やさない。撃破時EN回復は自分の直接攻撃で本体を倒し、使用者が生存している時に1回だけ。毒・反射・デコイ破壊で付与しない。
- critical_immunityは定義・正規化とcriticalBlock判定APIに対応する。GOには急所の追加ダメージ・急所乱数自体がないため、今回それを新設しない。このタイプだけは現行戦闘で適用すべき急所加算がない。

## 処理順

登場時は既存順序を維持し、自分の指定ランク、相手の指定ランク、相手EN減少を枠順に処理する。初回開始時は初期EN設定後に登場効果。同時補充は両側の補充後に発動する。

直接攻撃では本体ダメージ確定→パッシブ吸収→既存被弾処理・反射→技追加効果→撃破時EN回復・戦闘不能整理の順。追加効果の確率補正・免疫・状態付与後ランクは同じ共通経路で処理する。

交代時は既存の離脱リセット／リレー継承→交代先への味方ランク変化→登場効果。能力段階の上下限は既存±6を使う。戦闘不能による補充では倒れた側の交代時パッシブを発動しない。実戦で登場効果は1回だったが、previewSwitchで2回呼ばれていたため重複呼び出しを削除した。予測と実戦の入場ランク・相手ENが一致することを検証した。

## GOE

全面改修は行わず、passive.jsの同じカタログ・正規化を読み込む。既存のdatalistに日本語名と説明を表示し、選択したtypeのtarget_kindに合うtarget_idだけを候補にする。タイプ変更時に対象・状態条件の候補を更新する。対象・効果量・条件の不一致は画面へ示し、登録を拒否する。旧start_energy別名も維持する。CSVの読み込み・編集・複製・3枠の出力・再読み込みで正数／負数／0、空欄、条件を保持する。

## 検証結果

- 既存305件に新規33件（パッシブ）と3件（GOE）を加えた全341件：成功341、失敗0。
- ユーザー編集中の個別passive.csvを含めないコミット予定構成でも、読み取り時だけ登録済みpassive.csvを適用し、全341件成功。正式CSVを書き戻したり置換していない。テストの固定件数はCSVの名称設定／意図的未設定行を参照する検査へ更新し、未設定を勝手に埋めていない。
- 既存の多数戦闘テストは2505戦、JavaScript例外・不正行動0。検証用200ターン上限は正式な引き分け条件にしない。
- EdgeのGOE実操作：28名・説明、対象候補切替、不正登録拒否、新規・編集・複製、3枠CSV出力／再読込、負数と0を保持。成功。
- 既存正式UI：Edge1280pxと390pxで導線・各対戦モード・入力・リプレイ・表示を確認、両方成功。iPhone実機検証ではない。
- 未解決の共通タイプ実装・テスト失敗なし。個別に未設定のバイオエンジンは今回補完していない。急所無効の発動機会がない点は上記の現行GO仕様による。

再実行：node --test。重点検証：node --test test/passive28.test.mjs test/editor.test.mjs test/data.test.mjs。Edge：GO_PLAYWRIGHT_PATHを設定してnode tools/check-passive28.cjs／node tools/check-ui.cjs。

## 変更ファイル

passive.js、battle-core.js、battle-ai.js、app.js、GO_Editor.html、data/passive_type.csv、data/character.csv、test/passive28.test.mjs、test/editor.test.mjs、test/data.test.mjs、test/battle.test.mjs、tools/check-passive28.cjs、README.md、CHANGELOG.md、docs/passive-system.md、本記録。mainへの直接push・マージは行わない。
