# パッシブ共通エンジン v0.41

## パッシブ種別マスタ

`data/passive_type.csv` に28タイプの定義を置き、`passive.csv` の各効果を検証する。UTF-8で保存し、再読み込み後の新規戦闘に反映する。

| 列 | 内容 |
|---|---|
| `passive_type_id` | `passive.csv` の `passive_type1`〜`3` から参照するID |
| `name`、`description` | 種別の日本語名称と処理の説明 |
| `handler` | `passive.js` に登録された処理方式のID |
| `phase` | 発動タイミング。ハンドラーが対応するタイミングと照合 |
| `target_kind` | 属性、能力、属性＋能力、状態異常などの対象形式 |
| `value_type` | `integer` または `number` |
| `value_min`、`value_max` | 効果量の下限・上限。空欄はその側の制限なし |
| `min_inclusive`、`max_inclusive` | `TRUE` は境界を含む、`FALSE` は境界を含まない |
| `condition_kind` | `none`、`stat_condition`、`priority`、`attack_type` |
| `aliases` | 互換用の別名。複数の場合は `|` で区切る |

流動体質は `element_damage_multiplier` を使う。種別マスタは効果量を0より大きく1以下の倍率に制限し、個別パッシブの `value1=0.5` で半減する。`neutral` は無属性ID `none` へ正規化する。未設定の効果スロットを表す `passive_type=none` は種別マスタへの登録を必要としない。旧種別ID `start_energy` はマスタの `aliases` に記録し、`starting_en` として解決する。

既存の処理方式を使う種別は、新しい `passive_type_id` と既存の `handler` を指定した行を追加して利用できる。新しい処理方式を作る場合はJavaScriptにもハンドラーを実装する。発動タイミング・対象形式・条件形式がハンドラーと食い違う行、重複ID・別名、未登録ハンドラー、矛盾した数値範囲、正式28タイプの定義欠落は起動時エラーになる。個別パッシブの不正な対象・効果量・種別IDはデータ診断で検出する。

種別検証には `geneOrderPassives.readTypes(rows)`、パッシブの正規化には `normalize(row, elements, statuses, catalog)` を使う。ローダー・診断・テストへ同じ種別マスタを渡し、JavaScript側に範囲定義の代替データを持たせない。

## データと状態

[正式パッシブCSV](../data/passive.csv) は64枠。初期実装24件の一覧は履歴として以下に保持する。現在の名称設定件数と予約行・効果未設定行はCSVと起動時診断を正とする。既存の最大3枠と各枠の `passive_typeN`、`target_idN`、`valueN`、`trigger_textN` を使う。

| 効果種別 | 対象・数値 |
|---|---|
| `starting_en` | 対象なしの `none` または `en`。値は初期ENの整数。MHBの `start_energy` も受け付ける。 |
| `element_immunity` | GO属性ID。正の値で有効、0で無効。 |
| `element_power_multiplier` | GO属性ID。値は正の倍率。威力変動と乗算し、既存の丸めと上限を適用する。 |
| `on_use_element_stat_stage` | 属性と能力を `_` で連結。値は符号付きの段階数。 |
| `turn_end_stat_stage` | 能力ID。値は符号付きの段階数。 |
| `debuff_immunity` | 能力と `_down` を連結。正の値で有効、0で無効。 |
| `survive_once` | `hp_full_once` は満タン条件。値は戦闘中の最大発動回数。残HPは1。 |

`neutral → none`、`flash → light`。`pa / pd / sa / sd / sp → phy_atk / phy_def / sp_atk / sp_def / speed`。複合対象にも同じ対応を使用する。属性枠の `none` は無属性、効果種別欄の `none` は空き枠、初期ENの対象欄の `none` は対象なし。

`passive.js` の `geneOrderPassives.normalize()` を起動時マスタ読み込みと `data-validation.js` の診断が共有する。未知の種別・対象・異常値を診断し、対応枠のみ動作する一部対応と、未対応・未設定を区別する。`geneOrderBattle.createBattle({ passives, … })` が `character.passive_id` から照合し、個体ごとに枠別の発動回数を保持する。同じキャラクターを複数編成しても独立し、交代をまたいで保持され、新規戦闘で初期化される。正式マスタの更新は再読み込み後の新規戦闘に反映される。

