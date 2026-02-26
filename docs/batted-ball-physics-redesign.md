# 打球物理 再設計書

carry廃止・コンタクトモデル導入・物理計算一本化の包括的設計。

---

## 1. 現状の問題

| # | 問題 | 影響 |
|---|---|---|
| P1 | carryが守備AIとHR判定で不整合 | 捕れる打球がHRになる |
| P2 | 角度と初速が独立生成 | 50°+120km/hのポップフライ（非現実的） |
| P3 | ポップフライが40-60mも飛ぶ | 外野手が処理する異常な挙動 |
| P4 | ファウルが確率テーブルのみ | ファウルフライアウト・ファウルチップなし |
| P5 | 方向が0-90°にclamp | ファウルゾーン打球が存在しない |
| P6 | 弾道(trajectory)の効果がcarryだけ | carry廃止後の弾道表現が必要 |

---

## 2. 設計原則

1. **物理計算は1系統のみ**: `calcBallLanding()` が唯一の着地点計算。HR判定も守備AIも同じ値を使う
2. **角度と初速は相関する**: バット-ボール衝突物理に基づく（Statcastエンベロープカーブ）
3. **コンタクト品質モデル**: 打球の全属性を「当たり方」から一貫して導出
4. **carry廃止**: `TRAJECTORY_CARRY_FACTORS` を削除。弾道は角度分布で表現

---

## 3. コンタクトモデル

### 3.1 概念

打球の全属性は2つの根本要因から決まる：

```
┌─────────────────────────────────────────────────────┐
│  contactOffset: バットがボールのどこに当たったか      │
│    -1.0 = 極端に上を叩く（強いゴロ）                │
│     0.0 = 芯（ライナー/バレル）                      │
│    +1.0 = 極端に下を擦る（ポップフライ）             │
│                                                       │
│  timing: スイングのタイミング                        │
│    -1.0 = 非常に早い（引っ張り方向）                 │
│     0.0 = ジャスト                                    │
│    +1.0 = 非常に遅い（流し方向）                     │
│    ±1.5超 = ファウルゾーンに飛ぶ                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 contactOffset → 角度 + 初速

**角度の決定**:
```
launchAngle = PEAK_ANGLE + contactOffset × ANGLE_SPREAD
  PEAK_ANGLE = 10°（芯の打ち出し角度）
  ANGLE_SPREAD = 60°（offsetが±1.0で角度が±60°振れる）

例:
  offset = 0.0 → angle = 10°（ライナー）
  offset = +0.5 → angle = 40°（高フライ）
  offset = +1.0 → angle = 70°（ポップフライ）
  offset = -0.5 → angle = -20°（強ゴロ）
  offset = -1.0 → angle = -50° → clamp to -15°
```

**初速の決定（エンベロープカーブ）**:

Statcastデータと衝突物理に基づく。芯で捉えた時が最大で、角度が極端になるほど初速が低下する:

```
exitVelocity = playerMaxEV × efficiencyFactor(launchAngle)

efficiencyFactor:
  角度       効率    根拠
  ─────────────────────────
  -15°      0.80    叩きつけ（エネルギーが地面に逃げる）
  -10°      0.85    強いゴロ
   -5°      0.90    ゴロ
    0°      0.94    低いライナー
    5°      0.97    低いライナー
   10°      1.00    ← ピーク（芯）
   15°      0.99    ライナー
   20°      0.97    フライ
   25°      0.93    フライ
   30°      0.88    高フライ
   35°      0.82    高フライ（擦り始め）
   40°      0.74    フライ/ポップ境界
   45°      0.65    ポップフライ
   50°      0.55    ポップフライ
   55°      0.47    ポップフライ（かなり擦った）
   60°      0.40    極端なポップ
   70°      0.30    極端なポップ
```

この効率曲線は以下の式で近似可能:
```
efficiency = 1.0 - ((launchAngle - 10) / 70)² × 0.7
```
ただし角度10°で最大1.0、-15°で≈0.80、70°で≈0.30。

**初速の最大値（playerMaxEV）**:
```
playerMaxEV = 130 + (power / 100) × 40  [km/h]
  power=10:  134 km/h
  power=50:  150 km/h
  power=80:  162 km/h
  power=100: 170 km/h
