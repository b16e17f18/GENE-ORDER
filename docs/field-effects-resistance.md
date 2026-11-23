# フィールド効果・属性耐性低下（2026-11-23）

## 定義と保存先

陣営フィールドは battle.fields.player/enemy、共通フィールドは battle.fields.shared の単一Map、個体の耐性低下は fighter.timedEffects に保存する。旧MHBエンジンは変更しない。正式な既存技・キャラクター・個別パッシブ・相性表の値は変更していない。当初の実装ブランチは feature/field-effects-resistance。後続の共通フィールド・登場時パッシブは [登場時フィールド仕様](entry-field-effects.md) を参照。

### battle_effect.csv の追加定義

| ID | 名称 | battle_effect_group | element / modifier | damage_type / damage_value | turn | field_target |
|---|---|---|---|---|---|---|
| field_sanctuary | 聖域 | field_element_power | light / 1.3 | none / 0 | 3 | both |
| field_abyss | 深淵 | field_element_power | dark / 1.3 | none / 0 | 3 | both |
| field_spreading_fire | 延焼 | field_periodic_damage | 空欄 | percent_maxhp / 10 | 3 | enemy |

新設列は field_target、breakthrough_element、breakthrough_multiplier、field_clearable。聖域・深淵は earth / 1 / TRUE、延焼は突破列空欄 / TRUE。延焼の10%・3ターンは動作する暫定初期値で、バランスの確定値ではない。延焼以外の継続ダメージフィールドは追加していない。

追い風と既存の陣営防御フィールドにも self / TRUE を明記した。旧CSVで省略した場合も従来どおりself・解除可能として扱う。field_targetを技のtargetから推定しない。技のbattle_effect1/2から参照して設置できる。芭蕉扇以外の既存技への割り当ては行っていない（芭蕉扇のCSV自体も変更不要）。

### effect.csv の追加定義

共通グループ element_resistance_down。IDは element_resistance_down_fire / water / thunder / ice / wind / earth / light / dark / none の9件（各接尾辞に同じ接頭辞を付ける）。

設定例：

~~~csv
effect_id,name,effect_group,damage_type,damage_value,turn,can_move,target_stat,element,zero_multiplier,max_multiplier
element_resistance_down_light,光属性耐性低下,element_resistance_down,multiplier,2,3,TRUE,element_resistance,light,0.5,4
~~~

実ファイルでは従来13列を保ち、element、zero_multiplier、max_multiplierを末尾に追加した。damage_valueは非0相性の乗数、zero_multiplierは0相性の置換値、max_multiplierは最終上限。持続3ターンは編集可能な初期設定。noneは正式な無属性IDとして有効。技のeffect1～3、effect_target1～3、effect_chance1～3を既存どおり使用する。

## 共通ルール・順序

- フィールドは陣営ごとに独立。交代・補充でも残る。同一IDの再付与は残り期間をCSVの期間へ更新し、効果量は加算しない。既存Map方式を維持し、異なる防御・強化・継続ダメージフィールドは共存する。
- 期間は既存追い風と同じ。ターンTでturn=3、start_delay=0ならT～T+2に有効、T+2の終了処理後に削除。延焼は付与ターンを含め3回。start_delayも従来どおり使用可能。
- 耐性低下は同じ属性の別IDも含め上書きし、異なる属性は共存。通常・特殊交代で解除、パワーリレー対象外。状態異常とは別枠。ターン期限は共通タイマーで管理する。
- 毒などの個体状態異常→締め付け→その陣営の継続ダメージフィールド→双方の戦闘不能・勝敗判定→フィールド期限→既存の終了時パッシブ・HP自然回復・EN回復・補充の順。元の終了処理へフィールド分だけ追加した。継続ダメージは最大HP割合を四捨五入・最低1、実際の減少は残HPまで。控え・戦闘不能個体には適用しない。状態異常ダメージ無効パッシブはフィールドダメージを無効化しない。

## 威力・相性計算

1. 各攻撃属性×各防御属性の通常相性を読む。未定義はエラーを維持する。
2. 攻撃側の対応フィールドが有効なら、対応攻撃属性→breakthrough_elementの0だけをbreakthrough_multiplierへ置換。他の組み合わせやパッシブ無効を変更しない。
3. その攻撃属性について防御側の複数属性の倍率を乗算。
4. その攻撃属性の耐性低下があれば、0をzero_multiplierへ、非0をdamage_value倍へ変更しmax_multiplierで制限。
5. 複合属性技は従来の「0を除外して乗算・全0は0」を適用。今回の耐性低下が該当する場合は合成後にもCSV上限4を適用する。無関係な属性の耐性低下は上限にも影響しない。