## 発動順序

| 順序 | v0.40の処理と後続の接続位置 |
|---|---|
| 戦闘個体の初期化・戦闘開始 | `createFighter()` で効果と個体状態を設定し、`createBattle()` で控えを含め初期ENを設定する。上限は7。両側初期化後、自分側から初回登場効果を処理する。 |
| 交代 | `switchFighter()` の `before-switch → leave → enter → after-switch` を利用できる。通常交代・特殊交代は `enter` で発動する。同時補充は両側の選択と登場の確定後、自分側から発動する。 |
| 行動順・技発動前 | 狩猟本能は行動順決定時の相手HPを使う。無鉄砲のHP費用はEN消費後、技の適用前に支払う。 |
| 威力・無効・ダメージ | `calculateDamage()` が威力を求め、属性パッシブ無効を属性相性、回避、個別・陣営軽減、貯水、反射、デコイへ進む前に判定する。攻撃技のみ実装。 |
| HP適用・被ダメージ確定 | 本体に入る直接致死ダメージにリバイブを判定し、実戦の `runTurn()` だけが発動を記録する。反撃の成立にはリバイブ適用後の生存を使い、反撃量は既存の軽減後の仮想ダメージを基準にする。知覚過敏と毒の粘液を本体HPの実損失後、反撃と技の通常効果より前に判定する。 |
| 通常効果・技使用後 | 無鉄砲は相手の変化技から個体に向かう効果を無効にする。敵からの能力低下を `changeStage()` の発生元付き呼び出しで判定する。属性技使用による自己ランク変化は技の通常効果の後、特殊交代と戦闘不能処理の前。溜め技は予約時に一度だけ発動する。 |
| 回避行動・回避成功・戦闘不能 | 観察眼は実際に回避行動をとった時点で発動し、成否を問わない。軌道修正は相手の攻撃が `evaded` になった場合のみ発動する。 |
| ターン終了 | 毒・締め付け、戦闘不能・勝敗、期限終了の後に、場の生存個体の各枠を順番に処理。続けてEN回復、補充、ターン更新。勝敗が決まったターンは通常のGO終了処理に従う。 |

`previewDamage()` は実戦と同じ判定結果を返す。`powerPassives`、`immunity`、`survival` は成立見込み。乱数、HPや発動回数等を更新するのは実行時。溜めの威力は予約値を使用する。交代待ちの再開はv0.33の同一ターン継続を使う。デバッグ画面の発動ログにはCSVの個別メッセージを優先し、空欄や `none` には共通ログを表示する。

## MHBから流用した処理

MHB由来の `normalizePassive()` / `normalizePassiveEffect()`、`passiveEffectsOf()` / `findPassiveEffect()`、`externalPassiveSource()`、`passiveActivationLogEvents()` を共用。MHBでは `startEnergyFromPassiveEffects()` / `initialEnergyFromPassive()` が初期ENを参照し、`turnEndStatUpFromPassive()` / `turnEndStatDownFromPassive()` が終了時に増減を探す。GOは符号付きランク変化を複数枠順に処理する。MHBの `surviveOncePassiveEffect()` の直接攻撃制限を参考に満タン条件と枠別回数を加え、`findBlockingEffectPassive()` / `findBlockingBattleEffectPassive()` の発生元区別はGOの `changeStage()` に適用した。MHBの `elementDamageMultiplierFromPassive()` は最終ダメージを補正するため、GOの `element_power_multiplier` は威力計算に配置した。MHBの `hasPassiveEffect()` と `passiveEffectValue()` も確認した。移植元では専用のパッシブ自動テストファイルは確認できなかった。

## v0.41時点の正式CSV24件（履歴）

