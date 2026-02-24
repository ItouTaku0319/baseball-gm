/**
 * HR フェンス越え検証テスト
 *
 * simulateGame を1000試合実行し、AtBatLog の result === "homerun" の打球について
 * effectiveDistance (estimatedDistance * TRAJECTORY_CARRY_FACTORS) >= fenceDistance
 * であることを検証する。
 *
 * `npx vitest run --reporter=verbose batted-ball-lab/hr-fence-verification` で実行
 */
import { describe, it, expect } from "vitest";
import { simulateGame, estimateDistance, getFenceDistance } from "@/engine/simulation";
import { TRAJECTORY_CARRY_FACTORS } from "@/engine/physics-constants";
import { generateRoster } from "@/engine/player-generator";
import type { Team } from "@/models/team";
import type { AtBatLog } from "@/models/league";
import type { Player } from "@/models/player";

const NUM_GAMES = 1000;

// --- チーム生成 ---
function createTeam(id: string, name: string): Team {
  return {
    id,
    name,
    shortName: name,
    color: "#333",
    roster: generateRoster(65),
    budget: 5000,
    fanBase: 50,
    homeBallpark: "テスト球場",
  };
}

// --- HR打球の検証結果 ---
interface HRVerificationRecord {
  inning: number;
  halfInning: "top" | "bottom";
  batterId: string;
  direction: number;
  launchAngle: number;
  exitVelocity: number;
  estimatedDistance: number;
  fenceDistance: number;
  trajectory: number;
  carryFactor: number;
  effectiveDistance: number;
  clearsFence: boolean;
}

