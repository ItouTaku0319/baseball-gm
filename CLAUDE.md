# Baseball GM - NPB風野球シミュレーションゲーム

プレイヤーは1球団のGMとしてチームを運営する。パワプロのペナントモードを参考にしたUI/UX。

## コア原則

- **シンプル第一**: 最小影響の変更。必要な箇所だけ変更し、新たなバグを生まない
- **根本原因を解決**: 応急処置・ハック禁止。シニアエンジニア水準の実装
- **即停止・再プラン**: 問題が起きたら無理に進めず、立ち止まって原因分析
- **完了前に自問**: 「スタッフエンジニアが承認するか？」

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router) / TypeScript 5 (strict)
- **UI**: React 19 + Tailwind CSS 4
- **状態管理**: Zustand 5 / **永続化**: IndexedDB (Dexie.js)
- **テスト**: Vitest 4 / **パスエイリアス**: `@/*` → `src/*`

## 開発コマンド

```bash
npm run dev          # 開発サーバー
npm run build        # ビルド
npm run lint         # ESLint
npm run test         # Vitest
npx tsx scripts/test-balance-full.ts --games=1000  # バランステスト
```

Bashコマンドは `cd` プレフィックスなしで直接実行。ワーキングディレクトリはプロジェクトルート。

## ディレクトリ構成

```
src/
├── app/          # Next.js App Router ページ（全ページ "use client"）
├── components/   # 共通UIコンポーネント
├── engine/       # ゲームエンジン（純粋関数） ← 中核
├── models/       # 型定義（Player, Team, Season, GameState）
├── db/           # データ永続化（IndexedDB / Dexie.js）
├── store/        # Zustand状態管理（game-store.ts）
└── data/         # チームテンプレート（12球団）
scripts/          # バランステスト等のスクリプト
```

アーキテクチャ詳細は `docs/architecture.md` を参照。

## コーディング規約

- UIテキスト・コメントは日本語
- 数値表示: `tabular-nums` + 右寄せ (`text-right`)
- 色使い: 自チーム=`text-blue-400`、勝=blue、敗=red、引分=gray
- 能力値の色分け: 80+=gold(`text-yellow-400`)、65+=green、50+=white、35+=orange、<35=red
- テーブル: ストライプ(`even:bg-gray-800`) + ホバー(`hover:bg-gray-700`)
- 背景: `bg-gray-900`, テキスト: `text-white`
- 型にフィールド追加時は**必ずoptional** (`?:`) + 使用箇所で `?? デフォルト値`
- マジックナンバー禁止（`physics-constants.ts`に定数化）
- 不要なコメント・docstring・過剰な抽象化は避ける
- スケジュール: NPB準拠143試合制（同リーグ25×5=125 + 交流戦3×6=18）
- 指標の参考: https://1point02.jp/op/gnav/glossary/gls_index.aspx?cp=101

## ドキュメント体系

| ファイル | 役割 | いつ参照 |
|---|---|---|
| `CLAUDE.md` | プロジェクトルール | 常時（自動読込） |
| `task.md` | タスク一覧・優先度 | タスク選定時 |
| `GAME_SPEC.md` | ゲームルール・数値設計 | 実装時・監査時 |
| `docs/architecture.md` | レイヤー構成・依存ルール | 設計時 |
| `docs/baseball-knowledge.md` | NPBベンチマーク | 設計時・バランス検証時 |
| `docs/patterns.md` | 実装パターン | 実装開始前 |
| `docs/design-decisions.md` | 設計判断記録 | 関連機能の修正時 |
| `docs/autonomous-workflow.md` | 自律開発手順・ReActループ | 自律モード実行時 |
| `docs/workflow.md` | 開発ワークフロー・スプリント | 運用手順の確認時 |
| `docs/lessons.md` | 教訓・学習記録 | セッション開始時 |
| `docs/fielding-reference.md` | 守備AI参考資料（統合版） | 守備ロジック修正時 |
| `docs/testing-strategy.md` | テスト戦略 | テスト追加・修正時 |

`GAME_SPEC.md` はゲームバランスに関わる実装時に必ず参照。確率・計算式を変更したらコードと仕様書を同時更新。

## チーム体制（サブエージェント）

定義ファイルは `.claude/agents/` にある。

| 役割 | エージェント名 | モデル | 担当領域 |
|---|---|---|---|
| PM（メインセッション） | — | opus | 全体統括・タスク分解・Git操作 |
| エンジン実装 | `impl-engine` | sonnet | engine/ |
| UI実装 | `impl-ui` | sonnet | app/ components/ |
| データ実装 | `impl-data` | sonnet | models/ store/ db/ |
| 汎用実装 | `implementer` | sonnet | 領域横断・小規模修正 |
| テスト | `tester` | haiku | 動作検証（読み取り専用） |
| レビュー | `reviewer` | sonnet | コードレビュー（編集不可） |
| 品質監査 | `guardian` | sonnet | 品質監査（編集不可） |

### 委譲ルール

- `engine/` → impl-engine / `app/` `components/` → impl-ui / `models/` `store/` `db/` → impl-data
- 異なる領域の実装は並列委譲OK。ただし `models/player.ts` `store/game-store.ts` を触るタスクは他と並列にしない
- テスト・レビュー・ガーディアンはコードを編集しない（指摘のみ）

## 運用ルール

- コミットメッセージは日本語で変更内容を要約
- **コミット後は `git push origin` まで自動実行**（確認不要）
- force-push禁止、`git reset --hard` 禁止
- ファイルは Read してから Edit/Write（未読ファイルの編集禁止）
- ビルドエラー3回リトライで解決しなければ**即停止→原因分析→再プラン**
- ガーディアン差し戻し2回で人間に報告して中断
- 自律実行は `task.md` の `自律: YES` + 完了条件付きタスクのみ
- 詳細な自律開発手順は `docs/autonomous-workflow.md` を参照
