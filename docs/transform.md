# へんしん（承認仕様）

## 基準とCSV

feature/entry-shared-fieldsの先行実装と途中実装は、外部操作でmainの64450aeへ統合・コミット済みだった。作業ツリーがクリーンであることとリモート同期、先行2478a73の包含を確認し、feature/transform-moveで続行。mainへ直接実装しない。

既存のdata/effect.csvに登録済みの次の定義を引き継ぐ。列構造と他のCSV性能値は変更しない。既存技・キャラクターへの割り当ては行わない。

| 設定 | 値 |
|---|---|
| effect_id / name | transform / へんしん |
| effect_group / damage_type | transform / none |
| damage_value / turn | 0 / 0（即時の形態変更。期間は交代・戦闘不能まで） |
| can_move / target_stat | TRUE / none |
| start_text | {user}は{target}にへんしんした！ |

skill.csvで新規技を作る際は、category=status、attack_type=none、power=0、target=enemy、effect1=transform、effect_target1=enemy、effect_chance1=100を指定する。cost・priority・animation_id等は通常の技と同様に設定する。effect2/3でも参照可能。攻撃技にも設定可能（下記参照）。self対象への指定は戦闘データ診断で拒否する。

## コピーと参照

fighter.baseは元のキャラクターマスタ参照のまま維持。fighter.transformに、コピーした戦闘用base・外見・パッシブ・解除用ランク情報・変身先IDを保持する。battleBase / battleSkills / battlePassive / battleAppearanceとpassiveEffectsOfを通じて現在の性能を参照する。

- コピー対象：相手の基礎PA・PD・SA・SD・SP、現在の5能力ランク、回復力、現在属性（最大2属性）、技構成、パッシブ、外見。
- 相手の補正後実効値はコピーせず、コピー後に自分の状態異常とコピーしたパッシブで通常計算。二重補正しない。
- HP・最大HP・現在EN・最大EN（既存上限）、回避率・EN自然回復量、個体ID・名前・AIタイプは自分のものを維持。技実行の費用や、その後のターン末自然回復は通常どおり発生する。
- 相手の状態異常、デコイ、防御・継続効果、溜め予約、使用履歴はコピーしない。自分の状態異常・継続効果・場の効果は維持する。
- コピーした登場時・初期ENパッシブは変身時に発動しない。以後の被弾・使用・ターン終了などの通常フックにはコピーしたパッシブを用いる。
- 通常・特殊交代、戦闘不能で解除。交代元の退出時パッシブはその時点で有効なコピー能力を使い、既存の退出処理で元の性能へ戻す。パワーリレーは既存どおりランク・デコイだけを渡し、変身を渡さない。

## 成否と履歴

自分または相手が変身中なら失敗。対象が戦闘不能・位置で捕捉不能・相手の変化技無効が成立した場合も変身しない。成功・失敗は実行時の現在状態で判定する。技を実行した場合のEN費用は既存どおり払い、EN不足・眠り等による実行不能なら払わない。

デコイとの関係はGOの既存判定を維持する。現在のGOでは、デコイへの攻撃に付随する敵対象追加効果は遮断される一方、通常の敵対象変化効果はデコイだけを理由に遮断しない。このため変化技のへんしんもデコイ越しに成立する。ポケモン由来の別ルールは追加していない。

技のmoveUsesは元の個体に保持し、相手からコピーせず、変身・解除でもリセットしない。パッシブは元のusesを保存し、コピー分は自分のcopiedUses（パッシブID→枠別回数）へ記録する。同じコピー先への再変身で回数を復活させない。元と同じパッシブIDなら元の使用履歴を共有する。相手側の使用履歴は継承しない。copyStateは履歴Mapも複製し、予測による消費を防止する。登場後初回・最低HP到達履歴は自分の個体のものを継続する。

## AI・予測・画面

previewTransformは現在条件でのコピー候補を純粋に返す。previewDamageのtransformationに成功見込み・理由・確率・コピー候補を含める。通常のダメージプレビューと同じく、他の未実行行動を仮定しない。費用・実行不能確率はenergyCost / hpCost / actorHp / executionChanceを参照する。確率付きコピーは成立した場合の候補であり、プレビューで乱数を消費しない。

