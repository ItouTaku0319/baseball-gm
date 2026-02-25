/**
 * 守備AI網羅テスト
 *
 * 打球パラメータ(方向 × 速度 × 角度)の全組み合わせで
 * calcBallLanding → evaluateFielders → 結果判定 を実行し、
 * 打球パラメータごとの結果分布を検証する。
 *
 * ランダム要素は排除し、決定的な結果を出力する。
 *
 * Usage:
 *   npx tsx scripts/test-fielding-grid.ts [--csv]
 */

import { calcBallLanding, evaluateFielders } from "../src/engine/fielding-ai";
import type { BallLanding, FielderDecision } from "../src/engine/fielding-ai";
import { classifyBattedBallType, estimateDistance, getFenceDistance } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import {
  GRAVITY, BAT_HEIGHT, FENCE_HEIGHT, TRAJECTORY_CARRY_FACTORS,
  BOUNCE_CLOSE_THRESHOLD, BOUNCE_NEAR_THRESHOLD, BOUNCE_MID_THRESHOLD,
} from "../src/engine/physics-constants";
import type { Player } from "../src/models/player";

// ========== パラメータ範囲 ==========
const DIRECTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const EXIT_VELOCITIES = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const LAUNCH_ANGLES = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type ResultType = "out" | "error" | "infieldHit" | "single" | "double" | "triple" | "homerun";

const POS_NAMES: Record<number, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

// ========== ダミー選手(平均能力65) ==========
function createFielderMap(): Map<FielderPosition, Player> {
  const roster = generateRoster(65);
  const map = new Map<FielderPosition, Player>();
  const pitchers = roster.filter(p => p.position === "P");
  const batters = roster.filter(p => p.position !== "P");
  if (pitchers.length > 0) map.set(1, pitchers[0]);
  const positions: FielderPosition[] = [2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 0; i < positions.length && i < batters.length; i++) {
    map.set(positions[i], batters[i]);
  }
  return map;
}

// ========== 結果判定ロジック(ランダムなし) ==========
const BASE_LENGTH = 27.4;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function distToLanding(d: FielderDecision, landing: BallLanding): number {
  if (!d.posAtLanding) return d.distanceAtLanding ?? d.distanceToBall;
  return Math.sqrt(
    (d.posAtLanding.x - landing.position.x) ** 2 +
    (d.posAtLanding.y - landing.position.y) ** 2
  );
}

/** 回収者選択: retrievalCandidate=trueの最短距離 */
function selectRetriever(
  fieldingResult: Map<FielderPosition, FielderDecision>,
  landing: BallLanding,
  best: FielderDecision
): FielderDecision {
  let retriever: FielderDecision | null = null;
  let minDist = Infinity;
  for (const decision of fieldingResult.values()) {
    if (!(decision.retrievalCandidate ?? false)) continue;
    const d = distToLanding(decision, landing);
    if (d < minDist) { minDist = d; retriever = decision; }
  }
  return retriever ?? best;
}

/** 1Bへの送球距離 */
function getThrowDistToFirst(pos: number): number {
  const distances: Record<number, number> = {
    1: 19.4, 2: 27.4, 3: 5, 4: 18, 5: 38.8, 6: 32, 7: 55, 8: 60, 9: 35,
  };
  return distances[pos] ?? 30;
}

/** HR判定(フェンス越え) */
function checkHR(dir: number, ev: number, la: number, trajectory: number): boolean {
  if (la < 10) return false; // 低角度はHRにならない
  const distance = estimateDistance(ev, la);
  const fenceDist = getFenceDistance(dir);
  const baseCarry = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, trajectory - 1))];
  let carryFactor = baseCarry;
  if (la > 35) {
    const taper = Math.max(0, 1 - (la - 35) / 15);
    carryFactor = 1 + (baseCarry - 1) * taper;
  }
  const effDist = distance * carryFactor;
  if (effDist / fenceDist < 1.0) return false;

  // 高さチェック
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