| ID末尾 | 名称 | 説明・構造化内容 | 状況・確認事項 |
|---|---|---|---|
| 001 | リバイブ | `survive_once / hp_full_once / 1`。満タンからHP1で耐える | 実装。直接攻撃のみ暫定 |
| 002 | エメラルドアイ | `element_immunity / water / 1` | 実装。攻撃技のみ暫定 |
| 003 | オールドターボ | 初期EN4、終了時SA+1 | 実装 |
| 004 | スピンナップ | `wind_sp / +1` | 実装。使用時の順序は暫定 |
| 005 | 電熱線 | 終了時PA+1 | 実装 |
| 006 | 全身全霊 | `neutral / 1.2` の威力補正、`neutral_pa / −1` | 実装。使用時の順序は暫定 |
| 007 | 流動体質 | `element_damage_multiplier / neutral / 0.5` | 無属性の物理・特殊攻撃の被ダメージを半減。倍率はCSVで管理 |
| 008 | 短期決戦 | 初期EN5、終了時SA−1 | 実装 |
| 009 | 氷棚形成 | `water_pd / +1` | 実装。使用時の順序は暫定 |
| 010 | スーパーハード | `debuff_immunity / pd_down / 1`。相手のPD低下を無効 | 実装 |
| 011 | ソーラーエナジー | `flash_pa / +1` | 実装。使用時の順序は暫定 |
| 012 | イオンチャージャー | `fire_pa / +1` | 実装。使用時の順序は暫定 |
| 013 | オーバーロード | 初期EN2、`fire_pa / +1` | 実装。使用時の順序は暫定 |
| 014 | 精神崩壊 | 終了時PD+1、SD−1 | 実装 |
| 015 | 知覚過敏 | 光の直接攻撃で本体HPが減るとPA・SP+1 | 実装。変化技・致死被弾は対象外（暫定） |
| 016 | 羽音 | 登場時に相手SP−1 | 実装。初回・同時補充では両側確定後に発動 |
| 017 | 火事場 | 自分HP1/2以下でPA・SA×1.2 | 実装。攻撃評価時に判定。シェルハードはPDを参照 |
| 018 | 狩猟本能 | 相手HP1/3以下でSP×1.5 | 実装。行動順決定時に評価 |
| 019 | 異常代謝 | 状態異常時にPD・SD×1.5 | 実装。締め付け・ランク・防御は対象外（暫定） |
| 020 | 無鉄砲 | 優先度+1以上で最大HPの10%消費、相手の個体対象変化効果を無効 | 実装。支払いと対象の範囲は暫定 |
| 021 | 観察眼 | 回避行動でPD+2 | 実装。回避判定の成否を問わない |
| 022 | 毒の粘液 | 物理の直接攻撃で本体HPが減ると相手へ毒。確率1 | 実装。受け手の生存が条件（暫定） |
| 023 | 軌道修正 | 相手の攻撃を実際に回避するとSA+1 | 実装。回避状態獲得は対象外（暫定） |
| 024 | アメジストアイ | `element_immunity / fire / 1` | 実装。攻撃技のみ暫定 |

暫定採用事項は、リバイブの対象から継続ダメージ・反動・反射・反撃・HP消費を除くこと、属性無効を変化技に適用しないこと、属性技の使用時効果が回避・無効でも発動し、溜めの解放では再発動しないこと。技を実行する前に戦闘不能になった個体と、反射や反動で技の処理中に戦闘不能になった個体では、技使用後の自己ランク変化を適用しない。

## v0.41のCSV調整

追加列 `condition1`～`condition3` は各効果枠に対応する。既存効果や無条件の効果では空欄。条件が必須の効果では空欄や無効な形式を診断する。

| 追加効果種別 | 対象 | 値・条件 |
|---|---|---|
| `on_hit_element_stat_stage` | 属性と能力を `_` で連結 | 符号付きの能力ランク変化 |
| `on_entry_enemy_stat_stage` | 相手の能力ID | 符号付きの能力ランク変化 |
| `conditional_stat_multiplier` | 能力ID | 正の倍率。条件は `self_hp_lte:1/2`、`opponent_hp_lte:1/3` のようなHP分数閾値、または `status` |
| `priority_move_hp_cost` | `hp` | 最大HPに対する負の消費割合（`-0.1` は10%）。条件は最低優先度の整数 |
| `hostile_status_move_immunity` | `none` | 正の値で有効。0で無効 |
| `on_dodge_action_stat_stage` | 能力ID | 符号付きの能力ランク変化 |
| `on_evade_stat_stage` | 能力ID | 符号付きの能力ランク変化 |
| `on_hit_inflict_status` | 使用可能な状態異常の効果ID | 発動確率0～1。条件は `physical` または `special` |