AIは変身後の性能・技で共通のダメージ／速度計算を使用する。変身前の技評価は公開・観測済みの相手技のみで候補を推定し、実行して自分の技になった後はコピーした全技を使用可能とする。相手の未公開の行動を参照しない。形態別に観測履歴を区別し、元の技と変身後の技を混同しない。公開用transformの外見情報から技ID等を除き、未公開データの迂回参照を防ぐ。

戦闘スプライトはコピーした外見へ更新し、個体名は維持。技カード・詳細の能力とパッシブ・属性・状態チップを現在形態へ切り替える。超適応はコピーした属性から通常どおり攻撃後に変化し、複合相性・聖域等・耐性DOWNの既存計算を使う。レイアウト・CSSは変更しない。

## 検証方法と変更範囲

- 関連：node --test test/transform.test.mjs test/editor.test.mjs。必要な依存先としてsuper-adaptation / passive-events / priority / entry-fields / dual-elementsを選択。
- Edge：node tools/check-transform.cjs。GO_PLAYWRIGHT_PATHでPlaywrightを指定可能。PC1280px・スマートフォン相当390pxのGOE操作／CSV往復・外見／技／詳細・コピー技と超適応を検証。正式CSVは編集せず、ブラウザ内の検証用データのみ使用。
- 最終：node --test（既存の多数対戦を含む）。今回の最終結果は作業完了後に追記する。

途中実装から引き継いだ主要ファイル：battle-core.js、passive.js、GO_Editor.html、data/effect.csv。今回の継続差分：battle-core.js、battle-ai.js、go-ui.js、app.js、test/transform.test.mjs、test/editor.test.mjs、tools/check-transform.cjs、本書、README.md。個別CSV性能値の変更・mainへのマージは行わない。


## 最終検証結果（2026-11-24）

- へんしん専用35件＋GOE追加1件、計36件の新規テストは成功。直近の関連実行は213件成功、および最終調整後のtransform/editor 73件成功。失敗を削除・スキップしていない。
- Edge PC1280px・スマートフォン相当390pxで、GOE登録／CSV保存・再読み込みと戦闘中の外見・技・パッシブ・コピーした技による超適応を計4シナリオ検証し成功。実機iPhoneの検証ではない。
- 全テストは完成状態で1回実行：896件中891件成功、5件失敗、スキップ0。多数対戦2,505戦では例外・不正行動0。全体テストは未合格であり、全面的な完了・統合可能とは扱わない。

| 失敗した既存テスト | 現在のデータとの差異 |
|---|---|
| battle：imported definitions stay unassigned | skill_073が旧期待値のlight/dark guard参照と異なる |
| data：production scripts parse | 技89件の固定期待値に対し現在93件 |
| data：each named skill uses valid animation metadata | skill_089〜092のanimation_id等が未設定 |
| data：excludes placeholders | 技89件の固定期待値に対し現在93件（後続アサーションにも最新データとの照合が必要） |
| data：official UI accepts newly configured fighters | character_047（Ｋ－１２）の技4枠が空欄で、既存の使用可能チェックに拒否される |

今回のコード差分を適用しない64450aeのbattle-core.js・battle-ai.js・go-ui.js・app.jsを読み取り時だけ差し込む検証で、上記5件のみを再実行し、同じ5件の失敗を確認した。正式CSVは作業開始時からバイト単位のGit差分なし。新技の性能・演出や既存キャラクターの技構成を独断で補完せず、旧テストの期待値もこの作業では変更しない。

ログ：.cache/transform-related.log、.cache/transform-final-related.log、.cache/transform-edge.log、.cache/transform-full.log、.cache/transform-baseline-failures.log（Git管理外）。mainへのマージ・Push・コミットは行わない。


## 攻撃技への追加効果対応（2026-11-24）

作業ブランチ：feature/attack-transform。基準はmainのcdc303b。既存の変化技へんしんを維持し、同じeffect_id=transformを物理・特殊の攻撃技にも設定可能にする。新しいCSV列・効果ID・個別技への割り当ては追加しない。