例：光→地は通常0、聖域中1、さらに光耐性低下で2。光・風→地は通常2（風→地=2）、聖域のみでも2、光耐性低下を併用すると4。地・光の複合Geneに光を当てる場合、聖域で地の0だけを1へ変え、光の0.5を保持する。

威力は既存の可変威力・条件補正・属性別次回強化・パッシブとともにフィールド倍率を乗算し、既存の威力丸め・power_capを最後に適用する。最終ダメージを1.3倍する方式ではない。STAB1.25、軽減、能力ランク、ダメージ丸め・最低ダメージは変更していない。溜め開始時の威力確定には1回だけ含め、解放時に二重適用しない。相性や相手の耐性低下は実行時の場を参照する。

moveWeaknessMultiplierに明示的なcontextを追加し、calculateDamage / previewDamage / AI / 技詳細の倍率表示で共有。Mapのiteratorは一度配列へ展開し、複合属性の第2属性でも同じフィールド・耐性低下を参照する。予測はHP・EN・タイマー・乱数を変更しない。

## 芭蕉扇

clear_fieldは対象陣営のfield_clearableがTRUE（省略もTRUE）のフィールドを共通に削除し、解除名をログへ出す。個別IDの列挙はしない。相手側の追い風・延焼・既存の防御フィールドと、共通の聖域・深淵・同グループの将来定義が対象。FALSEのフィールドは残す。個体の耐性低下・状態異常・能力ランク・デコイ・パッシブ、自分側の既存フィールドを消さない。その後の自分側追い風3ターン・SP1.5は従来どおり。

## GOE・UI・AI

- GOEのbattle_effectを参照専用から既存の編集フォームへ追加。新規作成・複製・編集・CSV出力・再読み込みに対応。旧列だけのファイルも読める。effectの新規列と9定義を技の選択候補に反映。属性ID、数値、期間、設置先、解除フラグを検証する。
- 戦闘詳細の既存効果チップに両陣営のフィールド名と残りターン、個体の耐性低下名・属性・残りターンを表示。既存のログで付与・継続ダメージ・解除・期限終了を表示する。レイアウトとCSSは変更していない。
- AIは共通ダメージ予測で聖域・深淵と耐性低下を評価。延焼は継続ダメージと残り期間を評価し、終了時回復予測・交代評価にも反映。相手の有利なフィールド解除は加点、相手を傷つけるフィールドの解除は減点。未公開行動の参照を増やしていない。将来行動や再付与の長期戦略まで完全探索は行わない。

## 検証

新規テスト：test/field-effects.test.mjs 51件、test/editor.test.mjs 追加5件。9属性、複合属性、物理/特殊、期間・再付与、個体/陣営、パワーリレー、デコイ、無効・回避、CSV倍率変更、予測の無副作用と乱数非消費を含む。

Edge: tools/check-fields.cjsをGO_PLAYWRIGHT_PATH指定で実行。1280pxと390pxでGOEの新規/複製/編集/CSV再入出力、技の参照候補、実戦の設置先・延焼HP/ログ・両側詳細・残りターン・相性表示を確認。画像は.cache/field-validationに保存（Git対象外）。

全テスト初回764件中748成功・16失敗。16件とも作業開始HEAD=9e515caのコード/CSVでも再現した。別途先行検査で判明した状態異常5件も同様。旧毒10%/5ターン・火/氷5%と現在のCSV（毒15%/7ターン・火/氷10%/5ターン）、名称変更の固定期待値が主因。性能値を変更せず、該当テストを現行CSVの値・名称を用いる検証へ修正した。テスト用CSVの変更も文字列丸ごとの置換から列指定へ修正した。テスト削除や失敗無視は行っていない。

手動同士・プレイヤー対AI・AI対AIはシード1～12を各モードで実行し36/36完走、例外0、上限到達0。既存の正式CSVによる多数対戦の集計は最終ログ参照。検証用上限は正式な引き分け条件に追加していない。

## 残課題

延焼の割合/期間、耐性低下の期間はCSVで調整できる初期値であり、バランス調整は未実施。新しい効果は既存技へ割り当てていないため、本採用する技の指定は別途必要。新規技を自動生成していない。