変更後はページを再読み込みして新規戦闘を開始する。毒のダメージ割合と持続は `effect.csv` の定義を使う。複数の状態異常があっても異常代謝の倍率は各能力に一度だけ適用する。HP境界は分数を交差乗算して判定する。

`effectiveStat()` が基礎能力にランク、条件付き倍率、フィールド補正を順に適用する。条件付き倍率が有効な能力は最後に切り捨て、倍率がかからないときは既存のランク丸めを維持する。能力上昇解除はランクに作用する。実戦・予測・速度評価で同じ関数を使う。

## v0.41で参照したMHBと暫定仕様

MHBの `lowHpDamageMultiplierFromPassive()` は33%の閾値で最終ダメージを補正する。GOはCSVの分数閾値で実効能力値を補正する。MHBの `applySkillEffects()` と `findBlockingEffectPassive()` で効果対象と発生元の扱いを確認し、GOでは既存の交代・回避イベント、状態異常の再付与処理、発生元付き能力ランク処理に接続した。光の変化技で被弾ランクを上げる処理、高優先度技のHP消費、致死被弾で毒を返す対応処理はMHBで確認できなかった。

- 無鉄砲は優先度+1以上の技を対象にし、共通回避を含む。技のENを払い、最大HPに割合を掛けて切り捨てた分を一度だけ失う。HPを使い切ると技は不発。同時に必要な交代先の選択は支払い前に行う。変化技無効は相手からの個体対象効果に限り、自己効果・陣営効果・場解除・攻撃技の追加効果は通る。
- 知覚過敏と毒の粘液は本体HPが実際に減り、受け手が生存した場合に発動する。変化技、デコイ、継続ダメージ、反射などの派生ダメージは対象外。毒の粘液は既存の毒再付与を使用する。
- 羽音は初回・同時補充で両者の登場後、自分側→相手側。通常交代が両側で選択された場合は既存の行動順に従い、各時点の相手を対象とする。軌道修正は相手の攻撃を実際に回避することが条件。

## v0.42 パッシブ総合検証

IDは `data/passive.csv` の `passive_NNN`。各効果の対象・量・条件は `target_idN`、`valueN`、`conditionN`、技との相互作用は `test/battle.test.mjs` の対応テストで照合した。暫定事項は上の一覧と [未確定仕様](pending-decisions.md) に記載。