/** ゴロ: 野手到達 → 送球 vs 走者 */
function resolveGroundBallResult(
  best: FielderDecision,
  batter: Player,
): ResultType {
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;
  const runnerTo1B = 0.3 + timePerBase;

  const skill = best.skill;
  const secureTime = 0.3 + (1 - skill.fielding / 100) * 0.3;
  const transferTime = 0.6 + (1 - skill.arm / 100) * 0.4;
  const throwSpeed = 25 + (skill.arm / 100) * 15;
  const fieldTime = Math.max(best.timeToReach, best.ballArrivalTime);
  const throwDist = getThrowDistToFirst(best.position);
  const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;

  if (runnerTo1B < defenseTime) return "infieldHit";
  return "out";
}

/** ヒット確定後の進塁判定(ランダムなし, 中央値使用) */
function resolveHitAdvancement(
  ball: { direction: number; exitVelocity: number },
  landing: BallLanding,
  retriever: FielderDecision,
  batter: Player,
): ResultType {
  const skill = retriever.skill;
  const distAtLanding = retriever.distanceAtLanding ?? retriever.distanceToBall;

  // バウンドペナルティ(ランダム中央値)
  let bouncePenalty: number;
  let rollDistance: number;
  if (landing.isGroundBall) {
    bouncePenalty = 0.75; // 0.5 + 0.25 (中央値)
    rollDistance = 3;
  } else {
    const depthFactor = clamp((landing.distance - 50) / 50, 0, 1);
    const fenceDist = getFenceDistance(ball.direction);
    if (distAtLanding < BOUNCE_CLOSE_THRESHOLD) {
      bouncePenalty = 0.5 + depthFactor * 0.5 + 0.2;
      rollDistance = 1 + depthFactor * 2;
    } else if (distAtLanding < BOUNCE_NEAR_THRESHOLD) {
      bouncePenalty = 0.8 + depthFactor * 1.0 + 0.3;
      rollDistance = 2 + depthFactor * 3;
    } else if (distAtLanding < BOUNCE_MID_THRESHOLD) {
      bouncePenalty = 1.2 + depthFactor * 1.5 + 0.35;
      rollDistance = clamp((landing.distance - 50) * 0.1, 0, 6);
    } else {
      bouncePenalty = 1.2 + depthFactor * 2.0 + 0.4;
      rollDistance = clamp((landing.distance - 50) * 0.15, 0, 12);
    }
    if (landing.distance >= fenceDist * 0.90) {
      bouncePenalty += 0.9; // 0.6 + 0.3 中央値
    }
  }

  const pickupTime = 0.3 + (1 - skill.catching / 100) * 0.4;
  const runSpeedFielder = retriever.speed ?? 6.5;
  const additionalRunTime = distAtLanding / runSpeedFielder;
  const totalFielderTime = landing.isGroundBall
    ? retriever.timeToReach + bouncePenalty + pickupTime
    : retriever.ballArrivalTime + additionalRunTime + bouncePenalty + pickupTime;

  const throwSpeed = 25 + (skill.arm / 100) * 15;
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;

  const angleRad = (ball.direction - 45) * Math.PI / 180;
  const retrievalPos = {
    x: landing.position.x + rollDistance * Math.sin(angleRad),
    y: landing.position.y + rollDistance * Math.cos(angleRad),
  };

  const throwTo2B = Math.sqrt(
    (retrievalPos.x - 0) ** 2 + (retrievalPos.y - 38.8) ** 2
  );
  const throwTo3B = Math.sqrt(
    (retrievalPos.x - (-19.4)) ** 2 + (retrievalPos.y - 19.4) ** 2
  );

  const runnerTo2B = 0.3 + timePerBase * 2;
  const runnerTo3B = 0.3 + timePerBase * 3;
  const defenseTo2B = totalFielderTime + throwTo2B / throwSpeed;
  const defenseTo3B = totalFielderTime + throwTo3B / throwSpeed;

  let basesReached = 1;
  if (runnerTo2B < defenseTo2B + 1.2) basesReached = 2;
  if (basesReached >= 2 && runnerTo3B < defenseTo3B - 0.9) basesReached = 3;

  if (basesReached >= 3) return "triple";
  if (basesReached >= 2) return "double";
  return "single";
}