## 最終結果

- 全自動テスト：766件成功、失敗0、スキップ0（約43秒）。初回失敗の調査と修正後、新たな複合属性iterator検証2件も加えて最終一式を実行した。
- 追加テストは合計56件（フィールド/耐性低下51、GOE5）。既存テストを削除していない。
- 既存正式CSVによる対戦：2,505戦、2,440戦完了、例外0、検証上限65戦。内訳はランダム1,024戦中1,019完了/5上限、AI対AI1,024戦中970完了/54上限、AI対ランダム256戦中252完了/4上限、旧再現9戦中8完了/1上限、AI性格192戦中191完了/1上限。AIの不正行動は0。検証上限はゲーム上の引き分けではない。
- 新効果を設定した検証用編成：手動対手動12戦、プレイヤー対AI12戦、AI対AI12戦、計36戦全完了。既存対戦と合わせ2,541戦、例外0。
- Edge：1280px/390pxそれぞれでGOEと戦闘UIの4シナリオ成功。headless Edge使用。390pxの画面キャプチャも目視確認済み。
- effect.csvの既存83行とbattle_effect.csvの既存37行について、元のすべての列の値が変更前と一致。追加後は92行/40行。character.csv、skill.csv、passive.csvは開始時とバイト一致、element.csv、element_effectiveness.csv、passive_type.csvにGit差分なし。
- コミット・push・mainへの統合・バージョン変更は行っていない。

### 変更ファイル

実装：battle-core.js、battle-ai.js、app.js、data-validation.js、go-ui.js、GO_Editor.html。
CSV：data/battle_effect.csv、data/effect.csv。
テスト：test/field-effects.test.mjs（新規）、test/editor.test.mjs、test/battle.test.mjs、test/data.test.mjs、test/status.test.mjs、test/passive28.test.mjs、tools/check-fields.cjs（新規）。
記録：README.md、CHANGELOG.md、docs/battle-system.md、本書（新規）。

## マージ前の再確認・技への登録例（2026-11-23）

検証開始HEADは1855d65。最新origin/main=0c8349fはこのブランチの祖先で、未取得のmain変更はない。今回の確認では正式CSVや既存技への割り当てを変更していない。以下は設定する場合の例であり、新規技の正式登録ではない。

### 正式な定義

| 効果 | 正式ID | 定義ファイル | 対象 | 持続 | 性能値 |
|---|---|---|---|---|---|
| 聖域 | field_sanctuary | battle_effect.csv | 戦場共通 field_target=both | 3ターン | light威力modifier=1.3、light→earthの0をbreakthrough_multiplier=1へ |
| 深淵 | field_abyss | battle_effect.csv | 戦場共通 field_target=both | 3ターン | dark威力modifier=1.3、dark→earthの0を1へ |
| 延焼 | field_spreading_fire | battle_effect.csv | 敵陣 field_target=enemy | 3ターン | percent_maxhp、damage_value=10（暫定） |
| 火耐性DOWN | element_resistance_down_fire | effect.csv | 技のeffect_targetで個体を指定 | 3ターン | 非0相性×2、0→0.5、上限4 |
| 水耐性DOWN | element_resistance_down_water | effect.csv | 同上 | 3ターン | 同上 |
| 雷耐性DOWN | element_resistance_down_thunder | effect.csv | 同上 | 3ターン | 同上 |
| 氷耐性DOWN | element_resistance_down_ice | effect.csv | 同上 | 3ターン | 同上 |
| 風耐性DOWN | element_resistance_down_wind | effect.csv | 同上 | 3ターン | 同上 |
| 地耐性DOWN | element_resistance_down_earth | effect.csv | 同上 | 3ターン | 同上 |
| 光耐性DOWN | element_resistance_down_light | effect.csv | 同上 | 3ターン | 同上 |
| 闇耐性DOWN | element_resistance_down_dark | effect.csv | 同上 | 3ターン | 同上 |
| 無耐性DOWN | element_resistance_down_none | effect.csv | 同上 | 3ターン | 同上。noneは有効な属性ID |

耐性DOWNの倍率はdamage_value=2、zero_multiplier=0.5、max_multiplier=4。各持続は定義側turnで変更可能。技CSVにturnを追加する必要はない。

### skill.csv の具体例

