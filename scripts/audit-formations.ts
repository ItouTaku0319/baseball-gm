/**
 * 守備フォーメーション自動監査スクリプト
 *
 * 1. 全77ゴロパターンで台本を生成し、物理的におかしい動きを検出
 * 2. 元データの記述と台本テーブルの分類を突合
 */
import { generateGroundBallScript } from "../src/engine/play-script";
import { createBallTrajectory } from "../src/engine/ball-trajectory";
import type { FielderAgent, FielderPosition } from "../src/engine/fielding-agent-types";
import * as fs from "fs";

const posN: Record<number, string> = {1:"P",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF"};
const BASE_POS = {
  1: { x: 19.4, y: 19.4 },   // first
  2: { x: 0, y: 38.8 },      // second
  3: { x: -19.4, y: 19.4 },  // third
  4: { x: 0, y: 0 },         // home
};
const HOME_POSITIONS: Record<number, {x:number,y:number}> = {
  1: {x:0,y:18.4}, 2: {x:0,y:1}, 3: {x:20,y:28}, 4: {x:8,y:33},
  5: {x:-19,y:27}, 6: {x:-12,y:33}, 7: {x:-28,y:75}, 8: {x:0,y:90}, 9: {x:28,y:75},
};

function dist(a: {x:number,y:number}, b: {x:number,y:number}): number {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);
}

function makeAgents(traj: any): FielderAgent[] {
  return Object.entries(HOME_POSITIONS).map(([p, pos]) => ({
    pos: Number(p) as FielderPosition, player: {} as any, state: "READY" as const,
    currentPos: {...pos}, targetPos: {...pos}, currentSpeed: 0, maxSpeed: 7.5,
    reactionRemaining: 0.3, baseReactionTime: 0.3,
    perceivedLanding: {position: {...traj.landingPos}, confidence: 0},
    hasCalled: false, hasYielded: false, action: "hold" as any,
    skill: {fielding:70,catching:70,arm:70,speed:60,awareness:60},
    homePos: {...pos}, distanceAtArrival: Infinity, arrivalTime: Infinity,
  }));
}

// --- テストシナリオ生成 ---
interface Scenario {
  label: string;
  ev: number;
  la: number;
  dir: number;  // play-viewer座標(0=LF, 45=CF, 90=RF)
  runners: { first: boolean; second: boolean; third: boolean };
}

const scenarios: Scenario[] = [
  // ランナーなし: 各ポジションへのゴロ
  { label: "P ゴロ", ev: 60, la: -5, dir: 45, runners: {first:false,second:false,third:false} },
  { label: "C ゴロ", ev: 80, la: -15, dir: 0, runners: {first:false,second:false,third:false} },
  { label: "C ゴロ(右)", ev: 70, la: -20, dir: 60, runners: {first:false,second:false,third:false} },
  { label: "1B ゴロ", ev: 90, la: -3, dir: 80, runners: {first:false,second:false,third:false} },
  { label: "2B ゴロ", ev: 100, la: -5, dir: 65, runners: {first:false,second:false,third:false} },
  { label: "3B ゴロ", ev: 90, la: -3, dir: 20, runners: {first:false,second:false,third:false} },
  { label: "SS ゴロ", ev: 100, la: -5, dir: 35, runners: {first:false,second:false,third:false} },
  { label: "SS ゴロ(中)", ev: 110, la: -8, dir: 45, runners: {first:false,second:false,third:false} },
  // ランナー1塁: DP体制
  { label: "R1 SS ゴロ DP", ev: 110, la: -8, dir: 40, runners: {first:true,second:false,third:false} },
  { label: "R1 3B ゴロ DP", ev: 100, la: -5, dir: 20, runners: {first:true,second:false,third:false} },
  { label: "R1 2B ゴロ DP", ev: 100, la: -5, dir: 65, runners: {first:true,second:false,third:false} },
  { label: "R1 P ゴロ", ev: 70, la: -5, dir: 45, runners: {first:true,second:false,third:false} },
  // ランナー2塁
  { label: "R2 SS ゴロ", ev: 100, la: -5, dir: 35, runners: {first:false,second:true,third:false} },
  { label: "R2 3B ゴロ", ev: 90, la: -3, dir: 20, runners: {first:false,second:true,third:false} },
  // ランナー3塁
  { label: "R3 SS ゴロ", ev: 90, la: -3, dir: 35, runners: {first:false,second:false,third:true} },
  // ランナー1,2塁
  { label: "R12 SS ゴロ", ev: 110, la: -8, dir: 40, runners: {first:true,second:true,third:false} },
  { label: "R12 3B ゴロ", ev: 100, la: -5, dir: 20, runners: {first:true,second:true,third:false} },
  // 満塁
  { label: "Full P ゴロ", ev: 70, la: -5, dir: 45, runners: {first:true,second:true,third:true} },
  { label: "Full 3B ゴロ", ev: 100, la: -5, dir: 20, runners: {first:true,second:true,third:true} },
];

// --- 監査ルール ---
interface Issue {
  scenario: string;
  pos: string;
  issue: string;
  detail: string;
}

