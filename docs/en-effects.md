# EN妨害エフェクト

ローカル実装日：2026-11-20。バージョン番号は変更しない。正式技への新規割り当ては行わない。

## CSVと読み込み

正式な data/effect.csv に6効果を統合した。開始時点のファイルには6行が存在したが旧10列に戻っていたため、前回保存した13列版（SHA-256 d6cab09f60d9815e0fc15d86cf72f8d7e5fdc900eaf9d539496975699eae5105）を照合して復元し、6行だけをマージした。復元した既存75効果の全セルは保存済みの正本と一致する。全体は13列・81効果、ID重複なし。毒5ターン、火やられ・麻痺・氷やられ、能力補正と行動不能の3列を保持する。元ファイルの控えは .cache/en-before/data__effect.csv。キャラクター、パッシブ、技の正式CSVにはこの作業で書き込んでいない。

|effect_id|effect_group|damage_type|damage_value|target_stat|turn|
|---|---|---|---:|---|---:|
|en_down1|heal|none|-1|en|0|
|en_down2|heal|none|-2|en|0|
|en_drain1|en_drain|none|1|en|0|
|en_charge_down1|en_charge_modifier|none|-1|cost_charge|3|
|en_charge_zero|en_charge_modifier|multiplier|0|cost_charge|3|
|en_cost_up1|en_cost_modifier|none|1|en|3|

既存の normalizeEffect は数値の符号と0を保持できるため、その読み込みを再利用する。新しいgroupとtarget_statの組み合わせは effectKind で検査し、data-validation.jsでは持続ターンが正の整数であることも検査する。6効果への未対応・数値異常・参照不一致の診断は0件。

## 共通戦闘処理

- heal/en の負数は現在ENの減少。上下限は0～既存MAX_ENERGY=7。HPダメージや能力ランクとは別処理。
- en_drain は対象の実減少量を計算し、その量以下を使用者に回復する。使用者が最大ENでも対象からは指定量を減らす。対象ENが0なら回復0。self指定でもENを生成しない。
- 持続補正はGene個体の timedEffects に格納し、statusesとは別枠。同じIDは残り期間をCSVのturnへ更新し、加算しない。異なるIDは共存する。
- effectiveEnergyCharge は基礎energy_charge（CSVのcost_charge）に加算補正を適用してから倍率補正を適用する。0倍は減少補正と併存しても最終的に0。下限0。技の直接EN回復とパッシブのEN処理は従来の changeEnergy を使い、自然回復補正を参照しない。
- effectiveMoveCost は基礎costと有効なENコスト補正を合算する。元コスト0の技にも適用。通常交代・待機は技処理を通らず、共通回避は既存のCOMMON_MOVE_IDで基本行動として除外する。CSVに登録された個別の防御技は通常の技として扱う。
- checkAction、実行直前、previewDamage.energyCost、AI、初期／詳細技カードで同じeffectiveMoveCostを参照する。行動順確定後、先手の妨害で不足した後手は発動せず、HP・EN費用や追加効果を発生させない。ログは必要EN・現在ENと消費なしを示す。
- 溜め技は予約時に補正済みENを一度払い、解放時は0。解放前にENが減っても再請求しない。
- 3ターン補正は付与ターンを含む3回のターン終了回復まで有効とし、最後の自然EN回復の後に解除する。既存の状態異常・回避・フィールドの減算タイミングは変更しない。
- 通常交代・特殊交代は既存switchFighterのtimedEffects消去を利用する。パワーリレーは能力ランク／デコイのみ従来どおり継承し、EN補正を持ち越さない。
- 追加効果は既存applyMoveEffects経路に統合。effect_targetとeffect_chanceを維持し、回避・属性無効・デコイなどで本体に命中しなかった攻撃の相手向けEN効果は発動しない。連続攻撃でも各追加効果スロットの処理回数は変えない。
- ダメージ式・属性倍率・性能値・行動順の計算方法は変更しない。

## UIとAI

現在EN、技の補正後コスト、EN不足による発動不可、状態欄・詳細の持続名と残りターンを表示する。詳細画面のEN回復は補正後の値。付与・減少・吸収・期限終了をログに出し、実際の増減量を表示する。継承UIの白い詳細パネルで効果ラベルが白文字となり読めなかった箇所だけ、既存パネルと同じ黒文字・黒枠にした。レイアウトは変更しない。

AIは共通コストで合法行動とEN温存を評価し、自然回復の低下・無効、減少・吸収・消費増加を既存のEN評価重みで評価する。長さが十分残った同一補正の無意味な再使用の価値は増やさない。次ターンの技コスト予測ではその時点の期限も参照する。プレイヤーの未公開選択は参照しない。

