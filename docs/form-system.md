# 戦闘中のフォルムチェンジ

## 正式データと参照元

form.csvはUTF-8の正式マスタ。18列を維持する。

`form_id,character_id,name,trigger_type,trigger_value,hp,pa,pd,sa,sd,sp,regen_value,evasion_percent,cost_charge,image_id,hp_change_mode,once_per_battle,persist_on_switch`

| 列 | 役割 |
|---|---|
| form_id / character_id / name | フォルムID・元のキャラクターID・表示名 |
| trigger_type | passive：パッシブによる能力変化、element_change：現在の第1属性による画像選択 |
| trigger_value | element_changeの場合のみ属性ID（noneも正式な値）。passiveでは空欄 |
| hp / pa / pd / sa / sd / sp | 基礎能力の上書き。空欄は元キャラクターから継承 |
| regen_value / evasion_percent / cost_charge | 回復力・回避率・EN自然回復量。0は有効な設定で空欄と区別 |
| image_id | asset/character/以下の画像ファイル名。既存のパス解決と透過・サイズ指定を使用 |
| hp_change_mode | add_max_hp_difference：最大HP差分を現在HPへ加算、preserve_current_hpまたは空欄：現在HPを維持して上限補正 |
| once_per_battle / persist_on_switch | 戦闘中1回制限・交代時維持（TRUE/FALSE、空欄はFALSE） |

HP・PA～SPに0は設定不可として診断し、回復力・回避率・EN回復の0は保持する。属性連動フォームは能力欄を空欄とし、画像だけを変更する。

添付案のcopen_trueのtrigger_type=hp_threshold / trigger_value=50を、passive / 空欄へ変更した。HP条件はpassive.csvのcondition2だけで管理する。GOEのフォルム画面から条件を編集すると、紐づくpassive.csvのcondition列を更新する。条件変更の保存にはpassive.csvも出力する。

## 登録内容

- copen_true：コペンの真の姿。HP229、PA143、PD88、SA88、SD138、SP89、回復力25、回避率50、EN回復2。最大HP差分加算・1戦闘1回・交代維持。
- quantum_none / quantum_fire / quantum_water / quantum_thunder / quantum_ice / quantum_wind / quantum_earth / quantum_light / quantum_dark：クアンタムの9属性画像。能力欄は全て空欄。
- passive_typeにform_changeを追加（計39タイプ）。phase=hp-change、target_kind=form、value=1、condition_kind=stat_condition。
- passive_040の既存の変化技優先度+1を維持し、2枠目をform_change / copen_true / 1 / self_hp_lte:1/2に設定。添付passive.csvの表記と他の設定を維持。
- passive_037の水・風被ダメージ倍率0.25は変更していない。添付CSVの説明文修正も維持。
- passive_043に画像専用パッシブは追加しない。超適応の属性変化と威力60以下の優先度+1を維持。

## 判定と戦闘状態

元のfighter.baseとcharacter_idを保持し、能力フォームをfighter.form（form_id・基礎能力プロファイル・定義）、使用回数をformUsesで個体別に管理する。battleBaseが現在プロファイルの共通入口。基礎CSVや他個体を直接変更しない。

HP減少は共通applyHPDamageへ集約し、直接攻撃・毒等・締め付け・フィールド・反動・反射・パッシブHP費用・デコイ費用に対応する。HP減少直後に条件判定する。HP0では発動せず、HP増加から再帰判定もしない。現在のフォームを繰り返し再適用しない。

152→229の増加分は差分として算出する。76/152→153/229、50→127、1→78。EN・ランク・状態異常・技・属性・種族・パッシブ・フィールドは維持し、その後の処理から新しい基礎値・最大HPを使用する。HP費用で変化した場合は、その技のダメージ計算にも反映する。

現行のrepeat_countは演出回数であり、1技のHPダメージは一括適用される。今回も一括HP減少の直後に判定し、多段計算を新設しない。行動順は従来どおりターン開始時に確定し、途中の能力変化で並べ替えない。

交代維持がTRUEなら控えでも真の姿を維持。FALSEなら退出時に解除するが戦闘中の使用履歴は保持。戦闘終了時は能力フォームを通常へ戻し、現在HPを元の最大HPで上限補正する（戦闘不能個体は復活しない）。新規戦闘は全て初期状態で生成する。

クアンタムの画像はappearanceForm / battleAppearanceが現在の第1属性を参照して決める。画像選択から属性を変更しない。登場・属性変化・復元・再登場のたびに同じ参照で一致する。形式上のform_idも取得できる。

## へんしんとの承認済みルール

へんしん中はHP条件フォルムへの新規変化と、元キャラクターの属性連動画像を停止する。既存の真の姿は内部に保持し、交代でへんしんが解除されれば真の姿へ戻る。コピーしたform_changeから他キャラクター専用フォルムには変化しない。へんしんの基礎能力・ランク・現在属性・外見のコピー自体は既存の共通参照を使用する。

## UI・GOE・AI

- 本体・最大HP・能力詳細・回避率・EN回復・現在フォームを既存UIへ反映。各フレームにフォーム状態を保持し、画像更新キーへform_idを含める。画像は読み込み段階で事前取得する。画像ファイルの加工・差し替えは行わない。
- GOEの正式編集対象にformを追加。一括読込、新規・複製・削除、ID・条件参照・HP方式・使用制限・交代維持・属性別画像の設定、基礎6能力合計と通常値比較、画像プレビュー、CSV出力・再読込に対応。
- AIの観測に現在フォームを保持。ダメージ・被ダメージ・HP費用・反応ダメージ・継続ダメージ・自然回復の予測もフォームを反映し、予測で状態や乱数を変更しない。対戦相手の未公開行動は参照しない。クアンタムの画像は評価を変更しない。