/** フライ捕球成功率(平均値を返す) */
function flyCatchRate(best: FielderDecision): number {
  const skill = best.skill;
  // 本来はdistanceAtLandingベースだが、canReach=trueなら高確率
  return clamp(0.92 + skill.fielding / 100 * 0.07, 0.92, 0.99);
}

// ========== メイン ==========
const csvMode = process.argv.includes("--csv");
const fielderMap = createFielderMap();
const runners = { first: false, second: false, third: false };
const batter = [...fielderMap.values()].find(p => p.position !== "P")!;

interface TestResult {
  direction: number;
  exitVelocity: number;
  launchAngle: number;
  ballType: string;
  distance: number;
  result: ResultType;
  primaryPos: number;
  retrieverPos: number;
  retrieverDist: number;
}

const results: TestResult[] = [];

for (const dir of DIRECTIONS) {
  for (const ev of EXIT_VELOCITIES) {
    for (const la of LAUNCH_ANGLES) {
      const ballType = classifyBattedBallType(la, ev);
      const landing = calcBallLanding(dir, la, ev);
      const fieldingResult = evaluateFielders(landing, ballType, fielderMap, runners, 0);

      // primary決定
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

      let result: ResultType;

      // HR判定
      if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la, 2)) {
        result = "homerun";
        results.push({
          direction: dir, exitVelocity: ev, launchAngle: la, ballType,
          distance: Math.round(landing.distance * 10) / 10,
          result, primaryPos: best.position, retrieverPos: best.position,
          retrieverDist: 0,
        });
        continue;
      }

      // popup(非HR)は常にアウト
      if (ballType === "popup") {
        result = "out";
        results.push({
          direction: dir, exitVelocity: ev, launchAngle: la, ballType,
          distance: Math.round(landing.distance * 10) / 10,
          result, primaryPos: best.position, retrieverPos: best.position,
          retrieverDist: 0,
        });
        continue;
      }

      if (best.canReach) {
        // 野手が到達可能
        if (ballType === "ground_ball") {
          result = resolveGroundBallResult(best, batter);
        } else {
          // フライ/ライナー: 捕球率の中央値で判定 → ここでは「到達=アウト」で統一
          result = "out";
        }
        results.push({
          direction: dir, exitVelocity: ev, launchAngle: la, ballType,
          distance: Math.round(landing.distance * 10) / 10,
          result, primaryPos: best.position, retrieverPos: best.position,
          retrieverDist: 0,
        });
      } else {
        // 野手が到達不可 → ヒット確定、回収者による進塁判定
        const retriever = selectRetriever(fieldingResult, landing, best);
        result = resolveHitAdvancement(
          { direction: dir, exitVelocity: ev },
          landing, retriever, batter,
        );
        results.push({
          direction: dir, exitVelocity: ev, launchAngle: la, ballType,
          distance: Math.round(landing.distance * 10) / 10,
          result, primaryPos: best.position,
          retrieverPos: retriever.position,
          retrieverDist: Math.round(distToLanding(retriever, landing) * 10) / 10,
        });
      }
    }
  }
}

// ========== CSV出力 ==========
if (csvMode) {
  console.log("direction,exitVelocity,launchAngle,ballType,distance,result,primaryPos,retrieverPos,retrieverDist");
  for (const r of results) {
    console.log([
      r.direction, r.exitVelocity, r.launchAngle, r.ballType,
      r.distance, r.result, POS_NAMES[r.primaryPos],
      POS_NAMES[r.retrieverPos], r.retrieverDist,
    ].join(","));
  }
  process.exit(0);
}

// ========== サマリー出力 ==========
const total = results.length;
console.log(`\n⚾ 守備AI網羅テスト (${total}ケース)`);
console.log("━".repeat(60));