## GO Editor

GO_Editor.htmlでeffectを参照専用から編集可能へ変更した。正式列名はcan_move/start_textであり、stackable/log_textのような別名を新設していない。新規・編集・複製、skillのeffect1～3・self/enemy・確率、正数／負数／0、持続、CSV出力・再読み込みに対応する。未知のgroup/target_statも自由入力として保持し、数値と期間は別途検査する。旧10列のeffect読み込みも引き続き可能で、新しい任意列の欠落だけで拒否しない。未編集CSVは文字コード・改行を含め元文字列をそのまま出力し、編集後も空欄・未知の列・符号・0を保持する。空行はデータ行として扱わない。

## テストと残件（2026-11-20時点）

- 新規Nodeテスト41件：EN34件、GOE7件。41件成功、失敗0件。
- Edge実操作3シナリオ：GOEの新規／編集／複製・技への設定・ダウンロードと再読込、PC1280pxとモバイル390pxの戦闘表示。すべて成功。EN即時変化、補正コスト、EN不足、残りターン、補正後自然回復、ラベルの可読性とJavaScript例外なしを確認。iPhone実機ではない。
- 既存Edge回帰：マウス／タッチの通常操作33件、状態異常表示8条件、正式UIのPC1280px／モバイル390pxの2条件がすべて成功。
- 現行CSVの全自動テスト：262件中256件成功、6件失敗。正式skill.csvは現在80技あり、今回変更していない。
- 保存済み65技CSVを読み取り時だけテストへ適用した比較回帰：262件成功、失敗0件。正式CSVを置換・書戻ししていない。この結果を現行80技の全件成功とは扱わない。

現行データの6失敗：
1. 技総数65を固定した表示テスト（実際80）。
2. 技総数65を固定した読込テスト（実際80）。
3. 予約行件数93を固定したテスト（実際78）。
4. 正式技のアニメーション検査で未設定13件：skill_066, 067, 068, 070, 071, 072, 073, 075, 076, 077, 078, 079, 080。
5. 以前は未割り当てだった流用効果が未使用であるというテスト。現在skill_068に割り当てあり。
6. 未解決参照数1件を固定したテスト（実際2）。skill_047.effect2=どろぼう、skill_074.element=炎。正式属性マスタの火はfire／名称「火」。

新規技の設定・演出や既存テストの前提更新は今回のEN効果追加とは分けて扱う。全テスト成功というコミット条件を満たしていないため、コミット・pushは行わない。既存HEADとGitHub mainは477710ac5d90d81ff98bfd32850d6ac5c6349a9c。バージョンは維持。

## 追補（2026-11-21）

正式CSVの拡張後の現行データを再照合し、上記の旧件数前提を現行仕様に更新した。技能は89件あり、全件に有効なアニメーション設定がある。83件は実行可能で、残る6件は理由を表示したうえで選択不可にしている。内訳は、`skill_047` の「どろぼう」効果定義待ち、`skill_066` の光・風複合属性のダメージ式待ち、`skill_084`〜`skill_087` の攻撃分類・属性・対象の正式定義待ちである。推測による性能設定は行っていない。

`guard_break` は個別・フィールドのダメージ軽減を半減する正式効果として共通戦闘処理へ反映し、溜め状態を前提にせず使用可能にした。全46名の名前付きキャラクターには少なくとも1つの使用可能技があることを検査している。

- `node --test`：304件成功、失敗0件。
- `node tools/check-ui.cjs`：EdgeでPC 1280px・モバイル390pxの公式フロー、全モード、再戦、ダブルクリック、11 CSV読込、状態詳細、継承、通常演出を検証して成功。画像未設定の `character_064` は仕様どおり検知した。
- UI回帰は、HUDへ状態を常時重複表示しない現行設計に合わせ、デコイ・毒を詳細パネルで、相手の能力変化をランクと段階表示で検証する。値を隠す相手情報の仕様は維持した。

## 再実行

- Node追加分：node --test test/en-effects.test.mjs test/editor.test.mjs
- 全テスト（現行データ）：node --test
- Edge：GO_PLAYWRIGHT_PATHにインストール済みPlaywrightの場所を指定してnode tools/check-en-ui.cjs

比較用の65技データ、読み取り用ローダー、実行ログ、スクリーンショットは.cache配下のローカル検証資料であり、Git登録対象外。比較テストだけを正式な合格判定に使わない。

## 今回の変更ファイル

