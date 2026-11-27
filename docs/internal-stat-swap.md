# 聖界次元と個体内能力入替（2026-11-28）

## 修正内容とCSV設定

聖界次元（skill_116）で必要なのは、自分と相手がそれぞれ自分のPD・SDを入れ替える効果。旧swap_defenses（stat_exchange）は個体間の同一能力コピーとして残し、他の参照を壊さない。

| CSV | 項目 | 値 |
|---|---|---|
| effect.csv | effect_id | swap_defense_stats |
| effect.csv | name / effect_group | 防御入替 / stat_swap |
| effect.csv | target_stat | phy_def\|sp_def |
| effect.csv | damage_type / damage_value / turn | none / 0 / 0 |
| effect.csv | start_text | {target}の物理防御と特殊防御が入れ替わった！ |
| skill.csv（skill_116） | effect1 / effect_target1 / effect_chance1 | swap_defense_stats / enemy / 100 |
| skill.csv（skill_116） | effect2 / effect_target2 / effect_chance2 | swap_defense_stats / self / 100 |

技の属性・EN・優先度などは変更しない。説明文のみ「優先度+1。自分と相手それぞれのPDとSDを入れ替える。」に明確化した。キャラクター・パッシブ・属性相性の正式マスタは変更しない。

## 既存仕様を維持した能力処理

- 技の追加効果開始時点の整数実効値を個体別に保存する。selfは自分の中だけ、enemyは相手の中だけを操作する。
- 173/74→74/173、80/140→140/80。相手の能力値をコピー元にしない。
- 能力ランク・状態異常・パッシブ自体は動かさず、既存の実効値補正格納処理を再利用する。その時点の補正を二重適用しない。
- 交換後の新しい補正には既存のratio方式で追従する。通常の能力計算結果×受け取る値÷適用時の交換補正を除いた実効値を切り捨て、最低1とする。
- 同一技で同じ対象へ複数枠を指定しても、技開始時の同じスナップショットを使うため、二重に反転しない。
- 別ターンの再使用ではその時点の実効値を改めて入れ替える。途中で補正が変わらなければ2回の使用で元の値へ戻る。
- 通常・特殊交代、戦闘不能で個体ごとに解除し、パワーリレーでは継承しない。フィールド効果ではないためclear_fieldでは消えない。
- 既存の変化技無効・位置・確率判定を対象ごとに適用する。enemy枠が防がれてもself枠は独立して発動する。新しい乱数処理は追加しない。

## 共通化とAI・UI・GOE

stat_swapはPA・PD・SA・SD・SPの異なる2能力をtarget_statのパイプ区切りで指定できる。HP、同じ能力、3能力以上、持続ターン付きは拒否する。今回正式に追加するのはPD・SDの1効果だけ。

previewStatAssignmentを旧個体間コピーと共用する。previewStatSwapは個体内の相互参照だけを指定する。実戦とAIの技評価がこの関数を使う。予測によってHP・EN・能力補正・乱数を消費しない。

戦闘イベントはstat-swappedとし、既存のstat-exchangedと区別する。メッセージは「〇〇の物理防御と特殊防御が入れ替わった！」。戦闘詳細は既存の実効値参照を利用する。GOEにstat_swap選択と2能力の検証を追加し、既存CSVの列構成・配置は維持する。

## 検証と作業保全

- 変更前の旧交換・GOE関連81件成功。実装後も同81件成功。
- 新規の個体内入替テストは具体例、個別対象、ランク・状態異常・パッシブ、再使用、同一技重複、確率、通常交代、パワーリレー、戦闘不能、フィールド解除、汎用PA-SA、変化技無効、AI・ダメージ予測を検証。
- Edge 1280px/390pxで正式skill_116、能力詳細、指定ログ、GOE編集・CSV保存・再読込が成功。ブラウザ検証中の基礎能力変更はテスト内メモリだけで、正式CSVに保存しない。
- 作業中にGitHub Desktopによるmainへの切替と自動退避が発生した。stashを削除せず、専用worktree（.cache/node_modules/internal-stat-swap）へ今回の10ファイルだけを復元し、退避時の内容一致を確認した。GIFは今回の変更に含めない。
- 切替中に実行していた全体テストは中断し、結果を採用しない。独立worktreeでの最終全体実行は1,069件成功・0失敗・スキップ0（約511秒）。main基準の1,048件に今回の新規21件を追加した。主要4,505戦は完走4,252・検証上限253・例外0・不正行動0。検証上限はテスト専用であり正式な引き分け条件にしない。

ログ・画像: .cache/internal-swap-*、.cache/internal-stat-swap/。作業ブランチはfix/seikai-internal-defense-swap。mainへ自動統合しない。

関連テスト: node --test test/internal-stat-swap.test.mjs test/stat-exchange.test.mjs test/editor.test.mjs。画面確認: GO_PLAYWRIGHT_PATHを設定しnode tools/check-internal-swap.cjs。

基準コミットは7fdd26b。回避ログ・先発指定・AI待機禁止のfeature/battle-logs-lead-ai-actionsは今回の基準mainに未統合であり、この修正で取り込み・破棄は行わない。