describe("HR フェンス越え検証", () => {
  const teams: Team[] = [];
  const allPlayers = new Map<string, Player>();
  const hrRecords: HRVerificationRecord[] = [];
  let totalAtBats = 0;

  it(`${NUM_GAMES}試合シミュレーション実行 & HR打球収集`, () => {
    // 6チーム生成
    const teamNames = ["チームA", "チームB", "チームC", "チームD", "チームE", "チームF"];
    for (const name of teamNames) {
      const team = createTeam(name.toLowerCase(), name);
      teams.push(team);
      for (const p of team.roster) {
        allPlayers.set(p.id, p);
      }
    }

    // ランダムな対戦カードでN試合実行 (collectAtBatLogs: true)
    for (let i = 0; i < NUM_GAMES; i++) {
      const hi = Math.floor(Math.random() * teams.length);
      let ai = Math.floor(Math.random() * (teams.length - 1));
      if (ai >= hi) ai++;

      const result = simulateGame(teams[hi], teams[ai], { collectAtBatLogs: true });
      const logs = result.atBatLogs ?? [];
      totalAtBats += logs.length;

      // HR打球を抽出
      for (const log of logs) {
        if (log.result !== "homerun") continue;
        if (log.direction == null || log.launchAngle == null || log.exitVelocity == null || log.estimatedDistance == null) continue;

        const player = allPlayers.get(log.batterId);
        const trajectory = player?.batting?.trajectory ?? 2;
        const carryFactor = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, trajectory - 1))];
        const effectiveDistance = log.estimatedDistance * carryFactor;
        const fenceDistance = getFenceDistance(log.direction);

        hrRecords.push({
          inning: log.inning,
          halfInning: log.halfInning,
          batterId: log.batterId,
          direction: log.direction,
          launchAngle: log.launchAngle,
          exitVelocity: log.exitVelocity,
          estimatedDistance: log.estimatedDistance,
          fenceDistance,
          trajectory,
          carryFactor,
          effectiveDistance,
          clearsFence: effectiveDistance >= fenceDistance,
        });
      }
    }

    console.log(`\n${NUM_GAMES}試合完了。総打席数: ${totalAtBats}, HR数: ${hrRecords.length}`);
    expect(hrRecords.length).toBeGreaterThan(0);
  }, 120000);

  it("HR打球の速度・角度・飛距離分布を表示", () => {
    if (hrRecords.length === 0) return;

    const exitVelocities = hrRecords.map(r => r.exitVelocity);
    const launchAngles = hrRecords.map(r => r.launchAngle);
    const estimatedDistances = hrRecords.map(r => r.estimatedDistance);
    const effectiveDistances = hrRecords.map(r => r.effectiveDistance);
    const fenceDistances = hrRecords.map(r => r.fenceDistance);
    const margins = hrRecords.map(r => r.effectiveDistance - r.fenceDistance);

    const calcStats = (arr: number[]) => ({
      min: Math.min(...arr),
      max: Math.max(...arr),
      avg: arr.reduce((s, v) => s + v, 0) / arr.length,
    });

    const evStats = calcStats(exitVelocities);
    const laStats = calcStats(launchAngles);
    const edStats = calcStats(estimatedDistances);
    const effStats = calcStats(effectiveDistances);
    const fdStats = calcStats(fenceDistances);
    const marginStats = calcStats(margins);

    console.log("\n" + "=".repeat(70));
    console.log(`  HR打球統計 (${hrRecords.length}本, ${NUM_GAMES}試合, HR/試合=${(hrRecords.length / NUM_GAMES).toFixed(2)})`);
    console.log("=".repeat(70));

    console.log("\n--- 打球速度 (km/h) ---");
    console.log(`  最小: ${evStats.min.toFixed(1)}`);
    console.log(`  最大: ${evStats.max.toFixed(1)}`);
    console.log(`  平均: ${evStats.avg.toFixed(1)}`);

    console.log("\n--- 打球角度 (度) ---");
    console.log(`  最小: ${laStats.min.toFixed(1)}`);
    console.log(`  最大: ${laStats.max.toFixed(1)}`);
    console.log(`  平均: ${laStats.avg.toFixed(1)}`);

    console.log("\n--- 推定飛距離 (m, estimateDistance生値) ---");
    console.log(`  最小: ${edStats.min.toFixed(1)}`);
    console.log(`  最大: ${edStats.max.toFixed(1)}`);
    console.log(`  平均: ${edStats.avg.toFixed(1)}`);

    console.log("\n--- 有効飛距離 (m, estimateDistance * carryFactor) ---");
    console.log(`  最小: ${effStats.min.toFixed(1)}`);
    console.log(`  最大: ${effStats.max.toFixed(1)}`);
    console.log(`  平均: ${effStats.avg.toFixed(1)}`);

    console.log("\n--- フェンス距離 (m) ---");
    console.log(`  最小: ${fdStats.min.toFixed(1)}`);
    console.log(`  最大: ${fdStats.max.toFixed(1)}`);
    console.log(`  平均: ${fdStats.avg.toFixed(1)}`);

    console.log("\n--- フェンス超過マージン (m, effectiveDistance - fenceDistance) ---");
    console.log(`  最小: ${marginStats.min.toFixed(1)}`);
    console.log(`  最大: ${marginStats.max.toFixed(1)}`);
    console.log(`  平均: ${marginStats.avg.toFixed(1)}`);

    // 弾道別分布
    const trajectoryGroups = new Map<number, HRVerificationRecord[]>();
    for (const r of hrRecords) {
      const group = trajectoryGroups.get(r.trajectory) ?? [];
      group.push(r);
      trajectoryGroups.set(r.trajectory, group);
    }

    console.log("\n--- 弾道別HR分布 ---");
    for (const traj of [1, 2, 3, 4]) {
      const group = trajectoryGroups.get(traj) ?? [];
      if (group.length === 0) {
        console.log(`  弾道${traj}: 0本`);
        continue;
      }
      const avgEv = group.reduce((s, r) => s + r.exitVelocity, 0) / group.length;
      const avgLa = group.reduce((s, r) => s + r.launchAngle, 0) / group.length;
      const avgEff = group.reduce((s, r) => s + r.effectiveDistance, 0) / group.length;
      const avgMargin = group.reduce((s, r) => s + (r.effectiveDistance - r.fenceDistance), 0) / group.length;
      console.log(`  弾道${traj}: ${group.length}本 (carryFactor=${TRAJECTORY_CARRY_FACTORS[traj - 1]}), 平均速度=${avgEv.toFixed(1)}km/h, 平均角度=${avgLa.toFixed(1)}°, 平均有効飛距離=${avgEff.toFixed(1)}m, 平均超過=${avgMargin.toFixed(1)}m`);
    }
  });

  it("フェンス未到達HR が 0件 であることを検証", () => {
    const failedHRs = hrRecords.filter(r => !r.clearsFence);

    if (failedHRs.length > 0) {
      console.log("\n=== フェンス未到達HR一覧 ===");
      for (const r of failedHRs.slice(0, 20)) {
        const shortfall = r.fenceDistance - r.effectiveDistance;
        console.log(
          `  ${r.inning}回${r.halfInning === "top" ? "表" : "裏"} | ` +
          `速度=${r.exitVelocity.toFixed(1)}km/h | 角度=${r.launchAngle.toFixed(1)}° | ` +
          `方向=${r.direction.toFixed(1)}° | 弾道=${r.trajectory} (×${r.carryFactor}) | ` +
          `推定飛距離=${r.estimatedDistance.toFixed(1)}m | 有効飛距離=${r.effectiveDistance.toFixed(1)}m | ` +
          `フェンス=${r.fenceDistance.toFixed(1)}m | 不足=${shortfall.toFixed(1)}m`
        );
      }
      if (failedHRs.length > 20) {
        console.log(`  ... 他 ${failedHRs.length - 20}件`);
      }
    }

    console.log(`\n検証結果: HR ${hrRecords.length}本中、フェンス未到達 ${failedHRs.length}件`);

    expect(failedHRs.length).toBe(0);
  });
});
