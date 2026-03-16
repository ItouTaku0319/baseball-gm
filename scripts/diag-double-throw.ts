/**
 * 診断: ゴロで送球が2回出るか全フレーム確認
 */
import { resolvePlayWithAgents } from "../src/engine/fielding-agent";
import { calcBallLanding } from "../src/engine/fielding-ai";
import { classifyBattedBallType } from "../src/engine/simulation";
import type { Player, Position } from "../src/models/player";
import type { FielderPosition } from "../src/engine/fielding-agent-types";

const POSITION_MAP: Record<FielderPosition, Position> = {
  1:"P",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF"
};
function createPlayer(pos: FielderPosition, fielding = 50): Player {
  const position = POSITION_MAP[pos];
  return {
    id: `g-${position}`, name: `${position}`, age: 25, position,
    isPitcher: pos === 1, throwHand: "R", batSide: "R",
    batting: { contact:50, power:50, trajectory:2, speed:50, arm:50, fielding, catching: fielding, eye:50 },
    pitching: pos === 1 ? { velocity:145, control:50, pitches:[{type:"slider",level:4}], stamina:50, mentalToughness:50, arm:50, fielding, catching: fielding } : null,
    potential: { overall:"C" }, salary:500, contractYears:1, careerBattingStats:{}, careerPitchingStats:{}
  } as Player;
}

const posNames: Record<number, string> = {1:'P',2:'C',3:'1B',4:'2B',5:'3B',6:'SS',7:'LF',8:'CF',9:'RF'};

// ランナーなし普通ゴロ
const scenarios = [
  { label: "普通ゴロ(SS)", ev: 130, la: -10, dir: 30, runners: "none" as const },
  { label: "普通ゴロ(3B)", ev: 130, la: -10, dir: 15, runners: "none" as const },
  { label: "普通ゴロ(2B)", ev: 130, la: -10, dir: 60, runners: "none" as const },
  { label: "速いゴロ(SS)", ev: 150, la: -10, dir: 30, runners: "none" as const },
  { label: "遅いゴロ(P)", ev: 80, la: -15, dir: 0, runners: "none" as const },
  { label: "普通ゴロ(SS)+1塁", ev: 130, la: -10, dir: 30, runners: "first" as const },
];

for (const s of scenarios) {
  const fm = new Map<FielderPosition, Player>();
  for (const p of [1,2,3,4,5,6,7,8,9] as FielderPosition[]) fm.set(p, createPlayer(p));
  const batter = createPlayer(3);
  const runner = createPlayer(7);
  const runners = {
    first: s.runners === "first" ? runner : null,
    second: null,
    third: null,
  };

  const ballType = classifyBattedBallType(s.la, s.ev);
  const landing = calcBallLanding(s.dir, s.la, s.ev);
  const ball = { direction: s.dir, launchAngle: s.la, exitVelocity: s.ev, type: ballType };

  const result = resolvePlayWithAgents(ball, landing, fm, batter, runners, 0, {
    collectTimeline: true,
    perceptionNoise: 0,
    random: () => 0.5,
  });

  const tl = result.agentTimeline;
  if (!tl) continue;

  console.log(`\n=== ${s.label} → ${result.result} ===`);

  // 全フレームでthrowBall, SECURING, THROWING, HOLDINGを表示
  for (const frame of tl) {
    const throwers = frame.agents.filter(a =>
      a.state === "THROWING" || a.state === "SECURING" || a.state === "HOLDING"
    );
    const throwInfo = frame.throwBall
      ? `throw:base${frame.throwBall.targetBase} prog=${frame.throwBall.progress.toFixed(2)}`
      : "";
    const stateInfo = throwers.map(a => `${posNames[a.pos]}=${a.state}`).join(" ");

    if (throwInfo || throwers.some(a => a.state === "THROWING" || a.state === "SECURING")) {
      console.log(`  t=${frame.t.toFixed(2)}: ${stateInfo} ${throwInfo}`);
    }
  }
}
