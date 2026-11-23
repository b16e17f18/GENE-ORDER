# GENE ORDER 開発運用

## 作業開始・調査
- 最初に `git status --short --branch` と `git branch --show-current` を確認する。
- ネットワーク利用可能時は `git fetch origin` でリモート参照を更新し、対象ブランチとの差分・包含関係を確認する。例：`git log --oneline HEAD..origin/main`、`git log --oneline origin/main..HEAD`、`git merge-base --is-ancestor <依存ブランチ> HEAD`（終了0なら包含）。古いmainから開始せず、同じ修正を重複実装しない。
- 既存docsと関連コードを優先し、まず変更対象と依存箇所を特定する。毎回リポジトリ全体を調査し直さない。
- CSV全件検査はCSV構造変更・参照整合性への広い影響・全体検証が必要な場合に限る。

## 実装・Git
- 1回の作業は原則1機能。既存の共通処理を再利用し、無関係なリファクタリングを行わない。
- ユーザーが確定した仕様・性能値を勝手に変更しない。不明点は重要なものだけ質問する。
- 未コミットのユーザー編集と既存の作業内容を保持し、今回の変更だけを扱う。MHB・NPBCは変更しない。
- mainに直接変更しない。作業ブランチを使用し、mainへのマージはユーザーの明示的な承認を必要とする。
- Push・PR作成は依頼された場合に実行する。強制Pushはしない。

## テストの選択
- 変更中は関連テストだけを実行する。同じ内容を理由なく繰り返さない。
- 全テストは機能完成時・PR作成前などの節目に実行する。既に成功した全テストは、コード・入力CSV・検証環境に変更がなければ原則再実行しない。
- ブラウザ検証はUI変更時または必要な動作確認時に限定する。2,505戦の対戦検証も戦闘ロジック変更時など必要な場合に限る。
- テストを省略した場合は明記し、実施済みと誤認させない。対戦検証を除いた実行を「全テスト成功」と報告しない。

コマンドはリポジトリ直下、Node.js 22以降で実行する。既存テストを分類して選択する方式とし、テスト自体は変更しない。

| 分類 | コマンド・用途 |
|---|---|
| 関連テスト | `node --test test/priority.test.mjs` など、変更に関連するファイルだけ指定。複数ファイルも指定可能 |
| 戦闘の関連テスト | `node --test --test-skip-pattern="1,024 seeded battles|GO AI seeded tournaments" test/battle.test.mjs`。必要なら `--test-name-pattern="対象名"` でさらに絞る |
| 全体テスト（対戦検証除外） | `node --test --test-skip-pattern="1,024 seeded battles|GO AI seeded tournaments"`。広い回帰確認が必要だが多数対戦は不要な場合 |
| 全体テスト（すべて） | `node --test`。下記2,505戦も含むため、同じ作業で別途重複実行しない |
| ブラウザ検証 | `node tools/check-ui.cjs`、または変更に応じた `tools/check-fields.cjs`、`tools/check-super-adaptation.cjs` 等を1つ選ぶ。Microsoft EdgeとPlaywrightが必要。別環境のPlaywrightは `GO_PLAYWRIGHT_PATH` にモジュールパスを指定 |
| 対戦シミュレーションのみ | `node --test --test-name-pattern="1,024 seeded battles|GO AI seeded tournaments" test/battle.test.mjs`。正式CSVの1,024戦＋AI等の1,481戦＝2,505戦。再現シード・検証用ターン上限は既存テストに定義 |

関連テストの目安：データは `test/data.test.mjs`、GOEは `test/editor.test.mjs`、通常効果・ENは `test/status.test.mjs` / `test/sleep.test.mjs` / `test/en-effects.test.mjs`、フィールドは `test/field-effects.test.mjs`、複合属性は `test/dual-elements.test.mjs`、超適応は `test/super-adaptation.test.mjs`。パッシブは対応する `test/*passive*.test.mjs`、優先度は `test/priority.test.mjs`。依存箇所に応じて選び、全てを毎回実行しない。

## 参照先・CSVの役割
- 起動・構成：`README.md`。基本戦闘：`docs/battle-system.md`。データ契約：`docs/data-foundation.md`。
- パッシブ：`docs/passive-system.md`。フィールド・耐性DOWN：`docs/field-effects-resistance.md`。複合属性：`docs/dual-elements.md`。超適応：`docs/super-adaptation.md`。
- 検証方法：`docs/battle-validation.md` / `docs/ui-validation.md`。AI：`docs/ai-integration.md`。未確定仕様：`docs/pending-decisions.md`。過去版の件数・結果を現在の実施結果として扱わない。
- `data/character.csv`：基礎能力・属性・技・個別パッシブ参照。`skill.csv`：技性能・効果参照。`passive.csv`：個別パッシブの対象・値・条件。`passive_type.csv`：共通タイプの定義・検証条件。
- `effect.csv`：通常効果・個体の持続効果。`battle_effect.csv`：戦闘効果・陣営フィールド。`power_rule.csv`：可変威力。`element.csv` / `element_effectiveness.csv`：属性・基本相性。`species.csv`：図鑑分類。`animation.csv`：演出。
- `data/reference/` と `data-inline.js` は旧データの参照用。正式データへ混入させない。GOEは `GO_Editor.html`。

## 報告
- 原則短く、変更ファイル・実装内容・テスト結果（実行範囲／省略）・未解決事項を報告する。
- 長い検証ログは要求された場合のみ提示する。問題がない項目を何度も詳細説明しない。