- battle-core.js：EN効果分類、共通コスト／自然回復、実行前再検査、期限処理、予測メタデータ。
- battle-ai.js：補正後ENと妨害評価、次ターンの期限考慮。
- data-validation.js：EN持続効果の期間検査。
- app.js：EN減少・吸収・補正・不足のログ。
- go-ui.js：補正後技コスト／自然EN回復、演出分類。
- go-ui.css：詳細の効果ラベルの可読性だけ補正。
- data/effect.csv：13列の既存設定保持と6行マージ。
- GO_Editor.html：effect編集とEN対応、往復保持。
- test/en-effects.test.mjs：EN戦闘検証34件。
- test/editor.test.mjs：エディタ検証7件。
- tools/check-en-ui.cjs：EdgeのGOE・PC／モバイル戦闘実操作。
- docs/en-effects.md：仕様・互換性・検証・残件。
- CHANGELOG.md：未リリース欄への記録。

既存の他の未コミットファイルは今回の作業以前の変更であり、まとめてステージしていない。


## EN自然回復量UPの移植（2026-11-21）

基準コミット8d3165dd0eb4074e1576f02f34044cc68f6bed0fを含む最新作業ブランチからfeature/en-charge-up1を作成した。古いmainからは開始していない。

### MHBの確認とGOでの再利用

MHBの[data/effect.csv](https://github.com/b16e17f18/MHB/blob/main/data/effect.csv)にenergy_charge_up（energy_up、value=1、turn=3、target=en）がある。battle-core.jsのapplyEnergyEffectは持続効果をaddTimedStatusEffectへ渡し、fighterEnergyChargeModifier／effectiveEnergyChargeで基礎回復量へ加減算する。app.jsのendRoundはターン終了時の回復量を期間減算前に保存してから期限切れを除外し、その保存値で自然EN回復する。基礎値を書き換えないため、効果終了時には通常回復へ自動復帰する。

GOでは既存en_charge_modifierが符号付き整数の正値を受理する。effectiveEnergyCharge、setTimedEffect、tickTimedEffects、changeEnergyをそのまま利用できるため、戦闘エンジン・ローダー・AI・GOE本体のJavaScript変更は不要だった。MHBの旧groupやstatuses管理を追加せず、GO既存の個体別timedEffectsへ統一する。

### 正式CSV定義

既存13列を維持し、en_charge_down1と同じ任意列の空欄を保って1行だけ追加した。

~~~csv
effect_id,name,effect_group,damage_type,damage_value,turn,can_move,target_stat,start_text,start_delay,stat_modifier_target,stat_modifier_multiplier,action_failure_chance
en_charge_up1,EN回復量1増加,en_charge_modifier,none,1,3,TRUE,cost_charge,{target}のEN自然回復量が1増加した！,,,,
~~~

### 期間・相互作用

- 基礎cost_chargeは読み込み後のbase.energy_chargeを使用し、書き換えない。
- 補正後回復量はmax(0, floor((基礎回復量 + 有効な加算補正の合計) × 有効な倍率補正の積))。
- +1とen_charge_down1の-1は相殺。en_charge_zeroの0倍が併存する場合は自然回復0。適用順に依存しない。
- 付与ターンtではstarts=t、expires=t+3。t・t+1・t+2の3回の自然回復後に解除し、t+3から通常回復量へ戻る。即時EN回復ではない。
- 同じIDの再付与は重複加算せず、再付与ターンから3回分へ期限更新する。
- EN上限は既存7。通常交代で解除し、控えへ持ち越さない。特殊交代でも既存のtimedEffects消去に従い、パワーリレーで引き継がない。
- self／enemy、追加効果スロット1～3、発生率は既存の共通処理を使用する。正式技・キャラクターへの新規割り当ては行わない。

### 検証・変更ファイル

追加自動テスト17件（EN処理15、GOE2）。付与ターン込みの3回、期限後復元、即時回復との区別、上限、減少・無効との併用と順序、再付与、通常交代、リレー、自己・相手、確率0、テスト用CSVの量・期間変更、GOEの3枠・対象・CSV往復を確認した。

関連テスト66件成功。EdgeでGOEの新効果候補・3枠への設定・自己／相手・CSV出力と再読込、既存のPC1280px／スマートフォン相当390pxの戦闘UI回帰を確認し、すべて成功した。仕上げ時の全テストは1回実行し、464件すべて成功・失敗0（既存447＋追加17）、約42.8秒だった。

変更ファイルはdata/effect.csv、test/en-effects.test.mjs、test/editor.test.mjs、tools/check-en-ui.cjs、本記録、CHANGELOG.mdの6ファイル。ゲームの戦闘エンジン・UI配置・能力値・個別技・パッシブ設定・バージョンは変更しない。編集中のpassive.csvと画像2件を保持し、今回のコミットから除外する。mainへのマージ・Pushは行わない。
