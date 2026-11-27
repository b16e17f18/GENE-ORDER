# 全作業ブランチの統合（2026-11-27）

## 基準と保全

- 基準main: d6438ca。統合ブランチ: integration/all-features-20261127。
- 作業開始時のcharacter.csvとExcel編集はf3aedc1で先に保全した。
- character.csvはCP932だったため、CP932のバイト往復一致と変換後の文字列一致を確認してUTF-8化した。列値は変更しない。Excelは元のバイト列を維持。
- 既存ブランチ・worktree・stashは削除しない。MHB・NPBCは変更しない。

## 取り込んだ作業

- fix/current-csv-tests（feature/form-changesを含む）: フォルム変化・属性連動画像・GOE・テスト整合。
- feature/defense-stat-swap: self/enemy各枠への実効能力コピーと両枠指定でのPD・SD交換、AI・UI・GOE。
- fix/self-contained-sleep-reference-test: 実装とfixtureは既存mainと同一のため、未採用だった検証記録を取り込む。
- chore/agents-git-automation: ユーザー指定の開発運用設定。
- archive/uma-verification-edits: adaptive_stat_multiplier、conditional_priority_modifier、HP履歴・使用回数の管理、AI・GOE対応は現行に含まれる。古い個別CSV（UMA倍率1.5）や古いタイプ件数へ戻さず、現在の実装・設定を維持して履歴を包含する。独立した新機能は追加しない。
- その他の作業ブランチはすでに基準mainの祖先。共通フィールド、耐性DOWN、超適応、複合属性、へんしん、攻撃後へんしん、各EN・パッシブ拡張を維持。

## 競合解消の方針

- 最新ユーザー編集のcharacter.csvとExcelを正本とする。古いブランチの技構成・cost_chargeで上書きしない。
- form.csvのcopen_trueは実装済みのtrigger_type=passiveを維持し、passive_040のtarget_id2=copen_trueを保持する。
- 戦闘状態、AI観測、UIのフレームにformとstatExchangeを両方保持する。
- 退出時は能力交換を解除し、フォルムの交代維持設定は別に判定する。
- GOEの能力交換検証とフォーム編集・検証を両方残す。
- プレビュー用cloneFighterも能力交換の内部レコードをコピーし、実戦状態と共有しない。
- 「○の呪文」など特定の技IDへの特例は作らない。演出の空欄と攻撃威力0はCSVから一般的に判定し、未設定の報告・技の使用不可を検証する。未知のID・不正数値を注入する否定テストを維持する。

## 検証

- 関連テスト121件成功。データ関連65件成功。追加したフォーム×能力交換の結合テスト4件成功。
- 最終の全体実行: node --test、1,048件成功・0失敗・スキップ0（約218秒）。全体実行は完成時に1回。
- 主要対戦4,505戦: 勝敗確定4,261戦、検証上限244戦、例外0、不正行動0。内訳は通常1,024戦、AI比較1,481戦、フォーム重点2,000戦。上限はテスト専用で、正式ゲームの引き分け条件に追加しない。
- 上記に加えてフォーム8戦と技効果12戦のスモーク試験も成功。
- Edge 1280px/390px: GOEのCSV一括読み込み・編集・保存・出力・再読込、コペンの真の姿・クアンタムの属性連動画像・戦闘詳細を計4シナリオで確認。EN数値と相手HP数値の非表示も維持。
- 最新のユーザーCSVの値は維持。空欄・未完成の技設定は補完しない。過去ブランチのデータへ一括置換しない。
- ログは.cache/integration-*.log、画面画像は.cache/form-validation/（Git管理外）。
