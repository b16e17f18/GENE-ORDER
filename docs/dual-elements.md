# 複合属性技の正式対応

## 基準と現状

最新作業ブランチfeature/dual-element-movesを使用。EN回復追加0f8719cを基に開始し、途中の実装はユーザーのコミット9baf4aff26c1f5783c55298ce4bb6805ce8918eaへ取り込まれていたため、そのコミットを引き継いで検証・仕上げを行った。個別パッシブと画像のユーザー編集もそのコミットに含まれ、改変しない。mainの基準は5a09158のまま。

移植元MHBのbattle-core.jsにmoveElements、moveWeaknessMultiplier、sameElementBonusForMoveがあり、属性の重複排除、平均相性、STAB1.15を使っていた。GOには同じ参照経路が残る一方、正式エンジンのcalculateDamageとmoveAvailabilityは第2属性ありの技を拒否していた。CSVローダー・GOEにはelement／element2、UIには2属性のアイコン表示が既に存在した。

MHBの属性抽出・重複排除という構造を参考に、GO正式エンジン内にmoveElements／moveHasElement／moveWeaknessMultiplier／sameElementBonusForMoveをまとめた。平均合成は共通combineMoveElementMultipliersによる乗算へ変更した。MHBの旧STABやダメージ乱数などは持ち込まない。

## 確定ルール

- 第1属性は正式ID、第2属性は空欄・null・未設定・noneなら不参加。重複属性は除く。noneは第1属性なら正式な無属性として残す。
- 各攻撃属性について、相性表から防御側の各属性への倍率を乗算する。防御側の無効はこの段階で通常どおり0になる。
- こうして得た攻撃属性別倍率のうち0だけを除き、残りを乗算する。残りがなければ0。0.25や4、それ以上の複合倍率をクランプしない。
- 例：0・0→0、0・0.5→0.5、0・1→1、0・2→2、0.5・0.5→0.25、0.5・2→1、1・2→2、2・2→4。
- 風→地は正式CSVとユーザーの訂正どおり2倍。したがって光・風→地は0を除き2倍。元の指示の1倍例は訂正済み。火・水→地は4倍、火・氷→火は0.25倍。
- STABは使用者のどちらかの属性が技のいずれかに一致すれば1.25倍を一度だけ適用。数値・適用順・丸めは最新GOを維持。
- 未定義IDや相性欠落は例外／診断となり、等倍に置換しない。未知の第2属性を正規化で空欄へ落としていた箇所も、不正値を保持して判定対象にする。

## パッシブ・戦闘効果との相互作用

| 対象 | 複合技での処理 |
|---|---|
| element_immunity | 一方に一致すれば攻撃全体を無効。相性表で0となり除外される側への一致でも同じ。相性0除外とは別判定 |
| element_power_multiplier | 一致する各スロットを1回ずつ乗算。第1・第2属性重複で二重適用しない |
| element_damage_multiplier | 両属性を照合し、一致する各スロットを1回ずつ適用。既存の最終補正順を維持 |
| on_use_element_stat_stage | 指定属性がどちらかに一致する攻撃技で各スロット1回。変化技は対象外のまま |
| on_hit_element_stat_stage | 本体被弾時にどちらかへ一致する各スロットを1回。従来の生存・命中条件を維持 |
| 属性軽減・壁 | guardAppliesを共通の属性抽出へ接続。各壁の適用は従来どおり1回 |
| 貯水・反射 | 貯水の属性照合は両属性へ拡張。一致で技全体を吸収。反射は既存の物理／特殊判定を維持 |
| next_element_power | 一致する両属性の保持効果はそれぞれ乗算し、技実行時にそれぞれ1回消費。予測では保持、溜め開始時に威力を確定・消費し解放時に再適用しない |

一致した属性が技の一部である場合も技全体へ補正する、という既存の単属性効果の意味を継続した。CSVの各スロットは独立した効果なので別スロットの倍率は併用するが、同じスロットを属性ごとに再実行しない。新しい乱数は導入していない。

## 実戦・AI・UI・GOE

通常戦闘、previewDamage／previewRelease、AIの評価が同じ正式計算を使う。次回威力のAI候補評価、貯水の保護評価も両属性に対応。UIの相性バッジは共通moveWeaknessMultiplierを使い、属性無効は独立表示する。技ログに複合技のみ属性名を併記する。既存のカード配置・CSSは変更しない。

GOEは既に2列を編集・出力できていたため本体変更なし。PC1280pxとスマートフォン相当390pxで、両列の9属性候補、光・風の保存／CSV書き出し／再読み込み、第2属性noneへの復帰を実操作確認した。正式CSVを編集せずブラウザのテスト用データで行った。

同じ2画面幅で正式の天使の羽搏きを実行し、地属性相手への×2表示・光と風のログ・予測と実ダメージの一致を確認した。比較用個体の自然HP回復を0にし、攻撃直後の予測とターン末自然回復を混同しない条件で照合している。

## 検証と残件

新規複合属性テスト114件、GOE追加2件。10種類の倍率合成、全81組の攻撃属性ペア×90通りの防御属性組（7,290組）、全単属性相性、重複排除、STAB、属性パッシブ、軽減、実戦・AI・UIの共通計算、追加効果、無効、次回威力、溜め、予測の非変更を確認。関連テスト133件成功、ローダー関連15件成功、Edgeの4確認（GOE／戦闘×2幅）が成功。

ユーザーの最新CSVには別件の不正対象が2件ある：passive_026はconditional_stat_multiplierのtarget_id3=all、passive_029はelement_damage_multiplierのtarget_id1=all。前者は能力名、後者は属性IDが必要であり、両者はpartialとして診断される。今回これらを勝手に別タイプへ変更していない。テストでは全行正常という旧前提を外し、この2件が具体的なエラーとして検出され、その他の設定済み行が正常なことを確認する。

全自動テストを仕上げ時に1回実行：580件中579成功・1件失敗（約50.3秒）。失敗はユーザーの最新CSVのpartial 2件を含めず全設定済み行を正常と仮定した既存テストの件数前提だった。その1件の期待値にpassive_026／029の診断を明示し、該当テストだけ再実行して成功した。戦闘エンジンの追加修正は不要で、全体の重複実行は行っていない。580件すべての最終検証が成功し、未解決のテスト失敗は0。既存のキャラクター・技・パッシブの個別CSVと属性マスタ・相性表は変更なし。未確定の4攻撃分類と持ち物移動の技は選択不可のまま維持する。mainへマージ・Pushしない。

再現：node --test test/dual-elements.test.mjs test/editor.test.mjs。Edge：GO_PLAYWRIGHT_PATHを指定してnode tools/check-dual-elements.cjs。全体：node --test。

既存多数対戦も含め2505戦：完走2436、検証上限到達69、例外0、不正行動0。上限は検証用であり正式の引き分け条件ではない。

## 変更ファイル

先行実装（9baf4afに取り込み済み）：battle-core.js、passive.js、battle-ai.js、go-ui.js、app.js、test/battle.test.mjs、test/data.test.mjs。

今回の仕上げ：battle-core.js、app.js、test/dual-elements.test.mjs（追加）、test/battle.test.mjs、test/data.test.mjs、test/editor.test.mjs、tools/check-dual-elements.cjs（追加）、README.md、CHANGELOG.md、docs/battle-system.md、docs/skill-effects.md、docs/pending-decisions.md、本記録。
