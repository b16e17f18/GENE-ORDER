# 超適応（passive_043）

## 基準

feature/field-effects-resistanceのff46eb43bd5619d106c7903228f539be99182939を引き継ぎ、feature/super-adaptationで実装する。mainへ直接変更しない。先行するフィールド・耐性DOWN・複合属性・UMA・優先度の実装を保持する。開始時のdata/passive.csvにはユーザー編集があり、内容を.cache/super-adaptation/passive-before.csvへ保管した。実装側から正式passive.csvを書き換えていない。

添付名のファイルは未発見だったためユーザーへ保存場所を確認し、最終的に指定されたdata内のpassive.csvを最新版として採用した。採用時点の内容を.cache/super-adaptation/passive-canonical.csvへ保管。開始時からユーザーによるpassive_026名称とpassive_047 condition3の更新もあり、保持している。

## CSVと共通処理

| 枠 | passive_type | target_id | value | condition |
|---|---|---|---|---|
| 1 | on_attack_element_change | used_element | 1 | 空欄 |
| 2 | conditional_priority_modifier | power_lte | 1 | 60 |

説明文：攻撃後、使用した属性技の属性になる。威力60以下の技の優先度+1。

passive.csvの列・値・説明文は変更しない。passive_type.csvへon_attack_element_changeを1種類だけ追加し、カタログは37種類。phase=after-attack、target_kind=used_element、整数value=1、condition_kind=none。個別IDの分岐は使わず、同じタイプを別パッシブでも使用できる。

conditional_priority_modifierにpower_lteを追加。数値conditionは基本威力の上限として解釈し、対象power_lteのときだけ有効。空欄・HP条件・小数・負数をこの対象に組み合わせた場合は診断エラー。既存のstatus/all/attack/physical/special、HP条件・複合条件・回数制限は維持する。

基本威力0以上の技を対象とするため、威力0の変化技とCSV登録済み共通回避も対象になる。威力未定義/非数値は対象外。威力60以下なら元の優先度へvalueを加算し、61以上では補正なし。威力補正・power_cap適用後の値を判定には使用しない。技の威力・消費EN自体は変更しない。無邪気のstatus条件は従来どおり変化技だけ。

## 属性状態

fighter.currentElementsに一時的な最大2属性を保持し、currentElements(fighter)で参照する。未変化ならbase.element_1/element_2を返す。技のelement2が空欄/noneなら単属性、同属性の重複を除く。第1属性のnoneは正式な無属性。正式キャラクターマスタのbaseを直接書き換えない。

使用技のダメージと追加効果を処理した後、属性変化を適用する。したがって変化した属性のSTABはその攻撃に遡及しない。次の攻撃/被弾から現在属性を使用する。物理・特殊の両方を対象とし、変化技では変化しない。同じ属性の並びなら再設定・発動ログ・発動回数増加を省略する。

EN不足、技の不成立、行動不能、使用前の戦闘不能、使用費用や反動/反射で使用者が倒れた場合は変化しない。溜め開始では変化せず、解放時の処理後に1回だけ判定する。デコイへの命中・貯水による吸収・反射でも、使用者が生存して攻撃処理を終えれば属性変化する。ユーザー回答により、回避・相性0・パッシブ無効・位置による不命中でも、技を実行できていれば属性変化する。

通常/特殊交代では退出本人と登場先の一時属性をリセット。戦闘不能時もリセット。パワーリレーはステージ/デコイの既存引き継ぎを維持し、一時属性は渡さない。新規戦闘は常に正式属性で開始する。

## 計算順序と相互作用

- 防御側：各攻撃属性に対して現在の防御2属性への倍率を0も含め乗算。光・風防御は地0、火0.25、水1、雷2。
- 攻撃側：防御2属性の積を攻撃属性ごとに求めてから、0の攻撃属性だけを除外して乗算。全0なら0。既存ルールを変更しない。
- STAB：現在の自分の属性のいずれかと技のいずれかが一致すれば既存1.25を1回だけ適用。
- 聖域/深淵：対応する攻撃属性→地の0だけ置換した後に防御属性の積、個体耐性DOWN、攻撃側の0除外合成を適用。威力倍率・上限・丸めは従来順序。
- 属性耐性DOWN：変化後の防御属性にも適用。同じ属性の補正1回、CSV上限4を維持。
- 属性無効パッシブは相性計算とは独立。属性変化で突破しない。
- 属性別威力/被ダメージ補正、壁、回避、デコイ、技の追加効果は既存の処理を維持。
- 延焼の割合ダメージは属性を参照しない。交代後も陣営に残る。
- 攻撃後交代は属性変化の後に既存交代処理へ進み、控えに戻ると元の属性に復元する。

