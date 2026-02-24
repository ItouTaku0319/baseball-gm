/**
 * フェンス高さHR判定の検証テスト
 *
 * 10,000試合をAtBatLog付きで実行し、HR関連の打球詳細を出力する。
 * `npx vitest run --reporter=verbose batted-ball-lab/fence-height-verification` で実行
 */
import { describe, it, expect } from "vitest";
import { simulateGame, estimateDistance, getFenceDistance } from "@/engine/simulation";
import { generateRoster } from "@/engine/player-generator";
import { GRAVITY, BAT_HEIGHT, DRAG_FACTOR, FENCE_HEIGHT, TRAJECTORY_CARRY_FACTORS } from "@/engine/physics-constants";
import type { Team } from "@/models/team";
import type { AtBatLog } from "@/models/league";

const NUM_GAMES = 10000;

function createTeam(id: string, name: string): Team {
  return {
    id, name, shortName: name, color: "#333",
    roster: generateRoster(65), budget: 5000, fanBase: 50, homeBallpark: "テスト球場",
  };
}

/** フェンス水平距離到達時の打球高さを計算（simulation.tsのHR判定と同一ロジック） */
function calcHeightAtFence(exitVelocityKmh: number, launchAngleDeg: number, directionDeg: number, effectiveDistance: number, carryFactor: number): number {
  const v0 = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vy0 = v0 * Math.sin(theta);
  const gEff = GRAVITY / carryFactor;
  const tUp = vy0 / gEff;
  const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * gEff);
  const tDown = Math.sqrt(2 * maxH / gEff);
  const tRaw = tUp + tDown;
  const fenceDist = getFenceDistance(directionDeg);
  const tFence = (fenceDist / effectiveDistance) * tRaw;
  return BAT_HEIGHT + vy0 * tFence - 0.5 * gEff * tFence * tFence;
}