| 設定例 | category | attack_type | power | target | battle_effect1 | battle_effect_chance1 | effect1 | effect_target1 | effect_chance1 |
|---|---|---|---|---|---|---|---|---|---|
| 聖域を張る変化技 | status | none | 0 | self | field_sanctuary | 100 | none | enemy | 0 |
| 深淵を張る変化技 | status | none | 0 | self | field_abyss | 100 | none | enemy | 0 |
| 延焼を敵陣へ設置 | status | none | 0 | enemy | field_spreading_fire | 100 | none | enemy | 0 |
| 光耐性を下げる変化技 | status | none | 0 | enemy | none | 0 | element_resistance_down_light | enemy | 100 |
| 攻撃の追加効果で水耐性低下 | attack | physical または special | 既存の技威力 | enemy | none | 0 | element_resistance_down_water | enemy | 100（任意に変更可能） |

battle_effect2 / battle_effect_chance2も利用可能。通常効果はeffect2/3・effect_target2/3・effect_chance2/3も利用可能。未使用枠はnone、発動率0。技自身のelement/element2は別に設定し、耐性DOWNの対象属性はeffect.csvのelementで決まる。技の消費ENや優先度は任意の既存設定を維持する。

battle_effect_target列は存在しない。フィールドの設置先はbattle_effect.csvのfield_targetが正本で、skill.csvのtargetに左右されない。たとえば芭蕉扇のtarget=enemyでも追い風は自陣へ付与される。聖域＋延焼を1技に設定する場合はbattle_effect1=field_sanctuary、battle_effect2=field_spreading_fire、両確率100として、共通フィールドと敵陣フィールドへ設置できる。

### 発見した問題と修正

1. GOEのeffect/battle_effectのelement候補が日本語名になっており、正式IDを要求するエンジンと一致していなかった。これら2種類の定義だけ候補の値を正式IDへ変更し、日本語名はラベルに残した。none候補の「無」ラベルを上書きしないようにした。skill/characterの日本語属性選択は維持。ID専用欄へ日本語名を入力すると検証エラーになる。
2. 睡眠テストがGit管理外のMBHdata/effect.csvへ依存していた。別PR #2の修正と同じ比較用fixtureを採用し、test/sleep.test.mjsの参照先を変更した。状態異常の仕様や正式CSVを変更していない。

### GUIと実戦の往復確認

Edge1280px/390pxで上表の5例をGOEの新規・複製で登録、skill.csvへ出力し、再読み込み後のID・対象・発動率を検証。その出力CSVをnormalizeSkill→createBattleへ渡し、3フィールドと個体耐性DOWNが実際に付与されることを確認した。正式skill.csvは書き換えていない。

属性定義候補は日本語ラベル付きIDで保存され、9属性の耐性DOWNはeffect1～3に設定できる。フィールドと耐性DOWNの数値編集・保存・再読み込み、戦闘詳細と残りターン・ログも成功。

複合属性の計算順序は上記を維持。光・風→地は通常2倍、聖域のみでも2倍、聖域＋光耐性DOWNで4倍。光→地は0→聖域で1→耐性DOWNで2。属性無効パッシブは突破しない。光/闇×物理/特殊×複合防御を追加検証し、AI・プレビュー・実戦の威力/ダメージ一致と予測の無副作用を確認した。

陣営フィールドは交代後も残り、個体の耐性DOWNは交代で消えてパワーリレーで渡さない。芭蕉扇は相手側と共通領域の解除可能フィールドを消し、個体効果や自陣のフィールドは残す。追い風の自陣付与を維持。

### 再確認の最終結果

全自動テスト775件成功、失敗0、スキップ0（約55秒）。関連227件も成功。Edgeは1280px/390px各3シナリオ、合計6シナリオ成功。正式データの多数対戦2505戦：完走2440、例外0、検証上限65。新効果3モード36戦は36完走、例外0。今回の追加修正はGOEとテスト/検証記録のみで、戦闘エンジン・AI・正式CSVには差分なし。

対象ブランチはmainより先行する3コミットに、画像中心線制約・UMA・優先度変更・ユーザーCSV編集も含む。フィールド以外の既存変更を失わないよう、そのまま保持して確認した。mainへのマージは実行していない。今回の最終確認修正はローカルのみで、コミット・pushは実行していない。GitHubでマージする際にはこの修正を対象ブランチへ反映する必要がある。
