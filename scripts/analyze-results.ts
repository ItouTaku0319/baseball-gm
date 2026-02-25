// @ts-nocheck
/**
 * 守備AI結果の簡易分析
 */
import { calcBallLanding, evaluateFielders } from "../src/engine/fielding-ai";
import type { BallLanding, FielderDecision } from "../src/engine/fielding-ai";
import { classifyBattedBallType, estimateDistance, getFenceDistance } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import {
  GRAVITY, BAT_HEIGHT, FENCE_HEIGHT, TRAJECTORY_CARRY_FACTORS,
} from "../src/engine/physics-constants";

const DIRECTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const EXIT_VELOCITIES = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const LAUNCH_ANGLES = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];
const POS_NAMES: Record<number, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// ダミー選手
const roster = generateRoster(65);
const fielderMap = new Map<FielderPosition, any>();
const pitchers = roster.filter(p => p.position === "P");
const batters = roster.filter(p => p.position !== "P");
if (pitchers.length > 0) fielderMap.set(1, pitchers[0]);
const positions: FielderPosition[] = [2, 3, 4, 5, 6, 7, 8, 9];
for (let i = 0; i < positions.length && i < batters.length; i++) {
  fielderMap.set(positions[i], batters[i]);
}

const runners = { first: false, second: false, third: false };
const BASE_LENGTH = 27.4;

function checkHR(dir: number, ev: number, la: number): boolean {
  if (la < 10) return false;
  const distance = estimateDistance(ev, la);
  const fenceDist = getFenceDistance(dir);
  const baseCarry = TRAJECTORY_CARRY_FACTORS[1]; // trajectory=2
  let carryFactor = baseCarry;
  if (la > 35) {
    const taper = Math.max(0, 1 - (la - 35) / 15);
    carryFactor = 1 + (baseCarry - 1) * taper;
  }
  const effDist = distance * carryFactor;
  if (effDist / fenceDist < 1.0) return false;
  const v0 = ev / 3.6;
  const theta = la * Math.PI / 180;
  const vy0 = v0 * Math.sin(theta);
  const gEff = GRAVITY / carryFactor;
  const tUp = vy0 / gEff;
  const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * gEff);
  const tDown = Math.sqrt(2 * maxH / gEff);
  const tRaw = tUp + tDown;
  const tFence = (fenceDist / effDist) * tRaw;
  const height = BAT_HEIGHT + vy0 * tFence - 0.5 * gEff * tFence * tFence;
  return height >= FENCE_HEIGHT;
}

function distToLanding(d: FielderDecision, landing: BallLanding): number {
  if (!d.posAtLanding) return d.distanceAtLanding ?? d.distanceToBall;
  return Math.sqrt(
    (d.posAtLanding.x - landing.position.x) ** 2 +
    (d.posAtLanding.y - landing.position.y) ** 2
  );
}

function selectRetriever(fieldingResult: Map<FielderPosition, FielderDecision>, landing: BallLanding): FielderDecision | null {
  let retriever: FielderDecision | null = null;
  let minDist = Infinity;
  for (const decision of fieldingResult.values()) {
    if (!(decision.retrievalCandidate ?? false)) continue;
    const d = distToLanding(decision, landing);
    if (d < minDist) { minDist = d; retriever = decision; }
  }
  return retriever;
}

// 結果集計
const results: Record<string, number> = {};
const evResults: Record<number, Record<string, number>> = {};
const issueCount: Record<string, number> = {
  "遠距離P/C回収": 0, "浅ゴロOF回収": 0, "深打球IF回収": 0,
  "短距離長打": 0, "長距離単打": 0, "フライC回収": 0,
};
const weakGroundRows: any[] = [];
const retrieverDist: Record<string, number[]> = {};