| ID | 発動条件と時点 | 効果対象と量 | 回数管理 | 相互作用 | 対応テスト名の一部 |
|---|---|---|---|---|---|
| 001 | 最大HP・直接致死｜本体HP直前 | 自分 HP1、値1は上限 | 枠別1回、交代保持 | 反撃・毒の粘液・デコイ・テールパージ | Revive survives / Tail Purge and Revive |
| 002 | 水攻撃｜無効判定 | 敵技を無効、1 | 枠別記録 | 貯水・反射・回避 | elemental immunity |
| 003 | 戦闘開始・場で生存｜初期化・終了 | 自分 EN4、SA+1 | 初期化1回、SAは終了ごと | 控えEN・通常交代 | starting EN |
| 004 | 風技使用｜通常効果後 | 自分 SP+1 | 使用ごと、溜め1回 | 回避・リレー | all elemental use-stage / special switch suspension |
| 005 | 場で生存｜終了 | 自分 PA+1 | 終了ごと | 通常交代後・補充前 | official GO teams replay |
| 006 | 無攻撃の威力評価・無技使用後 | 威力×1.2、自分 PA−1 | 各枠、技使用ごと | 窮鼠猫噛・溜め・無効 | Full Commitment / neutral power |
| 007 | 無攻撃｜軽減計算 | 被ダメージ×0.5 | 回数制限なし | 防御・追加効果・AI予測 | Fluid Body |
| 008 | 戦闘開始・場で生存｜初期化・終了 | 自分 EN5、SA−1 | 初期化1回、SAは終了ごと | 交代再登場 | starting EN |
| 009 | 水技使用｜通常効果後 | 自分 PD+1 | 使用ごと | 属性無効、自己変化技 | all elemental use-stage |
| 010 | 敵由来PD低下｜ランク適用前 | 自分の低下を無効、1 | 阻止ごと | 外部デバフ・自己低下・強化解除 | stage immunity |
| 011 | 光技使用｜通常効果後 | 自分 PA+1 | 使用ごと | 光の変化技 | all elemental use-stage |
| 012 | 火技使用｜通常効果後 | 自分 SD+1 | 使用ごと | 火の攻撃 | all elemental use-stage |
| 013 | 戦闘開始・火技使用後 | 自分 EN2、PA−1 | 初期化1回、低下は使用ごと | 控えEN・火技 | starting EN / all elemental use-stage |
| 014 | 場で生存｜終了 | 自分 PD+1・SD−1 | 各枠、終了ごと | 毒・締め付け・補充 | poison and binding precede |
| 015 | 光攻撃で本体HP減・生存｜被弾後 | 自分 PA+1・SP+1 | 各枠、被弾ごと | 回避・反射・デコイ・光変化 | perception reacts |
| 016 | 登場｜入場後 | 相手 SP−1 | 登場ごと | 通常・特殊交代・同時補充 | entry debuffs / both manual replacements |
| 017 | 自身HP≤1/2｜ダメージ評価 | 自分 PA・SA×1.2 | 使用箇所を記録、常時計算 | HP消費・吸収・シェルハード | drain and HP cost / conditional attack stats |
| 018 | 相手HP≤1/3｜実効SP評価 | 自分 SP×1.5 | 使用箇所を記録、常時計算 | 追い風・速度ランク・同速 | hunter speed |
| 019 | 状態異常中｜実効防御評価 | 自分 PD・SD×1.5 | 使用箇所を記録、異常数で累積なし | 毒の粘液・追い討ち・締め付け | Toxic mucus and Pursuit / metabolism |
| 020 | 優先度≥1・相手の変化効果｜技前・効果前 | 自分 最大HP10%損失・敵個体効果を無効（1） | 使用時1回、無効は技ごと | 回避・溜め・フィールド・攻撃追加効果 | priority cost / hostile status immunity |
| 021 | 回避行動｜成否判定前 | 自分 PD+2 | 行動1回 | 共通回避・刃研ぎ・回避失敗 | dodge action and actual evade |
| 022 | 物理で本体HP減・生存｜被弾後 | 相手へ毒。確率1、毒の量・期間はeffect.csv | 被弾ごと | 毒再付与・デコイ・反撃 | Revive survives / toxic mucus |
| 023 | 実際の攻撃回避｜evaded | 自分 SA+1 | 回避ごと | 回避不可・回避状態取得 | dodge action and actual evade |
| 024 | 火攻撃｜無効判定 | 敵技を無効、1 | 枠別記録 | 反射・回避・デコイ | elemental immunity |


## 28タイプへの拡張（2026-11-21）

正式なpassive_type.csvの既存16タイプと追加12タイプへ対応した。対象・条件・値は共通の正規化で検証する。詳細な対応表、MHBとの比較、処理順、境界仕様、検証結果は[28タイプ拡張記録](passive-extension-28.md)を参照する。急所無効は定義・判定APIのみ対応し、GOへ急所やダメージ乱数を新設しない。


## 属性技使用時ランク変化の対象変更（2026-11-21）

on_use_element_stat_stageは、ユーザー指示により指定属性の「攻撃技」だけを対象とする。category=attackの物理・特殊技が実行された場合に従来のタイミングで発動し、変化技・共通回避は対象外。技自体の通常効果による能力変化は妨げない。命中しなかった攻撃の扱いと、溜め技の予約時に1回だけ発動する仕様は維持する。geneOrderPassives.useStageEffectsを実戦・溜め予測・AIが共有する。passive_type.csvは説明のみ更新し、効果量・個別passive.csv・skill.csv・キャラクター性能を変更しない。

検証：9属性の変化技除外、物理・特殊攻撃、共通回避、AIの不要な加点・状態非変更を追加し、全354件成功（失敗0）。ドラミングビートの通常効果は維持され、全身全霊の使用後PA低下による相殺は発生しない。
