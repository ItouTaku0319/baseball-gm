// 守備グリッドテストの結果を分析するスクリプト
// Usage: npx tsx scripts/analyze-grid.ts

import { calcBallLanding, evaluateFielders, DEFAULT_FIELDER_POSITIONS } from "../src/engine/fielding-ai";
import { classifyBattedBallType, estimateDistance, getFenceDistance } from "../src/engine/simulation";
import { TRAJECTORY_CARRY_FACTORS, GRAVITY, BAT_HEIGHT, FENCE_HEIGHT } from "../src/engine/physics-constants";
import type { Player } from "../src/models/player";
import type { BallLanding, FielderDecision } from "../src/engine/fielding-ai";

const DIRECTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const EXIT_VELOCITIES = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const LAUNCH_ANGLES = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
const POS_NAMES: Record<number, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};
const POSITION_MAP: Record<FielderPosition, Player["position"]> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function createTestPlayer(pos: FielderPosition): Player {
  const position = POSITION_MAP[pos];
  const isPitcher = pos === 1;
  return {
    id: `test-${position}`, name: `Test${position}`, age: 25, position, isPitcher,
    throwHand: "R" as const, batSide: "R" as const,
    batting: { contact: 50, power: 50, trajectory: 2, speed: 50, arm: 50, fielding: 50, catching: 50, eye: 50 },
    pitching: isPitcher ? { velocity: 145, control: 50, pitches: [{ type: "slider" as const, level: 4 }], stamina: 50, mentalToughness: 50, arm: 50, fielding: 50, catching: 50 } : null,
    potential: { overall: "C" as const }, salary: 500, contractYears: 1, careerBattingStats: {}, careerPitchingStats: {},
  } as Player;
}

const fielderMap = new Map<FielderPosition, Player>();
for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) fielderMap.set(pos, createTestPlayer(pos));
const runners = { first: false, second: false, third: false };
const BASE_LENGTH = 27.4;

function distToLanding(d: FielderDecision, landing: BallLanding): number {
  if (!d.posAtLanding) return d.distanceAtLanding ?? d.distanceToBall;
  return Math.sqrt((d.posAtLanding.x - landing.position.x) ** 2 + (d.posAtLanding.y - landing.position.y) ** 2);
}

function selectRetriever(fieldingResult: Map<FielderPosition, FielderDecision>, landing: BallLanding): FielderDecision | null {
  const ofConvergers = Array.from(fieldingResult.values())
    .filter(d => d.interceptType === "fly_converge" && d.position >= 7)
    .sort((a, b) => (a.distanceAtLanding ?? a.distanceToBall) - (b.distanceAtLanding ?? b.distanceToBall));
  let retriever: FielderDecision | null = ofConvergers[0] ?? null;
  if (landing.distance < 30) {
    let bestDist = retriever ? distToLanding(retriever, landing) : Infinity;
    for (const d of fieldingResult.values()) {
      if (d.position <= 2 || d.position >= 7) continue;
      const dist = distToLanding(d, landing);
      if (dist < bestDist) { retriever = d; bestDist = dist; }
    }
  }
  if (!retriever) {
    for (const d of fieldingResult.values()) {
      if (d.position >= 7) { retriever = d; break; }
    }
  }
  return retriever;
}

function checkHR(dir: number, ev: number, la: number, trajectory: number): boolean {
  if (la < 10) return false;
  const distance = estimateDistance(ev, la);
  const fenceDist = getFenceDistance(dir);
  const baseCarry = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, trajectory - 1))];
  let carryFactor = baseCarry;
  if (la > 35) { const taper = Math.max(0, 1 - (la - 35) / 15); carryFactor = 1 + (baseCarry - 1) * taper; }
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

// ===== 全パターン計算 =====
interface Row {
  dir: number; ev: number; la: number;
  ballType: string; dist: number; landX: number; landY: number;
  result: string; primaryPos: number; primaryReach: boolean;
  retrieverPos: number; retrieverDist: number;
  issues: string[];
}

const allRows: Row[] = [];

