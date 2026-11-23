# UMA専用「未確認生物」（2026-11-23）

## 基準と保持

GitHub最新main 0c8349f68864b9a412bc7504b3c23fe0ec65899dを確認した。作業ブランチfeature/uma-adaptive-passiveでは既存のPC画像表示コミットbdabca9も保持する。ユーザー編集中のcharacter.csv、skill.csv、effect.csv、能力値Excelは変更しない。Excelは開かれていて排他ロック中のため内容ハッシュ取得を行えないが、本作業では書き込み操作を一切行わない。

編集済みデータを既存の回帰テストの旧期待値へ戻すことを避けるため、GENE-ORDER内の.cache/node_modules/uma-verificationに最新mainの独立worktreeを用意し、今回の実装ファイルだけを複製して回帰検証する。node_modules配下なので通常のnode --testの探索対象にならない。独立作業場では主作業場の未コミットCSVは使わない。

## CSV

既存13列のpassive_type.csvへadaptive_stat_multiplierを1行追加し、効果タイプは35種類となる。handlerは同名、phase=stat-multiplier、target_kind=adaptive_stat、value_type=number、value_min=0（非包含）、上限空欄、condition_kind=none。

passive_035の設定：name=未確認生物、passive_type1=adaptive_stat_multiplier、target_id1=auto、value1=1.5、condition1は空欄。第2・第3効果はnone／none／0。予約IDを維持し、他の個別パッシブ行は変更しない。character_035がpassive_035を参照することを確認し、character.csv自体は編集しない。

## 比較と倍率

passive.jsのadaptiveStatが、fighter.baseとopponent.baseのphy_atk／phy_def／sp_atk／sp_def／speedを順番に比較する。相手−自分が正かつ既存最大差より大きい場合にだけ候補を更新するので、同率はPA→PD→SA→SD→SPが優先される。HP・回復力・回避率は比較しない。差の絶対値を使い、比率では選ばない。

比較にeffectiveStatを呼ばないため、ランク、他パッシブ、自身の1.5倍、状態異常や追い風を比較へ混入させない。基礎値やstagesを書き換えず、状態キャッシュも作らない。能力計算時のstatModifiersで、このhandlerの対象能力が現在計算中の能力に一致する場合だけ既存の倍率リストへ加える。

battle-core.jsの既存effectiveStatが、能力ランク適用値×パッシブ倍率×状態異常倍率×場の倍率を従来の順序と端数処理で計算する。比較や倍率適用のためにbattle-core.jsを改修する必要はない。値1.5をJSへ固定せず、value1から読み取る。対象なし・対面なし・相手戦闘不能・自身戦闘不能時は適用しない。

この純粋な動的照会により、場に出た直後から有効になり、相手交代・自己交代後の再登場でも現在の相手に再判定する。以前の対象への補正は次の計算で自然に消える。発動状態や永続能力変化を重ねて保存しないので二重適用や循環参照がない。既存の能力倍率パッシブと同様、戦闘計算で使われた時は既存の発動ログ経路を使う。新しい登場イベントや乱数処理は追加しない。

## GOEと各モード

GOEの候補母集合にautoを追加した。選択したタイプのtarget検証で絞るため、適応型の候補はautoだけ、既存タイプの候補は変わらない。既存のCSV列と正規化・値範囲検証・書き出しを再利用し、UI配置は変更しない。EdgeのPC1280pxとスマートフォン相当390pxでタイプ選択、誤対象拒否、保存、倍率変更、複製、CSV出力・再読み込みを確認した。

正式createMatchを使う手動対戦、対AI、AI対AIの3モードで能力倍率とターン解決を確認した。AIは既存の共通effectiveStat／effectiveSpeed／previewDamageを通すため専用の二重計算を追加しない。状態異常の評価が全stat-multiplierにconditionがあると仮定していた1箇所をoptional chainingに修正し、条件なしの適応型を状態異常連動パッシブと誤認しないようにした。プレビューやAI評価はHP・EN・ランク・発動回数・乱数を変更しない。

## テスト

新規能力テスト37件：5能力、対象なし、同率順、差と比率の違い、HP除外、ランク±、状態異常、他倍率との併用、相手交代、自己交代と再登場、二重適用防止、双方UMA、AIと実ダメージ一致、SP行動順、交代予測、CSV倍率変更・別名、対象／値の不正、3モード、条件なしパッシブを持つ対象への自己／相手向け状態異常のAI評価。編集中CSVのある主作業場でも37件成功した。

GOEのNode追加2件：auto候補・検証と空欄／倍率のCSV往復。最新mainの独立作業場で既存HP条件・GOEを含む関連92件が成功（3モード追加前）。Edgeで2画面幅のGOE確認も成功した。

初回全体629件は627成功・2失敗だった。AIシード対戦で上記condition参照の例外を発見し、もう1件は独立作業場に非追跡のMBHdata/effect.csvが存在しない環境不足だった。AIを1箇所修正し回帰テスト2件を追加、参照CSVは元のGO内資料から読み取り複製した。修正後の関連82件は全て成功。ソース修正後の全体631件（既存592＋今回39）が全て成功、失敗0、約53.2秒。初回の失敗を無視せず、修正後にAIシード対戦を含む全体を再実行して確認した。現段階で新しい乱数、能力ランク方式、ダメージ式、技、既存パッシブの意味・性能値、画像表示、バージョン番号は変更していない。コミット・Pushは行っていない。

## 変更ファイル

実装：passive.js、battle-ai.js、GO_Editor.html、data/passive_type.csv、data/passive.csv。テスト：test/adaptive-passive.test.mjs（追加）、test/editor.test.mjs、test/data.test.mjs、test/passive28.test.mjs、test/passive-events.test.mjs、test/hp-conditional-passives.test.mjs。Edge確認：tools/check-adaptive-passive.cjs（追加）、tools/check-passive28.cjs、tools/check-passive-events.cjs、tools/check-hp-passives.cjs。記録：README.md、CHANGELOG.md、docs/passive-system.md、本記録。既存テスト・確認スクリプトの件数期待値は35タイプへ更新した。

シード対戦も含む2505戦：完走2437、検証上限68、例外0、不正行動0。上限は検証用で正式な戦闘仕様へ追加しない。

実装・テストの未解決事項なし。ただし編集中のCSV変更全体をこの機能の回帰期待値へ合わせて改変することはせず、全体631件は最新main＋今回実装で検証している。主作業場の新規37件も成功。ユーザー編集済み3 CSVは開始時ハッシュを維持した。
