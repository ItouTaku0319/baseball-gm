// 守備グリッドテストの結果を分析するスクリプト（エージェントベース守備AI版）
// Usage: npx tsx scripts/analyze-grid.ts

import { calcBallLanding } from "../src/engine/fielding-ai";
import { classifyBattedBallType, estimateDistance, getFenceDistance } from "../src/engine/simulation";
import { GRAVITY, BAT_HEIGHT, FENCE_HEIGHT, DRAG_FACTOR, FLIGHT_TIME_FACTOR } from "../src/engine/physics-constants";
import { resolvePlayWithAgents } from "../src/engine/fielding-agent";
import type { Player } from "../src/models/player";
import type { FielderPosition } from "../src/engine/fielding-agent-types";

const DIRECTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const EXIT_VELOCITIES = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const LAUNCH_ANGLES = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];

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
const batter = createTestPlayer(4); // テスト打者
const bases = { first: null, second: null, third: null };
const BASE_LENGTH = 27.4;

function checkHR(dir: number, ev: number, la: number): boolean {
  if (la < 10) return false;
  const landing = calcBallLanding(dir, la, ev);
  const fenceDist = getFenceDistance(dir);
  if (landing.distance < fenceDist) return false;
  const v0 = ev / 3.6;
  const theta = la * Math.PI / 180;
  const vy0 = v0 * Math.sin(theta);
  const vx = v0 * Math.cos(theta);
  const tUp = vy0 / GRAVITY;
  const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * GRAVITY);
  const tDown = Math.sqrt(2 * maxH / GRAVITY);
  const totalFlightTime = (tUp + tDown) * FLIGHT_TIME_FACTOR;
  const totalDistance = vx * totalFlightTime * DRAG_FACTOR;
  const tFence = totalDistance > 0 ? totalFlightTime * (fenceDist / totalDistance) : totalFlightTime;
  const height = BAT_HEIGHT + vy0 * tFence - 0.5 * GRAVITY * tFence * tFence;
  return height >= FENCE_HEIGHT;
}

// ===== 全パターン計算 =====
interface Row {
  dir: number; ev: number; la: number;
  ballType: string; dist: number; landX: number; landY: number;
  result: string; fielderPos: number;
  issues: string[];
}

const allRows: Row[] = [];
// 決定的テスト用の固定乱数シード
let rngState = 42;
function seededRng(): number {
  rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

console.log("計算開始...");
const startTime = Date.now();

for (const dir of DIRECTIONS) {
  for (const ev of EXIT_VELOCITIES) {
    for (const la of LAUNCH_ANGLES) {
      const ballType = classifyBattedBallType(la, ev);
      const landing = calcBallLanding(dir, la, ev);

      // HR/ポップフライは事前判定（エージェント呼び出し不要）
      if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la)) {
        allRows.push({
          dir, ev, la, ballType, dist: Math.round(landing.distance * 10) / 10,
          landX: Math.round(landing.position.x * 10) / 10,
          landY: Math.round(landing.position.y * 10) / 10,
          result: "homerun", fielderPos: 8, issues: [],
        });
        continue;
      }
      if (ballType === "popup") {
        allRows.push({
          dir, ev, la, ballType, dist: Math.round(landing.distance * 10) / 10,
          landX: Math.round(landing.position.x * 10) / 10,
          landY: Math.round(landing.position.y * 10) / 10,
          result: "popout", fielderPos: 2, issues: [],
        });
        continue;
      }

      // エージェントベース守備AI（ノイズなし = 決定的）
      rngState = dir * 10000 + ev * 100 + la + 42; // パターンごとにシード変更
      const ball = { direction: dir, launchAngle: la, exitVelocity: ev, type: ballType };
      const agentResult = resolvePlayWithAgents(
        ball, landing, fielderMap, batter, bases, 0,
        { perceptionNoise: 0, random: seededRng }
      );

      const result = agentResult.result;
      const fielderPos = agentResult.fielderPos;
      const isOut = ["groundout", "flyout", "lineout", "popout", "doublePlay", "fieldersChoice"].includes(result);

      const issues: string[] = [];
      const isHit = !isOut && result !== "homerun";
      if (isHit && landing.distance > 50 && (fielderPos === 1 || fielderPos === 2)) issues.push("遠距離P/C回収");
      if (isHit && ballType === "ground_ball" && landing.distance < 25 && fielderPos >= 7) issues.push("浅ゴロOF回収");
      if (isHit && landing.distance > 60 && fielderPos >= 3 && fielderPos <= 6) issues.push("深打球IF回収");
      if (landing.distance < 50 && (result === "double" || result === "triple")) issues.push("短距離長打");
      if (landing.distance > 60 && result === "single") issues.push("長距離単打");
      if (isHit && ballType === "fly_ball" && fielderPos === 2 && landing.distance > 10) issues.push("フライC回収");

      allRows.push({
        dir, ev, la, ballType, dist: Math.round(landing.distance * 10) / 10,
        landX: Math.round(landing.position.x * 10) / 10,
        landY: Math.round(landing.position.y * 10) / 10,
        result, fielderPos, issues,
      });
    }
  }
}

const elapsed = Date.now() - startTime;

// ===== 分析出力 =====

console.log("======================================================================");
console.log("  守備グリッド分析レポート (エージェントベース守備AI)");
console.log(`  総パターン数: ${allRows.length}  計算時間: ${elapsed}ms`);
console.log("======================================================================");

