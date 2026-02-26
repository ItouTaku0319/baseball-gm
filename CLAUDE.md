# Baseball GM - NPB風野球シミュレーションゲーム

## プロジェクト概要

NPB（日本プロ野球）をモデルにした野球GMシミュレーションゲーム。パワプロのペナントモードを参考にしたUI/UXで、プレイヤーは1球団のGMとしてチームを運営する。

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router)
- **言語**: TypeScript 5 (strict mode)
- **UI**: React 19 + Tailwind CSS 4
- **状態管理**: Zustand 5
- **データ永続化**: IndexedDB (Dexie.js) — `src/db/`
- **テスト**: Vitest 4
- **パスエイリアス**: `@/*` → `src/*`

## 開発コマンド

```bash
npm run dev      # 開発サーバー起動
npm run build    # プロダクションビルド
npm run lint     # ESLint実行
npm run test     # Vitestテスト実行
npx tsx scripts/test-balance-full.ts --games=1000  # バランステスト（品質ゲート）
```

**重要**: Bashコマンドは `cd` プレフィックスなしで直接実行すること。ワーキングディレクトリはプロジェクトルートで維持される。`cd` を付けると許可パターン(`Bash(git *)` 等)にマッチしなくなり、不要な許可プロンプトが発生する。

## ディレクトリ構成

```
src/
├── app/                    # Next.js App Router ページ
│   ├── page.tsx           # タイトル画面（セーブデータ一覧）
│   ├── layout.tsx         # ルートレイアウト（Geistフォント）
│   └── game/
│       ├── new/page.tsx   # 新規ゲーム作成（チーム選択）
│       └── [id]/
│           ├── page.tsx       # ダッシュボード（成績・順位・シム操作）
│           ├── roster/page.tsx    # ロスター（選手一覧・能力）
│           ├── lineup/page.tsx    # 打順・ローテ編集
│           ├── standings/page.tsx # 順位表
│           ├── schedule/page.tsx  # スケジュール（日程・結果）
│           ├── stats/page.tsx     # 成績（打撃/投手・セイバー指標）
│           ├── analytics/page.tsx # 打球分析（シーズンデータ・診断シミュ）
│           ├── pitching/page.tsx  # 投球分析（ストライクゾーン・球種分析）
│           ├── draft/page.tsx     # ドラフト（ウェーバー方式・CPU自動選択）
│           └── trade/page.tsx     # トレード（選手価値算出・CPU交渉）
├── components/             # 共通UIコンポーネント
│   ├── player-ability-card.tsx    # 選手能力カード・グレード色・弾道アイコン
│   ├── lineup-field.tsx           # SVGフィールド図（守備位置ノード）
│   ├── lineup-card.tsx            # 打順カード（選手情報+能力値+成績）
│   ├── batted-ball-trajectory.tsx # 打球軌道可視化（フィールド/サイドビュー）
│   └── player-tooltip.tsx         # 選手ツールチップ
├── engine/                 # ゲームエンジン（純粋関数）
│   ├── index.ts           # バレルエクスポート
│   ├── simulation.ts      # 試合シミュレーション（打席・走塁・投手交代）
│   ├── fielding-ai.ts     # 守備AI（座標系・到達時間計算・判断ロジック）
│   ├── physics-constants.ts # 打球物理の共通定数
│   ├── season.ts          # シーズン生成・スケジュール・順位
│   ├── season-advancement.ts # シーズン進行（1試合/1日/1週間/自チームまで）
│   ├── player-generator.ts # 選手生成（能力値・球種・弾道）
│   ├── lineup.ts          # 打順・ローテ自動構成
│   ├── draft.ts           # ドラフトエンジン（ウェーバー方式）
│   ├── trade.ts           # トレードエンジン（選手価値算出・CPU交渉）
│   ├── awards.ts          # 表彰（MVP・ベストナイン等）
│   ├── playoffs.ts        # プレーオフ・CS
│   ├── preseason.ts       # シーズン前処理
│   ├── offseason.ts       # オフシーズン処理
│   ├── roster-management.ts # ロスター管理
│   └── __tests__/         # Vitestテスト（打球物理・守備分布等）
├── models/                 # 型定義
│   ├── index.ts           # バレルエクスポート
│   ├── player.ts          # Player, BatterSeasonStats, PitcherSeasonStats
│   ├── team.ts            # Team, TeamRecord, TeamLineupConfig
│   ├── league.ts          # Season, ScheduleEntry, League, GameResult, AtBatLog
│   └── game-state.ts      # GameState（セーブデータ構造）
├── db/                     # データ永続化（IndexedDB / Dexie.js）
│   ├── database.ts        # DB定義・テーブルスキーマ
│   ├── save-load.ts       # セーブ/ロードAPI
│   └── helpers.ts         # ヘルパー関数
├── store/
│   └── game-store.ts      # Zustandストア（ゲーム状態・アクション）
└── data/
    └── teams.ts           # 12チームテンプレート（セ6+パ6）


scripts/                   # プロジェクトルート直下
├── test-balance-full.ts   # バランステスト（1000試合、品質ゲート）
└── test-balance.ts        # 簡易バランステスト
```

