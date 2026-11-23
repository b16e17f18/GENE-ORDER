# 条件付き技優先度パッシブ

## 基準と既存機能

GitHub最新mainは0c8349f。既存の未確認生物・画像表示とユーザー編集中のCSV／Excelを保持し、feature/conditional-priorityで作業する。元のGO正式orderActionsは技のpriorityを直接参照し、AIのmoveRiskも基礎優先度を比較していた。MHB由来のstatus_move_priority_upは参照層に残るが、正式GOに専用タイプとしては接続されていない。土俵際（passive_030）は名称のみで専用処理はない。

## 正式マスタ

既存13列のpassive_type.csvにconditional_priority_modifierを追加し、全36タイプ。handlerは同名、phase=move-priority、target_kind=move_category、value_type=integer（正負・0可）、condition_kind=priority_condition。個別passive.csvやキャラクターには新規割り当てを行わない。既存のUMA設定は保持する。

対象target_idはall／status／attack／physical／special。技分類と攻撃分類を確認する共通の判定Mapを使い、将来の分類はこのMapと検証を拡張できる。healing・defensive・power_lte:60など未対応の対象は今はエラーにする。通常交代・待機は対象外。共通回避はCSVにある変化技なのでall／statusの対象になる。

倍率ではなく整数の加算：最終優先度=基礎優先度+一致する全スロットのvalue合計。技のCSVや共有moveオブジェクトは変更しない。上昇・下降・0を保持する。

## 条件と複合条件

| condition | 意味 |
|---|---|
| 空欄 | 無条件 |
| self_hp_lte:1/2 | 判定時にHP半分以下 |
| self_hp_lte:1/3 | 判定時にHP1/3以下 |
| self_hp_eq:1/1 | 判定時に満タン |
| status | 自分が状態異常 |
| first_move_after_entry | 登場後、まだ技を一度も使っていない |
| once_per_battle | この効果スロットをこの戦闘で未使用 |
| self_hp_reached_lte:1/2 | この戦闘で一度でもHP半分以下になった（回復後も保持） |

既存statConditionとconditionMatchesのHP比率・以下／一致・状態異常の解析を再利用する。既存のopponent_hp_lte／eqも同形式で使用可能。新しいHP履歴条件はself_hp_reached_lte:N/Dとして任意の有効な比率を扱う。数値は整数の交差積で比較する。

複数条件は&でAND結合し、既存の単一条件文字列はそのまま使える。空の要素、不明な条件、重複した同じ条件、分母0、範囲外の比率、未対応のORは検証エラー。既存の他パッシブの条件構文は変更しない。

CSV設定例（全てconditional_priority_modifier、個別IDへの登録はしない）：

| 例 | target_id | value | condition |
|---|---|---|---|
| いたずらごころ | status | 1 | 空欄 |
| 高速詠唱 | special | 1 | 空欄 |
| 起死回生 | attack | 1 | self_hp_lte:1/3 |
| 奇襲 | attack | 1 | first_move_after_entry |
| 土俵際 | all | 1 | self_hp_reached_lte:1/2&once_per_battle |

ユーザー確認済み：奇襲は対象外の技でも最初に使った時点で権利を失う。待機・通常交代・不成立は技の使用ではない。土俵際は一度HP半分以下になれば、回復しても権利を保ち、次の対象技の実行時に一度だけ使用する。通常のself_hp_lteと区別するため到達履歴用の条件を新設した。

## 状態・処理順序

passiveStateのuses Mapは既存のスロット別発動履歴を再利用。once_per_battleは交代しても保持し、新しい戦闘で初期化する。登場後の技使用数entryMovesは、成立した技ごとに増やし、通常・特殊・補充を問わず登場時に0へ戻す。対象外技も増える。

HP到達履歴は最低HP比のhp／maxHpの組を個体に保持し、交代しても維持する。行動開始前の現在HP、直接・継続・反射・反動・パッシブHP費用を通るapplyHPDamage、デコイ費用で更新する。自然回復や即時回復の前に低HPを記録し、現在HPや基礎HPを履歴のために書き換えない。

orderActionsで補正後優先度と一致効果リストを確定する。ターン途中でHPが変わってもその行動の予定値は変えない。通常のSP比較・同速乱数・交代優先度6は維持。プラスが十分大きい技が交代に並ぶ／先行する場合も通常の比較規則に従う。

