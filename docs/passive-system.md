# パッシブ共通エンジン v0.40

## データと状態

[正式パッシブCSV](../data/passive.csv) は64枠。名称設定済み24件のうち15件を実装し、9件は効果種別が未設定。残る40枠は予約行。既存の最大3枠と各枠の `passive_typeN`、`target_idN`、`valueN`、`trigger_textN` を使う。

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
| 戦闘個体の初期化・戦闘開始 | `createFighter()` で効果と個体状態を設定し、`createBattle()` で控えを含め初期ENを設定する。上限は7。初回登場時の効果は、両側初期化後の位置で扱う。 |
| 交代 | `switchFighter()` の `before-switch → leave → enter → after-switch` を利用できる。通知は交代先の確定後に行う。通常交代、特殊交代、補充が共通経路を通る。 |
| 行動順・技発動前 | 後続の能力倍率は `effectiveSpeed()` と `statValue()`、技発動前条件は `runTurn()` 内の行動可否・EN消費の前後で扱う。 |
| 威力・無効・ダメージ | `calculateDamage()` が威力を求め、属性パッシブ無効を属性相性、回避、個別・陣営軽減、貯水、反射、デコイへ進む前に判定する。攻撃技のみ実装。 |
| HP適用・被ダメージ確定 | 本体に入る直接致死ダメージにリバイブを判定し、実戦の `runTurn()` だけが発動を記録する。反撃の成立にはリバイブ適用後の生存を使い、反撃量は既存の軽減後の仮想ダメージを基準にする。後続の被弾効果には、HP適用後の本体損失とデコイ損失を個別に使用できる。 |
| 通常効果・技使用後 | 敵からの能力低下を `changeStage()` の発生元付き呼び出しで判定する。属性技使用による自己ランク変化は技の通常効果の後、特殊交代と戦闘不能処理の前。溜め技は予約時に一度だけ発動する。 |
| 回避行動・回避成功・戦闘不能 | `applyMoveEffects()` に回避行動と確率判定の位置があり、`recordFaint()` が戦闘不能を整理する。該当パッシブはv0.41の対象。 |
| ターン終了 | 毒・締め付け、戦闘不能・勝敗、期限終了の後に、場の生存個体の各枠を順番に処理。続けてEN回復、補充、ターン更新。勝敗が決まったターンは通常のGO終了処理に従う。 |

`previewDamage()` は実戦と同じ判定結果を返す。`powerPassives`、`immunity`、`survival` は成立見込み。乱数、HPや発動回数等を更新するのは実行時。溜めの威力は予約値を使用する。交代待ちの再開はv0.33の同一ターン継続を使う。デバッグ画面の発動ログにはCSVの個別メッセージを優先し、空欄や `none` には共通ログを表示する。

## MHBから流用した処理

MHB由来の `normalizePassive()` / `normalizePassiveEffect()`、`passiveEffectsOf()` / `findPassiveEffect()`、`externalPassiveSource()`、`passiveActivationLogEvents()` を共用。MHBでは `startEnergyFromPassiveEffects()` / `initialEnergyFromPassive()` が初期ENを参照し、`turnEndStatUpFromPassive()` / `turnEndStatDownFromPassive()` が終了時に増減を探す。GOは符号付きランク変化を複数枠順に処理する。MHBの `surviveOncePassiveEffect()` の直接攻撃制限を参考に満タン条件と枠別回数を加え、`findBlockingEffectPassive()` / `findBlockingBattleEffectPassive()` の発生元区別はGOの `changeStage()` に適用した。MHBの `elementDamageMultiplierFromPassive()` は最終ダメージを補正するため、GOの `element_power_multiplier` は威力計算に配置した。MHBの `hasPassiveEffect()` と `passiveEffectValue()` も確認した。移植元では専用のパッシブ自動テストファイルは確認できなかった。

## 正式CSVの24件

| ID末尾 | 名称 | 説明・構造化内容 | 状況・確認事項 |
|---|---|---|---|
| 001 | リバイブ | `survive_once / hp_full_once / 1`。満タンからHP1で耐える | 実装。直接攻撃のみ暫定 |
| 002 | エメラルドアイ | `element_immunity / water / 1` | 実装。攻撃技のみ暫定 |
| 003 | オールドターボ | 初期EN4、終了時SA+1 | 実装 |
| 004 | スピンナップ | `wind_sp / +1` | 実装。使用時の順序は暫定 |
| 005 | 電熱線 | 終了時PA+1 | 実装 |
| 006 | 全身全霊 | `neutral / 1.2` の威力補正、`neutral_pa / −1` | 実装。使用時の順序は暫定 |
| 007 | 流動体質 | `element_immunity / neutral / 1` | 実装。攻撃技のみ暫定 |
| 008 | 短期決戦 | 初期EN5、終了時SA−1 | 実装 |
| 009 | 氷棚形成 | `water_pd / +1` | 実装。使用時の順序は暫定 |
| 010 | スーパーハード | `debuff_immunity / pd_down / 1`。相手のPD低下を無効 | 実装 |
| 011 | ソーラーエナジー | `flash_pa / +1` | 実装。使用時の順序は暫定 |
| 012 | イオンチャージャー | `fire_sd / +1` | 実装。使用時の順序は暫定 |
| 013 | オーバーロード | 初期EN2、`fire_pa / −1` | 実装。使用時の順序は暫定 |
| 014 | 精神崩壊 | 終了時PD+1、SD−1 | 実装 |
| 015 | 知覚過敏 | 光技を受けるとPA・SP+1。効果種別未設定 | v0.41。被弾の範囲 |
| 016 | 羽音 | 登場時に相手SP−1。効果種別未設定 | v0.41。初回・補充・同時登場の順序 |
| 017 | 火事場 | 自分HP1/2以下でPA・SA×1.2。効果種別未設定 | v0.41。倍率の評価点 |
| 018 | 狩猟本能 | 相手HP1/3以下でSP×1.5。効果種別未設定 | v0.41。行動順を確定する時点 |
| 019 | 異常代謝 | 状態異常時にPD・SD×1.5。効果種別未設定 | v0.41。対象に含める状態 |
| 020 | 無鉄砲 | 優先度の高い技でHP1/10損失、変化技無効。効果種別未設定 | v0.41。優先度閾値、HPの基準と丸め、変化技の適用範囲 |
| 021 | 観察眼 | 回避行動でPD+1。効果種別未設定 | v0.41。回避判定との前後関係 |
| 022 | 毒汗 | 物理被弾で相手を毒にする。効果種別未設定 | v0.41。デコイ・致死・派生ダメージの扱い |
| 023 | 軌道修正 | 回避成功でSA+1。効果種別未設定 | v0.41。回避行動の成功と相手の技回避の区別 |
| 024 | アメジストアイ | `element_immunity / fire / 1` | 実装。攻撃技のみ暫定 |

暫定採用事項は、リバイブの対象から継続ダメージ・反動・反射・反撃・HP消費を除くこと、属性無効を変化技に適用しないこと、属性技の使用時効果が回避・無効でも発動し、溜めの解放では再発動しないこと。技を実行する前に戦闘不能になった個体と、反射や反動で技の処理中に戦闘不能になった個体では、技使用後の自己ランク変化を適用しない。