## 空欄条件の承認済み拡張

ユーザー確認により、conditional_stat_multiplier / conditional_damage_multiplierの空欄conditionを無条件として扱う。明示されたHP条件は従来どおり評価する。これによりユーザー編集済みpassive_029/032/047の空欄は正常に扱われる。CSVの対象・値・説明文を変更していない。不明な非空欄条件は引き続き診断エラー。

## GOE・UI・AI

GOEは新タイプとused_element、既存優先度タイプのpower_lteと数値60を候補表示する。値・条件の検証、保存・複製・CSV出力・再読み込みに対応。CSVの型式は変更しない。

戦闘HUD/スプライトの属性表示と戦闘詳細は既存アイコンを使い現在の1～2属性を表示する。描画フレームは一時属性をコピーして、後続の変化で過去フレームを書き換えない。パッシブ発動ログには変化後の属性を表示する。CSS・レイアウトは変更していない。

calculateDamage/previewDamage/AIがcurrentElementsを共有する。予測結果にactorElementsAfterを含め、使用前の属性で現在攻撃を計算したまま、使用後の属性も確認できる。予測はHP/EN・属性・ランク・発動回数・乱数を変更しない。

AIは公開済み相手技について、攻撃後の予測属性に対する被ダメージを共通previewDamageで計算し、防御面の利得/損失を既存の評価係数で加点/減点する。行動順の優先度/SPで自分が先に行動する可能性を考慮し、相手の未公開選択は参照しない。この仮評価は属性と予測HPのみを対象とし、未確定の相手行動や確率追加効果の完全な先読みは行わない。

## 検証とデータ保護

関連テストはtest/super-adaptation.test.mjs、test/editor.test.mjs。Edgeの再現はtools/check-super-adaptation.cjs（GO_PLAYWRIGHT_PATHを指定）。PC1280pxとスマートフォン相当390pxのGOE/戦闘の4シナリオを確認した。GOEのCSV往復では既存全行が元データと一致することも検査する。

ユーザー編集された全身全霊1.3倍・火事場1.3倍・適応倍率1.2倍等は変更しない。旧数値固定のテストは、同じ入力のアルゴリズム検証を固定fixtureで維持するか、正式CSVの現在値を使って期待値を計算するよう更新した。テストの削除や閾値の緩和はしていない。

境界条件と正本を確認済み。ユーザー指定のdata/passive.csvをそのまま採用して最終検証する。passive_047のcondition3は最新版でself_hp_eq:1/1となっており、その明示条件を評価する。

## 最終検証

- 全自動テスト832件成功、失敗0、スキップ0（約47秒）。既存775件に新規57件（超適応55、GOE2）を追加。
- Edge PC1280px/スマートフォン相当390px：超適応のGOE/戦闘4シナリオ、既存フィールドと技登録往復6シナリオ、従来優先度条件のGOE2シナリオを検証（合計12）。
- 正式CSVの再現可能な対戦2,505戦：完走2,433、検証上限72、例外0、不正行動0。上限はテストだけの制限で、ゲームの引き分け条件へ追加していない。
- フィールド・耐性DOWNの新効果を使う既存3モード36戦も36完走。
- 正本passive.csvは採用時のスナップショットとバイト一致。character/skill/effect/battle_effect/element/element_effectiveness.csvに今回の差分なし。
- 作業ブランチはfeature/super-adaptation。mainへのマージ・pushは行わない。

## 変更ファイル

実装：passive.js、battle-core.js、battle-ai.js、app.js、go-ui.js、GO_Editor.html。CSV：data/passive.csv（ユーザー指定の正本をそのまま採用）、data/passive_type.csv（1行追加）。
テスト：test/super-adaptation.test.mjs（新規）、test/editor.test.mjs、test/adaptive-passive.test.mjs、test/battle.test.mjs、test/data.test.mjs、test/status.test.mjs、test/pr-integration.test.mjs、test/priority.test.mjs、test/hp-conditional-passives.test.mjs、test/passive-events.test.mjs、test/passive28.test.mjs。
ブラウザ検証：tools/check-super-adaptation.cjs（新規）と既存のcheck-adaptive-passive / check-hp-passives / check-passive-events / check-passive28 / check-priority.cjsのカタログ件数・候補を更新。
記録：README.md、CHANGELOG.md、docs/battle-system.md、docs/passive-system.md、本書。

実装上の未解決事項はなし。AIの攻撃後防御評価は公開情報と予測HPに基づく近似で、相手の未公開行動を使わず、確率追加効果を含む完全探索はしない。