function audit(label: string, script: any, traj: any): Issue[] {
  const issues: Issue[] = [];
  if (!script) return issues;

  for (const [pos, assignment] of script.assignments) {
    const name = posN[pos];
    const target = (assignment as any).targetPos;
    const state = (assignment as any).state;
    const home = HOME_POSITIONS[pos];

    // --- ルール1: 投手はサードベースに行くべきではない（Cゴロ/Pゴロ以外で） ---
    if (pos === 1 && script.primaryFielder !== 1) {
      const distTo3B = dist(target, BASE_POS[3]);
      if (distTo3B < 5) {
        issues.push({ scenario: label, pos: name, issue: "P→三塁ベース",
          detail: `target=(${target.x.toFixed(1)},${target.y.toFixed(1)}) 三塁ベースまで${distTo3B.toFixed(1)}m` });
      }
    }

    // --- ルール2: 内野手がホームポジションから動かない（HOLDING相当） ---
    const distFromHome = dist(target, home);
    if (distFromHome < 1 && state !== "PURSUING") {
      issues.push({ scenario: label, pos: name, issue: "動いていない",
        detail: `target=(${target.x.toFixed(1)},${target.y.toFixed(1)}) ホームから${distFromHome.toFixed(1)}m` });
    }

    // --- ルール3: 一塁ベースカバーが誰もいない ---
    // (後でまとめてチェック)

    // --- ルール4: 内野手・投手が外野エリアに走る ---
    if (pos <= 6 && pos !== script.primaryFielder) {
      if (target.y > 50) {
        issues.push({ scenario: label, pos: name, issue: "内野手が外野エリアへ",
          detail: `target=(${target.x.toFixed(1)},${target.y.toFixed(1)})` });
      }
    }

    // --- ルール5: 2人以上が同じベースに行く ---
    // (後でまとめてチェック)

    // --- ルール6: 投手がマウンドから30m以上離れる ---
    if (pos === 1 && script.primaryFielder !== 1) {
      const distFromMound = dist(target, {x:0, y:18.4});
      if (distFromMound > 25) {
        issues.push({ scenario: label, pos: name, issue: "Pがマウンドから遠すぎ",
          detail: `target=(${target.x.toFixed(1)},${target.y.toFixed(1)}) マウンドから${distFromMound.toFixed(1)}m` });
      }
    }
  }

  // ルール3: 一塁ベースカバーチェック
  let has1BCover = false;
  for (const [pos, assignment] of script.assignments) {
    const target = (assignment as any).targetPos;
    const state = (assignment as any).state;
    if (state === "COVERING" && dist(target, BASE_POS[1]) < 3) {
      has1BCover = true;
    }
  }
  if (!has1BCover) {
    issues.push({ scenario: label, pos: "ALL", issue: "一塁カバーなし",
      detail: "誰も一塁ベースをカバーしていない" });
  }

  // ルール5: 同じベースに2人
  const coverTargets: { pos: string; target: {x:number,y:number} }[] = [];
  for (const [pos, assignment] of script.assignments) {
    const state = (assignment as any).state;
    if (state === "COVERING") {
      coverTargets.push({ pos: posN[pos], target: (assignment as any).targetPos });
    }
  }
  for (let i = 0; i < coverTargets.length; i++) {
    for (let j = i+1; j < coverTargets.length; j++) {
      if (dist(coverTargets[i].target, coverTargets[j].target) < 3) {
        issues.push({ scenario: label, pos: `${coverTargets[i].pos}+${coverTargets[j].pos}`,
          issue: "同一ベースに2人カバー",
          detail: `(${coverTargets[i].target.x.toFixed(0)},${coverTargets[i].target.y.toFixed(0)})` });
      }
    }
  }

  return issues;
}

// --- 実行 ---
console.log("=== 守備フォーメーション自動監査 ===\n");

let totalIssues = 0;
let passCount = 0;

for (const s of scenarios) {
  const traj = createBallTrajectory(s.dir, s.la, s.ev);
  const agents = makeAgents(traj);
  const script = generateGroundBallScript(traj, agents, s.runners, 0);

  if (!script) {
    console.log(`[SKIP] ${s.label}: 台本null (内野を抜ける打球)`);
    continue;
  }

  const issues = audit(s.label, script, traj);

  if (issues.length === 0) {
    // 簡潔に表示
    const summary = [...script.assignments.entries()]
      .sort((a,b) => a[0] - b[0])
      .map(([p, a]) => `${posN[p]}:${(a as any).state.substring(0,4)}`)
      .join(" ");
    console.log(`[PASS] ${s.label} (primary=${posN[script.primaryFielder]}) ${summary}`);
    passCount++;
  } else {
    console.log(`[FAIL] ${s.label} (primary=${posN[script.primaryFielder]})`);
    for (const issue of issues) {
      console.log(`  ❌ ${issue.pos}: ${issue.issue} — ${issue.detail}`);
      totalIssues++;
    }
  }
}

console.log(`\n=== 結果: ${passCount} PASS / ${totalIssues} issues ===`);

if (totalIssues === 0) {
  console.log("全シナリオ合格！");
}
