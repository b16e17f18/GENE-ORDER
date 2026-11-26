# v0.10 データ基盤

## 現行データの状態（2026-11-21）

以下は現在読み込む正式CSVの集計であり、後続のv0.10〜v0.42節にある件数・診断は当時の履歴として保持する。

| 正式ファイル | CSV行 | 現在利用する定義 |
|---|---:|---:|
| character.csv | 75 | 名前付き46体 |
| passive.csv | 64 | 名前付き27件 |
| skill.csv | 100 | 名前付き89件 |
| animation.csv | 30 | 30件 |
| effect.csv | 82 | 82件 |
| battle_effect.csv | 37 | 37件 |
| power_rule.csv | 17 | 17件 |
| element.csv | 9 | 9属性 |
| element_effectiveness.csv | 81 | 81組 |
| species.csv | 10 | 10種 |
| passive_type.csv | 16 | 16種 |

89件の名前付き技はすべて有効なアニメーションID・時間・繰り返し回数を持つ。83件は選択可能で、長い舌、天使の羽搏き、奪う光、ハイドロジェット、激流、浄化の6件だけは不足した仕様を理由とともに表示して選択不可とする。名前付き46体は少なくとも1件の選択可能な技を持つ。ID付き予約行はキャラクター・技・パッシブの合計66件、画像欠落はcharacter_064の1件、既知の参照不一致は長い舌の`どろぼう`のみである。

## 9属性対応

正式マスタは火・水・雷・氷・風・地・光・闇・無の9属性と81組。相性は単属性の技に対し、防御側の属性ごとの倍率を乗算する。技と自身の属性が一致した場合は1.25倍。戦闘、AI予測、画面はいずれも正式CSVを参照する。data-inline.js は起動経路外の旧MHBデータ。GOの保存形式と属性IDの互換性は維持する。

## 確定したデータ契約

### MHBから追加した効果定義

移植元は `C:/Users/b16e1/Documents/MHB/MHB/data/effect.csv`、`battle_effect.csv` および `battle-core.js`。追加した定義は今後の技設定用とし、既存の技・キャラクター・パッシブへの参照を追加しない。

| CSV | ID | 内容・出典 |
|---|---|---|
| effect.csv | `heal_hp1`、`heal_hp2`、`heal_hp3` | MHBと同じ固定HP300・250・150回復 |
| battle_effect.csv | `phy_protect`、`phy_protect2` | MHBと同じ物理25％・50％軽減、当ターンから4ターン |
| battle_effect.csv | `sp_protect2` | MHBと同じ特殊50％軽減、当ターンから4ターン |
| battle_effect.csv | `fire_protect`、`thunder_protect`、`ice_protect` | MHBと同じ対象属性50％軽減、当ターンから4ターン |
| battle_effect.csv | `wind_protect`、`earth_protect`、`light_protect`、`dark_protect`、`none_protect` | MHBの属性軽減定義をGOの風・地・光・闇・無へ展開。50％軽減、当ターンから4ターン |

既存の `water_protect` と合わせて9属性を扱える。既存の `sp_protect` はGOの翌ターン開始・3ターンという定義を維持する。EN1回復は既存の `bf_heal_en` がMHBの `heal_en` と同じ挙動であり、既存の別名解決を継続利用する。

MHBの `heal_hp1`〜`3` はCSV上の `damage_type` が `percent_maxhp` だが、`applyHealEffect()`（移植元 `battle-core.js:1417`）は `damage_value` を固定HPとして加算する。GOでは単位を `fixed_hp` に明記して移植し、最大HPで上限を処理する。GOの既存割合回復は `percent_maxhp` を維持する。予測と実行は共通の回復量計算を参照し、CSVの値を読み直すと新しい戦闘に反映される。MHBの0回復予約行、GOに存在しない龍属性の軽減は追加しない。

自動テストでは全9属性・物理・特殊の対象判定、対象外への非適用、期間、固定回復量・回復上限、プレビューと実戦の一致、CSV変更後の反映、既存技に追加定義の参照がないことを確認する。

