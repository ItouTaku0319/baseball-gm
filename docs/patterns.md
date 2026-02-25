# 実装パターン集

このプロジェクトで頻出する作業の手順書。
PMおよびサブエージェント（特に実装くん）がこのパターンに従って作業することで、抜け漏れを防ぐ。

---

## パターン1: Player型にフィールドを追加する

### 手順
1. **型定義** (`models/player.ts`): フィールドを**optional** (`?:`) で追加
2. **デフォルト値**: 既存データとの互換のため `?? デフォルト値` を使用箇所に追加
3. **選手生成** (`engine/player-generator.ts`): 新規選手生成時にフィールドを設定
4. **セーブ互換**: `store/game-store.ts` の `loadGame()` 内にマイグレーション処理を追加（必要な場合）
5. **GAME_SPEC.md**: 能力値体系セクションにフィールドを追記
6. **UI**: 該当する表示ページ（ロスター等）にフィールドを表示

### チェックリスト
- [ ] フィールドは optional (`?:`) か
- [ ] 既存コードの参照箇所で `?? デフォルト値` が入っているか
- [ ] `npm run build` でフィールド未参照エラーが出ないか
- [ ] 既存セーブデータをロードしてもクラッシュしないか

### 例: 弾道(trajectory)追加時
```typescript
// models/player.ts
interface BatterAbilities {
  // ...既存フィールド
  trajectory?: number; // 1-4, optional for backwards compat
}

// 使用箇所
const traj = batter.trajectory ?? 2; // デフォルト弾道2
```

---

## パターン2: 新しいAtBatResultを追加する

### 手順
1. **型定義** (`models/league.ts` or `engine/simulation.ts`): AtBatResult union型に新しいリテラルを追加
2. **判定ロジック** (`engine/simulation.ts`): `simulateAtBat()`の確率チェーン内に判定を挿入
3. **成績記録** (`engine/simulation.ts`): 該当するPlayerGameStats / PitcherGameLogのフィールドを更新
4. **シーズン集計** (`engine/season-advancement.ts`): `updatePlayerStats()` で累積加算を追加
5. **PO/A/E記録**: 守備成績の記録ロジックを追加
6. **UI表示**:
   - `app/game/[id]/stats/page.tsx`: 成績テーブルに列追加
   - `app/game/[id]/analytics/page.tsx`: 打球分析の結果分類に追加（日本語名・色分け）
7. **GAME_SPEC.md**: 打席判定フローに追記

### チェックリスト
- [ ] AtBatResult型にリテラルが追加されたか
- [ ] simulateAtBat()で判定されるか
- [ ] playerStats/pitcherStatsに正しく記録されるか
- [ ] season-advancement.tsで累積されるか
- [ ] 成績ページに表示されるか
- [ ] analytics/page.tsxの日本語化マッピングに追加されたか
- [ ] GAME_SPEC.mdが更新されたか
- [ ] 1000試合バランステストで新結果の発生頻度が妥当か

---

## パターン3: 物理パラメータを変更する

### 手順
1. **定数変更** (`engine/physics-constants.ts`): 変更する定数を更新
2. **バランステスト**: `npx tsx scripts/test-balance-full.ts --games=1000` を実行
3. **NPB基準と照合**: `docs/baseball-knowledge.md` の「バランステスト基準値」と比較
4. **設計メモ**: `CLAUDE.md` の設計メモセクションに変更理由と検証結果を追記
5. **GAME_SPEC.md**: 該当するパラメータの記述を更新

### チェックリスト
- [ ] physics-constants.ts以外にマジックナンバーが残っていないか
- [ ] バランステスト全指標が正常範囲内か
- [ ] 異常パターン（低速HR、内野ゴロ三塁打等）が増えていないか
- [ ] CLAUDE.mdの設計メモに変更前後の数値を記録したか

### 注意事項
- 物理定数は3ファイル（simulation.ts, fielding-ai.ts, batted-ball-trajectory.tsx）で共有
- **必ず** physics-constants.ts からimportして使う。マジックナンバー禁止
- 1つの定数を変えると他の指標にも連鎖的に影響する。必ずバランステストで確認

---

## パターン4: 新しいページを追加する

### 手順
1. **ページ作成**: `app/game/[id]/xxx/page.tsx` を新規作成
   - `"use client"` を先頭に記述（全ページクライアントサイド）
   - `useParams()` でゲームIDを取得
   - `useGameStore()` でゲーム状態を取得