## 作業の分離

作業ブランチはfeature/form-changes。元のfeature/defense-stat-swapの未コミットコード・CSV・Excel等は元の作業ツリーに保持している。今回の作業コピーは同じ最新コミット73b5188を基準とし、未コミットのPD・SD交換実装そのものは含めない。その統合を勝手にコミット・マージしない。

クアンタムの正式character.csvは技4枠が空欄のため、正式UIでは引き続き未設定キャラクターとして扱われる。技の自動補完は行わない。専用テストと対戦検証では既存の正式攻撃技から4技を選ぶテスト用構成だけを使用する。

## 検証結果

2026-11-27時点。

| 検証範囲 | 結果 |
|---|---|
| フォルム・GOE・超適応・変身の関連実行 | 195件成功（2,000戦テストは除外） |
| 多数対戦込みの全体実行（1回） | 997件中986成功・11失敗、スキップ0 |
| 上記の注入テスト追従後の被弾／撃破／多段回帰 | 49件成功 |
| 最終の高速全体回帰（大規模対戦3件を除外） | 997件中987成功・既存10件失敗 |
| Edge PC1280px / スマートフォン相当390px | GOE・戦闘の計4シナリオ成功 |

全体実行の11件目は、HP処理に追加した引数へ、既存の合成3ヒット試験のコード注入位置が追従していなかったもの。注入箇所と各パケットの引数を更新し、3パケット・被弾時EN回復・相手ランク低下・撃破処理の全ての既存アサーションを維持して再実行した。テストの削除やスキップ化はしていない。

その後、AIが空欄HPを継承する汎用フォームと交代時解除も予測できるよう、観測データに元のHPを保持し、1件の回帰テストを追加した。最終高速回帰はこれを含む。同名のコペン対戦で予測対象を名前ではなく陣営で識別する修正も追加したため、フォーム専用2,000戦のみ再実行した。既存の2,505戦は再実行していない。全体実行後のため「最終コードで全997件を再実行した」とは扱わない。

残る10件は以前の検証と同じテスト名で、旧技件数・演出未設定・旧技効果期待・未設定技・攻撃威力0などの既存データ／テスト不一致。詳細はskill-effect-validation.mdを参照。全体テストは未合格であり、main統合可能と断定しない。

### フォルムを重点としたAI対AI 2,000戦

- シード73000～74999。1,800戦はコペン対クアンタム、200戦は両者を含む2対2。
- 勝敗確定1,832戦、検証上限到達168戦、例外0、不正行動・不正なHP・EN・能力値は0件。上限は1対1が100ターン、2対2が160ターンで、正式ルールには追加しない。
- コペンの主追跡個体：フォーム発動63戦（3.15%）、発動前に戦闘不能90戦（4.5%）。
- コペン側の陣営：1,735勝・97敗・引き分け0。勝敗確定戦に対する勝率94.71%、全2,000戦に占める勝利86.75%。未決着168戦を負けとして数えていない。
- クアンタムの9属性画像を対戦中にも全て参照し、画像欠落0を確認。
- 正式Copenの技・能力・パッシブを維持。Quantumだけは正式技未設定のため、テスト内で既存の正式攻撃技4つを割り当てる。正式CSVは変更しない。編成と技選択を限定した検証であり、一般的な対戦バランスの評価ではない。

既存の2,505戦も最初の全体実行に含まれる。別途重複実行していない。

ログ・画像（Git管理外）：.cache/forms-full.log、forms-fast-final.log、forms-packet-regression.log、forms-simulation-result.json、forms-simulation-final.log、forms-browser-final.log、form-validation/。

最終CSVはform10件・passive_type39件。画像はユーザー提供の10ファイルとバイト一致を確認（9ファイルを新規登録、通常クアンタムは既存ファイルを維持）。検証用のPNG加工・性能調整・未設定技の自動生成は行っていない。

## 変更ファイル

プログラム：battle-core.js、passive.js、data-validation.js、app.js、battle-ai.js、go-ui.js、GO_Editor.html、index.html。

CSV：data/form.csv（新規）、data/passive.csv、data/passive_type.csv。素材：character_040_true.pngとクアンタムの属性別8画像を登録。通常クアンタム画像は既存のまま。

検証：test/forms.test.mjs、tools/check-forms.cjs、test/editor.test.mjs、test/data.test.mjs、および既存のタイプ件数を検査するパッシブ関連6テスト。新しい39種類の定義に期待値を追従させ、既存効果のアサーションは維持した。画像だけのelement_changeフォームはHP条件パッシブの対象候補から除外し、不正な組み合わせを診断する。

記録：README.md、docs/battle-system.md、docs/passive-system.md、docs/data-foundation.md、本書。合計35ファイル。

## 後続のテスト整合修正（2026-11-27）

fix/current-csv-testsで旧10件の不一致を修正し、多数対戦除外の全体テスト1,001件が成功。Ｋ－１２は技未設定のため使用不可を正として検証した。演出21件と光の呪文の未設定データは診断・使用制限を維持している。CSVや戦闘性能は変更していない。[修正内容と検証範囲](csv-test-maintenance.md)を参照。

## 全機能統合（2026-11-27）

PD・SD交換との分離を解消し、両状態を保持して交代・プレビュー・AIの相互作用を検証する統合を実施。最新のユーザー編集でクアンタムの技が設定されているため、過去の「正式技未設定」の記録は当時の状態である。現在のCSVを正本として使う。詳細と最終検証はintegration-20261127.mdを参照。