- 実行時に参照する正式マスタは `data/` 直下のUTF-8 CSV 11表。追加の `passive_type.csv` はパッシブ16種の入力条件と処理対応を管理する。
- 属性マスタは **火 fire、水 water、風 wind、地 earth、光 light、闇 dark、無 none**。指示の7 IDと一致。CSVセルは維持し、日本語表示名とIDの両方をマスタから引いて実行時に正規化する。未定義値・空欄は `null`、明示的な無は `none`。技の第2属性欄の `none` は第2属性なしを表す現行データ表記として扱う。
- 種族は図鑑分類。属性と同様に、マスタの表示名からIDを解決する。
- 相性表の倍率0を有効な数値として保持する。戦闘の倍率計算はv0.20以降。
- 名前の空欄は予約行として扱う。未設定の技は補完しない。
- 保存領域は `gene_order:save:1`～`3`。現在の起動は保存領域にアクセスせず、旧保存画面も起動しない。旧保存形式はGOのゲーム進行の仕様に含めない。
- HTTPで正式CSVを取得する。取得、文字コード、必須列で失敗すると対象ファイルのエラーを表示する。`file:` はHTTPサーバーでの起動を案内する。MHBの埋め込みデータはロードしない。

## 変換と件数

| 正式ファイル | データ行 | 起動時に利用する件数 |
|---|---:|---:|
| character.csv | 64 | 46 |
| passive.csv | 64 | 24 |
| skill.csv | 100 | 65 |
| animation.csv | 30 | 30 |
| effect.csv | 70 | 70 |
| battle_effect.csv | 6 | 6 |
| power_rule.csv | 2 | 2（1グループ） |
| element.csv | 7 | 7 |
| element_effectiveness.csv | 49 | 49（倍率0は4組） |
| species.csv | 10 | 10 |

CP932から厳密にデコードしたキャラ・技と、ワークブックの `passive` シート（数式なし）を含む初期の正式マスタ9表について、ヘッダーから全行・全セルの順序と値が一致。表示用に追加した `animation.csv` は、技からの参照、数値定義、参照PNGシートの寸法までを検証する。正本の変換前ファイルは初期コミット `72ed342d4d31410ede052fb2479faeee9dc898f0` のルートにあり、例えば `git show 72ed342:data/element.csv` で旧10属性版、`git show 72ed342:element.csv` で正式版の変換前ファイルを参照できる。旧10属性表とテンプレートは `data/reference/bf-10-elements/`、MHB由来の敵編成30行は `data/reference/mhb/enemy_party.csv` に保管。

## データ診断

| 診断 | 件数 | 内訳 |
|---|---:|---|
| 参照不一致 | 70 | 通常効果39箇所・23 ID、戦闘効果26箇所・18 ID、威力ルール5箇所・4 ID |
| 効果未対応 | 41 | 現行エンジンが扱えない種別、単位、対象IDなど |
| 効果未設定 | 9 | 名称・説明はあるが効果種別なし |
| 項目未設定 | 22 | 名前付きキャラクターの技枠が全て空欄 |
| 参照先未設定 | 22 | 名前付きキャラクターが、予約行のパッシブを参照 |
| 予約行 | 93 | キャラ18、技35、パッシブ40 |
| 画像欠落 | 1 | `character_064.png`。現画面は代替表示 |
| ID重複・相性不足・相性重複・数値異常 | 0 | 現在の正式データ |

未解決ID一覧

- 通常効果 — `burn`, `clear_buff`, `drain_50`, `heal_en`, `heal_half`, `pa_down1`, `pa_up1`, `pa_up2`, `pd_down1`, `pd_up1`, `sa_down1`, `sa_down4`, `sa_up1`, `sa_up2`, `sd_down1`, `sd_up2`, `sp_down2`, `sp_up1`, `bind`, `どろぼう`, `recoil_25`, `evasion_up`, `clear_field`
- 戦闘効果 — `charge_attack`, `dodge_guard`, `ghost_phase`, `next_fire_power_150`, `protect`, `reflection`, `revenge`, `shed_tail`, `sp_protect`, `switch_after_attack`, `switch_lock`, `water_absorb_guard`, `water_protect`, `water_super_effective`, `みがわり`, `ゆきなだれ`, `バトンタッチ`, `追い風`
- 威力ルール — `en_value`, `hp_exact_1`, `speed_advantage`, `target_status`
- 参照先未設定のパッシブ — `passive_025`～`passive_044`、`passive_047`、`passive_064`

