/**
 * 打球生成の統計テスト
 *
 * generateBattedBall の分布を打者/投手プロファイル別に検証
 */
import { describe, it, expect } from "vitest";
import { generateBattedBall, classifyBattedBallType, isFairBall } from "@/engine/simulation";
import { DIRECTION_MIN, DIRECTION_MAX } from "@/engine/physics-constants";
import {
  BATTER_PROFILES,
  PITCHER_PROFILES,
  createBatter,
  createPitcher,
  mean,
  stdDev,
  percentile,
  statSummary,
  histogram,
  formatTable,
} from "./helpers";
import type { Player } from "@/models/player";

const N = 5000; // 各テストの試行回数

/** N回打球を生成して統計を収集 */
function collectBalls(batter: Player, pitcher: Player, n: number = N) {
  const directions: number[] = [];
  const angles: number[] = [];
  const velocities: number[] = [];
  const types: Record<string, number> = { ground_ball: 0, line_drive: 0, fly_ball: 0, popup: 0 };

  for (let i = 0; i < n; i++) {
    const ball = generateBattedBall(batter, pitcher);
    directions.push(ball.direction);
    angles.push(ball.launchAngle);
    velocities.push(ball.exitVelocity);
    types[ball.type]++;
  }

  return { directions, angles, velocities, types, n };
}

/** タイプ分布をパーセンテージで表示 */
function typeDistStr(types: Record<string, number>, n: number): string {
  return Object.entries(types)
    .map(([t, c]) => `${t}: ${((c / n) * 100).toFixed(1)}%`)
    .join(", ");
}

describe("generateBattedBall: 値域チェック", () => {
  const batter = createBatter();
  const pitcher = createPitcher();

  it("direction は DIRECTION_MIN-DIRECTION_MAX の範囲（フェア/ファウル連続分布）", () => {
    for (let i = 0; i < N; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(ball.direction).toBeGreaterThanOrEqual(DIRECTION_MIN);
      expect(ball.direction).toBeLessThanOrEqual(DIRECTION_MAX);
    }
  });

  it("launchAngle は -15~70 の範囲", () => {
    for (let i = 0; i < N; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(ball.launchAngle).toBeGreaterThanOrEqual(-15);
      expect(ball.launchAngle).toBeLessThanOrEqual(70);
    }
  });

  it("exitVelocity は 60-185 の範囲", () => {
    // コンタクトモデル: exitVelocity は clamp(baseEV * (1.0 + noise), 60, 185) で生成
    for (let i = 0; i < N; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(ball.exitVelocity).toBeGreaterThanOrEqual(60);
      expect(ball.exitVelocity).toBeLessThanOrEqual(185);
    }
  });

  it("type は classifyBattedBallType と一致", () => {
    for (let i = 0; i < 1000; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(ball.type).toBe(classifyBattedBallType(ball.launchAngle, ball.exitVelocity));
    }
  });

  it("1000球生成してフェア率を検証", () => {
    // コンタクトモデル: timingSigma=1.50でD50のファウル率≈31%、フェア率≈69%
    const n = 1000;
    let fairCount = 0;
    for (let i = 0; i < n; i++) {
      const ball = generateBattedBall(batter, pitcher);
      if (isFairBall(ball.direction)) fairCount++;
    }
    const fairRate = fairCount / n;
    console.log(`フェア率: ${(fairRate * 100).toFixed(1)}% (${fairCount}/${n})`);
    expect(fairRate).toBeGreaterThan(0.55);
    expect(fairRate).toBeLessThan(0.85);
  });

  it("0°/90° 付近のclamp artifactがないこと", () => {
    const n = 5000;
    const directions: number[] = [];
    for (let i = 0; i < n; i++) {
      directions.push(generateBattedBall(batter, pitcher).direction);
    }
    // 境界付近のビン (0±2° と 90±2°) に不自然な集中がないことを確認
    const nearZero = directions.filter(d => d >= -2 && d <= 2).length;
    const nearNinety = directions.filter(d => d >= 88 && d <= 92).length;
    const midRange = directions.filter(d => d >= 43 && d <= 47).length;

    // 境界ビンが中央ビンの3倍以上なら artifact
    console.log(`0°付近: ${nearZero}, 90°付近: ${nearNinety}, 45°付近: ${midRange}`);
    expect(nearZero).toBeLessThan(midRange * 3);
    expect(nearNinety).toBeLessThan(midRange * 3);
  });
});

