# 登場時フィールドと共通フィールド

## 定義・設定

- 新タイプ：on_entry_field_effect（entry、target_kind=field、value=1、conditionは空欄）。全38タイプ。既存の個別passive.csv・character.csv・skill.csvは変更せず、予約枠への自動割り当てもしない。
- passive.csvの例：passive_type1=on_entry_field_effect、target_id1=field_sanctuary、value1=1、condition1は空欄。2・3枠も同様。対象はbattle_effect.csvの実在するフィールド定義のみ。対象マスタ未読込・不正ID・個体防御効果は検証エラー。
- field_targetはself（所持者側）、enemy（対戦相手側）、both（戦場共通）。省略時は従来どおりself。技のtargetからは推定しない。

| battle_effect_id | field_target | turn | 性能（既存数値を維持） |
|---|---|---|---|
| field_sanctuary | both | 3 | 双方の光攻撃技威力1.3倍、光→地の0を1へ |
| field_abyss | both | 3 | 双方の闇攻撃技威力1.3倍、闇→地の0を1へ |
| field_spreading_fire | enemy | 3 | 敵陣の場の個体へ最大HP10%（従来の暫定CSV値） |
| 追い風 | self | 3 | 自陣のSP1.5倍 |

倍率・期間・突破属性・解除可否はbattle_effect.csvを参照。聖域・深淵で変更したセルはfield_targetのみ。防御フィールドを含む既存の共存ルールを維持し、聖域・深淵は同時存在可能。

## 保存・タイミング

battle.fields.sharedに各IDを1件だけ保存し、計算・表示時はfieldEffectsForSideで片側Mapと合成する。両陣営へのコピーは作らず、同じIDはCSV期間へ更新する。異なるIDは共存する。ターン末の期限処理は共有領域に1回だけ行い、自然消滅ログも1回。交代・戦闘不能で共有領域は消さない。

初登場・通常交代・補充登場を既存applyEntryPassiveから処理。通常の設置は発動ターンを期間に含む。ターン末の補充は継続ダメージ・期限整理の後なので、次ターンを開始としてCSV期間を確保する。登場順は従来のplayer→enemy。双方が同じIDを設置しても重複せず期間更新する。特別な登場順・乱数は追加しない。

installFieldを技とパッシブで共有する。previewSwitchは各フィールドMapを複製し、登場パッシブの予測によって実戦状態を変更しない。

## 解除・計算・画面

clear_fieldは指定陣営の解除可能フィールドと、field_clearableがTRUE（省略もTRUE）の共通フィールドを削除する。芭蕉扇は敵陣＋共通を解除し、その後自陣追い風を付与する。自陣の既存追い風、FALSEのフィールド、個体の状態異常・能力ランク・耐性DOWN・デコイは保持する。共有Mapからの削除で、双方の威力・無効突破が即時消滅する。

複合攻撃の0除外乗算、防御2属性の通常乗算、STAB、超適応、属性耐性DOWNの順序・倍率は変更しない。実戦・プレビュー・AIは共有のフィールド参照を使用。AIは共有設置による双方の攻撃利得と、共通フィールド解除による双方の変化を公開情報から評価する（完全探索ではない）。

既存の戦闘詳細チップで双方に同じ残り期間を表示し、設置・消滅ログを共通フィールドとして表示する。レイアウト・CSSは変更しない。GOEはbattle_effect.csvも読み込み、bothの編集と登場時パッシブのフィールド候補選択・検証・CSV往復に対応。

## 再現方法

- 関連：node --test test/entry-fields.test.mjs test/field-effects.test.mjs test/editor.test.mjs
- Edge PC1280px・スマートフォン相当390px：node tools/check-fields.cjs（必要ならGO_PLAYWRIGHT_PATHを設定）。エディタ操作・CSV往復・書き出した技とパッシブの実行・戦闘詳細表示を検査。
- 完成時：node --test（既存2,505戦を含む）。当該実行結果は作業完了報告に記載。


## 変更範囲

作業ブランチ：feature/entry-shared-fields（feature/super-adaptationの9d33a6cから作成）。元ブランチ・PR #4・mainは変更しない。以前作成した未追跡のAGENTS.mdも保持する。

- 実装：battle-core.js、passive.js、battle-ai.js、app.js、data-validation.js、go-ui.js、GO_Editor.html。
- 正式CSV：data/battle_effect.csv（聖域・深淵のfield_targetのみbothへ）、data/passive_type.csv（on_entry_field_effectを1行追加）。他の正式CSVは無変更。
- 記録：README.md、docs/field-effects-resistance.md、本書。
- 新規テスト：test/entry-fields.test.mjs。GOEテストをtest/editor.test.mjsへ追加。既存フィールドの設置先期待値はtest/field-effects.test.mjsで新仕様へ更新。
- カタログ件数37→38の追従のみ：test/data.test.mjs、test/adaptive-passive.test.mjs、test/hp-conditional-passives.test.mjs、test/passive-events.test.mjs、test/passive28.test.mjs、test/priority.test.mjs、test/super-adaptation.test.mjs。
- Edge検証：tools/check-fields.cjsに登場時パッシブのCSV往復・設置検証を追加。tools/check-adaptive-passive.cjs、tools/check-hp-passives.cjs、tools/check-passive-events.cjs、tools/check-passive28.cjs、tools/check-priority.cjs、tools/check-super-adaptation.cjsは種別件数のみ追従。

## 今回の検証結果

- 関連テスト174件成功。最終全自動テスト860件成功・失敗0・スキップ0（約231秒）。新規28件。初回の全体実行で残っていたUMAのカタログ件数期待値37を38へ修正し、UMA関連37件も個別に再検証した。共通領域が空なら従来の陣営Mapを直接参照し、不要な合成を避ける。
- Edge PC1280px・スマートフォン相当390pxで各4、計8シナリオ成功。フィールド編集・技登録CSV往復・戦闘詳細・登場時パッシブ登録CSV往復と書き出しデータの実行を含む。
- 全テストに含まれる正式CSVの2,505戦は例外・不正行動なし。ターン上限は検証専用で、正式な引き分け条件へ追加していない。
- 差分検査成功。他の正式CSV性能値・個別パッシブ・説明文は無変更。mainへのマージ・Push・PR更新は実行していない。
- 本機能の未解決事項なし。過去のpassive_037の設定倍率0.25と説明「半減」の不一致は、今回対象外として保持する。