## 検証

- `node --test` 185件成功、失敗0。スクリプト評価順、UTF-8、GOデータ、相性0、プレースホルダー、未解決参照、画像、MHBフォールバック禁止、保存キー隔離、エラー表示を含む回帰を確認。
- Edge実ブラウザでHTTP起動を確認。46体、画像45件、代替1件。旧 `assets/` と `data-inline.js` の取得なし。幅375pxで横スクロールなし。`file:` でHTTP起動案内を確認。

## 仕様確認待ち

- ダメージ式、丸め、複合攻撃、STAB・無効化の順、段階係数、優先度同値、初期ENとEN上限、交代時のリセットや引き継ぎ。
- 回避の発動点と持続、追加効果やパッシブの発動順、毒付与率の資料差。
- 編成における `slot` の意味、GOの正式な敵編成、ゲーム進行と保存形式、旧ストーリー・ショップ・装備・アリーナ等の採否。

## v0.30の参照整合性

上記の70箇所はv0.20までの基準値。v0.30は通常効果30、戦闘効果13、威力ルール1の計44箇所を解消し、26箇所が残る。実行時・診断とも同じ対応表を使う。skill.csv のID、説明、性能値と既存効果量はそのまま。

- 通常効果のID対応（接頭辞 bf_ を付与） — pa_down1、pa_up1、pa_up2、pd_down1、pd_up1、sa_down4、sa_down1、sa_up1、sa_up2、sd_down1、sd_up2、sp_up1、sp_down2、heal_half、drain_50、heal_en。
- 戦闘効果 — dodge_guard → bf_dodge_guard、protect → bf_half_guard。shed_tail、water_absorb_guard、water_super_effective、next_fire_power_150 も対応する bf_ IDへ解決するが処理は未対応。
- 威力ルール — hp_exact_1 → bf_hp_exact_1。実行時に使用する。
- 追加した定義 — bf_pa_up2（PA＋2段階）、bf_sa_up2（SA＋2段階）、bf_sp_down2（SP−2段階）、bf_heal_en（EN＋1）。既存15行を保持し、効果表は19行。

| 分類 | 残件 | 未解決ID |
|---|---:|---|
| 通常効果 | 9 | burn、clear_buff、bind、どろぼう、recoil_25、evasion_up、clear_field |
| 戦闘効果 | 13 | charge_attack、ghost_phase、reflection、revenge、sp_protect、switch_after_attack、switch_lock、water_protect、みがわり、ゆきなだれ、バトンタッチ、追い風 |
| 威力ルール | 4 | en_value、speed_advantage、target_status |

[技の状況](skill-effects.md) はIDの解決可否に加え、エンジン上で全効果が実行できるかを分類している。

## v0.31の参照整合性

v0.30の26箇所から10箇所を解消し、16箇所が残る。技CSVは保持。通常効果にevasion_up・clear_field・bind、戦闘効果にsp_protect・water_protect・追い風・switch_lock、威力表にtarget_statusの真偽2行を追加。sp_protectの翌ターン開始を記録する start_delay 列を加え、既存行は空欄のまま保持。

| 分類 | 残件 | 未解決ID |
|---|---:|---|
| 通常効果 | 4 | burn、clear_buff、どろぼう、recoil_25 |
| 戦闘効果 | 9 | charge_attack、ghost_phase、reflection、revenge、switch_after_attack、みがわり、ゆきなだれ、バトンタッチ |
| 威力ルール | 3 | en_value、speed_advantage |

[技65件の対応状況](skill-effects.md) を参照。火やられのMHB定義は [比較記録](status-and-field-effects.md) に記載。

## v0.32の参照整合性

v0.31の16箇所から9箇所を解消し、7箇所が残る。技・能力・相性の正式マスタは同一。通常効果2行、戦闘効果5行と列 element / modifier、EN威力8行を追加した。性能値の列と単位は [特殊技の移植記録](special-skills.md) を参照。

| 分類 | 残件 | 未解決ID |
|---|---:|---|
| 通常効果 | 2 | burn、どろぼう |
| 戦闘効果 | 3 | switch_after_attack、みがわり、バトンタッチ |
| 威力ルール | 2 | speed_advantage |