```

**結果の飛距離の例（D50選手, maxEV=150km/h）**:

| 角度 | 効率 | 初速 | 計算飛距離 | 打球種別 |
|---|---|---|---|---|
| -10° | 0.85 | 128 km/h | ゴロ30m | ground_ball |
| 0° | 0.94 | 141 km/h | ゴロ40m | ground_ball |
| 10° | 1.00 | 150 km/h | ライナー35m | line_drive |
| 20° | 0.97 | 146 km/h | フライ55m | fly_ball |
| 30° | 0.88 | 132 km/h | フライ55m | fly_ball |
| 40° | 0.74 | 111 km/h | フライ38m | fly_ball |
| 50° | 0.55 | 83 km/h | ポップ22m | popup |
| 60° | 0.40 | 60 km/h | ポップ10m | popup |

ポップフライが20-30m以内に収まり、現実的になる。

### 3.3 timing → 方向

```
direction = basePull + timing × DIRECTION_SPREAD + noise

basePull:
  右打者: 38°（レフト方向寄り）
  左打者: 52°（ライト方向寄り）
  スイッチ: 45°

DIRECTION_SPREAD = 30°
noise = gaussianRandom(0, 8)  （打球のブレ）

例（右打者）:
  timing = -1.0 → direction = 38 + (-1.0)×30 + noise = 8° + noise（引っ張り）
  timing =  0.0 → direction = 38 + noise（センター寄り）
  timing = +1.0 → direction = 38 + 30 + noise = 68° + noise（流し打ち）
  timing = +1.5 → direction = 38 + 45 + noise = 83° + noise（ファウル領域に近い）
```

方向の範囲を **-30° ~ 120°** に拡張:
- direction < 0° → レフトファウルゾーン
- 0° ≤ direction ≤ 90° → フェアゾーン
- direction > 90° → ライトファウルゾーン

### 3.4 contactOffset と timing の生成

```
contactOffset = gaussianRandom(offsetMean, offsetSigma)
timing = gaussianRandom(timingMean, timingSigma)

offsetMean:
  0.0（基本はど真ん中狙い）
  + (trajectory - 2) × 0.08   弾道が高いほどやや下を打つ傾向
  - sinkerBonus               シンカー系はゴロ誘発

offsetSigma:
  0.40 - (contact / 100) × 0.15   ミートが高いほど散らばりが小さい
  + (avgPitchLevel / 7) × 0.05    変化球が多いほど散らばる

timingMean:
  0.0（基本はジャストタイミング狙い）
  + speedPenalty               速球が速いほど振り遅れやすい

timingSigma:
  0.50 - (contact / 100) × 0.15   ミートが高いほど安定
  + (avgPitchLevel / 7) × 0.05    変化球でバラつく
```

### 3.5 弾道(trajectory)の表現

carry廃止後の弾道の効果:

```
弾道1（ゴロヒッター）:   offsetMean += -0.08  → ゴロが多い
弾道2（普通）:           offsetMean += 0.00
弾道3（やや上がる）:     offsetMean += +0.08  → フライが増える
弾道4（フライ/アーチ）:  offsetMean += +0.16  → 高フライ・HR狙い
```

弾道4は角度が上がりやすい（offset正方向）が、エンベロープで初速が自然に減衰するので「フライが増えるがポップフライのリスクもある」というトレードオフが生まれる。

---

## 4. 物理計算の一本化

### 4.1 calcBallLanding の改修

変更なし。現在の `calcBallLanding(direction, launchAngle, exitVelocity)` がそのまま唯一の物理計算として機能する。carry は適用しない。

### 4.2 HR判定の改修

```
Before:
  distance = estimateDistance(exitVelocity, launchAngle)
  effectiveDistance = distance × carryFactor    ← 削除
  if effectiveDistance >= fenceDist → HR判定

After:
  landing = calcBallLanding(direction, launchAngle, exitVelocity)
  if landing.distance >= fenceDist → HR判定
```

`checkHomeRun` 関数を簡素化:
- `TRAJECTORY_CARRY_FACTORS` の参照を全て削除
- `estimateDistance` の代わりに `calcBallLanding` の結果を使用
- `heightAtFence` の計算はフライの最高到達点から概算（または `createBallTrajectory` を使用）

### 4.3 削除するもの

- `TRAJECTORY_CARRY_FACTORS` 定数
- `estimateDistance()` 関数（calcBallLandingに統合）
- `checkHomeRun` 内のcarry適用ロジック
- atBatLog生成部のcarry適用

---

## 5. ファウル判定の物理化

### 5.1 判定フロー

```
generateBattedBall()
  → direction を -30°~120° で生成
  ↓
