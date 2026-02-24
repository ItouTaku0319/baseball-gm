/**
 * 統計レポートテスト
 *
 * 大量シミュレーションを回してNPB準拠の統計データを出力
 * `npx vitest run --reporter=verbose batted-ball-lab/statistical-report` で実行
 */
import { describe, it, expect } from "vitest";
import { generateBattedBall, classifyBattedBallType, estimateDistance, getFenceDistance } from "@/engine/simulation";
import { calcBallLanding, evaluateFielders, resolveHitTypeFromLanding } from "@/engine/fielding-ai";
import {
  createBatter,
  createPitcher,
  createFielderMap,
  BATTER_PROFILES,
  PITCHER_PROFILES,
  mean,
  stdDev,
  percentile,
  statSummary,
  formatTable,
} from "./helpers";
import type { Player } from "@/models/player";

const LARGE_N = 10000;

/** 打球→着地→守備→結果までの全パイプラインを1打球分実行 */
function simulateOneBattedBall(batter: Player, pitcher: Player, fielderMap: Map<1|2|3|4|5|6|7|8|9, Player>) {
  const ball = generateBattedBall(batter, pitcher);
  const landing = calcBallLanding(ball.direction, ball.launchAngle, ball.exitVelocity);
  const distance = ball.launchAngle > 0 ? estimateDistance(ball.exitVelocity, ball.launchAngle) : 0;
  const fenceDist = getFenceDistance(ball.direction);
  const ratio = distance / fenceDist;
  const fieldingResult = evaluateFielders(landing, ball.type, fielderMap);
  const primary = [...fieldingResult.values()].find(d => d.role === "primary");

  // HR判定
  let isHR = false;
  if (ball.type === "fly_ball" && ratio >= 1.05) {
    isHR = true;
  } else if (ball.type === "fly_ball" && ratio >= 0.95) {
    const powerBonus = (batter.batting.power - 50) * 0.002;
    const hrChance = Math.max(0.01, Math.min(0.90, (ratio - 0.95) / 0.10 + powerBonus));
    isHR = Math.random() < hrChance;
  }

  return {
    ball,
    landing,
    distance,
    fenceDist,
    ratio,
    isHR,
    primary,
    canReach: primary?.canReach ?? false,
  };
}

