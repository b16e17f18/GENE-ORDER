# GENE ORDER

GENE ORDER（GO）は、MHBの戦闘コードを基盤に開発中のキャラクター対戦ゲームです。v0.60では正式画面でチームを編成し、プレイヤー対AI・手動対手動・AI対AIを遊べます。

## 起動

リポジトリのルートで Python 3 のHTTPサーバーを起動します。

```powershell
py -3 -m http.server 8000 --bind 127.0.0.1
```

[ローカルのタイトル](http://127.0.0.1:8000/) から「バトルモード」を開き、自分の3体を選択して開始すると、相手3体をランダム編成する対AI戦になります。先発は双方の最小スロットです。相手の手動編成・手動対手動・AI対AIは対戦モードから選べ、こちらは暫定で各側1～4体です。タイトルの「図鑑」からキャラクター情報を、「デバッグ」から固定編成の戦闘と診断を確認できます。Pythonの実行コマンドが `python` の環境では `py -3` を `python` に読み替えてください。HTMLを直接開くと `file:` になり、HTTP起動を案内するエラーが表示されます。

タイトルまたは編成画面の「ランダムバトル（3対3）」では、使用可能なキャラクターから双方3体を抽選してプレイヤー対AIを開始します。各チーム内は重複なしで、スロット値が最も低い個体が先発です。同値なら抽選で先に選ばれた個体を使います。対戦終了後は「同じ編成で再戦」「再抽選して対戦」を選べます。

## ファイル構成

| パス | 用途 |
|---|---|
| `index.html`, `app.js`, `go-preview.css` | 正式CSVローダー・MHB由来テンプレート・固定編成デバッグ |
| `go-ui.js`, `go-ui.css`, `styles.css` | 正式対戦の操作・表示とMHB由来のスタイル |
| `data-validation.js` | ID・データ型・相性組・素材参照の診断 |
| `data/*.csv` | UTF-8の正式マスタ（技とアニメーション定義を含む） |
| `data/passive_type.csv` | パッシブ効果36タイプの種別ID・名称・発動タイミング・対象形式・効果量条件・別名 |
| `data/reference/` | 旧10属性資料とMHB由来の敵編成 |
| `asset/character/` | キャラクター画像 |
| `asset/battle-animation/`, `asset/bgm/`, `asset/element/` | 対戦アニメーション、BGM、属性アイコン |
| `passive.js`, `battle-core.js`, `battle-ai.js` | GOの基本戦闘コアと移植元の戦闘処理 |
| `data-inline.js` | MHBの参照用埋め込みデータ |
| `test/` | データ基盤・戦闘ルールの自動テスト |
| `docs/data-foundation.md` | データ契約・検証結果・未解決事項 |
| `docs/battle-system.md` | 基本戦闘の仕様と暫定ルール |
| `docs/passive-system.md` | 共通36タイプ、個別パッシブ、CSV調整、発動順と暫定仕様 |

全65技の対応状況は技一覧に記録しています。 [技一覧](docs/skill-effects.md)

状態異常・フィールド効果の採用根拠とMHB比較は [移植記録](docs/status-and-field-effects.md) を参照してください。

特殊技と性能値のCSV管理は [特殊技の移植記録](docs/special-skills.md) を参照してください。

Node.js 22以降で `node --test` を実行すると自動テストを再現できます。

[デコイと特殊交代の仕様・CSV調整](docs/switch-and-decoy.md)

[v0.42 総合検証・再現方法](docs/battle-validation.md) · [v0.50 AI移植と公開情報](docs/ai-integration.md)

[正式UIの再利用範囲](docs/ui-integration.md) · [Edgeでの再現手順](docs/ui-validation.md)


v0.61〜v0.63の正式表示は7属性の共通アイコン、日本語の能力名、回復力を含むMHB配色のグラフ。グラフ上限は体力275、物理攻撃・物理防御・特殊攻撃・特殊防御・敏捷225、回復力50。

## 開発を始める前に

ローカルとGitHubの双方で開発するため、作業開始前に `git status --short --branch` で未コミット変更を確認し、`git fetch origin main` と `git rev-list --left-right --count HEAD...origin/main` で差分を確認します。ローカルのコミットが先行しておらず早送りできる場合は、未コミット変更を保護したうえで `git pull --ff-only origin main` を実行します。履歴が分岐している場合は双方の変更を確認してから統合します。

被弾・撃破・通常交代・味方戦闘不能後の登場に対応する5効果を加え、正式マスタは34タイプです。設定例・MHB比較・検証結果は [イベント型パッシブ追加](docs/passive-events-34.md) を参照してください。

2属性の攻撃技を正式対応しました。0倍を除外した相性乗算、1回限りのSTAB、属性パッシブ・AI・UI・GOEの動作は[複合属性技の記録](docs/dual-elements.md)を参照してください。

陣営フィールド（聖域・深淵・延焼）と個体の属性耐性低下をCSVから設定できます。[定義・設置先・計算順序・検証記録](docs/field-effects-resistance.md)を参照してください。

超適応（攻撃後の一時属性変化・基本威力による優先度補正）は[実装記録](docs/super-adaptation.md)を参照してください。
