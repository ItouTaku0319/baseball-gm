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

// ========== テスト用選手(全能力50固定・再現性担保) ==========
const POSITION_NAMES: Record<FielderPosition, Player["position"]> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function createTestPlayer(pos: FielderPosition): Player {
  const position = POSITION_NAMES[pos];
  const isPitcher = pos === 1;
  return {
    id: `test-${position}`,
    name: `テスト${position}`,
    age: 25,
    position,
    isPitcher,
    throwHand: "R",
    batSide: "R",
    batting: {
      contact: 50, power: 50, trajectory: 2, speed: 50,
      arm: 50, fielding: 50, catching: 50, eye: 50,
    },
    pitching: isPitcher ? {
      velocity: 145, control: 50, pitches: [{ type: "slider", level: 4 }],
      stamina: 50, mentalToughness: 50, arm: 50, fielding: 50, catching: 50,
    } : null,
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
  };
}

function createFielderMap(): Map<FielderPosition, Player> {
  const map = new Map<FielderPosition, Player>();
  for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
    map.set(pos, createTestPlayer(pos));
  }
  return map;
}

// ========== 結果判定ロジック(ランダムなし, simulation.ts の新モデルに合わせる) ==========
const BASE_LENGTH = 27.4;
const BASE_POSITIONS = {
  first: { x: 19.4, y: 19.4 },
  second: { x: 0, y: 38.8 },
  third: { x: -19.4, y: 19.4 },
} as const;

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

/** 実際の捕球位置から1Bへの送球距離 */
function calcThrowDistFromCatchPos(d: FielderDecision): number {
  if (d.targetPos) {
    return Math.sqrt(
      (d.targetPos.x - BASE_POSITIONS.first.x) ** 2 +
      (d.targetPos.y - BASE_POSITIONS.first.y) ** 2
    );
  }
  const distances: Record<number, number> = {
    1: 19.4, 2: 27.4, 3: 5, 4: 18, 5: 38.8, 6: 32, 7: 55, 8: 60, 9: 35,
  };
  return distances[d.position] ?? 30;
}

/** 守備完了時間の推定 */
function estimateDefenseTime(d: FielderDecision, phase: "path_intercept" | "chase_to_stop" = "path_intercept"): number {
  const fieldTime = Math.max(d.timeToReach, d.ballArrivalTime);
  const throwDist = calcThrowDistFromCatchPos(d);
  const throwSpeed = 25 + (d.skill.arm / 100) * 15;
  let secureApprox: number;
  let transferApprox: number;
  if (phase === "chase_to_stop") {
    // 停止球: secure短縮 + transfer短め
    secureApprox = 0.15 + (1 - d.skill.fielding / 100) * 0.15;
    transferApprox = 0.5 + (1 - d.skill.arm / 100) * 0.3;
  } else {
    // path_intercept: ゴロのルーチンプレー → secure/transfer短め
    secureApprox = 0.2 + (1 - d.skill.fielding / 100) * 0.2;
    transferApprox = 0.5 + (1 - d.skill.arm / 100) * 0.3;
  }
  return fieldTime + secureApprox + transferApprox + throwDist / throwSpeed;
}

/** 外野回収者選択: retrievalCandidate + 外野手優先 */
function selectRetriever(
  fieldingResult: Map<FielderPosition, FielderDecision>,
  landing: BallLanding,
  outfieldOnly: boolean
): FielderDecision | null {
  let retriever: FielderDecision | null = null;
  let minDist = Infinity;
  // retrievalCandidate + 外野手
  for (const decision of fieldingResult.values()) {
    if (!(decision.retrievalCandidate ?? false)) continue;
    if (outfieldOnly && decision.position < 7) continue;
    const d = distToLanding(decision, landing);
    if (d < minDist) { minDist = d; retriever = decision; }
  }
  if (retriever) return retriever;
  // 外野手のみ
  for (const decision of fieldingResult.values()) {
    if (decision.position < 7) continue;
    const d = distToLanding(decision, landing);
    if (d < minDist) { minDist = d; retriever = decision; }
  }
  if (retriever) return retriever;
  // 最終フォールバック: 全野手
  for (const d of fieldingResult.values()) {
    const dist = d.distanceAtLanding ?? d.distanceToBall;
    if (dist < minDist) { minDist = dist; retriever = d; }
  }
  return retriever;
}