## アーキテクチャ方針

### エンジン層（`src/engine/`）
- **純粋関数**: `GameState` を受け取り新しい `GameState` を返す
- UIやストアに依存しない
- 物理定数は必ず `physics-constants.ts` からimport

### DB層（`src/db/`）
- Dexie.js（IndexedDB）でセーブデータを永続化
- `save-load.ts` がセーブ/ロードAPIを提供

### ストア層（`src/store/`）
- Zustandでグローバル状態管理
- DB層経由でセーブ/ロード
- エンジン関数をラップしてアクションとして公開

### UI層（`src/app/`）
- 全ページ `"use client"` （ゲームなのでSSR不要）
- Tailwind CSSでスタイリング

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
- 成績指標の定義・計算式は `docs/baseball-knowledge.md` を参照
- 実装パターンは `docs/patterns.md` を参照
- 指標の参考: https://1point02.jp/op/gnav/glossary/gls_index.aspx?cp=101

## ドキュメント体系

| ファイル | 役割 | いつ参照 |
|---|---|---|
| `CLAUDE.md` | プロジェクトの知識・ルール | 常時（自動読込） |
| `task.md` | タスク一覧・完了条件・優先度 | タスク選定時 |
| `GAME_SPEC.md` | ゲームルール・数値設計の仕様 | 実装時・監査時 |
| `docs/baseball-knowledge.md` | 野球ドメイン知識・NPBベンチマーク | 設計時・バランス検証時 |
| `docs/patterns.md` | 実装パターン・アンチパターン | 実装開始前 |
| `docs/design-decisions.md` | 過去の設計判断・バランス調整履歴 | 関連機能の修正時 |
| `docs/autonomous-workflow.md` | 自律開発の詳細手順・ReActループ | 自律モード実行時 |
| `docs/fielding-distribution-analysis.md` | 守備機会分布のNPB実データ分析 | 守備ロジック修正時 |

`GAME_SPEC.md` はゲームバランスに関わる実装を行う際に必ず参照する。
確率・計算式・パラメータを変更した場合は、コードと仕様書を同時に更新する。

## チーム体制（サブエージェント）

PMが専門エージェントに作業を委譲する。定義ファイルは `.claude/agents/` にある。

| 役割 | エージェント名 | モデル | 担当領域 |
|---|---|---|---|
| PM（あなた自身） | メインセッション | opus | 全体統括・タスク分解・Git操作 |
| エンジン実装くん | `impl-engine` | sonnet | engine/ (simulation/fielding-ai/physics/season等) |
| UI実装くん | `impl-ui` | sonnet | app/game/[id]/ 全ページ・components/ |
| データ実装くん | `impl-data` | sonnet | models/・store/・db/・GAME_SPEC/docs |
| 汎用実装くん | `implementer` | sonnet | 領域横断・小規模修正（フォールバック） |
| テストくん | `tester` | haiku | 動作検証（読み取り専用） |
| レビューくん | `reviewer` | sonnet | コードレビュー（編集不可） |
| ガーディアン | `guardian` | sonnet | 品質監査（編集不可） |

### ワークフロー

```
1. PM: task.md を読み、タスクを分解
2. PM → 適切な実装くん: 領域に応じて委譲
3. 実装くん: コード実装 → npm run build → 結果を返す
4. [自動] hook: build + lint チェック
5. PM → ガーディアン: 品質監査（大きい変更時）
6. PM: git commit → push origin → task.md 更新
```

### 運用ルール
- テストくん・レビューくん・ガーディアンはコードを編集しない（指摘のみ）
- 異なる領域の実装くんは並列委譲OK（例: impl-engine + impl-ui）
- `models/player.ts` `store/game-store.ts` を触るタスクは他と並列にしない
- ガーディアンはシミュレーション変更・型変更・大きな機能追加時に呼ぶ
- コミットメッセージは日本語で変更内容を要約
- force-pushは使わない

### 自動化（Hooks）
- **Edit/Write後**: 自動で `npm run build` → 失敗時はClaudeに通知され自動修正
- **実装くん完了後**: 自動で build + lint チェック

## 進捗の可視化ルール

- **すべての進捗表示・報告は日本語で行う**
  - TaskCreate の subject / activeForm は日本語（例: subject「エラー率をスキル依存に変更」、activeForm「エラー率修正中…」）
  - サブエージェントへの Task の description も冒頭に日本語で要約を入れる
- 複数ステップの作業は必ず TaskCreate で進捗追跡
- サブエージェント委譲**前**に「○○を実装くんに任せます」と報告
- ビルドエラーやテスト失敗でループしそうなら即座に状況を報告。黙ってリトライしない

## task.md の運用

