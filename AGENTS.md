# GENE ORDER 開発運用

## 作業開始・調査
- 最初に `git status --short --branch` と `git branch --show-current` を確認する。
- ネットワーク利用可能時は `git fetch origin` でリモート参照を更新し、対象ブランチとの差分・包含関係を確認する。例：`git log --oneline HEAD..origin/main`、`git log --oneline origin/main..HEAD`、`git merge-base --is-ancestor <依存ブランチ> HEAD`（終了0なら包含）。古いmainから開始せず、同じ修正を重複実装しない。
- 既存docsと関連コードを優先し、まず変更対象と依存箇所を特定する。毎回リポジトリ全体を調査し直さない。
- CSV全件検査はCSV構造変更・参照整合性への広い影響・全体検証が必要な場合に限る。

## 実装・Git

### 標準運用（2026-11-28のユーザー指定・過去のブランチ運用より優先）

- 特別な指示がない限り、専用ブランチを新規作成せずmainで直接実装・修正する。
- 開始前にmainの最新状態を取得する。git fetch origin後に差分を確認し、安全に早送り可能ならgit pull --ff-only origin main等で反映する。未コミット変更を破棄・上書きしない。
- 実装・修正→必要な自動テストと動作検証→差分確認→今回の変更だけをコミット→GitHubのmainへ通常Push→当該コミットのGitHub Actions成功確認→GitHub Pagesへの反映確認を一連の作業範囲とする。
- ローカルの実装・コミットだけで完了扱いにしない。Actions・Pagesの確認が未完了なら、その状態と残作業を明示する。
- テスト失敗や競合があれば無理にPushせず、原因を調査して報告する。未確定仕様を独断で決めない。強制Pushは禁止する。
- ユーザーから別ブランチ・PR・承認待ち等の特別な指定がある場合は、その指定を優先する。既存ブランチ・worktreeは無断で削除しない。

- 1回の作業は原則1機能。既存の共通処理を再利用し、無関係なリファクタリングを行わない。
- ユーザーが確定した仕様・性能値を勝手に変更しない。不明点は重要なものだけ質問する。
- 未コミットのユーザー編集と既存の作業内容を保持し、今回の変更だけを扱う。MHB・NPBCは変更しない。

- 履歴の書き換えや既存ブランチの削除は、ユーザーの明示的な許可なく行わない。
- GitHub Desktopでの手動操作を前提にしない。不要なブランチ作成・重複PR・広範なGit履歴調査を避ける。

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
作業完了時は、以下のみを簡潔に報告する。
- 作業ブランチ
- 実装内容
- テスト結果
- コミット・Pushの結果
- GitHub ActionsとGitHub Pagesの確認結果（PRがある場合はURLも記載）
- 未解決事項
