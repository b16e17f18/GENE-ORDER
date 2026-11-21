# イベント型パッシブ5タイプ追加

## 基準と重複調査

基準はHP条件付き拡張コミット65624b4212d5d4de66fc7e0512827957cb7016a3。前段の28タイプ拡張fd37b08と攻撃技限定5c2b93bも含む。古いmain（作業開始時5a09158）から開始せず、feature/passive-events-34を作成した。

| 新タイプ | 既存29タイプでの代用 | 再利用した処理 |
|---|---|---|
| on_damage_en_restore | on_hit_element_stat_stageは能力ランクのみ。EN回復を表現できない | applyBodyHitPassives、changeEnergy、共通発動ログ |
| on_ko_stat_stage | on_ko_en_restoreはENのみ | 同じon-koフック、changeStageと上下限 |
| on_switch_out_heal | on_switch_out_stat_stageは交代先の能力変化。本人HP回復ではない | switchFighter、hpEffectAmount、MHBの回復条件と端数処理 |
| on_hit_enemy_stat_stage | on_hit_element_stat_stageは被弾側自身の属性条件付き変化で対象・方向が異なる | applyPassiveStages、changeStage、敵由来低下無効 |
| on_enemy_ko_en_restore | starting_enや通常登場時タイプでは味方戦闘不能との因果を区別できない | 補充交代理由、applyEntryPassive、changeEnergy |

5種とも既存の能力・資源更新や判定は流用できるが、CSVで発動条件と対象を指定する新タイプが必要。GO正式エンジンに旧switch_healは登録されていない。