- 人間: タスク追加・優先度決定・提案の承認/却下
- PM: 完了マーク・発見タスクの追記（`## PMからの提案`セクション）・CLAUDE.md更新
- PMは正式タスクを勝手に追加・削除しない（提案のみ）

## 自律開発モード

`task.md` の `自律: YES` タスクを人間の指示なしに実行できる。
詳細な手順は `docs/autonomous-workflow.md` を参照。

### 自律判断のルール

| 自律OK | 人間確認が必要 |
|---|---|
| `自律: YES` + 完了条件付きタスク | 新しいUIページの追加 |
| バグ修正（既存動作の回帰） | モデル型の大幅変更（5フィールド以上） |
| バランス調整（NPB準拠範囲が明確） | ゲームルールの新規追加 |
| ドキュメントの実態同期 | ゲームデザイン判断 |

### 暴走防止ルール
1. 完了条件のないタスクは着手しない
2. 迷ったらスキップして次へ
3. 1タスク1コミット（巨大な変更にならないよう分割）
4. ビルドエラー3回リトライで解決しなければ報告して中断
5. ガーディアン差し戻し2回で人間に報告して中断

## セッション開始時の振る舞い

新しいセッションを開始したら、最初に自分の役割を宣言する:

```
PMセッション（デフォルト）:
  「PM担当です。/sprint で現在のスプリント状況を確認できます。」

実装セッション（ユーザーが実装指示を出した場合）:
  「実装担当です。[タスク名] に着手します。」
  → 完了条件を確認してから作業開始
```

判断基準:
- ユーザーの最初のメッセージが設計・相談・管理系 → PM
- ユーザーの最初のメッセージが具体的な実装指示 → 実装担当
- 不明な場合 → PM（デフォルト）

## 開発ワークフロー

### スプリント制（2-3日サイクル）

```
スプリント開始 → /sprint plan でバックログから選定 → GM承認
作業中         → タスクを実行（下記参照）
スプリント終了 → /sprint done で振り返り → 次スプリント計画
```

### タスク実行の流れ

```
1. タスクの規模を判断
   小 (数行〜30行)    → PMタブで直接実装
   中 (30〜100行)     → /delegate でサブエージェントに委譲
   大 (100行+、新ファイル) → 別タブに指示を投入

2. 別タブへの指示テンプレート
   ■ やること: 〇〇を実装して
   ■ 読むべきドキュメント: CLAUDE.md, docs/xxx.md, plan.txt
   ■ 完了条件: build成功, テスト通過, バランステスト通過
   ■ やらないこと: スコープ外の変更を明記

3. 結果確認
   /review で変更内容をレビュー
   問題なければ「コミットして」

4. 次のタスクへ
```

### カスタムコマンド

| コマンド | 用途 |
|---------|------|
| `/sprint` | スプリント状況確認・計画・振り返り |
| `/sprint plan` | 次のスプリントを計画（バックログから選定） |
| `/sprint done` | スプリント振り返り + 次の計画 |
| `/delegate <タスク>` | タスクを適切なサブエージェントに委譲 |
| `/review` | 直近の変更をレビュー（別タブの実装結果確認） |

### 3タブ運用

```
左(縦長): PMタブ（常駐）
  → 計画・相談・小中タスク・進捗管理・コミット
右上: 実装タブA（必要時のみ）
  → 大規模タスク（守備AI書き換え等）
右下: 実装タブB（必要時のみ）
  → もう1つの大タスク（打球生成再設計等）
```

- 右のタブは大タスクがある時だけ開く。終わったら閉じてOK
- 同時に2つの大タスクを並行する時だけ3タブ使う
- 普段はPMタブ + 実装1タブで十分

### 役割分担

| 役割 | 誰 | やること |
|------|-----|---------|
| GM/PO | あなた | 方針決定、優先度判断、承認 |
| PM | Claude (PMタブ) | 設計、タスク分解、委譲、進捗管理、コミット |
| 実装 | サブエージェント or 別タブ | コード実装、テスト通過 |
| 検証 | tester/reviewer/guardian | 品質チェック（読み取り専用） |

### 判断のルール

| 状況 | ルール |
|------|--------|
| 実装していいか？ | バックログにあって完了条件が明確 → YES |
| テストが通らない | 3回リトライで直らない → 報告して中断 |
| 設計で合ってるか？ | NPB統計と比較して範囲内 → OK |
| スコープ外に気づいた | バックログに1行追加 → 今のタスクに戻る |

### 参照すべきドキュメント

| ファイル | 用途 |
|---------|------|
| `docs/project-map.md` | プロジェクト全体図・システム成熟度 |
| `docs/fielding-test-guide.md` | 守備AIのテスト手順・品質基準 |
| `docs/batted-ball-design-context.md` | 打球生成ロジック再設計の前提情報 |

## 既知の問題

- **投手守備機会が少ない**: バント実装済みだが頻度がまだ低い可能性あり
- **フライボール安打率がやや高め(~20%)**: NPB標準(~15%)より高い。外野手デフォルト位置調整で改善可能
