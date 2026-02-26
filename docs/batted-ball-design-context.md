# 打球生成ロジック再設計 — 前提情報

別セッションへのハンドオフ用。このファイルを読めば設計に着手できる状態にする。

---

## 1. 現状の実装

### 打球生成フロー (`simulation.ts`)

```
コンタクト判定 (L1446)
  → contactRate = 0.50 + (contact/100)*0.40 - (avgPitchLevel/7)*0.15
  ↓ 成功
ファウル判定 (L1448-1452)
  → foulRate = 0.40 - (contact/100)*0.10
  → ファウル: strike++ (2S時は変化なし) → 投球に戻る
  → インプレー: generateBattedBall() 呼び出し (L1455)
  ↓
守備判定 → 結果確定
```

### `generateBattedBall()` (simulation.ts:378-420)

```typescript
// 1. 方向 (0-90°にclamp)
dirMean = 45 (S), 38 (R), 52 (L)
pullShift = (power - 50) * 0.08
direction = clamp(gaussianRandom(dirMean, 18), 0, 90)

// 2. 角度 (-15° ~ 70°)
angleMean = 10 + (power-50)*0.08 - (contact-50)*0.04 + (trajectory-2)*3 - sinkerBonus
launchAngle = clamp(gaussianRandom(angleMean, 16), -15, 70)

// 3. 速度 (80-170 km/h)
velMean = 132 + (power-50)*0.15 + (contact-50)*0.15
exitVelocity = clamp(gaussianRandom(velMean - breakingPenalty, 18), 80, 170)

// 4. タイプ分類
type = classifyBattedBallType(launchAngle, exitVelocity)
```

### 打球タイプ分類 (`classifyBattedBallType`, simulation.ts:338-348)

```
launchAngle >= 50°        → popup
launchAngle < 10°         → ground_ball
10-12° && exitVelocity<85 → ground_ball
10-20°                    → line_drive
20-50°                    → fly_ball
```

### 座標系 (fielding-ai.ts)

```
方向: 0° = レフト線, 45° = センター, 90° = ライト線
座標: x = 正→ライト方向(1塁側), 負→レフト方向(3塁側)
      y = 0→ホーム, 正→外野方向
変換: angleRad = (direction - 45) * PI / 180
      x = distance * sin(angleRad)
      y = distance * cos(angleRad)
```

### BattedBall型 (simulation.ts:229-238)

```typescript
interface BattedBall {
  direction: number;      // 0=レフト線, 45=センター, 90=ライト線
  launchAngle: number;    // 負=ゴロ, 0-10=低打球, 10-25=ライナー, 25-50=フライ, 50+=ポップフライ
  exitVelocity: number;   // km/h (80-170)
  type: BattedBallType;   // "ground_ball"|"line_drive"|"fly_ball"|"popup"
}
```

---

## 2. 現状の問題点

### P1: ファウルが確率テーブルのみ

- ファウルは打球方向を生成する**前**に確率で決まる
- 打球の物理特性（方向・角度）とファウルが独立
- ファウルフライアウト（捕手・一塁手・三塁手のファウルゾーン捕球）が存在しない
- ファウルチップ（2S後のファウルで三振）が存在しない

### P2: 方向が0-90°にclamp

- `clamp(gaussianRandom(dirMean, 18), 0, 90)` で強制的にフェアゾーン内
- σ=18のガウシアンなので、0°・90°付近に確率密度の山ができる（clamp artifacts）
- 実際の打球分布は0°や90°を超えてファウルゾーンに広がるべき

### P3: 後方打球が存在しない

- direction < 0°（レフト後方）やdirection > 90°（ライト後方）の打球がない
- キャッチャーポップフライ（ホーム後方に上がる）が再現できない
- 実際の野球ではファウルゾーン後方のフライは頻出

### P4: ファウルフライの守備判定がない

- 現在の守備AI（evaluateFielders / resolvePlayWithAgents）はフェアゾーン内のみ
- ファウルゾーンに飛んだ打球の捕球判定ロジックが必要
- 特にキャッチャー・一塁手・三塁手のファウルフライ守備

---

## 3. 再設計で実現すべきこと

### 必須要件

