# MHB既存UIとGO戦闘エンジンの接続調査

v0.60では現行のMHB由来マークアップとCSSを正式画面に活用する。v0.30は固定編成のデバッグ画面だけを変更した。旧画面は index.html の legacy-screens テンプレート内に保管されている。

| 既存資産 | 接続時の変更点 |
|---|---|
| index.html の旧戦闘・編成画面と styles.css | 対戦に必要なテンプレートを有効化し、旧ストーリー等から独立させる。配色、文字、ボタン、レイアウト、モーションは現行の指定を維持する。 |
| app.js の renderHud、renderBattleSprite、renderBattleStatusPanel | GOの activeFighter、teams、active を表示用に変換する。HP・ENゲージと画像は既存レンダラーを活用し、属性は element_1 / element_2、ランクは stages、防御状態はGOイベントから表示する。 |
| renderMoveGrid、playerChooseMove | 技の可否を geneOrderBattle.checkAction に委ねる。共通回避を技枠から独立して表示する。詳細の予測値は純粋な calculateDamage を利用する。 |
| renderSwitchGrid、playerChooseSwitch | GOの編成と生存状態から候補を表示し、交代アクションを送る。強制交代の入力フローは仕様確定後に接続する。 |
| resolveTurn、renderBattle、pushLog、既存アニメーション | 旧処理へのコマンド接続を切り替え、geneOrderBattle.resolveTurn のイベントを順に再生する。同期処理後の個体状態から描画し、旧 executeAction、旧効果ハンドラー、旧ターン終了処理を経由させない。 |
| renderSetup、startBattle、TEAM_SLOT_LIMIT | GOのデータからチームを生成する。MHBの上限5、初期編成、敵編成、対戦開始時の物語・装備・交換処理はGO仕様確定後に個別判断する。 |
| 起動・保存・素材 | 既存 initializeLegacyScreens を丸ごと実行する経路は採用しない。GOのUTF-8マスタと保存名前空間を維持し、旧埋め込みMHBデータを読み込まない。旧 assets/ を指す素材はGOで利用するものの所在を確認する。 |

受入確認は、既存の見た目、編成→技選択→交代→勝敗、ゲージ・演出とエンジンのイベントの一致、旧データ・旧保存・旧進行の非使用を含む。