for (const dir of DIRECTIONS) {
  for (const ev of EXIT_VELOCITIES) {
    for (const la of LAUNCH_ANGLES) {
      const ballType = classifyBattedBallType(la, ev);
      const landing = calcBallLanding(dir, la, ev);
      const fieldingResult = evaluateFielders(landing, ballType, fielderMap, runners, 0);

      let best: FielderDecision | null = null;
      for (const d of fieldingResult.values()) { if (d.canReach && (!best || d.timeToReach < best.timeToReach)) best = d; }
      if (!best) { for (const d of fieldingResult.values()) { if (!best || d.distanceToBall < best.distanceToBall) best = d; } }
      if (!best) continue;

      let result: string = "single";
      let retrieverPos = best.position;
      let retrieverDist = 0;

      if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la, 2)) {
        result = "homerun";
      } else if (ballType === "popup") {
        result = "popupOut";
      } else if (ballType === "ground_ball") {
        // ゴロ: path_intercept判定
        const interceptors = Array.from(fieldingResult.values())
          .filter(d => d.interceptType === "path_intercept")
          .sort((a, b) => (a.projectionDistance ?? 0) - (b.projectionDistance ?? 0));
        let caught = false;
        for (const f of interceptors) {
          if (f.timeToReach <= f.ballArrivalTime) {
            // アウトかIFH判定
            const runnerSpeed = 6.5 + 50 / 100 * 2.5;
            const timePerBase = BASE_LENGTH / runnerSpeed;
            const runnerTo1B = 0.7 + timePerBase;
            const secureTime = 0.2 + (1 - 50 / 100) * 0.2;
            const transferTime = 0.45 + (1 - 50 / 100) * 0.25;
            const throwSpeed = 25 + (50 / 100) * 15;
            const fieldTime = Math.max(f.timeToReach, f.ballArrivalTime);
            const throwDist = f.targetPos ? Math.sqrt((f.targetPos.x - 19.4) ** 2 + (f.targetPos.y - 19.4) ** 2) : 20;
            const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
            result = runnerTo1B < defenseTime ? "infieldHit" : "out";
            retrieverPos = f.position;
            caught = true;
            break;
          }
        }
        if (!caught) {
          // chase_to_stop
          let chaseF: FielderDecision | null = null;
          let minDist = Infinity;
          for (const d of fieldingResult.values()) {
            if (d.interceptType !== "chase_to_stop" || !d.canReach) continue;
            if (d.position > 6 || d.position === 1) continue;
            const dd = distToLanding(d, landing);
            if (dd < minDist) { minDist = dd; chaseF = d; }
          }
          if (chaseF) {
            const runnerSpeed = 6.5 + 50 / 100 * 2.5;
            const timePerBase = BASE_LENGTH / runnerSpeed;
            const runnerTo1B = 0.7 + timePerBase;
            const secureTime = 0.15 + (1 - 50 / 100) * 0.15;
            const transferTime = 0.45 + (1 - 50 / 100) * 0.25;
            const throwSpeed = 25 + (50 / 100) * 15;
            const fieldTime = Math.max(chaseF.timeToReach, chaseF.ballArrivalTime);
            const throwDist = chaseF.targetPos ? Math.sqrt((chaseF.targetPos.x - 19.4) ** 2 + (chaseF.targetPos.y - 19.4) ** 2) : 20;
            const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
            result = runnerTo1B < defenseTime ? "infieldHit" : "out";
            retrieverPos = chaseF.position;
          } else {
            result = "single"; // 外野抜け
            const ret = selectRetriever(fieldingResult, landing);
            if (ret) { retrieverPos = ret.position; retrieverDist = Math.round(distToLanding(ret, landing) * 10) / 10; }
          }
        }
      } else if (best.canReach) {
        result = "out";
      } else {
        const retriever = selectRetriever(fieldingResult, landing) ?? best;
        retrieverPos = retriever.position;
        retrieverDist = Math.round(distToLanding(retriever, landing) * 10) / 10;
        // 簡易長打判定
        if (landing.distance > 100) result = "triple";
        else if (landing.distance > 80) result = "double";
        else result = "single";
      }

      const issues: string[] = [];
      const isHit = !["out", "popupOut"].includes(result);
      if (isHit && landing.distance > 50 && (retrieverPos === 1 || retrieverPos === 2)) issues.push("遠距離P/C回収");
      if (isHit && ballType === "ground_ball" && landing.distance < 25 && retrieverPos >= 7) issues.push("浅ゴロOF回収");
      if (isHit && landing.distance > 60 && retrieverPos >= 3 && retrieverPos <= 6) issues.push("深打球IF回収");
      if (landing.distance < 50 && (result === "double" || result === "triple")) issues.push("短距離長打");
      if (landing.distance > 60 && result === "single") issues.push("長距離単打");
      if (isHit && ballType === "fly_ball" && retrieverPos === 2 && landing.distance > 10) issues.push("フライC回収");

      allRows.push({
        dir, ev, la, ballType, dist: Math.round(landing.distance * 10) / 10,
        landX: Math.round(landing.position.x * 10) / 10, landY: Math.round(landing.position.y * 10) / 10,
        result, primaryPos: best.position, primaryReach: best.canReach,
        retrieverPos, retrieverDist, issues,
      });
    }
  }
}