| skill.csv列 | 攻撃技の設定例（実データは変更しない） |
|---|---|
| category | attack |
| attack_type | physical または special（noneは未対応） |
| power | その技の基本威力 |
| element / element2 | 正式な技属性 |
| target | enemy |
| effect1（effect2/3でも可） | transform |
| effect_target1 | enemy |
| effect_chance1 | 発動確率0～100 |
| cost | 技自身のCSV設定値を使用 |

### 成立条件と順序

- 実際に相手の本体HPを1以上減らした場合のみ発動判定する。回避・相性0・パッシブ無効・完全軽減・デコイのみへのダメージでは発動せず、変身用の乱数も消費しない。
- 相手を倒した場合も変身する。コピー元の基礎能力・ランク・現在属性・外見・パッシブは、ダメージ適用直前の情報を固定する。攻撃の他の追加効果や被弾パッシブが後からランクを変えても、この攻撃でコピーする情報は固定済みのものを使う。通常の変化技のコピー時点は変更しない。
- ダメージ・被弾反応・反撃／反射・すべての通常追加効果（反動を含む）・元のパッシブの使用後／撃破時処理の後、変身を適用する。途中で使用者が戦闘不能になったら発動しない。変身が反動より前の効果欄にあっても同じ。
- コピーしたパッシブの登場時効果や撃破時効果を、この攻撃へ遡って発動しない。元の撃破時パッシブの処理は維持する。勝敗確定は変身の後なので最後の相手を倒した場合もコピーできる。
- 攻撃技では最初の発動率が正のtransform枠を1回だけ評価する。repeat_countで追加の変身や確率判定は増やさない。重複したtransform枠は設定しないことを推奨する。
- 溜め開始時には変身せず、解放攻撃で条件を満たした時だけ発動。既存の変身済み自身／相手への失敗・HP/EN維持・使用履歴・交代解除も継続する。

previewDamageのtransformation、およびpreviewTransformは同じ本体ダメージ・応答／反動後HPを使い、KO後のコピー可否も予測する。actorElementsAfterはコピー成立時の属性を返す。確率が100%未満ならコピー後性能は成立した場合の分岐であり、乱数を消費しない。AIの変身評価もその候補を利用し、超適応の防御評価との二重加点を防ぐ。実際の攻撃ダメージ計算、EN費用、パッシブ倍率・相性表は変更しない。

追加検証：test/attack-transform.test.mjs。従来のtest/transform.test.mjsの攻撃技拒否チェックだけを対応済みの期待へ更新し、self対象の拒否は維持。test/editor.test.mjsに攻撃技としてのCSV往復を追加。tools/check-transform.cjsはPC／スマホ相当の両方で変化技・攻撃技のGOE往復と実戦表示を検証する。


### 攻撃技対応の検証結果（2026-11-25）

- 新規28件：攻撃変身27件＋GOE攻撃技CSV往復1件、すべて成功。関連テスト156件成功。
- Edge PC1280px・スマートフォン相当390pxで、変化技／攻撃技それぞれのGOE登録・CSV往復と実戦表示を計8シナリオ確認し成功。正式CSVを編集せずブラウザ内の検証用技で行った。
- 最終全テストは今回1回実行：924件中919件成功、5件失敗、スキップ0（約234秒）。失敗は上記の既知5件と同一で、新規の失敗はない。多数対戦2,505戦も実行され、例外・不正行動なし。
- 全体テストは既知5件が残るため未合格。旧技設定・演出・編成・固定件数期待値の残件は今回変更しない。既存テストの削除・スキップ化は行わない。
- 変更ファイル：battle-core.js、battle-ai.js、test/attack-transform.test.mjs（新規）、test/transform.test.mjs、test/editor.test.mjs、tools/check-transform.cjs、docs/transform.md。正式CSVは全て無変更。
- 作業はfeature/attack-transformに保持し、コミット・Push・mainへのマージは実行しない。
- ログ：.cache/attack-transform-final-related.log、.cache/attack-transform-edge.log、.cache/attack-transform-full.log。
