# v0.50 敵AI移植計画

GOに残る `battle-ai.js` は調査したMHBの原本とSHA-256が一致した。v0.42では読み取りのみ。新しいAIはGOの公開戦闘状態を入力とし、選択済みのプレイヤー行動や交代先、乱数の次の値を受け取らない。両者の選択は独立に確定し、戦闘エンジンが順番を解決する。

| 対象 | MHBの処理と再利用範囲 | GOへの接続 |
|---|---|---|
| 行動傾向 | `ENEMY_AI_TYPE_CONFIGS` 51行、`enemyAiTypeFor` 279行。balanced、aggressive、patient、defensive、disruptor、tactical の重みの考え方を流用 | `ai_type` 空欄はbalanced。初期は係数の移植を優先し、勝率調整は後工程。 `ai_setup_skill` / `ai_main_skill` は任意 |
| 候補列挙 | `chooseEnemyBattleAction` 103行、`applyEnemySkillPreference` 594行の候補順位とセットアップ・主力の考え方 | `moveAvailability()` と `checkAction()` で手持ち技、共通回避、待機、交代を検証。予約中は予約技を優先。未完成技は除外 |
| ダメージ・KO | `scoreEnemyUsableMove` 292行のKO・EN重みを流用。MHBの `estimateMoveDamage` 呼び出しを交換 | `previewDamage()` の実HP減少、残HP、返却ダメージ、リバイブ、デコイ、HP費用を使う。 `effectiveStat()` / `effectiveSpeed()` で先後を扱う。乱数は同速・確率効果などの公開分布のみ。仮定した回避等でシナリオを分け、単一予測をKO確率と同一視しない |
| 支援・待機 | `scoreEnemyHealingMove` 638行、`scoreEnemySelfBuffMove` 661行、`scoreEnemyProtectMove` 693行、`scoreEnemyTargetStatusMove` 732行、`scoreEnemySaveEnergy` 786行の優先づけ | 回復は残HPとCSV、ランクは±6、毒と締め付けは残りターン、回避は使用時判定・回避不可を別々に評価。EN回復は現行GOのターン終了規則を使う |
| 溜め・デコイ | `scoreEnemyTwoTurnMove` 326行の遅延リスクを流用。MHBの専用遅延技経路はGOの現在の対象外 | 開始・解放の威力予約、再消費なし、反動や途中KOの危険を区別。デコイの作成費用、耐久、継承、回数を扱う評価を追加 |
| 通常・特殊交代 | `scoreEnemySwitchCandidate` 521行の攻守・残HPの考え方を流用 | `switchTargets()` と `checkAction()` で候補を得る。仮の対面は元の戦闘を変更せず、GOの交代、羽音、リレー、デコイのルールで評価。交代待ちは候補の公開後に選択し `continueSwitch()` へ |
| 乱数と再現 | `pickEnemyAiCandidate` 861行の近いスコアの選択 | 戦闘用と区別した注入可能な選択用乱数に変更。予測中はどちらも消費しない |

実装順は、公開状態と候補収集の接続→GO予測への置換→支援・待機・交代→タイプ別重み→シード付き回帰。完了判定は違法行動なし、予測による状態・乱数の変更なし、プレイヤー選択を変えても同じ公開状態・同じシードならAI出力が同じ、リバイブ等を加味したKO判定、予約・手動交代への復帰。MHB固有の旧属性・ダメージ乱数・百分率能力・低ランク戦の交代制限・進行依存の待機可否はGO向けの前提に置き換える。

## v0.50 実装

`geneOrderAI.observe()` は自分側の編成と現在の対面を切り出す。デフォルトの相手技は解決済みイベントの記録と公開された予約技に限る。 `revealFixedMoves` は図鑑で固定技が公開される場合の設定。相手の控えや選択アクション、戦闘用乱数、ターン再開用の内部状態は入力に含めない。自分側の全個体と公開中のHP・EN、属性、能力、ランク、パッシブ、状態異常・防御・場・デコイを評価する。現在の対面が同じなら、未公開の相手技や控えを変更しても同じシードで同じ判断になる。

`evaluate()` は乱数を使わず採点する。 `choose()` は高い確度のKO候補を優先し、その他はMHBの近い評価値から重み付きで選ぶ。戦闘用とは独立した選択乱数を注入できる。確度は既知の行動候補と未知の脅威を見積もる評価値。実測されたKO確率ではない。現在の盤面からのHP予測と、相手が防御・回避・交代する可能性は分けて扱う。未知技は脅威の係数で評価し、個別の未公開技や交代先は推定入力にしない。

| MHBから再利用 | GO向けの接続 |
|---|---|
| `ENEMY_AI_CONFIG`、`ENEMY_AI_TYPE_CONFIGS`、タイプ解決と補正係数 | 正式な技・効果値はCSV。GO固有の評価係数は `geneOrderAI` 内の共通設定 |
| `applyEnemySkillPreference()`、`compareEnemyKnockoutMoves()`、`pickEnemyAiCandidate()` | 使用可能な習得技に優先設定を適用。GOの予測結果でKO候補を分け、選択乱数を注入 |
| `scoreEnemyUsableMove()`、`scoreEnemyTwoTurnMove()` のダメージ・消費・遅延の考え方 | `checkAction()`、`moveAvailability()`、`previewDamage()`、`previewRelease()`、`effectiveSpeed()`。本体、デコイ、反射・反撃、貯水、反動、HP費用と予約威力を評価 |
| 回復・支援・能力変化・状態異常の評価方式 | 効果単位で採点。ランク上限は `stageDelta()`、毒・締め付けは `residualDamage()`、回復は共通予測。防御の属性・分類、回避率、パッシブの対象と重複を確認 |
| `scoreEnemySaveEnergy()`、`scoreEnemySwitchCandidate()` の概念と重み | `wait` で次ターンのENと技の価値を見積もる。 `previewSwitch()` で交代後の能力、デコイ、羽音を仮適用し、 `switchTargets()` と `continueSwitch()` で合法な候補だけを処理 |

通常交代の評価には退場で失う能力変化・デコイ、交代後の対面、直前にも交代した場合のコストを含める。特殊交代はテールパージの費用・耐久と回数、リレーの正負ランクとデコイ、燕返しの本体・デコイ命中と使用者生存をGOの判定に合わせる。溜め開始は将来価値に割り引き、解放は予約技だけを候補にする。防御・回避は現在見えている危険と行動順から採点する。公開技が少ないときは仮の脅威を使うため、回避不可や攻撃の有無を確定できない。

`character.csv` の `ai_type` は `balanced`、`aggressive`、`patient`、`defensive`、`disruptor`、`tactical`。空欄・未知の型は `balanced`。未知の型と未習得の指定技は診断される。 `ai_setup_skill` / `ai_main_skill` は任意の習得技ID。使用不能な指定は通常採点に戻る。正式な46体のAI設定は変更していない。

各タイプの係数はMHBから引き継いだ。aggressiveは攻撃と主力技を重く、patientはEN温存と準備を重く、defensiveは回復・防御を重く、disruptorは状態異常・弱体化を重く、tacticalは準備・主力・交代を重く見る。balancedは基準の係数を使う。対戦での選択割合は相手と編成にも依存する。

デバッグ画面は手動対手動・手動対AI・AI対AIに対応。AI対AIもボタンで1ターンずつ進む。候補と評価値はターン解決後に表示する。暫定の係数や公開範囲は [未確定仕様](pending-decisions.md) を参照。