## v0.33の参照整合性

7箇所から3箇所を解消し、4箇所が残る。戦闘効果の switch_after_attack、みがわり、バトンタッチを追加し、既存の bf_shed_tail にデコイ列を設定。残件は burn、どろぼう、speed_advantage（2箇所）。[CSV列と単位](switch-and-decoy.md) を参照。

## v0.40のパッシブ診断

正式CSVの既存3枠を使用。64枠中15件実装、9件は説明・名称ありの効果未設定、40件は予約行。診断は実戦と同じ効果レジストリを使用する。CSV応答を差し替える自動テストで初期EN、終了時ランク、威力倍率、無効対象の変更が新規戦闘に反映されることを確認。既知の参照不一致は4箇所。 [CSV列・ID対応](passive-system.md)

## v0.41のパッシブ診断

正式64枠のうち名称設定済み24件が構造化済み。予約40枠は空き枠として維持する。`condition1`～`condition3` に能力補正の分数閾値・状態、技の優先度閾値、被弾分類を格納する。被弾で付与する状態異常は使用可能な `effect.csv` の定義と照合する。既知の参照不一致4箇所と未対応技5件は継続。 [条件列と単位](passive-system.md)

## v0.42 正式9マスタ検証

24パッシブが対応済みで40枠が予約行。必須能力、EN、発生率、持続ターン、威力補正の診断を追加した。既知の参照不一致4箇所を維持。仮想CSV応答で初期EN・終了時ランク・火技倍率の3効果を合成し、倍率変更も検証した。[マスタ別結果](battle-validation.md)

## 技のランク・継続ダメージ・回避率・攻撃参照能力

- effect.csv は70定義で、そのうちランク効果は5能力×12種類。skill.csv の effect1〜3 には、例えば pa_down6 や bf_pd_up3 を指定し、対象と発動率を同じ番号の列に書く。ランクは戦闘中に−6〜＋6へ制限する。
- 継続ダメージは effect.csv に一意の効果IDを作り、effect_group=damage、damage_type=percent_maxhp、damage_value に最大体力に対する百分率、turn に回数を書く。付与ターンの終了時から進み、同じIDでの再付与は期間を更新する。交代封じを伴うものは effect_group=bind を使う。
- 回避率補正は effect_group=evasion、damage_type=multiplier、target_stat=evasion_percent。damage_value が倍率、turn が持続、start_delay が開始までのターン数（0で即時、1で次のターン）。ブロッサムシャインは倍率2・持続1・開始1。
- 攻撃側の能力参照は skill.csv の attack_stat。phy_atk／phy_def／sp_atk／sp_def／speed を指定でき、空欄は技の分類に従う。シェルハードは phy_def。

## 状態異常の追加カラム（2026-11-20）

| カラム | 意味・有効範囲 | 空欄または旧CSVで省略 |
|---|---|---|
| stat_modifier_target | phy_atk / phy_def / sp_atk / sp_def / speed | none（補正なし） |
| stat_modifier_multiplier | 有限の正数。倍率が1以外なら対象が必要 | 1 |
| action_failure_chance | 有限の0〜100。単位は% | 0 |

CSVの列名で読み込み、10カラムの旧形式も受け付ける。数値異常・未知の能力ID・倍率だけ設定して対象なしの組み合わせを診断する。effect_group=status、damage_type=none、damage_value=0、正のturnの行も状態異常として処理し、HPダメージを発生させない。状態異常IDのカタログはeffectKindの分類から生成するため、技・パッシブ・状態条件・AIで同じ分類を使う。複数の行動不能効果が共存する場合は独立した失敗確率の合成（1−各成功確率の積）とし、実行直前に1回だけ抽選する。

テスト用CSVの再読み込みで能力倍率・行動不能確率・継続ダメージ・期間が変わることを検証した。正式effect.csvは作業開始時のSHA-256と一致し、内容は書き換えていない。作業中に外部追加された技と画像も保持する。

## フォルムチェンジ

form.csvを正式マスタへ追加しました。能力プロファイル・画像参照・条件の正本・CSV空欄と0の扱い・へんしん併用は[フォルム仕様](form-system.md)を参照してください。