describe("統計レポート: 全体分布", () => {
  it("平均的な打者 vs 平均的な投手 (N=10000)", () => {
    const batter = createBatter();
    const pitcher = createPitcher();
    const fielderMap = createFielderMap();

    const typeCounts = { ground_ball: 0, line_drive: 0, fly_ball: 0, popup: 0 };
    const directions: number[] = [];
    const angles: number[] = [];
    const velocities: number[] = [];
    const distances: number[] = [];
    let hrCount = 0;
    let canReachCount = 0;

    for (let i = 0; i < LARGE_N; i++) {
      const result = simulateOneBattedBall(batter, pitcher, fielderMap);
      typeCounts[result.ball.type]++;
      directions.push(result.ball.direction);
      angles.push(result.ball.launchAngle);
      velocities.push(result.ball.exitVelocity);
      if (result.distance > 0) distances.push(result.distance);
      if (result.isHR) hrCount++;
      if (result.canReach) canReachCount++;
    }

    console.log("\n" + "=".repeat(60));
    console.log("  打球計算エンジン 統計レポート");
    console.log("  平均的打者 vs 平均的投手");
    console.log("  N = " + LARGE_N);
    console.log("=".repeat(60));

    console.log("\n--- 打球タイプ分布 ---");
    for (const [type, count] of Object.entries(typeCounts)) {
      const pct = ((count / LARGE_N) * 100).toFixed(1);
      const bar = "#".repeat(Math.round(count / 200));
      console.log(`  ${type.padEnd(12)} ${String(count).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
    }

    console.log("\n" + statSummary("打球方向 (°)", directions));
    console.log("\n" + statSummary("打球角度 (°)", angles));
    console.log("\n" + statSummary("打球速度 (km/h)", velocities));
    console.log("\n" + statSummary("飛距離 (m, フライのみ)", distances));

    console.log(`\n--- HR統計 ---`);
    console.log(`  HR数: ${hrCount} / ${LARGE_N} (${((hrCount / LARGE_N) * 100).toFixed(2)}%)`);
    console.log(`  守備到達可能率: ${((canReachCount / LARGE_N) * 100).toFixed(1)}%`);

    // NPB参考値との比較
    console.log("\n--- NPB参考値との比較 ---");
    const gbPct = (typeCounts.ground_ball / LARGE_N) * 100;
    const ldPct = (typeCounts.line_drive / LARGE_N) * 100;
    const fbPct = (typeCounts.fly_ball / LARGE_N) * 100;
    const pfPct = (typeCounts.popup / LARGE_N) * 100;
    console.log(`  ゴロ率: ${gbPct.toFixed(1)}% (NPB参考: 40-50%)`);
    console.log(`  ライナー率: ${ldPct.toFixed(1)}% (NPB参考: 20-25%)`);
    console.log(`  フライ率: ${fbPct.toFixed(1)}% (NPB参考: 25-35%)`);
    console.log(`  ポップフライ率: ${pfPct.toFixed(1)}% (NPB参考: 5-10%)`);
    console.log(`  HR/インプレー: ${((hrCount / LARGE_N) * 100).toFixed(2)}% (NPB参考: 2-4%)`);

    // 最低限の検証
    expect(gbPct).toBeGreaterThan(20);
    expect(fbPct).toBeGreaterThan(10);
  });
});

describe("統計レポート: 打者プロファイル別の比較", () => {
  it("全プロファイルの打球分布と HR率", () => {
    const pitcher = createPitcher();
    const fielderMap = createFielderMap();

    const profiles = [
      { name: "平均的", player: BATTER_PROFILES.average() },
      { name: "巧打者", player: BATTER_PROFILES.contactHitter() },
      { name: "強打者", player: BATTER_PROFILES.powerHitter() },
      { name: "長距離砲", player: BATTER_PROFILES.slugger() },
      { name: "俊足巧打", player: BATTER_PROFILES.speedster() },
      { name: "弱打者", player: BATTER_PROFILES.weak() },
      { name: "左打者", player: BATTER_PROFILES.lefty() },
    ];

    const N = 5000;
    const headers = [
      "プロファイル",
      "ゴロ%", "LD%", "FB%", "PF%",
      "速度平均", "角度平均", "飛距離平均",
      "HR%", "到達可能%",
    ];
    const rows: (string | number)[][] = [];

    for (const { name, player } of profiles) {
      const types = { ground_ball: 0, line_drive: 0, fly_ball: 0, popup: 0 };
      const vels: number[] = [];
      const angs: number[] = [];
      const dists: number[] = [];
      let hrs = 0;
      let reachable = 0;

      for (let i = 0; i < N; i++) {
        const r = simulateOneBattedBall(player, pitcher, fielderMap);
        types[r.ball.type]++;
        vels.push(r.ball.exitVelocity);
        angs.push(r.ball.launchAngle);
        if (r.distance > 0) dists.push(r.distance);
        if (r.isHR) hrs++;
        if (r.canReach) reachable++;
      }

      rows.push([
        name,
        ((types.ground_ball / N) * 100).toFixed(1),
        ((types.line_drive / N) * 100).toFixed(1),
        ((types.fly_ball / N) * 100).toFixed(1),
        ((types.popup / N) * 100).toFixed(1),
        mean(vels).toFixed(1),
        mean(angs).toFixed(1),
        dists.length > 0 ? mean(dists).toFixed(1) : "-",
        ((hrs / N) * 100).toFixed(2),
        ((reachable / N) * 100).toFixed(1),
      ]);
    }

    console.log("\n=== 打者プロファイル別 打球統計レポート ===");
    console.log(formatTable(headers, rows));

    // 長距離砲のHR率 > 弱打者のHR率
    const sluggerHR = rows.find(r => r[0] === "長距離砲");
    const weakHR = rows.find(r => r[0] === "弱打者");
    expect(parseFloat(String(sluggerHR?.[8]))).toBeGreaterThan(parseFloat(String(weakHR?.[8])));
  });
});

describe("統計レポート: 投手プロファイル別の比較", () => {
  it("全プロファイルの被打球分布", () => {
    const batter = createBatter();
    const fielderMap = createFielderMap();

    const profiles = [
      { name: "平均的", player: PITCHER_PROFILES.average() },
      { name: "速球派", player: PITCHER_PROFILES.flamethrower() },
      { name: "技巧派", player: PITCHER_PROFILES.craftsman() },
      { name: "シンカー", player: PITCHER_PROFILES.sinkerBaller() },
      { name: "フォーク", player: PITCHER_PROFILES.forkBaller() },
      { name: "多彩", player: PITCHER_PROFILES.versatile() },
    ];

    const N = 5000;
    const headers = [
      "プロファイル",
      "ゴロ%", "LD%", "FB%", "PF%",
      "被速度平均", "被角度平均",
      "被HR%",
    ];
    const rows: (string | number)[][] = [];

    for (const { name, player } of profiles) {
      const types = { ground_ball: 0, line_drive: 0, fly_ball: 0, popup: 0 };
      const vels: number[] = [];
      const angs: number[] = [];
      let hrs = 0;

      for (let i = 0; i < N; i++) {
        const r = simulateOneBattedBall(batter, player, fielderMap);
        types[r.ball.type]++;
        vels.push(r.ball.exitVelocity);
        angs.push(r.ball.launchAngle);
        if (r.isHR) hrs++;
      }

      rows.push([
        name,
        ((types.ground_ball / N) * 100).toFixed(1),
        ((types.line_drive / N) * 100).toFixed(1),
        ((types.fly_ball / N) * 100).toFixed(1),
        ((types.popup / N) * 100).toFixed(1),
        mean(vels).toFixed(1),
        mean(angs).toFixed(1),
        ((hrs / N) * 100).toFixed(2),
      ]);
    }

    console.log("\n=== 投手プロファイル別 被打球統計レポート ===");
    console.log(formatTable(headers, rows));
  });
});

describe("統計レポート: 守備到達分析", () => {
  it("打球タイプ別の守備到達率", () => {
    const batter = createBatter();
    const pitcher = createPitcher();
    const fielderMap = createFielderMap();

    const N = 5000;
    const stats: Record<string, { total: number; reached: number; margins: number[] }> = {
      ground_ball: { total: 0, reached: 0, margins: [] },
      line_drive: { total: 0, reached: 0, margins: [] },
      fly_ball: { total: 0, reached: 0, margins: [] },
      popup: { total: 0, reached: 0, margins: [] },
    };

    for (let i = 0; i < N; i++) {
      const r = simulateOneBattedBall(batter, pitcher, fielderMap);
      const s = stats[r.ball.type];
      s.total++;
      if (r.canReach) {
        s.reached++;
        if (r.primary) {
          s.margins.push(r.primary.ballArrivalTime - r.primary.timeToReach);
        }
      }
    }

    const headers = ["打球タイプ", "総数", "到達可能", "到達率%", "余裕時間(s)平均", "余裕時間P5"];
    const rows: (string | number)[][] = [];

    for (const [type, s] of Object.entries(stats)) {
      if (s.total === 0) continue;
      rows.push([
        type,
        s.total,
        s.reached,
        ((s.reached / s.total) * 100).toFixed(1),
        s.margins.length > 0 ? mean(s.margins).toFixed(2) : "-",
        s.margins.length > 0 ? percentile(s.margins, 5).toFixed(2) : "-",
      ]);
    }

    console.log("\n=== 打球タイプ別 守備到達分析 ===");
    console.log(formatTable(headers, rows));
  });
});

describe("統計レポート: 飛距離分布とフェンス到達率", () => {
  it("フライ打球の飛距離分布", () => {
    const batter = createBatter();
    const pitcher = createPitcher();

    const N = 10000;
    const flyDistances: number[] = [];
    const hrDistances: number[] = [];
    const nonHrDistances: number[] = [];

    for (let i = 0; i < N; i++) {
      const ball = generateBattedBall(batter, pitcher);
      if (ball.type !== "fly_ball") continue;

      const distance = estimateDistance(ball.exitVelocity, ball.launchAngle);
      const fenceDist = getFenceDistance(ball.direction);
      flyDistances.push(distance);

      if (distance / fenceDist >= 0.95) {
        hrDistances.push(distance);
      } else {
        nonHrDistances.push(distance);
      }
    }

    console.log("\n" + statSummary("フライ飛距離 (全体)", flyDistances));
    if (hrDistances.length > 0) {
      console.log("\n" + statSummary("フライ飛距離 (フェンス際以上)", hrDistances));
    }
    console.log("\n" + statSummary("フライ飛距離 (フェンス未到達)", nonHrDistances));

    // 飛距離ヒストグラム
    console.log("\n--- フライ飛距離分布 ---");
    const bins = [0, 20, 40, 60, 80, 90, 100, 110, 120, 130, 140, 160];
    for (let i = 0; i < bins.length - 1; i++) {
      const lo = bins[i];
      const hi = bins[i + 1];
      const count = flyDistances.filter(d => d >= lo && d < hi).length;
      const pct = ((count / flyDistances.length) * 100).toFixed(1);
      const bar = "#".repeat(Math.round(count / 30));
      console.log(`  ${String(lo).padStart(3)}-${String(hi).padStart(3)}m: ${String(count).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
    }
  });
});

describe("統計レポート: パラメータ感度分析", () => {
  it("パワーが打球結果に与える影響", () => {
    const pitcher = createPitcher();
    const fielderMap = createFielderMap();
    const powers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    const headers = ["パワー", "速度平均", "角度平均", "ゴロ%", "FB%", "HR%", "飛距離平均"];
    const rows: (string | number)[][] = [];

    for (const p of powers) {
      const batter = createBatter({ power: p, trajectory: Math.min(4, Math.max(1, Math.round(1 + (p / 100) * 2.5))) });
      const vels: number[] = [];
      const angs: number[] = [];
      const dists: number[] = [];
      let gb = 0, fb = 0, hrs = 0;
      const N = 3000;

      for (let i = 0; i < N; i++) {
        const r = simulateOneBattedBall(batter, pitcher, fielderMap);
        vels.push(r.ball.exitVelocity);
        angs.push(r.ball.launchAngle);
        if (r.distance > 0) dists.push(r.distance);
        if (r.ball.type === "ground_ball") gb++;
        if (r.ball.type === "fly_ball") fb++;
        if (r.isHR) hrs++;
      }

      rows.push([
        String(p),
        mean(vels).toFixed(1),
        mean(angs).toFixed(1),
        ((gb / N) * 100).toFixed(1),
        ((fb / N) * 100).toFixed(1),
        ((hrs / N) * 100).toFixed(2),
        dists.length > 0 ? mean(dists).toFixed(1) : "-",
      ]);
    }

    console.log("\n=== パワー感度分析 ===");
    console.log(formatTable(headers, rows));
  });

  it("ミートが打球結果に与える影響", () => {
    const pitcher = createPitcher();
    const fielderMap = createFielderMap();
    const contacts = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    const headers = ["ミート", "速度平均", "角度平均", "ゴロ%", "LD%", "FB%"];
    const rows: (string | number)[][] = [];

    for (const c of contacts) {
      const batter = createBatter({ contact: c });
      const vels: number[] = [];
      const angs: number[] = [];
      let gb = 0, ld = 0, fb = 0;
      const N = 3000;

      for (let i = 0; i < N; i++) {
        const ball = generateBattedBall(batter, pitcher);
        vels.push(ball.exitVelocity);
        angs.push(ball.launchAngle);
        if (ball.type === "ground_ball") gb++;
        if (ball.type === "line_drive") ld++;
        if (ball.type === "fly_ball") fb++;
      }

      rows.push([
        String(c),
        mean(vels).toFixed(1),
        mean(angs).toFixed(1),
        ((gb / N) * 100).toFixed(1),
        ((ld / N) * 100).toFixed(1),
        ((fb / N) * 100).toFixed(1),
      ]);
    }

    console.log("\n=== ミート感度分析 ===");
    console.log(formatTable(headers, rows));
  });
});