MHBの[passive.js](https://github.com/b16e17f18/MHB/blob/main/passive.js)のswitchHealPassiveEffect／switchHealPercentFromPassiveと、[app.js](https://github.com/b16e17f18/MHB/blob/main/app.js)のapplySwitchHealPassive／switchActiveを読み取り専用で確認した。GO内に残る同関数とも一致する。MHBはpercent=20で20%だがGOはratio=0.2で20%。そのため旧IDの無変換エイリアスは登録しない。最大HP基準・floor・上限・生存条件を保ち、GO共通hpEffectAmountへ単位変換して通す。旧MHB関数をGOから重ねて呼ばない。

## 正式CSVと設定例

既存13列を保ち5行を追加、既存29行のID・内容を維持。condition1～3は空欄（condition_kind=none）。EN値は0以上の整数、段階値は符号付き整数、回復割合は0～1の実数。段階の実適用は既存±6、ENは既存0～7、HPは最大HPでクランプする。

| passive_type1 | target_id1 | value1 | phase | 意味 |
|---|---|---|---|---|
| on_damage_en_restore | en | 1 | body-hit-energy | 被弾側のEN+1 |
| on_ko_stat_stage | sa | 1 | on-ko | 撃破側のSA+1段階 |
| on_switch_out_heal | hp | 0.2 | normal-switch-heal | 控えに戻る本人を最大HPの20%回復 |
| on_hit_enemy_stat_stage | pd | -1 | hit-enemy-stage | 命中先のPD-1段階 |
| on_enemy_ko_en_restore | en | 2 | replacement-entry | 味方戦闘不能後の登場者EN+2 |

PA/PD/SA/SD/SPはpa/pd/sa/sd/spで設定できる。これらの例を2～3枠目に入れて複合設定も可能。正式passive.csvへサンプルを登録せず、テスト用データだけで検証した。

命名は、無断変更を避けて指定されたon_enemy_ko_en_restoreを採用。処理は相手撃破時ではなく味方戦闘不能後の補充登場のみ。意味が明確なon_ally_ko_entry_en_restoreへの改名と旧IDエイリアス化を提案したが、今回は承認を前提に変更していない。

## 発動タイミングと除外

- 被弾EN回復と敵ランク変化：技の本体実ダメージが確定した後の共通フックに1回だけ接続。従来の被弾ランク変化 → 被弾EN回復 → 攻撃側の敵ランク変化 → 被弾状態異常付与 → 接触反射の順。対象が生存している場合に限る。従来の吸収回復はこのフックより前。敵ランク低下はsourceを攻撃側にして個別／allのdebuff_immunityを適用する。
- 回避・完全軽減・属性無効・デコイだけへのダメージ・継続ダメージ・反射ダメージは上記2タイプの対象外。技の追加効果の確率から独立して発動する。
- 撃破時ランク変化：既存on_ko_en_restoreと同じ直接攻撃KO確定フック。直接本体ダメージあり・相手が今回戦闘不能・攻撃者生存を要求。スロット順で既存EN回復と併用。反射・継続ダメージでは発動しない。
- 交代回復：交代候補検証後、通常交代reason=normalで生存中の本人に実適用。退場状態リセットと交代先登場より前。特殊交代・補充交代には適用しない。floor(最大HP×割合)、HP上限を適用。失敗・待機・キャンセル時は通らない。
- 味方戦闘不能後EN回復：reason=replacementかつ退場者が戦闘不能だった情報を登場処理へ渡す。通常の登場時パッシブ後に適用。同時補充では双方の交代先確定後に登場処理を各1回行う。交代選択待ちの無効入力・再開でも重複しない。
- 実回復・実ランク変化が0の新効果は発動ログと使用回数を増やさない。既存タイプのログ仕様は維持。EN回復は共通パッシブログの実回復量、HP回復は共通healイベントへ出す。既存UI配置は変更しない。

## 予測・乱数・多段

previewDamageとAI評価から発動処理は呼ばない。previewSwitchはHP・EN・ランク・発動回数を複製した個体に対し同じswitchFighterを1回呼び、実戦と同じ交代回復・登場EN回復を予測する。今回、新しい乱数消費を追加していない。

現在のGOは1技の合計ダメージを1回確定する構造であり、独立したヒット回数マスタ／多段ループはない。新効果はその決着後に1回発動する。多段条件は、テスト内メモリ上だけで1技のダメージを3パケットへ分割して本体HPへ適用するハーネスでも確認した。正式戦闘に新しい多段仕様を導入したわけではない。

## GOE

既存のマスタ読込・候補生成・共通正規化が5タイプをそのまま扱う。日本語名と説明、energy／stat／hp別の候補、整数・符号・割合範囲の検証、作成・編集・複製・CSV出力・再読み込みを確認する。GO_Editor.htmlの配置・CSSや列構成を変更する必要はない。

## 検証結果

- 新規戦闘テスト49件：正常・除外条件、各5能力と正負、HP・EN・段階上下限、同時補充、交代待ちの再開、3枠、予測・AI非変更、乱数非消費、CSV効果量変更、別名／カスタムIDでのハンドラー流用、3パケット相当の単回発動。
- GOEのNode追加テスト3件：全5種の候補、値・対象検証、作成／複製相当のデータとCSV往復。
- Edge実操作：5種すべて作成、不正対象の保存拒否、値編集、複製、出力、再読み込みを確認。例外0。
- 全自動テストを仕上げ時に1回実行：447件成功、失敗0（既存395＋今回52）、約42.4秒。
- 既存の再現シード付き多数対戦も含む2,505戦：完走2,403、検証上限200ターン到達102、例外0、不正行動0。内訳は基本ランダム1,024、AI対AI1,024、AI対ランダム256、過去再現9、AI性格別192。上限は検証用であり正式な引き分け条件は変更しない。

再実行：重点はnode --test test/passive-events.test.mjs test/editor.test.mjs。全体はnode --test。EdgeのGOE実操作はGO_PLAYWRIGHT_PATHを指定してnode tools/check-passive-events.cjs。

## 保持・残件

既存の編集中data/passive.csvとcharacter_042.png／character_043.pngを保持し、今回のコミット対象から除外。キャラクター・技・個別パッシブの設定、ダメージ計算式、AI、UI配置、バージョン番号は変更しない。命名改善は任意の確認事項として残す。実装は既存29タイプを含む作業ブランチ上に限定し、mainへマージ・Pushしない。

## 変更ファイル

- 実装・マスタ：passive.js、battle-core.js、data/passive_type.csv。
- 自動テスト：test/passive-events.test.mjs（追加）、test/editor.test.mjs、test/data.test.mjs、test/hp-conditional-passives.test.mjs、test/passive28.test.mjs。
- Edge確認スクリプト：tools/check-passive-events.cjs（追加）、tools/check-hp-passives.cjs、tools/check-passive28.cjs（現行34件へ期待数更新）。
- 記録：README.md、CHANGELOG.md、docs/passive-system.md、本記録。

実装の未解決・テスト失敗なし。命名改善案のみ未採用。MHB・NPBCへは変更を加えていない。
