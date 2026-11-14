# GENE ORDER

GENE ORDER（GO）は、MHBの戦闘コードを基盤に開発中のキャラクター対戦ゲームです。v0.10ではGOデータの読み込みと確認画面を提供します。対戦ルールと編成画面は今後接続します。

## 起動

リポジトリのルートで Python 3 のHTTPサーバーを起動します。

```powershell
py -3 -m http.server 8000 --bind 127.0.0.1
```

[ローカルの確認画面](http://127.0.0.1:8000/) を開くと、キャラクター一覧とデータ診断を確認できます。Pythonの実行コマンドが `python` の環境では `py -3` を `python` に読み替えてください。HTMLを直接開くと `file:` になり、HTTP起動を案内するエラーが表示されます。

## ファイル構成

| パス | 用途 |
|---|---|
| `index.html`, `go-preview.css`, `app.js` | v0.10のデータ確認画面とローダー |
| `data-validation.js` | ID・データ型・相性組・素材参照の診断 |
| `data/*.csv` | UTF-8の正式マスタ9表 |
| `data/reference/` | 旧10属性資料とMHB由来の敵編成 |
| `asset/` | キャラクター画像と開発資料 |
| `passive.js`, `battle-core.js`, `battle-ai.js` | 移植元の戦闘処理 |
| `data-inline.js`, 旧画面テンプレート | 移植時の参照用。GO起動時には使用対象外 |
| `test/data.test.mjs` | ロード・診断・保存領域の自動テスト |
| `docs/data-foundation.md` | データ契約・検証結果・未解決事項 |

Node.js 22以降で `node --test` を実行すると自動テストを再現できます。
