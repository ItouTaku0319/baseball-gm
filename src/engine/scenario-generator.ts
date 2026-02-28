/**
 * シナリオ生成ユーティリティ
 *
 * 指定した打球パラメータ（初速・角度・方向）で守備AIを実行し、
 * AtBatLog形式の結果を返す。Fielding Labで使用。
 */
import type { Player, Position } from "../models/player";
import type { AtBatLog } from "../models/league";
import { calcBallLanding } from "./fielding-ai";
import { resolvePlayWithAgents } from "./fielding-agent";
import { classifyBattedBallType } from "./simulation";
import type { FielderPosition, AgentFieldingResult } from "./fielding-agent-types";

const POSITION_MAP: Record<FielderPosition, Position> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function createD50Player(pos: FielderPosition): Player {
  const position = POSITION_MAP[pos];
  const isPitcher = pos === 1;
  return {
    id: `d50-${position}`,
    name: `D50${position}`,
    age: 25,
    position,
    isPitcher,
    throwHand: "R",
    batSide: "R",
    batting: {
      contact: 50, power: 50, trajectory: 2, speed: 50,
      arm: 50, fielding: 50, catching: 50, eye: 50,
    },
    pitching: isPitcher
      ? {
          velocity: 145, control: 50,
          pitches: [{ type: "slider", level: 4 }],
          stamina: 50, mentalToughness: 50,
          arm: 50, fielding: 50, catching: 50,
        }
      : null,
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
  } as Player;
}

const fielderMap = new Map<FielderPosition, Player>();
for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
  fielderMap.set(pos, createD50Player(pos));
}
const d50Batter = createD50Player(3);
const emptyBases = { first: null, second: null, third: null };

export interface ScenarioParams {
  exitVelocity: number;    // 80-185 km/h
  launchAngle: number;     // -15 ~ 70°
  direction: number;       // 0-90° (0=レフト線, 45=センター, 90=ライト線)
  deterministic?: boolean; // true=ノイズ無し決定的実行 (デフォルトtrue)
}

export function generateScenarioLog(params: ScenarioParams): AtBatLog {
  const { exitVelocity, launchAngle, direction, deterministic = true } = params;

  const ballType = classifyBattedBallType(launchAngle, exitVelocity);
  const landing = calcBallLanding(direction, launchAngle, exitVelocity);

  const ball = { direction, launchAngle, exitVelocity, type: ballType };

  const agentResult: AgentFieldingResult = resolvePlayWithAgents(
    ball, landing, fielderMap, d50Batter, emptyBases, 0,
    {
      collectTimeline: true,
      perceptionNoise: deterministic ? 0 : 1.0,
      ...(deterministic ? { random: () => 0.5 } : {}),
    },
  );

  return {
    inning: 1,
    halfInning: "top",
    batterId: d50Batter.id,
    pitcherId: "d50-P",
    result: agentResult.result,
    battedBallType: ballType,
    direction,
    launchAngle,
    exitVelocity,
    fielderPosition: agentResult.fielderPos,
    estimatedDistance: Math.round(landing.distance * 10) / 10,
    basesBeforePlay: [false, false, false],
    outsBeforePlay: 0,
    fieldingTrace: agentResult.trace,
    agentTimeline: agentResult.agentTimeline,
    throwPlays: agentResult.throwPlays,
  };
}