/** HR判定(フェンス越え) */
function checkHR(dir: number, ev: number, la: number, trajectory: number): boolean {
  if (la < 10) return false;
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

/** ゴロ逐次インターセプト判定 (ランダムなし) */
function resolveGroundBallSequentialDeterministic(
  fieldingResult: Map<FielderPosition, FielderDecision>,
  landing: BallLanding,
  batter: Player,
  direction: number,
): { result: ResultType; fielderPos: number; retrieverPos: number; retrieverDist: number } {
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;
  // ゴロ時の走者到達時間: スイング完了→加速フェーズを含む
  const runnerTo1B = 0.5 + timePerBase;

  // Phase 1: path_intercept全野手(P含む)をprojDist昇順でソート（逐次インターセプト）
  const pathInterceptors = Array.from(fieldingResult.values())
    .filter(d => d.interceptType === "path_intercept")
    .sort((a, b) => (a.projectionDistance ?? 0) - (b.projectionDistance ?? 0));

  // 逐次チェック: timeToReach > ballArrival → 通過, <= → 捕球試行
  for (const fielder of pathInterceptors) {
    if (fielder.timeToReach > fielder.ballArrivalTime) continue; // ボール通過

    // この野手がインターセプト可能 → 捕球成功として送球判定
    const defTime = estimateDefenseTime(fielder);
    if (runnerTo1B < defTime) {
      return { result: "infieldHit", fielderPos: fielder.position, retrieverPos: fielder.position, retrieverDist: 0 };
    }
    return { result: "out", fielderPos: fielder.position, retrieverPos: fielder.position, retrieverDist: 0 };
  }

  // Phase 2: 全interceptor失敗 → chase_to_stop内野手(P除く)で捕球試行
  let chaseFielder: FielderDecision | null = null;
  let minChaseDist = Infinity;
  for (const decision of fieldingResult.values()) {
    if (decision.interceptType !== "chase_to_stop" || !decision.canReach) continue;
    if (decision.position > 6 || decision.position === 1) continue;
    const d = distToLanding(decision, landing);
    if (d < minChaseDist) { minChaseDist = d; chaseFielder = decision; }
  }

  if (chaseFielder) {
    // 捕球成功として送球判定（決定的テスト: 捕球は常に成功）
    const defTime = estimateDefenseTime(chaseFielder, "chase_to_stop");
    const runnerTo1Bx = 0.5 + timePerBase;
    if (runnerTo1Bx < defTime) {
      return { result: "infieldHit", fielderPos: chaseFielder.position, retrieverPos: chaseFielder.position, retrieverDist: 0 };
    }
    return { result: "out", fielderPos: chaseFielder.position, retrieverPos: chaseFielder.position, retrieverDist: 0 };
  }

  // Phase 3: 誰も届かない → 外野手が回収してヒット判定
  let retriever: FielderDecision | null = null;
  let minDist = Infinity;
  for (const decision of fieldingResult.values()) {
    if (decision.position < 7) continue;
    const d = distToLanding(decision, landing);
    if (d < minDist) { minDist = d; retriever = decision; }
  }
  if (!retriever) {
    retriever = selectRetriever(fieldingResult, landing, false);
  }
  if (!retriever) {
    return { result: "single", fielderPos: 8, retrieverPos: 8, retrieverDist: 0 };
  }
  if (landing.distance < 38) {
    return { result: "single", fielderPos: retriever.position, retrieverPos: retriever.position, retrieverDist: distToLanding(retriever, landing) };
  }
  const advResult = resolveHitAdvancementDeterministic(
    { direction }, landing, retriever, batter
  );
  return { result: advResult, fielderPos: retriever.position, retrieverPos: retriever.position, retrieverDist: distToLanding(retriever, landing) };
}

/** フライ複数収束判定 (ランダムなし) */
function resolveFlyMultiConvergeDeterministic(
  fieldingResult: Map<FielderPosition, FielderDecision>,
  landing: BallLanding,
  batter: Player,
  ball: { direction: number },
): { result: ResultType; fielderPos: number; retrieverPos: number; retrieverDist: number } {
  const convergers = Array.from(fieldingResult.values())
    .filter(d => d.interceptType === "fly_converge")
    .sort((a, b) => (a.distanceAtLanding ?? a.distanceToBall) - (b.distanceAtLanding ?? b.distanceToBall));

  // canReach=trueのconvergerがいれば捕球成功(決定的テストではアウト)
  for (const fielder of convergers) {
    if (fielder.canReach) {
      return { result: "out", fielderPos: fielder.position, retrieverPos: fielder.position, retrieverDist: 0 };
    }
  }

  // 全員canReach=false → ヒット確定
  const retriever = selectRetriever(fieldingResult, landing, false);
  if (!retriever) {
    return { result: "single", fielderPos: 8, retrieverPos: 8, retrieverDist: 0 };
  }
  const advResult = resolveHitAdvancementDeterministic(ball, landing, retriever, batter);
  return { result: advResult, fielderPos: retriever.position, retrieverPos: retriever.position, retrieverDist: distToLanding(retriever, landing) };
}

/** ヒット確定後の進塁判定(ランダムなし, 中央値使用) */
function resolveHitAdvancementDeterministic(
  ball: { direction: number },
  landing: BallLanding,
  retriever: FielderDecision,
  batter: Player,
): ResultType {
  const skill = retriever.skill;
  const distAtLanding = retriever.distanceAtLanding ?? retriever.distanceToBall;

  let bouncePenalty: number;
  let rollDistance: number;
  if (landing.isGroundBall) {
    bouncePenalty = 0.75;
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
      bouncePenalty += 0.9;
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
    (retrievalPos.x - BASE_POSITIONS.second.x) ** 2 + (retrievalPos.y - BASE_POSITIONS.second.y) ** 2
  );
  const throwTo3B = Math.sqrt(
    (retrievalPos.x - BASE_POSITIONS.third.x) ** 2 + (retrievalPos.y - BASE_POSITIONS.third.y) ** 2
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

      let result: ResultType;
      let fielderPos: number;
      let retrieverPos: number;
      let retrieverDist: number;

      // HR判定
      if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la, 2)) {
        result = "homerun";
        const best = Array.from(fieldingResult.values())[0];
        results.push({
          direction: dir, exitVelocity: ev, launchAngle: la, ballType,
          distance: Math.round(landing.distance * 10) / 10,
          result, primaryPos: best?.position ?? 8, retrieverPos: best?.position ?? 8,
          retrieverDist: 0,
        });
        continue;
      }

      // popup(非HR)は常にアウト
      if (ballType === "popup") {
        const converger = Array.from(fieldingResult.values())
          .filter(d => d.interceptType === "fly_converge")
          .sort((a, b) => (a.distanceAtLanding ?? a.distanceToBall) - (b.distanceAtLanding ?? b.distanceToBall))[0];
        results.push({
          direction: dir, exitVelocity: ev, launchAngle: la, ballType,
          distance: Math.round(landing.distance * 10) / 10,
          result: "out", primaryPos: converger?.position ?? 8, retrieverPos: converger?.position ?? 8,
          retrieverDist: 0,
        });
        continue;
      }

      // ゴロ: 逐次インターセプトモデル
      if (ballType === "ground_ball") {
        const gbResult = resolveGroundBallSequentialDeterministic(fieldingResult, landing, batter, dir);
        results.push({
          direction: dir, exitVelocity: ev, launchAngle: la, ballType,
          distance: Math.round(landing.distance * 10) / 10,
          result: gbResult.result, primaryPos: gbResult.fielderPos,
          retrieverPos: gbResult.retrieverPos,
          retrieverDist: Math.round(gbResult.retrieverDist * 10) / 10,
        });
        continue;
      }

      // フライ/ライナー: 複数収束モデル
      const flyResult = resolveFlyMultiConvergeDeterministic(fieldingResult, landing, batter, { direction: dir });
      results.push({
        direction: dir, exitVelocity: ev, launchAngle: la, ballType,
        distance: Math.round(landing.distance * 10) / 10,
        result: flyResult.result, primaryPos: flyResult.fielderPos,
        retrieverPos: flyResult.retrieverPos,
        retrieverDist: Math.round(flyResult.retrieverDist * 10) / 10,
      });
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

// 2b. ゴロのinterceptType分布（診断用）
{
  const gbResults = results.filter(r => r.ballType === "ground_ball");
  const gbTotal = gbResults.length;
  // 全ゴロケースで各野手のinterceptTypeを集計
  const itCounts: Record<string, number> = {};
  const itByPos: Record<string, Record<string, number>> = {};
  // 再計算: 各ゴロの評価結果を再生成
  let phase1Outs = 0, phase1IFH = 0, phase2Outs = 0, phase2IFH = 0, phase3Hits = 0;
  for (const dir of DIRECTIONS) {
    for (const ev of EXIT_VELOCITIES) {
      for (const la of LAUNCH_ANGLES) {
        const ballType = classifyBattedBallType(la, ev);
        if (ballType !== "ground_ball") continue;
        const landing = calcBallLanding(dir, la, ev);
        const fr = evaluateFielders(landing, ballType, fielderMap, runners, 0);
        for (const d of fr.values()) {
          const it = d.interceptType ?? "none";
          itCounts[it] = (itCounts[it] ?? 0) + 1;
          const posKey = POS_NAMES[d.position];
          if (!itByPos[posKey]) itByPos[posKey] = {};
          itByPos[posKey][it] = (itByPos[posKey][it] ?? 0) + 1;
        }
        // Phase分類
        const pathInt = Array.from(fr.values())
          .filter(d => d.interceptType === "path_intercept")
          .sort((a, b) => (a.projectionDistance ?? 0) - (b.projectionDistance ?? 0));
        let handled = false;
        for (const f of pathInt) {
          if (f.timeToReach <= f.ballArrivalTime) {
            const dt = estimateDefenseTime(f);
            const rSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
            const r1b = 0.5 + BASE_LENGTH / rSpeed;
            if (r1b < dt) { phase1IFH++; } else { phase1Outs++; }
            handled = true; break;
          }
        }
        if (!handled) {
          let chaser: FielderDecision | null = null;
          let minD = Infinity;
          for (const d of fr.values()) {
            if (d.interceptType !== "chase_to_stop" || !d.canReach) continue;
            if (d.position > 6 || d.position === 1) continue;
            const dist = d.distanceAtLanding ?? d.distanceToBall;
            if (dist < minD) { minD = dist; chaser = d; }
          }
          if (chaser) {
            const dt = estimateDefenseTime(chaser, "chase_to_stop");
            const rSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
            const r1b = 0.5 + BASE_LENGTH / rSpeed;
            if (r1b < dt) { phase2IFH++; } else { phase2Outs++; }
            handled = true;
          }
        }
        if (!handled) phase3Hits++;
      }
    }
  }
  console.log(`\n📊 ゴロ interceptType 診断 (${gbTotal}件):`);
  console.log(`  Phase1(path_intercept): OUT=${phase1Outs}, IFH=${phase1IFH}`);
  console.log(`  Phase2(chase_to_stop):  OUT=${phase2Outs}, IFH=${phase2IFH}`);
  console.log(`  Phase3(外野抜け):       HIT=${phase3Hits}`);
  console.log(`  interceptType分布(全野手×全ゴロ):`);
  for (const [it, c] of Object.entries(itCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${it}: ${c}`);
  }
  console.log(`  ポジション別:`);
  for (const pos of ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]) {
    const d = itByPos[pos] ?? {};
    const parts = Object.entries(d).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}=${c}`);
    console.log(`    ${pos}: ${parts.join(", ")}`);
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
