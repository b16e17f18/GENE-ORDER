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