describe("generateBattedBall: 打者プロファイル別の分布", () => {
  const pitcher = createPitcher();
  const profiles = [
    { name: "平均的打者", player: BATTER_PROFILES.average() },
    { name: "巧打者(C80/P30)", player: BATTER_PROFILES.contactHitter() },
    { name: "強打者(C40/P90)", player: BATTER_PROFILES.powerHitter() },
    { name: "長距離砲(P95/弾4)", player: BATTER_PROFILES.slugger() },
    { name: "俊足巧打(C70/S90)", player: BATTER_PROFILES.speedster() },
    { name: "弱打者(C25/P20)", player: BATTER_PROFILES.weak() },
  ] as const;

  it("全プロファイルの統計サマリー", () => {
    const headers = [
      "プロファイル",
      "方向平均", "方向σ",
      "角度平均", "角度σ",
      "速度平均", "速度σ",
      "ゴロ%", "ライナー%", "フライ%", "PF%",
    ];
    const rows: (string | number)[][] = [];

    for (const { name, player } of profiles) {
      const { directions, angles, velocities, types, n } = collectBalls(player, pitcher);

      rows.push([
        name,
        mean(directions).toFixed(1),
        stdDev(directions).toFixed(1),
        mean(angles).toFixed(1),
        stdDev(angles).toFixed(1),
        mean(velocities).toFixed(1),
        stdDev(velocities).toFixed(1),
        ((types.ground_ball / n) * 100).toFixed(1),
        ((types.line_drive / n) * 100).toFixed(1),
        ((types.fly_ball / n) * 100).toFixed(1),
        ((types.popup / n) * 100).toFixed(1),
      ]);
    }

    console.log("\n=== 打者プロファイル別 打球統計 ===");
    console.log(formatTable(headers, rows));

    // 基本的な検証
    // 強打者は速度平均が高い
    const powerStats = collectBalls(BATTER_PROFILES.powerHitter(), pitcher);
    const weakStats = collectBalls(BATTER_PROFILES.weak(), pitcher);
    expect(mean(powerStats.velocities)).toBeGreaterThan(mean(weakStats.velocities));
  });

  it("パワー別: 打球速度の変化", () => {
    const powers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const headers = ["パワー", "速度平均", "速度σ", "速度P5", "速度P95"];
    const rows: (string | number)[][] = [];

    for (const p of powers) {
      const batter = createBatter({ power: p });
      const { velocities } = collectBalls(batter, pitcher, 3000);
      rows.push([
        String(p),
        mean(velocities).toFixed(1),
        stdDev(velocities).toFixed(1),
        percentile(velocities, 5).toFixed(1),
        percentile(velocities, 95).toFixed(1),
      ]);
    }

    console.log("\n=== パワー別 打球速度 ===");
    console.log(formatTable(headers, rows));
  });

  it("弾道別: 打球角度の変化", () => {
    const trajectories = [1, 2, 3, 4];
    const headers = ["弾道", "角度平均", "角度σ", "ゴロ%", "ライナー%", "フライ%", "PF%"];
    const rows: (string | number)[][] = [];

    for (const t of trajectories) {
      const batter = createBatter({ trajectory: t });
      const { angles, types, n } = collectBalls(batter, pitcher, 3000);
      rows.push([
        String(t),
        mean(angles).toFixed(1),
        stdDev(angles).toFixed(1),
        ((types.ground_ball / n) * 100).toFixed(1),
        ((types.line_drive / n) * 100).toFixed(1),
        ((types.fly_ball / n) * 100).toFixed(1),
        ((types.popup / n) * 100).toFixed(1),
      ]);
    }

    console.log("\n=== 弾道別 打球角度・タイプ分布 ===");
    console.log(formatTable(headers, rows));

    // 弾道が高いほど角度平均が高いはず
    const t1 = collectBalls(createBatter({ trajectory: 1 }), pitcher, 3000);
    const t4 = collectBalls(createBatter({ trajectory: 4 }), pitcher, 3000);
    expect(mean(t4.angles)).toBeGreaterThan(mean(t1.angles));
  });
});