isFoul = direction < 0 || direction > 90
  ├→ フェア (0°~90°): resolvePlayWithAgents() → 通常守備判定
  └→ ファウル:
      ├→ ゴロ or 低角度: foulBall → strike++
      ├→ フライ（捕球可能範囲）: 守備判定
      │    ├→ 捕球成功: foul_out → アウト
      │    └→ 捕球失敗/到達不可: foulBall → strike++
      └→ ファウルチップ（後方+高角度+低速）:
           ├→ 2S時 + キャッチャー捕球: strikeout
           └→ それ以外: strike++
```

### 5.2 ファウルチップの条件

```
isFoulTip =
  direction < -15° || direction > 105°    （後方ファウル）
  && launchAngle > 30°                     （上に飛ぶ）
  && exitVelocity < 80 km/h               （弱い当たり）
```

### 5.3 ファウルフライの守備

キャッチャー(2)、一塁手(3)、三塁手(5)がファウルゾーンで捕球可能。
外野手もファウルライン際のフライを追える。

resolvePlayWithAgentsにファウルゾーン対応を追加する形で実装可能（座標ベースなので方向拡張のみ）。

---

## 6. 打球タイプ分類の改定

現在の分類をほぼ維持するが、初速との相関で自然な分布になる:

```
launchAngle >= 50°          → popup    (EV自然に低い: 50-90km/h)
launchAngle < 10°           → ground_ball
10° ≤ la < 20°              → line_drive
20° ≤ la < 50°              → fly_ball
```

`10-12° かつ EV<85` の特殊ルールは廃止可能（エンベロープで自然にEVが低くならないため）。

---

## 7. 実装フェーズ

### Phase A: コンタクトモデル + carry廃止（最優先）

1. `generateBattedBall()` をコンタクトモデルに改修
   - contactOffset → angle + velocity（相関生成）
   - timing → direction
2. `TRAJECTORY_CARRY_FACTORS` 削除
3. HR判定を `calcBallLanding` ベースに統一
4. グリッドテストで検証（5,586パターン）
5. バランステスト（1000試合）で統計確認

### Phase B: ファウル判定の物理化

1. direction範囲を -30°~120° に拡張
2. ファウル/フェア判定を方向ベースに変更
3. ファウルフライの守備判定追加
4. ファウルチップ実装

### Phase C: 守備AIとの統合

1. resolvePlayWithAgentsのファウルゾーン対応
2. simulation.ts のレガシーAPI → エージェントAPI切り替え
3. 分布テスト再調整

---

## 8. 検証基準（NPB準拠）

| 指標 | 目標範囲 | 根拠 |
|---|---|---|
| チーム打率 | .240-.280 | NPB平均 |
| HR/試合(両チーム) | 1.0-1.5 | NPB平均 |
| K% | 15-25% | NPB平均 |
| BB% | 7-12% | NPB平均 |
| BABIP | .280-.320 | NPB平均 |
| GO/AO | 0.8-1.3 | NPB平均 |
| 内野安打率 | 3-7% | NPB推定 |
| ポップフライ飛距離 | 10-30m | 内野内 |
| ファウルアウト/試合 | 1-2回 | NPB推定 |

---

## 9. 参考資料

- [MLB Barrel定義](https://www.mlb.com/glossary/statcast/barrel) — 初速98mph+, 角度26-30°から拡大
- [The Physics of Barreled Balls (Hardball Times)](https://tht.fangraphs.com/the-physics-of-barreled-balls/) — 角度-初速エンベロープカーブ
- [Alan Nathan Baseball Physics](https://baseball.physics.illinois.edu/) — 軌道計算モデル
- [Baseball Savant Field Breakdown](https://baseballsavant.mlb.com/statcast_field) — 初速×角度の結果分布
- [RPP Baseball Launch Angles](https://rocklandpeakperformance.com/baseball-launch-angles-exit-velos/) — 角度帯別の打球結果データ
