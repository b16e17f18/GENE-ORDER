# PR再確認（2026-11-23）

## 統合状況

指定のfeature/dual-element-moves（41e1a6a）はPR #1で2026-11-22 17:05 JSTにmainへ統合済み。main=0c8349f68864b9a412bc7504b3c23fe0ec65899d。origin/main...origin/feature/dual-element-movesは1/0、ファイル差分0。新たな同一PRや再マージは不要。

旧指示の「光・風→地=1倍」はユーザー回答で2倍へ訂正済み。相性表を変更せず、光0・風2から2倍、火・水→地4倍、0.5×0.5=0.25、全0=0、0×2=2を検証した。STAB1.25は1回。

EN自然回復量+1、34パッシブタイプと5イベント効果、HP最大時被ダメージ0.75倍、HP半分以下のSP2倍、条件解除・回復再成立、交代と補充の区別、発動回数、CSV・GOE・AI予測がmainに含まれる。

## 今回の修正

クリーンなmainの全テストでは592件中591成功、睡眠比較1件がENOENTで失敗した。test/sleep.test.mjsが.gitignore対象のMBHdata/effect.csvへ依存していたため、GitHubから取得しただけでは比較を実行できなかった。

既存ローカル参照CSVから睡眠の9列1行だけを値を変えずにtest/fixtures/mhb-sleep-reference.csvへ保存し、テストの参照先を変更した。正式data/effect.csv、MHB、戦闘コード、能力値・技・AI・UIを変更していない。比較する項目・期待値・テスト件数も維持。

修正はmainから分離したfix/self-contained-sleep-reference-testで実施。元のfeature/field-effects-resistanceと未コミット変更は保持。

## 検証

- 関連282件成功、失敗0。
- 修正後の睡眠24件成功、失敗0。Git管理外のMHB参照フォルダを検証用worktreeに設置せず実行した。
- Edge: PC1280px / スマートフォン相当390pxで複合属性技、相性バッジ2倍、実戦とプレビュー一致、9属性のGOE編集・CSV保存/再読み込み、第2属性noneへの復帰、HP条件の登録を確認。
- マウス/タッチ×手動/対AI/ランダム相手の技・変化技・回避・交代33操作成功。
- 既存画像参照、未設定/空欄、セーブ領域独立はdataテストで検証。

## 後続の未統合変更

元の28/29/34タイプ、EN回復、複合属性の各作業ブランチのコミットはmainに含まれる。

後続のfeature/conditional-priorityはmainより2コミット先（bdabca9、9e515ca）。PC画像中心線制約、UMAの適応能力倍率、汎用優先度変更、ユーザーのCSV編集などが未統合。feature/sprite-center-boundsとfeature/uma-adaptive-passiveの先端はbdabca9で、上記2コミットに含まれる。これらを今回のテスト修正PRへ混入させない。

feature/field-effects-resistanceも同じ2コミットを基点とし、フィールド・耐性低下の未コミット変更19ファイルが別途残る。今回の再確認でその変更を破棄・移動・コミットしていない。

## CIと残件

mainに.github/workflowsはない。旧PR先端のcheck-runs=0、コミットstatuses=0。CI成功とは扱わずローカル検証として報告する。

既存の未完成技・予約パッシブ・画像未設定はdocs/pr-integration.mdの記録どおり維持。自動生成や性能値の修正はしていない。今回のPRはクリーン環境でのテスト再現性の修正のみ。mainへのマージはユーザー承認まで実行しない。

## 最終集計

全自動テスト592件成功、失敗0、スキップ0（約53秒）。対戦2505戦：完走2438、例外0、検証上限67。AIの不正行動0。検証上限は正式な引き分け条件ではない。