// 1. 結果分布
const resultCount: Record<string, number> = {};
for (const r of results) resultCount[r.result] = (resultCount[r.result] ?? 0) + 1;
console.log("\n📊 全体の結果分布:");
const resultOrder: ResultType[] = ["out", "infieldHit", "single", "double", "triple", "homerun", "error"];
for (const res of resultOrder) {
  const count = resultCount[res] ?? 0;
  if (count === 0) continue;
  const pct = (count / total * 100).toFixed(1);
  const bar = "█".repeat(Math.round(count / total * 50));
  console.log(`  ${res.padEnd(10)} ${String(count).padStart(4)}件 (${pct.padStart(5)}%) ${bar}`);
}

// 2. 打球タイプ別結果分布
console.log("\n📊 打球タイプ別結果分布:");
const byType: Record<string, Record<string, number>> = {};
for (const r of results) {
  if (!byType[r.ballType]) byType[r.ballType] = {};
  byType[r.ballType][r.result] = (byType[r.ballType][r.result] ?? 0) + 1;
}
for (const [type, dist] of Object.entries(byType)) {
  const typeTotal = Object.values(dist).reduce((a, b) => a + b, 0);
  const hits = (dist.single ?? 0) + (dist.double ?? 0) + (dist.triple ?? 0)
    + (dist.infieldHit ?? 0) + (dist.homerun ?? 0);
  console.log(`  ${type} (${typeTotal}件, ヒット率=${(hits / typeTotal * 100).toFixed(1)}%):`);
  for (const res of resultOrder) {
    if (!dist[res]) continue;
    console.log(`    ${res}: ${dist[res]}件`);
  }
}

// 3. 回収野手分布(ヒットのみ)
const hitResults = results.filter(r =>
  ["single", "double", "triple", "infieldHit"].includes(r.result)
);
console.log(`\n📊 回収野手分布 (ヒット: ${hitResults.length}件):`);
const retrieverByType: Record<string, Record<string, number>> = {};
for (const r of hitResults) {
  const key = r.ballType;
  if (!retrieverByType[key]) retrieverByType[key] = {};
  const pos = POS_NAMES[r.retrieverPos];
  retrieverByType[key][pos] = (retrieverByType[key][pos] ?? 0) + 1;
}
for (const [type, dist] of Object.entries(retrieverByType)) {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  console.log(`  ${type}: ${entries.map(([p, c]) => `${p}=${c}`).join(", ")}`);
}

// 4. 速度帯 × 角度帯のヒートマップ
console.log("\n📊 速度×角度 結果ヒートマップ (全方向合算):");
console.log(`  ${"".padStart(6)} ${LAUNCH_ANGLES.map(a => String(a).padStart(5) + "°").join("")}`);
console.log(`  ${"─".repeat(6 + LAUNCH_ANGLES.length * 6)}`);
for (const ev of EXIT_VELOCITIES) {
  const row: string[] = [];
  for (const la of LAUNCH_ANGLES) {
    const cases = results.filter(r => r.exitVelocity === ev && r.launchAngle === la);
    if (cases.length === 0) { row.push("  --- "); continue; }
    const hits = cases.filter(r => !["out", "error"].includes(r.result));
    // 最頻結果を表示
    const counts: Record<string, number> = {};
    for (const c of cases) counts[c.result] = (counts[c.result] ?? 0) + 1;
    const topResult = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const abbrev: Record<string, string> = {
      out: "OUT", infieldHit: "IFH", single: "1B", double: "2B",
      triple: "3B", homerun: "HR", error: "ERR",
    };
    row.push((abbrev[topResult] ?? "???").padStart(5) + " ");
  }
  console.log(`  ${(ev + "km").padStart(5)}|${row.join("")}`);
}

// 5. 問題パターン検出
console.log("\n⚠️  問題パターン検出:");
let issues = 0;

