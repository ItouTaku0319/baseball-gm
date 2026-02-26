import { describe, it, expect, beforeAll } from "vitest";
import { calcBallLanding, evaluateFielders, DEFAULT_FIELDER_POSITIONS } from "../fielding-ai";
import { classifyBattedBallType, estimateDistance, getFenceDistance } from "../simulation";
import { TRAJECTORY_CARRY_FACTORS, GRAVITY, BAT_HEIGHT, FENCE_HEIGHT } from "../physics-constants";
import type { Player } from "../../models/player";
import type { BallLanding, FielderDecision } from "../fielding-ai";

const DIRECTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const EXIT_VELOCITIES = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const LAUNCH_ANGLES = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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

interface Row {
  dir: number; ev: number; la: number;
  ballType: string; dist: number;
  result: string; retrieverPos: number;
  issues: string[];
}

let allRows: Row[] = [];

beforeAll(() => {
  allRows = [];
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

        if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la, 2)) {
          result = "homerun";
        } else if (ballType === "popup") {
          result = "popupOut";
        } else if (ballType === "ground_ball") {
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
              const throwDist = f.targetPos ? Math.sqrt((f.targetPos.x - 19.4) ** 2 + (f.targetPos.y - 19.4) ** 2) : 20;
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
              const throwDist = chaseF.targetPos ? Math.sqrt((chaseF.targetPos.x - 19.4) ** 2 + (chaseF.targetPos.y - 19.4) ** 2) : 20;
              const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
              result = runnerTo1B < defenseTime ? "infieldHit" : "out";
              retrieverPos = chaseF.position;
            } else {
              result = "single";
              const ret = selectRetriever(fieldingResult, landing);
              if (ret) { retrieverPos = ret.position; }
            }
          }
        } else if (best.canReach) {
          result = "out";
        } else {
          const retriever = selectRetriever(fieldingResult, landing) ?? best;
          retrieverPos = retriever.position;
          if (landing.distance > 100) result = "triple";
          else if (landing.distance > 80) result = "double";
          else result = "single";
        }

        const issues: string[] = [];
        const isHit = !["out", "popupOut"].includes(result);
        if (isHit && landing.distance > 50 && (retrieverPos === 1 || retrieverPos === 2)) issues.push("遠距離P/C回収");
        if (isHit && ballType === "ground_ball" && landing.distance < 25 && retrieverPos >= 7) issues.push("浅ゴロOF回収");
        if (isHit && landing.distance > 60 && retrieverPos >= 3 && retrieverPos <= 6) issues.push("深打球IF回収");

        allRows.push({
          dir, ev, la, ballType, dist: Math.round(landing.distance * 10) / 10,
          result, retrieverPos, issues,
        });
      }
    }
  }
});

describe("守備グリッドテスト", () => {
  it("0-15m フライ/ライナーのアウト率 >= 80%", () => {
    const subset = allRows.filter(r =>
      (r.ballType === "fly_ball" || r.ballType === "line_drive") && r.dist >= 0 && r.dist < 15
    );
    if (subset.length === 0) return;
    const outs = subset.filter(r => r.result === "out" || r.result === "popupOut").length;
    const rate = outs / subset.length;
    expect(rate).toBeGreaterThanOrEqual(0.80);
  });

  it("15-30m フライ/ライナーのアウト率 >= 30%", () => {
    const subset = allRows.filter(r =>
      (r.ballType === "fly_ball" || r.ballType === "line_drive") && r.dist >= 15 && r.dist < 30
    );
    if (subset.length === 0) return;
    const outs = subset.filter(r => r.result === "out" || r.result === "popupOut").length;
    const rate = outs / subset.length;
    expect(rate).toBeGreaterThanOrEqual(0.30);
  });

  it("エラーパターン（遠距離P/C回収）= 0件", () => {
    const errors = allRows.filter(r => r.issues.includes("遠距離P/C回収"));
    expect(errors.length).toBe(0);
  });

  it("エラーパターン（浅ゴロOF回収）= 0件", () => {
    const errors = allRows.filter(r => r.issues.includes("浅ゴロOF回収"));
    expect(errors.length).toBe(0);
  });

  it("エラーパターン（深打球IF回収）= 0件", () => {
    const errors = allRows.filter(r => r.issues.includes("深打球IF回収"));
    expect(errors.length).toBe(0);
  });

  it("ゴロの方向別アウト率 >= 50%", () => {
    const directions = [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90];
    for (const dir of directions) {
      const subset = allRows.filter(r => r.dir === dir && r.ballType === "ground_ball");
      if (subset.length === 0) continue;
      const outs = subset.filter(r => r.result === "out").length;
      const rate = outs / subset.length;
      expect(rate).toBeGreaterThanOrEqual(0.50);
    }
  });
});
