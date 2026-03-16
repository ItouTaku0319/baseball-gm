import { resolvePlayWithAgents } from "../src/engine/fielding-agent";
import { calcBallLanding } from "../src/engine/fielding-ai";
import { classifyBattedBallType } from "../src/engine/simulation";
import type { Player, Position } from "../src/models/player";
import type { FielderPosition } from "../src/engine/fielding-agent-types";

const POSITION_MAP: Record<FielderPosition, Position> = {
  1:"P",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF"
};
function createD50(pos: FielderPosition): Player {
  const position = POSITION_MAP[pos];
  return {
    id: `g-${position}`, name: `G50${position}`, age: 25, position,
    isPitcher: pos === 1, throwHand: "R", batSide: "R",
    batting: { contact:50, power:50, trajectory:2, speed:50, arm:50, fielding:50, catching:50, eye:50 },
    pitching: pos === 1 ? { velocity:145, control:50, pitches:[{type:"slider",level:4}], stamina:50, mentalToughness:50, arm:50, fielding:50, catching:50 } : null,
    potential: { overall:"C" }, salary:500, contractYears:1, careerBattingStats:{}, careerPitchingStats:{}
  } as Player;
}

const fm = new Map<FielderPosition, Player>();
for (const p of [1,2,3,4,5,6,7,8,9] as FielderPosition[]) fm.set(p, createD50(p));
const batter = createD50(3);
const noRunners = { first: null, second: null, third: null };

const dir=10, la=30, ev=150;
const ballType = classifyBattedBallType(la, ev);
const landing = calcBallLanding(dir, la, ev);
const ball = { direction: dir, launchAngle: la, exitVelocity: ev, type: ballType };

console.log("Ball type:", ballType, "Landing dist:", landing.distance.toFixed(1), "m");

const result = resolvePlayWithAgents(ball, landing, fm, batter, noRunners, 0, {
  collectTimeline: true,
  perceptionNoise: 0,
  random: () => 0.5,
  debugThrow: true,
});

console.log("Result:", result.result, "FielderPos:", result.fielderPos);
console.log("ThrowPlays:", JSON.stringify(result.throwPlays));

const tl = result.agentTimeline;
if (tl) {
  const posNames: Record<number, string> = {1:'P',2:'C',3:'1B',4:'2B',5:'3B',6:'SS',7:'LF',8:'CF',9:'RF'};

  let catchFrame: number | null = null;
  let throwFrame: number | null = null;
  let firstRunnerFrame: number | null = null;

  for (const frame of tl) {
    if (!catchFrame && frame.agents.some(a => a.state === "FIELDING" || a.state === "SECURING")) {
      catchFrame = frame.t;
    }
    if (!throwFrame && frame.agents.some(a => a.state === "THROWING")) {
      throwFrame = frame.t;
    }
    if (!firstRunnerFrame && frame.runners && frame.runners.length > 0) {
      firstRunnerFrame = frame.t;
    }
  }

  console.log(`\n=== キーモーメント ===`);
  console.log(`  捕球: t=${catchFrame?.toFixed(2)}s`);
  console.log(`  送球: t=${throwFrame?.toFixed(2)}s`);
  console.log(`  ランナー出現: t=${firstRunnerFrame?.toFixed(2)}s`);
  console.log(`  タイムライン終了: t=${tl[tl.length-1].t.toFixed(2)}s (${tl.length}フレーム)`);
  if (catchFrame && throwFrame) {
    console.log(`  捕球→送球: ${(throwFrame - catchFrame).toFixed(2)}s`);
  }

  // 全野手の動き（フォーメーション確認用）
  console.log(`\n=== 全野手フォーメーション ===`);
  for (const frame of tl) {
    if (frame.t % 0.5 < 0.06 || frame.t === tl[tl.length - 1].t) {
      console.log(`--- t=${frame.t.toFixed(2)} ---`);
      for (const a of frame.agents) {
        const tgt = a.targetX != null ? `tgt=(${a.targetX.toFixed(1)},${a.targetY!.toFixed(1)})` : '';
        console.log(`  ${posNames[a.pos].padEnd(3)} ${a.state.padEnd(12)} pos=(${a.x.toFixed(1)},${a.y.toFixed(1)}) ${tgt}`);
      }
    }
  }

  // Ball holder tracking
  console.log(`\n=== ボール保持者の動き ===`);
  for (const frame of tl) {
    for (const a of frame.agents) {
      if (a.state === "SECURING" || a.state === "THROWING" || a.state === "HOLDING") {
        console.log(`  t=${frame.t.toFixed(2)}: ${posNames[a.pos]} state=${a.state.padEnd(12)} pos=(${a.x.toFixed(1)},${a.y.toFixed(1)})`);
        break;
      }
    }
  }

  // Runner tracking
  console.log(`\n=== ランナー ===`);
  for (const frame of tl) {
    if (frame.runners && frame.runners.length > 0) {
      for (const r of frame.runners) {
        if (frame.t % 0.5 < 0.06 || r.state === "SAFE" || r.state === "OUT") {
          console.log(`  t=${frame.t.toFixed(2)}: base${r.fromBase}->${r.targetBase} state=${r.state} pos=(${(r.x??0).toFixed(1)},${(r.y??0).toFixed(1)})`);
        }
      }
    }
  }
}
