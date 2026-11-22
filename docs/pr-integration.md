# main統合前の最終検証（2026-11-22）

## 基準とブランチ比較

対象feature/dual-element-moves、開始HEAD bc4689a89d5722ee3872156c91d8a1d081fe88e5、main 5a09158ed3381cdc93353ca9c92e61cea8ce583e。ローカル・GitHubのSHAが一致し、未コミット変更なしで開始。差分7コミット、36ファイル、追加1267・削除129行を確認した。

feature/passive-types-28（5c2b93b）、feature/hp-conditional-passives（65624b4）、feature/passive-events-34（8d3165d）、feature/en-charge-up1（0f8719c）は全て対象HEADの祖先。重要な変更が別作業ブランチに取り残されている状態ではない。リモートにもmainと対象ブランチ以外のheadはない。

| 機能 | 検証先 |
|---|---|
| 複合属性・0倍除外乗算・STAB1回 | dual-elements、battle、dataテスト／Edge PC・タッチ |
| EN自然回復+1と減少・無効の共存 | en-effectsテスト／Edge GOE・戦闘 |
| 34タイプと追加5イベント | passive28、passive-eventsテスト／Edge GOE |
| HP条件付き被ダメージ・能力倍率 | hp-conditional-passives、pr-integrationテスト／Edge GOE |
| CSV互換性・空欄・未設定・画像・GO保存領域 | data、editorテスト |
| AIの予測と実戦・合法行動 | battle、dual-elements、AIシード対戦 |

## 相性の正式な最終確認

今回の指示文に光・風→地1倍とあったが、質問へのユーザー回答で直前の訂正を維持し2倍を正式と再確認した。相性CSVは変更しない。光0・風2→2、火2・水2→4、0.5・0.5→0.25、0・0→0、0・2→2を共通計算で確認する。単属性の相性・既存STAB1.25倍を維持する。

## 発見・修正した不具合

passive_026の第3タイプconditional_stat_multiplierとpassive_029の第1タイプelement_damage_multiplierは対象allに対応せず、説明にある満タン時の軽減が適用されていなかった。2セルのみconditional_damage_multiplierへ変更。対象all、値0.5／0.75、条件self_hp_eq:1/1、passive_029のSP2倍とself_hp_lte:1/2はそのまま保持した。変更を許容するよう診断を緩めるのではなく、旧タイプでallを指定した場合にエラーとなる負例テストも残した。

HP200／199／100での0.75倍、HP102／100／98／200でのSP倍率、実回復で満タンへ戻った後の軽減再成立、被弾後の解除、AI・プレビューによる非変更を正式CSVから確認する。戦闘エンジン・技・キャラクター・相性表・画像は今回変更しない。

## CSV・GOE・画面

46キャラクター、89技、32個別パッシブ（30設定済み＋2名称のみ）、34タイプを読み込む。ID重複や新規参照切れはない。既存の未設定は生成・削除・置換しない。

既知の残件：skill_047のeffect2=どろぼう（持ち物処理未実装で選択不可）、attack_type未設定の4技、passive_030（土俵際）／032（大天使の輪）の効果未設定、character_033～044・047・064の予約パッシブ参照、character_064の画像欠落。画像は既存プレースホルダーで表示する。画像パス45件が存在することをdataテストで確認する。

EdgeでGOEの34タイプ・5効果・HP条件・複合属性・EN効果の編集／保存／CSV書出し／再読み込みを確認。PC1280pxとスマートフォン相当390pxの戦闘・相性バッジ・ログ・予測一致を確認。マウスとタッチの通常手動・対AI・ランダム相手モードで技、変化技、回避、交代を33操作確認し全て成功した。既存UIデザインと配置は維持する。

## テスト・PR・CI

関連テスト282件、ローダー／既存パッシブ22件が全て成功。今回追加の正式CSV統合テスト12件。全自動テストは仕上げ時に1回実行し、592件成功・失敗0、約40.1秒。既存580件と今回追加12件を含む。

開始時に対象headのopen PRはなし。CIは.github/workflows未配置、チェック実行0、コミットステータス登録0であり、pending表示は待機中のテストを示すものではない。CI成功と誤記しない。全テスト成功後に作業ブランチの修正を公開し、PR差分と最終headのチェック・マージ可否を確認する。自動マージは有効にしない。mainへのマージ・Pushはユーザーの承認まで行わない。

AI・簡易選択器の再現シード対戦を含む2505戦：完走2438、検証上限到達67、例外0、不正行動0。検証上限を正式な引き分け条件へ追加していない。

変更ファイル：data/passive.csv（処理タイプ2セル）、test/pr-integration.test.mjs（追加12件）、test/battle.test.mjs・test/data.test.mjs（正式設定の正常診断を検証）、CHANGELOG.md、docs/dual-elements.md、docs/pending-decisions.md、本記録。技・キャラクター・相性・画像に今回の差分はない。