// 1. 結果分布
console.log("\n--- 1. 全体結果分布 ---");
const resultCounts: Record<string, number> = {};
for (const r of allRows) resultCounts[r.result] = (resultCounts[r.result] ?? 0) + 1;
for (const [res, cnt] of Object.entries(resultCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${res.padEnd(16)} ${String(cnt).padStart(5)} (${(cnt / allRows.length * 100).toFixed(1)}%)`);
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
    console.log(`    ${res.padEnd(16)} ${String(cnt).padStart(4)} (${(cnt / total * 100).toFixed(1)}%) ${bar}`);
  }
}

// 3. エラーパターン詳細
const errors = allRows.filter(r => r.issues.some(i => ["遠距離P/C回収", "浅ゴロOF回収", "深打球IF回収"].includes(i)));
console.log(`\n--- 3. エラーパターン (${errors.length}件) ---`);
for (const r of errors.slice(0, 30)) {
  console.log(`  dir=${r.dir}° ev=${r.ev}km/h la=${r.la}° | type=${r.ballType} dist=${r.dist}m | ` +
    `fielder=${POS_NAMES[r.fielderPos]} result=${r.result} | ${r.issues.join(", ")}`);
}
if (errors.length > 30) console.log(`  ... 他 ${errors.length - 30}件`);

// 4. 警告パターン内訳
console.log("\n--- 4. 警告パターン内訳 ---");
const warnTypes = ["短距離長打", "長距離単打", "フライC回収"];
for (const wt of warnTypes) {
  const subset = allRows.filter(r => r.issues.includes(wt));
  console.log(`  ${wt}: ${subset.length}件`);
  if (subset.length > 0) {
    const evRange = [Math.min(...subset.map(r => r.ev)), Math.max(...subset.map(r => r.ev))];
    const laRange = [Math.min(...subset.map(r => r.la)), Math.max(...subset.map(r => r.la))];
    const distRange = [Math.min(...subset.map(r => r.dist)), Math.max(...subset.map(r => r.dist))];
    console.log(`    速度: ${evRange[0]}-${evRange[1]}km/h, 角度: ${laRange[0]}-${laRange[1]}°, 飛距離: ${distRange[0]}-${distRange[1]}m`);
    for (const r of subset.slice(0, 3)) {
      console.log(`    例: dir=${r.dir}° ev=${r.ev}km/h la=${r.la}° dist=${r.dist}m result=${r.result} fielder=${POS_NAMES[r.fielderPos]}`);
    }
  }
}

// 5. ゴロ方向別アウト率
console.log("\n--- 5. ゴロ方向別アウト率 ---");
for (const dir of [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90]) {
  const subset = allRows.filter(r => r.dir === dir && r.ballType === "ground_ball");
  const outs = subset.filter(r => ["groundout", "doublePlay", "fieldersChoice"].includes(r.result)).length;
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
  const outs = subset.filter(r => ["flyout", "lineout"].includes(r.result)).length;
  const total = subset.length;
  if (total > 0) {
    console.log(`  ${lo}-${hi}m: OUT=${outs}/${total} (${(outs/total*100).toFixed(1)}%)`);
  }
}

// 7. 守備位置別担当率（捕球者）
console.log("\n--- 7. 守備位置別 fielder担当 ---");
const fielderCounts: Record<string, Record<string, number>> = {};
for (const r of allRows) {
  if (r.result === "homerun") continue;
  const pos = POS_NAMES[r.fielderPos];
  if (!fielderCounts[pos]) fielderCounts[pos] = {};
  fielderCounts[pos][r.ballType] = (fielderCounts[pos][r.ballType] ?? 0) + 1;
}
console.log("  Pos   | ground_ball | line_drive | fly_ball | popup  | total");
console.log("  ------+-------------+------------+----------+--------+------");
for (const pos of ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]) {
  const c = fielderCounts[pos] ?? {};
  const g = c.ground_ball ?? 0;
  const l = c.line_drive ?? 0;
  const f = c.fly_ball ?? 0;
  const p = c.popup ?? 0;
  const total = g + l + f + p;
  console.log(`  ${pos.padEnd(5)} | ${String(g).padStart(11)} | ${String(l).padStart(10)} | ${String(f).padStart(8)} | ${String(p).padStart(6)} | ${String(total).padStart(5)}`);
}

// 8. ヒット時の fielder 分布
console.log("\n--- 8. ヒット時の fielder 分布 ---");
const hitRows = allRows.filter(r => !["groundout", "flyout", "lineout", "popout", "homerun", "doublePlay", "fieldersChoice", "sacrificeFly"].includes(r.result));
const retCounts: Record<string, number> = {};
for (const r of hitRows) retCounts[POS_NAMES[r.fielderPos]] = (retCounts[POS_NAMES[r.fielderPos]] ?? 0) + 1;
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
  const outs = subset.filter(r => ["groundout", "flyout", "lineout", "popout", "doublePlay", "fieldersChoice", "sacrificeFly"].includes(r.result)).length;
  const hits = subset.length - outs;
  const hr = subset.filter(r => r.result === "homerun").length;
  const total = subset.length;
  const bar = "#".repeat(Math.round(hits / total * 40));
  console.log(`  ${String(ev).padStart(3)}km/h: ヒット=${hits}/${total} (${(hits/total*100).toFixed(1)}%) HR=${hr} ${bar}`);
}

// 10. 角度帯別ヒット率
console.log("\n--- 10. 角度帯別ヒット率 ---");
for (const la of LAUNCH_ANGLES) {
  const subset = allRows.filter(r => r.la === la);
  const outs = subset.filter(r => ["groundout", "flyout", "lineout", "popout", "doublePlay", "fieldersChoice", "sacrificeFly"].includes(r.result)).length;
  const hits = subset.length - outs;
  const hr = subset.filter(r => r.result === "homerun").length;
  const total = subset.length;
  const bar = "#".repeat(Math.round(hits / total * 40));
  console.log(`  ${String(la).padStart(3)}°: ヒット=${hits}/${total} (${(hits/total*100).toFixed(1)}%) HR=${hr} ${bar}`);
}