describe("generateBattedBall: 投手プロファイル別の分布", () => {
  const batter = createBatter();
  const profiles = [
    { name: "平均的投手", player: PITCHER_PROFILES.average() },
    { name: "速球派(160km)", player: PITCHER_PROFILES.flamethrower() },
    { name: "技巧派(135km/C80)", player: PITCHER_PROFILES.craftsman() },
    { name: "シンカーボーラー", player: PITCHER_PROFILES.sinkerBaller() },
    { name: "フォークボーラー", player: PITCHER_PROFILES.forkBaller() },
    { name: "多彩な球種", player: PITCHER_PROFILES.versatile() },
  ] as const;

  it("全プロファイルの統計サマリー", () => {
    const headers = [
      "プロファイル",
      "方向平均", "角度平均", "速度平均",
      "ゴロ%", "ライナー%", "フライ%", "PF%",
    ];
    const rows: (string | number)[][] = [];

    for (const { name, player } of profiles) {
      const { directions, angles, velocities, types, n } = collectBalls(batter, player);
      rows.push([
        name,
        mean(directions).toFixed(1),
        mean(angles).toFixed(1),
        mean(velocities).toFixed(1),
        ((types.ground_ball / n) * 100).toFixed(1),
        ((types.line_drive / n) * 100).toFixed(1),
        ((types.fly_ball / n) * 100).toFixed(1),
        ((types.popup / n) * 100).toFixed(1),
      ]);
    }

    console.log("\n=== 投手プロファイル別 打球統計 ===");
    console.log(formatTable(headers, rows));
  });

  it("シンカーボーラーはゴロ率が高い", () => {
    const sinkerStats = collectBalls(batter, PITCHER_PROFILES.sinkerBaller());
    const avgStats = collectBalls(batter, PITCHER_PROFILES.average());

    const sinkerGBRate = sinkerStats.types.ground_ball / sinkerStats.n;
    const avgGBRate = avgStats.types.ground_ball / avgStats.n;

    expect(sinkerGBRate).toBeGreaterThan(avgGBRate);
    console.log(`\nシンカーボーラーのゴロ率: ${(sinkerGBRate * 100).toFixed(1)}% (平均: ${(avgGBRate * 100).toFixed(1)}%)`);
  });
});

describe("generateBattedBall: 左右打者の方向分布", () => {
  const pitcher = createPitcher();

  it("右打者はレフト方向 (方向平均 < 45°) にプル傾向", () => {
    const rBatter = createBatter({}, { batSide: "R" });
    const { directions } = collectBalls(rBatter, pitcher);
    expect(mean(directions)).toBeLessThan(45);
    console.log(`\n右打者の方向平均: ${mean(directions).toFixed(1)}°`);
  });

  it("左打者はライト方向 (方向平均 > 45°) にプル傾向", () => {
    const lBatter = createBatter({}, { batSide: "L" });
    const { directions } = collectBalls(lBatter, pitcher);
    expect(mean(directions)).toBeGreaterThan(45);
    console.log(`左打者の方向平均: ${mean(directions).toFixed(1)}°`);
  });

  it("打球方向のヒストグラム（右打者 vs 左打者）", () => {
    const rBatter = createBatter({}, { batSide: "R" });
    const lBatter = createBatter({}, { batSide: "L" });
    const rStats = collectBalls(rBatter, pitcher, 5000);
    const lStats = collectBalls(lBatter, pitcher, 5000);

    console.log("\n=== 右打者の方向分布 ===");
    const rHist = histogram(rStats.directions, 9);
    for (const bin of rHist) {
      const bar = "#".repeat(Math.round(bin.count / 50));
      console.log(`  ${bin.range.padEnd(12)} ${bin.pct.padStart(6)} ${bar}`);
    }

    console.log("\n=== 左打者の方向分布 ===");
    const lHist = histogram(lStats.directions, 9);
    for (const bin of lHist) {
      const bar = "#".repeat(Math.round(bin.count / 50));
      console.log(`  ${bin.range.padEnd(12)} ${bin.pct.padStart(6)} ${bar}`);
    }
  });
});

describe("generateBattedBall: 打球角度のヒストグラム", () => {
  const pitcher = createPitcher();

  it("平均的打者の打球角度分布", () => {
    const batter = createBatter();
    const { angles } = collectBalls(batter, pitcher, 10000);

    console.log("\n=== 打球角度分布 (平均的打者) ===");
    const hist = histogram(angles, 17); // ~5°刻み
    for (const bin of hist) {
      const bar = "#".repeat(Math.round(bin.count / 80));
      console.log(`  ${bin.range.padEnd(14)} ${bin.pct.padStart(6)} ${bar}`);
    }
    console.log(statSummary("打球角度", angles));
  });
});

describe("generateBattedBall: 打球速度のヒストグラム", () => {
  const pitcher = createPitcher();

  it("パワー別の打球速度分布", () => {
    for (const power of [30, 50, 80]) {
      const batter = createBatter({ power });
      const { velocities } = collectBalls(batter, pitcher, 5000);

      console.log(`\n=== 打球速度分布 (パワー=${power}) ===`);
      const hist = histogram(velocities, 9);
      for (const bin of hist) {
        const bar = "#".repeat(Math.round(bin.count / 50));
        console.log(`  ${bin.range.padEnd(14)} ${bin.pct.padStart(6)} ${bar}`);
      }
    }
  });
});
