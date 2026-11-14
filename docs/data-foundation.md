# v0.10 データ基盤

## 確定したデータ契約

- 実行時に参照する正式マスタは `data/` 直下のUTF-8 CSV 9表。
- 属性マスタは **火 fire、水 water、風 wind、地 earth、光 light、闇 dark、無 none**。指示の7 IDと一致。CSVセルは維持し、日本語表示名とIDの両方をマスタから引いて実行時に正規化する。未定義値・空欄は `null`、明示的な無は `none`。技の第2属性欄の `none` は第2属性なしを表す現行データ表記として扱う。
- 種族は図鑑分類。属性と同様に、マスタの表示名からIDを解決する。
- 相性表の倍率0を有効な数値として保持する。戦闘の倍率計算はv0.20以降。
- 名前の空欄は予約行として扱う。未設定の技は補完しない。
- 保存領域は `gene_order:save:1`～`3`。現在の起動は保存領域にアクセスせず、旧保存画面も起動しない。旧保存形式はGOのゲーム進行の仕様に含めない。
- HTTPで正式CSVを取得する。取得、文字コード、必須列で失敗すると対象ファイルのエラーを表示する。`file:` はHTTPサーバーでの起動を案内する。MHBの埋め込みデータはロードしない。

## 変換と件数

| 正式ファイル | データ行 | 起動時に利用する件数 |
|---|---:|---:|
| character.csv | 64 | 46 |
| passive.csv | 64 | 24 |
| skill.csv | 100 | 65 |
| effect.csv | 15 | 15 |
| battle_effect.csv | 6 | 6 |
| power_rule.csv | 2 | 2（1グループ） |
| element.csv | 7 | 7 |
| element_effectiveness.csv | 49 | 49（倍率0は4組） |
| species.csv | 10 | 10 |

CP932から厳密にデコードしたキャラ・技と、ワークブックの `passive` シート（数式なし）を含む正式マスタ全9表について、ヘッダーから全行・全セルの順序と値が一致。正本の変換前ファイルは初期コミット `72ed342d4d31410ede052fb2479faeee9dc898f0` のルートにあり、例えば `git show 72ed342:data/element.csv` で旧10属性版、`git show 72ed342:element.csv` で正式版の変換前ファイルを参照できる。旧10属性表とテンプレートは `data/reference/bf-10-elements/`、MHB由来の敵編成30行は `data/reference/mhb/enemy_party.csv` に保管。

## データ診断

| 診断 | 件数 | 内訳 |
|---|---:|---|
| 参照不一致 | 70 | 通常効果39箇所・23 ID、戦闘効果26箇所・18 ID、威力ルール5箇所・4 ID |
| 効果未対応 | 41 | 現行エンジンが扱えない種別、単位、対象IDなど |
| 効果未設定 | 9 | 名称・説明はあるが効果種別なし |
| 項目未設定 | 22 | 名前付きキャラクターの技枠が全て空欄 |
| 参照先未設定 | 22 | 名前付きキャラクターが、予約行のパッシブを参照 |
| 予約行 | 93 | キャラ18、技35、パッシブ40 |
| 画像欠落 | 2 | `character_047.png`、`character_064.png`。現画面は代替表示 |
| ID重複・相性不足・相性重複・数値異常 | 0 | 現在の正式データ |

未解決ID一覧

- 通常効果 — `burn`, `clear_buff`, `drain_50`, `heal_en`, `heal_half`, `pa_down1`, `pa_up1`, `pa_up2`, `pd_down1`, `pd_up1`, `sa_down1`, `sa_down4`, `sa_up1`, `sa_up2`, `sd_down1`, `sd_up2`, `sp_down2`, `sp_up1`, `しめつける`, `どろぼう`, `反動ダメージ1/4`, `回避率UP`, `場リセット`
- 戦闘効果 — `charge_attack`, `dodge_guard`, `ghost_phase`, `next_fire_power_150`, `protect`, `reflection`, `revenge`, `shed_tail`, `sp_protect`, `switch_after_attack`, `switch_lock`, `water_absorb_guard`, `water_protect`, `water_super_effective`, `みがわり`, `ゆきなだれ`, `バトンタッチ`, `追い風`
- 威力ルール — `en_value`, `hp_exact_1`, `speed_advantage`, `target_status`
- 参照先未設定のパッシブ — `passive_025`～`passive_044`、`passive_047`、`passive_064`

## 検証

- `node --test` 12件成功、失敗0。スクリプト評価順、UTF-8、GOデータ、相性0、プレースホルダー、未解決参照、画像、MHBフォールバック禁止、保存キー隔離、エラー表示を確認。
- Edge実ブラウザでHTTP起動を確認。46体、画像44件、代替2件。旧 `assets/` と `data-inline.js` の取得なし。幅375pxで横スクロールなし。`file:` でHTTP起動案内を確認。

## 仕様確認待ち

- ダメージ式、丸め、複合攻撃、STAB・無効化の順、段階係数、優先度同値、初期ENとEN上限、交代時のリセットや引き継ぎ。
- 回避の発動点と持続、追加効果やパッシブの発動順、毒付与率の資料差。
- 編成における `slot` の意味、GOの正式な敵編成、ゲーム進行と保存形式、旧ストーリー・ショップ・装備・アリーナ等の採否。
