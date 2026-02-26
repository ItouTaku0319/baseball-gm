// エラーパターン3件の詳細を確認するスクリプト
import { calcBallLanding, evaluateFielders } from "../src/engine/fielding-ai";
import { classifyBattedBallType, estimateDistance, getFenceDistance } from "../src/engine/simulation";
import { GRAVITY, BAT_HEIGHT, FENCE_HEIGHT, DRAG_FACTOR, FLIGHT_TIME_FACTOR } from "../src/engine/physics-constants";
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
const batter = createTestPlayer(3);

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

function getThrowDistToFirst(fielder: FielderDecision): number {
  if (fielder.targetPos) {
    return Math.sqrt((fielder.targetPos.x - 19.4) ** 2 + (fielder.targetPos.y - 19.4) ** 2);
  }
  return 20;
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

// Excel版と同じresolveHitAdvancement
function resolveHitAdvancement(
  dir: number, landing: BallLanding, retriever: FielderDecision
): string {
  const skill = retriever.skill;
  const distAtLanding = retriever.distanceAtLanding ?? retriever.distanceToBall;
  const fenceDist = getFenceDistance(dir);

  let bouncePenalty: number;
  let rollDistance: number;

  if (landing.isGroundBall) {
    bouncePenalty = 0.5 + 0.25;
    rollDistance = 3;
  } else {
    const depthFactor = clamp((landing.distance - 50) / 50, 0, 1);
    bouncePenalty = 0.3 + depthFactor * 0.5 + 0.2;
    rollDistance = clamp((landing.distance - 50) * 0.08, 0, 6);
    if (landing.distance >= fenceDist * 0.90) {
      bouncePenalty += 0.6 + 0.3;
      rollDistance = Math.min(rollDistance + 3, 10);
    }
  }

  const pickupTime = 0.3 + (1 - skill.catching / 100) * 0.4;
  const runSpeedFielder = retriever.speed ?? 6.5;
  const additionalRunTime = distAtLanding / runSpeedFielder;
  const totalFielderTime = landing.isGroundBall
    ? retriever.timeToReach + bouncePenalty + pickupTime
    : retriever.ballArrivalTime + additionalRunTime + bouncePenalty + pickupTime;

  const throwSpeed = 25 + (skill.arm / 100) * 15;
  const runnerSpeed = 6.5 + (50 / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;

  const angleRad = (dir - 45) * Math.PI / 180;
  const retrievalPos = {
    x: landing.position.x + rollDistance * Math.sin(angleRad),
    y: landing.position.y + rollDistance * Math.cos(angleRad),
  };

  const throwTo2B = Math.sqrt((retrievalPos.x - 0) ** 2 + (retrievalPos.y - 38.8) ** 2);
  const throwTo3B = Math.sqrt((retrievalPos.x - (-19.4)) ** 2 + (retrievalPos.y - 19.4) ** 2);

  const runnerTo2B = 0.3 + timePerBase * 2;
  const runnerTo3B = 0.3 + timePerBase * 3;
  const defenseTo2B = totalFielderTime + throwTo2B / throwSpeed;
  const defenseTo3B = totalFielderTime + throwTo3B / throwSpeed;

  let basesReached = 1;
  if (runnerTo2B < defenseTo2B - 0.3) basesReached = 2;
  if (basesReached >= 2 && runnerTo3B < defenseTo3B - 0.9) basesReached = 3;
  if (landing.isGroundBall) basesReached = Math.min(basesReached, 2);
  if (landing.distance < 25) basesReached = Math.min(basesReached, 1);

  if (basesReached >= 3) return "triple";
  if (basesReached >= 2) return "double";
  return "single";
}

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

// メイン: Excel版のロジックでエラーパターン検出
let errorCount = 0;
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

      let result = "";
      let retrieverPos = best.position;

      if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la)) {
        result = "homerun";
      } else if (ballType === "popup") {
        result = "popupOut";
      } else if (ballType === "ground_ball") {
        // ゴロ: analyze-gridと同じロジック
        const interceptors = Array.from(fieldingResult.values())
          .filter(d => d.interceptType === "path_intercept")
          .sort((a, b) => (a.projectionDistance ?? 0) - (b.projectionDistance ?? 0));
        let caught = false;
        for (const f of interceptors) {
          if (f.timeToReach <= f.ballArrivalTime) {
            const runnerSpeed = 6.5 + 50 / 100 * 2.5;
            const timePerBase = BASE_LENGTH / runnerSpeed;
            const runnerTo1B = 0.7 + timePerBase;
            const secureTime = 0.2 + (1 - 50 / 100) * 0.2;
            const transferTime = 0.45 + (1 - 50 / 100) * 0.25;
            const throwSpeed = 25 + (50 / 100) * 15;
            const fieldTime = Math.max(f.timeToReach, f.ballArrivalTime);
            const throwDist = getThrowDistToFirst(f);
            const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
            result = runnerTo1B < defenseTime ? "infieldHit" : "out";
            retrieverPos = f.position;
            caught = true;
            break;
          }
        }
        if (!caught) {
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
            const throwDist = getThrowDistToFirst(chaseF);
            const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
            result = runnerTo1B < defenseTime ? "infieldHit" : "out";
            retrieverPos = chaseF.position;
          } else {
            result = "single";
            const ret = selectRetriever(fieldingResult, landing);
            if (ret) retrieverPos = ret.position;
          }
        }
      } else if (best.canReach) {
        result = "out";
      } else {
        // Excel版: resolveHitAdvancementで長打判定
        const retriever = selectRetriever(fieldingResult, landing) ?? best;
        retrieverPos = retriever.position;
        result = resolveHitAdvancement(dir, landing, retriever);
      }

      const isHit = !["out", "popupOut"].includes(result);
      const issues: string[] = [];
      if (isHit && landing.distance > 50 && (retrieverPos === 1 || retrieverPos === 2)) issues.push("遠距離P/C回収");
      if (isHit && ballType === "ground_ball" && landing.distance < 25 && retrieverPos >= 7) issues.push("浅ゴロOF回収");
      if (isHit && landing.distance > 60 && retrieverPos >= 3 && retrieverPos <= 6) issues.push("深打球IF回収");

      if (issues.length > 0) {
        errorCount++;
        // 詳細情報を表示
        const retriever = selectRetriever(fieldingResult, landing);
        console.log(`ERROR #${errorCount}: dir=${dir}° ev=${ev}km/h la=${la}°`);
        console.log(`  type=${ballType} dist=${Math.round(landing.distance * 10) / 10}m landing=(${Math.round(landing.position.x * 10) / 10}, ${Math.round(landing.position.y * 10) / 10})`);
        console.log(`  result=${result} primary=${POS_NAMES[best.position]}(reach=${best.canReach}) retriever=${POS_NAMES[retrieverPos]}`);
        console.log(`  issues: ${issues.join(", ")}`);
        // 各野手の状態
        for (const [pos, d] of fieldingResult) {
          if (pos <= 6 || d.canReach) {
            console.log(`    ${POS_NAMES[pos]}: dist=${Math.round(d.distanceToBall * 10) / 10}m reach=${d.canReach} type=${d.interceptType} distAtLand=${Math.round((d.distanceAtLanding ?? 0) * 10) / 10}m`);
          }
        }
        console.log();
      }
    }
  }
}
console.log(`\nエラー合計: ${errorCount}件`);
