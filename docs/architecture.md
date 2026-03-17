# アーキテクチャ方針

## レイヤー構成

```
UI層 (src/app/)
  ↓ 利用
ストア層 (src/store/)
  ↓ 利用          ↓ 永続化
エンジン層 (src/engine/)   DB層 (src/db/)
  ↓ 参照
モデル層 (src/models/)
```

## エンジン層 (`src/engine/`)

- **純粋関数**: `GameState` を受け取り新しい `GameState` を返す
- UIやストアに依存しない
- 物理定数は必ず `physics-constants.ts` からimport
- 主要ファイル:
  - `simulation.ts` — 試合シミュレーション
  - `fielding-agent.ts` — エージェント型守備AI（台本方式）
  - `autonomous-fielder.ts` — フライ/ライナー自律判断
  - `ball-trajectory.ts` — 打球軌道計算
  - `physics-constants.ts` — 物理定数一元管理
  - `season-engine.ts` — シーズン進行

## DB層 (`src/db/`)

- Dexie.js（IndexedDB）でセーブデータを永続化
- `save-load.ts` がセーブ/ロードAPIを提供
- スキーマ変更時はマイグレーションを忘れない

## ストア層 (`src/store/`)

- Zustandでグローバル状態管理
- DB層経由でセーブ/ロード
- エンジン関数をラップしてアクションとして公開

## UI層 (`src/app/`)

- 全ページ `"use client"` （ゲームなのでSSR不要）
- Tailwind CSSでスタイリング
- ストア層のみ参照（エンジン層を直接呼ばない）

## 依存ルール

- エンジン層はUI/ストア/DBに依存**しない**
- DB層はエンジン層に依存**しない**
- ストア層はエンジン層とDB層の両方を利用する
- UI層はストア層のみ参照する
- models/ は全レイヤーから参照される（型定義のみ）
