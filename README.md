# GENE ORDER

GENE ORDER（GO）は、MHBの戦闘コードを基盤に開発中のキャラクター対戦ゲームです。v0.50では正式データと固定編成で、手動対手動・手動対AI・AI対AIを確認できます。

## 起動

リポジトリのルートで Python 3 のHTTPサーバーを起動します。

```powershell
py -3 -m http.server 8000 --bind 127.0.0.1
```

[ローカルの確認画面](http://127.0.0.1:8000/) を開くと、キャラクター一覧とデータ診断を確認できます。「基本戦闘テスト」を開くと、固定編成で両側の行動を選択できます。この画面は開発・デバッグ用です。特殊交代や補充の際は、該当側の候補から選んで「交代先を確定」を押します。Pythonの実行コマンドが `python` の環境では `py -3` を `python` に読み替えてください。HTMLを直接開くと `file:` になり、HTTP起動を案内するエラーが表示されます。

## ファイル構成

| パス | 用途 |
|---|---|
| `index.html`, `go-preview.css`, `app.js` | データ確認画面・ローダー・固定編成の戦闘接続 |
| `data-validation.js` | ID・データ型・相性組・素材参照の診断 |
| `data/*.csv` | UTF-8の正式マスタ9表 |
| `data/reference/` | 旧10属性資料とMHB由来の敵編成 |
| `asset/` | キャラクター画像と開発資料 |
| `passive.js`, `battle-core.js`, `battle-ai.js` | GOの基本戦闘コアと移植元の戦闘処理 |
| `data-inline.js`, 旧画面テンプレート | 移植時の参照用。GO起動時には使用対象外 |
| `test/` | データ基盤・戦闘ルールの自動テスト |
| `docs/data-foundation.md` | データ契約・検証結果・未解決事項 |
| `docs/battle-system.md` | 基本戦闘の仕様と暫定ルール |
| `docs/passive-system.md` | パッシブ24種、CSV調整、発動順と暫定仕様 |

正式画面はMHB既存UIの配色・レイアウト・操作表示を活用し、v0.60でGO戦闘エンジンに接続します。接続課題は [UI接続調査](docs/ui-integration.md)、全65技の対応状況は [技一覧](docs/skill-effects.md) を参照してください。

状態異常・フィールド効果の採用根拠とMHB比較は [移植記録](docs/status-and-field-effects.md) を参照してください。

特殊技と性能値のCSV管理は [特殊技の移植記録](docs/special-skills.md) を参照してください。

Node.js 22以降で `node --test` を実行すると自動テストを再現できます。

[デコイと特殊交代の仕様・CSV調整](docs/switch-and-decoy.md)

[v0.42 総合検証・再現方法](docs/battle-validation.md) · [v0.50 AI移植と公開情報](docs/ai-integration.md)