for (const dir of DIRECTIONS) {
  for (const ev of EXIT_VELOCITIES) {
    for (const la of LAUNCH_ANGLES) {
      const ballType = classifyBattedBallType(la, ev);
      const landing = calcBallLanding(dir, la, ev);
      const fieldingResult = evaluateFielders(landing, ballType, fielderMap, runners, 0);

      // primary選択
      let best: FielderDecision | null = null;
      for (const d of fieldingResult.values()) {
        if (!d.canReach) continue;
        if (!best || d.timeToReach < best.timeToReach) best = d;
      }
      if (!best) {
        for (const d of fieldingResult.values()) {
          if (!best || d.distanceToBall < best.distanceToBall) best = d;
        }
      }
      if (!best) continue;

      let result: string;
      let retrieverPos = best.position;

      if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la)) {
        result = "homerun";
      } else if (ballType === "popup") {
        result = "popupOut";
      } else if (best.canReach) {
        if (ballType === "ground_ball") {
          // 簡易ゴロ判定
          const batter = [...fielderMap.values()].find((p: any) => p.position !== "P")!;
          const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
          const timePerBase = BASE_LENGTH / runnerSpeed;
          const runnerTo1B = 0.3 + timePerBase;
          const skill = best.skill;
          const secureTime = 0.3 + (1 - skill.fielding / 100) * 0.3;
          const transferTime = 0.6 + (1 - skill.arm / 100) * 0.4;
          const throwSpeed = 25 + (skill.arm / 100) * 15;
          const fieldTime = Math.max(best.timeToReach, best.ballArrivalTime);
          const throwDists: Record<number, number> = { 1: 19.4, 2: 27.4, 3: 5, 4: 18, 5: 38.8, 6: 32, 7: 55, 8: 60, 9: 35 };
          const throwDist = throwDists[best.position] ?? 30;
          const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
          result = runnerTo1B < defenseTime ? "infieldHit" : "out";
        } else {
          result = "out";
        }
      } else {
        // ヒット判定
        const retriever = selectRetriever(fieldingResult, landing) ?? best;
        retrieverPos = retriever.position;
        const dist = distToLanding(retriever, landing);

        // 簡易長打判定
        const fenceDist = getFenceDistance(dir);
        if (landing.distance >= fenceDist * 0.90) {
          result = "triple";
        } else if (landing.distance >= 80) {
          result = "double";
        } else if (landing.distance >= 60) {
          result = dist > 15 ? "double" : "single";
        } else {
          result = "single";
        }
      }

      results[result] = (results[result] ?? 0) + 1;
      if (!evResults[ev]) evResults[ev] = {};
      evResults[ev][result] = (evResults[ev][result] ?? 0) + 1;

      // 問題検出
      const isHit = !["out", "popupOut", "error"].includes(result);
      if (isHit && landing.distance > 50 && (retrieverPos === 1 || retrieverPos === 2)) issueCount["遠距離P/C回収"]++;
      if (isHit && ballType === "ground_ball" && landing.distance < 25 && retrieverPos >= 7) issueCount["浅ゴロOF回収"]++;
      if (isHit && landing.distance > 60 && retrieverPos >= 3 && retrieverPos <= 6) issueCount["深打球IF回収"]++;
      if (landing.distance < 50 && (result === "double" || result === "triple")) issueCount["短距離長打"]++;
      if (landing.distance > 60 && result === "single") issueCount["長距離単打"]++;
      if (isHit && ballType === "fly_ball" && retrieverPos === 2 && landing.distance > 10) issueCount["フライC回収"]++;

      // EV=40弱ゴロ追跡
      if (ev === 40 && ballType === "ground_ball") {
        weakGroundRows.push({
          dir, la, dist: Math.round(landing.distance * 10) / 10,
          result, primary: POS_NAMES[best.position], canReach: best.canReach,
          retriever: POS_NAMES[retrieverPos],
        });
      }

      // 回収者距離
      if (isHit) {
        const rp = POS_NAMES[retrieverPos];
        if (!retrieverDist[rp]) retrieverDist[rp] = [];
        retrieverDist[rp].push(landing.distance);
      }
    }
  }
}

// 出力
const total = Object.values(results).reduce((a, b) => a + b, 0);
console.log("=== 全体結果分布 ===");
for (const [k, v] of Object.entries(results).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)}: ${String(v).padStart(4)} (${(v / total * 100).toFixed(1)}%)`);
}
console.log(`  合計: ${total}`);

console.log("\n=== 速度別結果 ===");
for (const ev of EXIT_VELOCITIES) {
  const r = evResults[ev] ?? {};
  const t = Object.values(r).reduce((a, b) => a + b, 0);
  const hits = (r.single ?? 0) + (r.double ?? 0) + (r.triple ?? 0) + (r.infieldHit ?? 0);
  console.log(`  EV=${String(ev).padStart(3)}: OUT=${String((r.out ?? 0) + (r.popupOut ?? 0)).padStart(3)} IFH=${String(r.infieldHit ?? 0).padStart(2)} 1B=${String(r.single ?? 0).padStart(3)} 2B=${String(r.double ?? 0).padStart(2)} 3B=${String(r.triple ?? 0).padStart(2)} HR=${String(r.homerun ?? 0).padStart(2)} | hit%=${(hits / t * 100).toFixed(1)}`);
}

console.log("\n=== 問題パターン ===");
for (const [k, v] of Object.entries(issueCount)) {
  console.log(`  ${k.padEnd(14)}: ${v}件${v === 0 ? " ✅" : " ⚠️"}`);
}

console.log("\n=== EV=40 弱ゴロ詳細 ===");
for (const r of weakGroundRows) {
  console.log(`  dir=${String(r.dir).padStart(2)} la=${String(r.la).padStart(3)} dist=${String(r.dist).padStart(5)}m → ${r.result.padEnd(10)} primary=${r.primary}(reach=${r.canReach}) retriever=${r.retriever}`);
}

console.log("\n=== ヒット時の回収者分布 ===");
for (const [pos, dists] of Object.entries(retrieverDist).sort((a, b) => b[1].length - a[1].length)) {
  const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
  console.log(`  ${pos.padEnd(3)}: ${String(dists.length).padStart(3)}件 (平均飛距離=${avg.toFixed(1)}m)`);
}