実行時は睡眠・麻痺・EN不足・戦闘不能・回復封印・技不成立・相手不在などを通過し、HP費用でも戦闘不能にならなかった時だけ、記録済み効果を消費・ログ化する。回避・相性無効・パッシブ無効・デコイで結果が0でも、技が実行されれば使用成立。交代先選択待ちや無効入力では消費せず、正しく再開して使用成立した時だけ消費する。

溜め開始は使用成立なので初回／1回の効果を消費する。解放時にはそのターンの状態で優先度を計算し、消費済み効果は二重適用しない。開始時に条件未成立で解放時に成立した別の未使用効果は適用できる。

無鉄砲の優先度に応じたHP費用も、この行動の補正後優先度を参照する。新タイプがなければ従来の値と一致する。HP費用による条件変化は能力・ダメージ側では従来どおり反映するが、確定済みの行動順を変えない。

## 予測・AI・UI

effectivePriority／priorityDetailsを共通化し、previewDamage.priority、AIの先行リスクと撃破評価、実戦イベントが同じ値を参照する。AIは公開された相手候補技の補正後優先度も考慮し、未公開の選択行動を参照しない。

copyStateでuses Map・最低HP比・登場使用数を複製し、AI観測、交代予測、溜め解放予測、UI再生フレームで元の履歴を共有・変更しない。解放予測は開始時の使用成立とHP費用をコピー上で反映する。新しい乱数は使わない。

GOEは5分類・条件候補・自由入力の複合条件を扱い、正負整数・0、空欄、CSV往復を保持する。既存画面配置は変更しない。技の優先度をカードに常時表示する改修は行わず、パッシブ発動ログに実際の補正値とその行動の最終優先度を示す。

## 検証

新規優先度テスト76件、GOE追加3件。対象分類15組、正負と0、既存優先度への加算、HP境界・状態異常・AND・履歴、対象外技の初回終了、交代と個体別履歴、未実行時非消費、回避／無効時消費、通常SP比較と同速乱数、溜め、HP費用・継続回復、交代待ち、3対戦モード、AI撃破リスク、予測とUIの状態非変更、入力異常を確認。

関連250件が成功し、その後のAI追加2件も成功。EdgeのPC1280px・スマートフォン相当390pxで5分類、HP到達履歴と1回の複合条件、負数・0・空欄の保存／CSV出力／再読込、不正値拒否を確認した。全体テストは最後に1回実行し、710件成功・失敗0（既存の未確認生物を含む631＋今回79）、約54.5秒。

ユーザー編集中CSVを保護するため、全体回帰は最新mainから作成した独立作業場に未確認生物と今回実装のみを反映して実行する。主作業場でも新規優先度76件は成功。個別パッシブ・キャラクター・技・効果のユーザー編集は変更しない。

## 未対応と変更ファイル

OR条件、healing／defensive／power_lte対象は未対応として検証エラーにする。個別パッシブの新規設定や土俵際への割り当ては行わない。新規CSV列、SP・ランク・通常ダメージ式、性能値、画像・レイアウト、バージョン番号は変更しない。

今回の実装：passive.js、battle-core.js、battle-ai.js、go-ui.js、app.js、GO_Editor.html、data/passive_type.csv。テスト：test/priority.test.mjs（追加）、test/editor.test.mjs、既存カタログ件数の期待値を36へ更新したtest/data.test.mjs・test/passive28.test.mjs・test/passive-events.test.mjs・test/hp-conditional-passives.test.mjs・test/adaptive-passive.test.mjs。確認ツール：tools/check-priority.cjs（追加）、既存の4パッシブ確認スクリプト（件数更新）。記録：README.md、CHANGELOG.md、docs/battle-system.md、docs/passive-system.md、本記録。

コミット・Pushは行っていない。個別passive.csvの未確認生物は前タスクの変更として保持し、今回は編集していない。

シード対戦2505戦：完走2437、検証上限到達68、例外0、不正行動0。検証上限は正式ルールへ追加していない。

実装・テストの未解決なし。新タイプは個別の予約IDやキャラクターに割り当てていない。ユーザー編集済みのcharacter.csv・skill.csv・effect.csvは開始時ハッシュを維持し、変更していない。能力値Excelにも書き込んでいない。