// ===== 分析出力 =====

console.log("======================================================================");
console.log("  守備グリッド分析レポート");
console.log(`  総パターン数: ${allRows.length}`);
console.log("======================================================================");

// 1. 結果分布
console.log("\n--- 1. 全体結果分布 ---");
const resultCounts: Record<string, number> = {};
for (const r of allRows) resultCounts[r.result] = (resultCounts[r.result] ?? 0) + 1;
for (const [res, cnt] of Object.entries(resultCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${res.padEnd(12)} ${String(cnt).padStart(5)} (${(cnt / allRows.length * 100).toFixed(1)}%)`);
}

// 2. 打球タイプ別結果
console.log("\n--- 2. 打球タイプ別結果 ---");
const ballTypes = ["ground_ball", "line_drive", "fly_ball", "popup"];
for (const bt of ballTypes) {
  const subset = allRows.filter(r => r.ballType === bt);
  const dist: Record<string, number> = {};
  for (const r of subset) dist[r.result] = (dist[r.result] ?? 0) + 1;
  const total = subset.length;
  console.log(`  ${bt} (n=${total}):`);
  for (const [res, cnt] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    const bar = "#".repeat(Math.round(cnt / total * 40));
    console.log(`    ${res.padEnd(12)} ${String(cnt).padStart(4)} (${(cnt / total * 100).toFixed(1)}%) ${bar}`);
  }
}

// 3. エラーパターン詳細
const errors = allRows.filter(r => r.issues.some(i => ["遠距離P/C回収", "浅ゴロOF回収", "深打球IF回収"].includes(i)));
console.log(`\n--- 3. エラーパターン (${errors.length}件) ---`);
for (const r of errors) {
  console.log(`  dir=${r.dir}° ev=${r.ev}km/h la=${r.la}° | type=${r.ballType} dist=${r.dist}m | ` +
    `primary=${POS_NAMES[r.primaryPos]}(reach=${r.primaryReach}) retriever=${POS_NAMES[r.retrieverPos]} | ${r.issues.join(", ")}`);
}

// 4. 警告パターン内訳
console.log("\n--- 4. 警告パターン内訳 ---");
const warnTypes = ["短距離長打", "長距離単打", "フライC回収"];
for (const wt of warnTypes) {
  const subset = allRows.filter(r => r.issues.includes(wt));
  console.log(`  ${wt}: ${subset.length}件`);
  if (subset.length > 0) {
    // 特徴を集計
    const evRange = [Math.min(...subset.map(r => r.ev)), Math.max(...subset.map(r => r.ev))];
    const laRange = [Math.min(...subset.map(r => r.la)), Math.max(...subset.map(r => r.la))];
    const distRange = [Math.min(...subset.map(r => r.dist)), Math.max(...subset.map(r => r.dist))];
    console.log(`    速度: ${evRange[0]}-${evRange[1]}km/h, 角度: ${laRange[0]}-${laRange[1]}°, 飛距離: ${distRange[0]}-${distRange[1]}m`);
    // サンプル3件
    for (const r of subset.slice(0, 3)) {
      console.log(`    例: dir=${r.dir}° ev=${r.ev}km/h la=${r.la}° dist=${r.dist}m result=${r.result} retriever=${POS_NAMES[r.retrieverPos]}`);
    }
  }
}

// 5. ゴロ方向別アウト率
console.log("\n--- 5. ゴロ方向別アウト率 ---");
for (const dir of [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90]) {
  const subset = allRows.filter(r => r.dir === dir && r.ballType === "ground_ball");
  const outs = subset.filter(r => r.result === "out").length;
  const ifh = subset.filter(r => r.result === "infieldHit").length;
  const singles = subset.filter(r => r.result === "single").length;
  const total = subset.length;
  if (total > 0) {
    console.log(`  ${String(dir).padStart(2)}°: OUT=${outs}(${(outs/total*100).toFixed(0)}%) IFH=${ifh}(${(ifh/total*100).toFixed(0)}%) 1B=${singles}(${(singles/total*100).toFixed(0)}%) | n=${total}`);
  }
}

// 6. フライ距離帯別アウト率
console.log("\n--- 6. フライ/ライナー 距離帯別アウト率 ---");
const distBands: [number, number][] = [[0, 30], [30, 50], [50, 70], [70, 90], [90, 110], [110, 140]];
for (const [lo, hi] of distBands) {
  const subset = allRows.filter(r => (r.ballType === "fly_ball" || r.ballType === "line_drive") && r.dist >= lo && r.dist < hi);
  const outs = subset.filter(r => r.result === "out").length;
  const total = subset.length;
  if (total > 0) {
    console.log(`  ${lo}-${hi}m: OUT=${outs}/${total} (${(outs/total*100).toFixed(1)}%)`);
  }
}

// 7. 守備位置別担当率
console.log("\n--- 7. 守備位置別 primary担当 ---");
const primaryCounts: Record<string, Record<string, number>> = {};
for (const r of allRows) {
  const pos = POS_NAMES[r.primaryPos];
  if (!primaryCounts[pos]) primaryCounts[pos] = {};
  primaryCounts[pos][r.ballType] = (primaryCounts[pos][r.ballType] ?? 0) + 1;
}
console.log("  Pos   | ground_ball | line_drive | fly_ball | popup  | total");
console.log("  ------+-------------+------------+----------+--------+------");
for (const pos of ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]) {
  const c = primaryCounts[pos] ?? {};
  const g = c.ground_ball ?? 0;
  const l = c.line_drive ?? 0;
  const f = c.fly_ball ?? 0;
  const p = c.popup ?? 0;
  const total = g + l + f + p;
  console.log(`  ${pos.padEnd(5)} | ${String(g).padStart(11)} | ${String(l).padStart(10)} | ${String(f).padStart(8)} | ${String(p).padStart(6)} | ${String(total).padStart(5)}`);
}

// 8. ヒット時の回収者分布
console.log("\n--- 8. ヒット時の回収者分布 ---");
const hitRows = allRows.filter(r => !["out", "popupOut", "homerun"].includes(r.result));
const retCounts: Record<string, number> = {};
for (const r of hitRows) retCounts[POS_NAMES[r.retrieverPos]] = (retCounts[POS_NAMES[r.retrieverPos]] ?? 0) + 1;
const hitTotal = hitRows.length;
console.log(`  ヒット総数: ${hitTotal}`);
for (const pos of ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]) {
  const cnt = retCounts[pos] ?? 0;
  if (cnt > 0) {
    const bar = "#".repeat(Math.round(cnt / hitTotal * 50));
    console.log(`  ${pos.padEnd(3)} ${String(cnt).padStart(4)} (${(cnt/hitTotal*100).toFixed(1)}%) ${bar}`);
  }
}

// 9. 速度帯別ヒット率
console.log("\n--- 9. 速度帯別ヒット率 ---");
for (const ev of EXIT_VELOCITIES) {
  const subset = allRows.filter(r => r.ev === ev);
  const hits = subset.filter(r => !["out", "popupOut"].includes(r.result)).length;
  const hr = subset.filter(r => r.result === "homerun").length;
  const total = subset.length;
  const bar = "#".repeat(Math.round(hits / total * 40));
  console.log(`  ${String(ev).padStart(3)}km/h: ヒット=${hits}/${total} (${(hits/total*100).toFixed(1)}%) HR=${hr} ${bar}`);
}

// 10. 角度帯別ヒット率
console.log("\n--- 10. 角度帯別ヒット率 ---");
for (const la of LAUNCH_ANGLES) {
  const subset = allRows.filter(r => r.la === la);
  const hits = subset.filter(r => !["out", "popupOut"].includes(r.result)).length;
  const hr = subset.filter(r => r.result === "homerun").length;
  const total = subset.length;
  const bar = "#".repeat(Math.round(hits / total * 40));
  console.log(`  ${String(la).padStart(3)}°: ヒット=${hits}/${total} (${(hits/total*100).toFixed(1)}%) HR=${hr} ${bar}`);
}