2. **ナビリンク追加**: `app/game/[id]/page.tsx`（ダッシュボード）にリンクを追加
3. **CLAUDE.md**: ディレクトリ構成セクションにファイルを追記

### テンプレート
```tsx
"use client";

import { useParams } from "next/navigation";
import { useGameStore } from "@/store/game-store";

export default function XxxPage() {
  const params = useParams();
  const game = useGameStore((s) => s.game);

  if (!game) return <div>Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-2xl font-bold mb-4">ページタイトル</h1>
      {/* コンテンツ */}
    </div>
  );
}
```

### UI規約
- 背景: `bg-gray-900`, テキスト: `text-white`
- 数値: `tabular-nums` + 右寄せ
- テーブル: ストライプ(`even:bg-gray-800`) + ホバー(`hover:bg-gray-700`)
- 能力値の色分け: 80+=gold, 65+=green, 50+=white, 35+=orange, <35=red
- 自チーム: `text-blue-400`

---

## パターン5: シミュレーションのバランス調整

### 手順
1. **現状計測**: `npx tsx scripts/test-balance-full.ts --games=1000` で基準値を記録
2. **仮説設定**: 何を変えると何が改善するかを予測
3. **変更実施**: physics-constants.ts または simulation.ts の該当箇所を変更
4. **再計測**: バランステストを再実行
5. **比較記録**: 変更前後の数値をCLAUDE.mdの設計メモに記録
   - 形式: `vN → vN+1: 変更内容。検証結果: AVG.XXX, HR/試合X.XX, ...`
6. **繰り返し**: 目標範囲に収まるまで微調整（最大3回。3回で収まらなければ報告）

### 注意事項
- **1度に1つの変数だけ変える**。複数同時に変えると因果関係が分からなくなる
- 100試合はサンプル不足。品質ゲートは必ず1000試合
- `docs/baseball-knowledge.md` のNPBベンチマークと照合する

---

## パターン6: 投手起用ロジックの変更

### 手順
1. **対象特定**: `engine/simulation.ts` の以下の関数を確認
   - `shouldChangePitcher()`: 交代判定
   - `selectNextPitcher()`: 次の投手選択
   - `changePitcher()`: 交代実行
2. **変更実施**: 該当関数を修正
3. **テスト**: バランステストで以下を確認
   - 投手交代/試合が3-5回（NPB範囲）
   - リリーフ最多IPが100以下（酷使防止）
   - 規定投球回超えリリーフが0人
4. **GAME_SPEC.md**: 投手起用セクションを更新

---

## パターン7: 既存セーブデータのマイグレーション

### 手順
1. **store/game-store.ts** の `loadGame()` 関数内にマイグレーション処理を追加
2. マイグレーションは**冪等**であること（何度実行しても同じ結果）
3. フィールド存在チェック → 未設定なら初期化

### テンプレート
```typescript
// store/game-store.ts loadGame() 内
// === マイグレーション: [機能名] ===
for (const team of Object.values(loaded.teams)) {
  for (const player of team.roster) {
    if (player.newField === undefined) {
      player.newField = defaultValue;
    }
  }
}
```

### 注意事項
- `models/player.ts` のフィールドは**必ずoptional** (`?:`)
- デフォルト値は `?? value` で使用箇所に入れるのが基本
- loadGameでのマイグレーションは「計算が必要な初期値」の場合のみ

---

## アンチパターン（やってはいけないこと）

### 1. マジックナンバーの直書き
```typescript
// BAD
const distance = speed * 0.85 * 0.70;

// GOOD
import { FLIGHT_TIME_FACTOR, DRAG_FACTOR } from './physics-constants';
const distance = speed * FLIGHT_TIME_FACTOR * DRAG_FACTOR;
```

### 2. Player型のrequiredフィールド追加
```typescript
// BAD - 既存セーブデータが壊れる
interface Player {
  injury: InjuryStatus; // required → 既存データにない → クラッシュ
}

// GOOD
interface Player {
  injury?: InjuryStatus; // optional → 既存データと互換
}
```

### 3. バランステストなしの確率変更
物理パラメータ・確率を変更して「npm run buildが通ったからOK」はNG。
必ず1000試合のバランステストを実行する。

### 4. GAME_SPEC.mdの更新忘れ
シミュレーションの数値・ルールを変更してGAME_SPEC.mdを更新しないと、
次のセッションのPMが古い仕様を基に作業してしまう。

### 5. 大きなタスクの一括実装
`simulation.ts` の大規模変更を1つのコミットにまとめない。
論理的な単位（型追加→ロジック→テスト→UI）で分割してコミットする。