describe("フェンス高さHR判定検証", () => {
  const allLogs: AtBatLog[] = [];
  const teams: Team[] = [];
  // 選手能力参照用
  const allPlayers = new Map<string, { name: string; trajectory: number; power: number }>();
  let totalRuns = 0;
  let totalHR = 0;
  let totalGames = 0;

  it(`${NUM_GAMES}試合シミュレーション実行`, () => {
    const teamNames = ["A","B","C","D","E","F","G","H","I","J","K","L"];
    for (const name of teamNames) {
      const team = createTeam(name.toLowerCase(), `チーム${name}`);
      teams.push(team);
      for (const p of team.roster) {
        allPlayers.set(p.id, {
          name: p.name,
          trajectory: p.batting.trajectory ?? 2,
          power: p.batting.power,
        });
      }
    }

    for (let i = 0; i < NUM_GAMES; i++) {
      const hi = Math.floor(Math.random() * teams.length);
      let ai = Math.floor(Math.random() * (teams.length - 1));
      if (ai >= hi) ai++;
      const result = simulateGame(teams[hi], teams[ai], { collectAtBatLogs: true });
      if (result.atBatLogs) allLogs.push(...result.atBatLogs);
      totalRuns += result.homeScore + result.awayScore;
      for (const ps of result.playerStats) totalHR += ps.homeRuns;
      totalGames++;
    }

    console.log(`\n${totalGames}試合完了。総打席数: ${allLogs.length}`);
    expect(totalGames).toBe(NUM_GAMES);
  }, 600000);

  it("リーグ全体統計", () => {
    const flyLogs = allLogs.filter(l => l.battedBallType === "fly_ball");
    const hrLogs = allLogs.filter(l => l.result === "homerun");
    const nonHrFlyLogs = flyLogs.filter(l => l.result !== "homerun");

    console.log("\n" + "=".repeat(70));
    console.log(`  リーグ全体統計 (${totalGames}試合)`);
    console.log("=".repeat(70));
    console.log(`  総打席:        ${allLogs.length}`);
    console.log(`  フライ打球:    ${flyLogs.length}`);
    console.log(`  HR数:          ${totalHR}`);
    console.log(`  HR/試合:       ${(totalHR / totalGames).toFixed(2)}`);
    console.log(`  HR/FB%:        ${(hrLogs.length / flyLogs.length * 100).toFixed(1)}%`);
    console.log(`  得点/試合:     ${(totalRuns / totalGames).toFixed(2)}`);
  });

  it("HR打球の詳細統計", () => {
    const hrLogs = allLogs.filter(l => l.result === "homerun" && l.exitVelocity != null);

    if (hrLogs.length === 0) {
      console.log("HRなし");
      return;
    }

    const evs = hrLogs.map(l => l.exitVelocity!);
    const angles = hrLogs.map(l => l.launchAngle!);
    const dists = hrLogs.map(l => l.estimatedDistance!);

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = (arr: number[]) => Math.min(...arr);
    const max = (arr: number[]) => Math.max(...arr);
    const pct = (arr: number[], p: number) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * p / 100)];
    };

    console.log("\n" + "=".repeat(70));
    console.log(`  HR打球詳細 (${hrLogs.length}本)`);
    console.log("=".repeat(70));

    console.log("\n--- 打球速度 (km/h) ---");
    console.log(`  平均:    ${avg(evs).toFixed(1)}`);
    console.log(`  最小:    ${min(evs).toFixed(1)}`);
    console.log(`  最大:    ${max(evs).toFixed(1)}`);
    console.log(`  10%ile:  ${pct(evs, 10).toFixed(1)}`);
    console.log(`  25%ile:  ${pct(evs, 25).toFixed(1)}`);
    console.log(`  50%ile:  ${pct(evs, 50).toFixed(1)}`);
    console.log(`  75%ile:  ${pct(evs, 75).toFixed(1)}`);
    console.log(`  90%ile:  ${pct(evs, 90).toFixed(1)}`);

    console.log("\n--- 打球角度 (°) ---");
    console.log(`  平均:    ${avg(angles).toFixed(1)}`);
    console.log(`  最小:    ${min(angles).toFixed(1)}`);
    console.log(`  最大:    ${max(angles).toFixed(1)}`);
    console.log(`  10%ile:  ${pct(angles, 10).toFixed(1)}`);
    console.log(`  25%ile:  ${pct(angles, 25).toFixed(1)}`);
    console.log(`  50%ile:  ${pct(angles, 50).toFixed(1)}`);
    console.log(`  75%ile:  ${pct(angles, 75).toFixed(1)}`);
    console.log(`  90%ile:  ${pct(angles, 90).toFixed(1)}`);

    console.log("\n--- 飛距離 (m) [carryFactor適用済] ---");
    console.log(`  平均:    ${avg(dists).toFixed(1)}`);
    console.log(`  最小:    ${min(dists).toFixed(1)}`);
    console.log(`  最大:    ${max(dists).toFixed(1)}`);
    console.log(`  10%ile:  ${pct(dists, 10).toFixed(1)}`);
    console.log(`  25%ile:  ${pct(dists, 25).toFixed(1)}`);
    console.log(`  50%ile:  ${pct(dists, 50).toFixed(1)}`);
    console.log(`  75%ile:  ${pct(dists, 75).toFixed(1)}`);
    console.log(`  90%ile:  ${pct(dists, 90).toFixed(1)}`);

    // フェンス距離との比較
    const fenceRatios = hrLogs.map(l => {
      const fd = l.direction != null ? getFenceDistance(l.direction) : 100;
      return (l.estimatedDistance ?? 0) / fd;
    });
    console.log("\n--- フェンス距離比 (飛距離/フェンス距離) ---");
    console.log(`  平均:    ${avg(fenceRatios).toFixed(3)}`);
    console.log(`  最小:    ${min(fenceRatios).toFixed(3)}`);
    console.log(`  最大:    ${max(fenceRatios).toFixed(3)}`);

    // フェンス到達時の高さ
    const heights = hrLogs.map(l => {
      const p = allPlayers.get(l.batterId);
      const traj = p?.trajectory ?? 2;
      const cf = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, traj - 1))];
      const rawDist = estimateDistance(l.exitVelocity!, l.launchAngle!);
      const effDist = rawDist * cf;
      return calcHeightAtFence(l.exitVelocity!, l.launchAngle!, l.direction ?? 45, effDist, cf);
    });
    console.log("\n--- フェンス到達時の高さ (m) ---");
    console.log(`  平均:    ${avg(heights).toFixed(1)}`);
    console.log(`  最小:    ${min(heights).toFixed(1)}`);
    console.log(`  最大:    ${max(heights).toFixed(1)}`);
    console.log(`  10%ile:  ${pct(heights, 10).toFixed(1)}`);
    console.log(`  FENCE_HEIGHT: ${FENCE_HEIGHT}m`);

    // フェンス未到達HR（あってはならない）
    const subFenceHR = hrLogs.filter(l => {
      const fd = l.direction != null ? getFenceDistance(l.direction) : 100;
      return (l.estimatedDistance ?? 0) < fd;
    });
    console.log(`\n  フェンス未到達HR: ${subFenceHR.length}件 (あってはならない)`);

    // 弾道別HR分布
    console.log("\n--- 弾道別HR ---");
    for (let traj = 1; traj <= 4; traj++) {
      const trajHR = hrLogs.filter(l => {
        const p = allPlayers.get(l.batterId);
        return p && p.trajectory === traj;
      });
      const trajAll = allLogs.filter(l => {
        const p = allPlayers.get(l.batterId);
        return p && p.trajectory === traj;
      });
      const trajFly = trajAll.filter(l => l.battedBallType === "fly_ball");
      console.log(`  弾道${traj}: ${trajHR.length}本 (HR/PA=${(trajHR.length/Math.max(1,trajAll.length)*100).toFixed(2)}%, HR/FB=${(trajHR.length/Math.max(1,trajFly.length)*100).toFixed(1)}%)`);
    }
  });

  it("フェンス直撃候補（距離OK・高さNG）の確認", () => {
    // フライ打球で、carry適用後の飛距離がフェンス距離以上だが、高さがFENCE_HEIGHT未満のもの
    const flyLogs = allLogs.filter(l =>
      l.battedBallType === "fly_ball" &&
      l.exitVelocity != null &&
      l.launchAngle != null &&
      l.direction != null
    );

    let fenceHitCount = 0;
    const fenceHitDetails: { ev: number; angle: number; dist: number; height: number; fenceDist: number }[] = [];

    for (const l of flyLogs) {
      const rawDist = estimateDistance(l.exitVelocity!, l.launchAngle!);
      const p = allPlayers.get(l.batterId);
      const traj = p?.trajectory ?? 2;
      const cf = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, traj - 1))];
      const effectiveDist = rawDist * cf;
      const fenceDist = getFenceDistance(l.direction!);

      if (effectiveDist >= fenceDist) {
        const height = calcHeightAtFence(l.exitVelocity!, l.launchAngle!, l.direction!, effectiveDist, cf);
        if (height < FENCE_HEIGHT) {
          fenceHitCount++;
          if (fenceHitDetails.length < 20) {
            fenceHitDetails.push({
              ev: l.exitVelocity!,
              angle: l.launchAngle!,
              dist: effectiveDist,
              height,
              fenceDist,
            });
          }
        }
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log(`  フェンス直撃（距離OK・高さNG）`);
    console.log("=".repeat(70));
    console.log(`  該当数: ${fenceHitCount}件 / フライ${flyLogs.length}件`);
    console.log(`  割合: ${(fenceHitCount / flyLogs.length * 100).toFixed(2)}%`);

    if (fenceHitDetails.length > 0) {
      console.log(`\n  サンプル (最大20件):`);
      console.log(`  ${"速度".padEnd(8)} ${"角度".padEnd(8)} ${"飛距離".padEnd(10)} ${"フェンス距離".padEnd(12)} ${"到達高さ".padEnd(10)}`);
      for (const d of fenceHitDetails) {
        console.log(`  ${d.ev.toFixed(1).padEnd(8)} ${d.angle.toFixed(1).padEnd(8)} ${d.dist.toFixed(1).padEnd(10)} ${d.fenceDist.toFixed(1).padEnd(12)} ${d.height.toFixed(2).padEnd(10)}`);
      }
    }
  });
});