1. **打球方向の拡張**: 0-90°のフェアゾーンを超えて、ファウルゾーンにも打球が飛ぶ
2. **ファウル判定の物理化**: 方向で判定する（direction < 0° or > 90° → ファウル）
3. **ファウルフライアウト**: ファウルゾーンのフライを野手が捕球 → アウト
4. **ファウルチップ**: 高角度+低速の後方打球 → キャッチャーが捕球 → 三振
5. **clamp artifactsの解消**: ファウルライン際の不自然な密度集中をなくす

### あると良い

6. **打球方向の連続分布**: フェアゾーン内外で自然に連続する確率分布
7. **キャッチャーポップフライ**: 後方高フライの再現
8. **ファウルゾーンの広さ**: 球場によるファウルゾーン面積の差（将来拡張用）

### 統計的制約（NPB準拠）

- ファウルアウト/試合: 約1-2回（大まかな目安）
- ファウルチップ三振: 全三振の5-10%程度
- フェア打球率: コンタクト成功時の60-70%程度（残りがファウル）
- 打球方向分布: プルヒッター傾向は維持（R=引っ張りレフト方向、L=引っ張りライト方向）

---

## 4. 守備AIとの統合ポイント

### エージェント型守備AI（実装中）

`plan.txt` にフルエージェント型守備AIの設計がある。打球生成ロジックの出力は以下を満たす必要がある:

```typescript
// 守備AIが受け取る入力
interface BattedBall {
  direction: number;      // ← 拡張後: -30°~120° 等の広い範囲
  launchAngle: number;
  exitVelocity: number;
  type: BattedBallType;
}
```

### フェア/ファウル判定の責務

```
generateBattedBall()
  → direction を広い範囲で生成（例: -30° ~ 120°）
  ↓
フェア/ファウル判定
  ├→ ファウルゴロ: strike++ → 投球に戻る
  ├→ ファウルフライ: 守備判定（捕球可能か？）
  │    ├→ 捕球成功: アウト
  │    └→ 捕球失敗/到達不可: strike++ → 投球に戻る
  └→ フェア: 通常の守備判定（resolvePlayWithAgents）
```

### ファウルフライ守備に必要なこと

- キャッチャー(2)、一塁手(3)、三塁手(5)がファウルゾーンに移動できること
- 外野手もファウルライン際のフライを追える必要がある
- エージェント型守備AIはフェアゾーン外の座標にも対応可能（移動ロジックは座標ベース）
- ただし守備AI側に「ファウルゾーン打球の場合、キャッチャーはマスクを外す動作(+0.3秒)」等の考慮が必要かもしれない

---

## 5. 関連ファイル

| ファイル | 変更の可能性 | 内容 |
|---------|-------------|------|
| `src/engine/simulation.ts` | **主要変更** | generateBattedBall(), simulateAtBat()のファウル処理 |
| `src/engine/physics-constants.ts` | 追加 | ファウルゾーン関連定数 |
| `src/engine/fielding-ai.ts` or `fielding-agent.ts` | 軽微 | ファウルフライ捕球対応 |
| `src/models/league.ts` | 追加 | AtBatResult に foul_out 等 |

### 触らないファイル

- `src/engine/ball-trajectory.ts` — 打球軌道計算。方向が広がっても同じ物理
- `src/engine/fielding-agent-types.ts` — 型定義。direction の型は number なので変更不要

---

## 6. 参照すべきドキュメント

- `CLAUDE.md` — プロジェクト全体のルール・技術スタック
- `GAME_SPEC.md` — ゲームルール・数値設計の仕様
- `docs/baseball-knowledge.md` — NPBベンチマーク・ドメイン知識
- `docs/fielding-test-guide.md` — 守備テストの手順・品質基準
- `plan.txt` — エージェント型守備AIの設計書（打球入力の仕様確認用）
- `src/engine/physics-constants.ts` — 物理定数一覧

---

## 7. 設計上の注意

1. **simulation.ts は大きいファイル**（1500行+）。変更は最小限に。新関数は外出しも検討
2. **乱数の注入**: 新しい関数には `rng: () => number` を引数で受け取れるようにする（テスト用）
3. **後方互換**: `BattedBall.type` は既存コードが依存。フェア/ファウル判定後にtypeを設定すれば互換性維持
4. **バランステスト**: 変更後は `npx tsx scripts/test-balance-full.ts --games=1000` で統計確認
5. **段階的実装**: まず方向拡張+ファウル物理判定 → 次にファウルフライ守備 → 最後にファウルチップ