// 5a. 弱いゴロ(EV≤80)でP/Cがprimaryにならない
const weakGrounders = results.filter(r =>
  r.ballType === "ground_ball" && r.exitVelocity <= 80 && r.distance < 20
);
const wgNoPorC = weakGrounders.filter(r => r.primaryPos !== 1 && r.primaryPos !== 2);
if (wgNoPorC.length > 0) {
  console.log(`  ❌ 弱いゴロ(EV≤80, dist<20m)でP/Cがprimaryでない: ${wgNoPorC.length}/${weakGrounders.length}件`);
  issues += wgNoPorC.length;
} else {
  console.log(`  ✅ 弱いゴロ(EV≤80, dist<20m): ${weakGrounders.length}件すべてP/Cがprimary`);
}

// 5b. 遠い打球でP/Cが回収者
const farPorC = hitResults.filter(r => r.distance > 50 && (r.retrieverPos === 1 || r.retrieverPos === 2));
if (farPorC.length > 0) {
  console.log(`  ❌ 遠い打球(dist>50m)でP/Cが回収者: ${farPorC.length}件`);
  for (const r of farPorC.slice(0, 3)) {
    console.log(`    dir=${r.direction} EV=${r.exitVelocity} LA=${r.launchAngle} dist=${r.distance}m → ${POS_NAMES[r.retrieverPos]}`);
  }
  issues += farPorC.length;
} else {
  console.log(`  ✅ 遠い打球(dist>50m): P/Cが回収者になるケースなし`);
}

// 5c. 浅いゴロでOFが回収
const shallowGroundOF = hitResults.filter(r =>
  r.ballType === "ground_ball" && r.distance < 25 && r.retrieverPos >= 7
);
if (shallowGroundOF.length > 0) {
  console.log(`  ❌ 浅いゴロ(dist<25m)でOFが回収者: ${shallowGroundOF.length}件`);
  issues += shallowGroundOF.length;
} else {
  console.log(`  ✅ 浅いゴロ(dist<25m): OFが無駄に回収者になるケースなし`);
}

// 5d. 深い打球で内野手が回収
const deepIF = hitResults.filter(r =>
  r.distance > 60 && r.retrieverPos >= 3 && r.retrieverPos <= 6
);
if (deepIF.length > 0) {
  console.log(`  ❌ 深い打球(dist>60m)で内野手が回収者: ${deepIF.length}件`);
  issues += deepIF.length;
} else {
  console.log(`  ✅ 深い打球(dist>60m): 内野手が回収者になるケースなし`);
}

// 5e. 短距離長打(dist<50mでdouble以上)
const shortXBH = results.filter(r =>
  r.distance < 50 && (r.result === "double" || r.result === "triple")
);
if (shortXBH.length > 0) {
  console.log(`  ⚠️  短距離長打(dist<50m): ${shortXBH.length}件`);
  // タイプ別内訳
  const byBT: Record<string, number> = {};
  for (const r of shortXBH) byBT[r.ballType] = (byBT[r.ballType] ?? 0) + 1;
  console.log(`    内訳: ${Object.entries(byBT).map(([t, c]) => `${t}=${c}`).join(", ")}`);
  for (const r of shortXBH.slice(0, 5)) {
    console.log(`    dir=${r.direction} EV=${r.exitVelocity} LA=${r.launchAngle} dist=${r.distance}m type=${r.ballType} → ${r.result} (retriever=${POS_NAMES[r.retrieverPos]} ${r.retrieverDist}m)`);
  }
} else {
  console.log(`  ✅ 短距離長打: なし`);
}

// 5f. 長距離シングル(dist>60mでsingle)
const longSingle = results.filter(r =>
  r.distance > 60 && r.result === "single"
);
if (longSingle.length > 0) {
  console.log(`  ⚠️  長距離シングル(dist>60m): ${longSingle.length}件`);
  for (const r of longSingle.slice(0, 3)) {
    console.log(`    dir=${r.direction} EV=${r.exitVelocity} LA=${r.launchAngle} dist=${r.distance}m → single (retriever=${POS_NAMES[r.retrieverPos]} ${r.retrieverDist}m)`);
  }
}

console.log(`\n━━━ 合計: ${total}ケース, 問題=${issues}件 ━━━\n`);
