#!/usr/bin/env tsx
// 投手・打者能力の影響度を検証

import { resolvePlateAppearance, type PAContext, type RunnerState } from "../src/engine/v2/outcome-resolver";
import type { Player, PitchRepertoire } from "../src/models/player";

const NUM_PA = 30000;

function makeBatter(label: string, c: number, p: number, e: number, s: number): { label: string; player: Player } {
  return {
    label,
    player: {
      id: "b", name: label, age: 27, position: "CF",
      isPitcher: false, throwHand: "R", batSide: "R",
      batting: { contact: c, power: p, trajectory: 2, speed: s, arm: 50, fielding: 50, catching: 50, eye: e },
      pitching: null, potential: { overall: "C" },
      salary: 5000, contractYears: 2, careerBattingStats: {}, careerPitchingStats: {},
    } as Player,
  };
}

function makePitcher(
  label: string, vel: number, ctrl: number,
  pitches: PitchRepertoire[], stam: number, mental: number,
): { label: string; player: Player } {
  return {
    label,
    player: {
      id: "p", name: label, age: 27, position: "P",
      isPitcher: true, throwHand: "R", batSide: "R",
      batting: { contact: 30, power: 20, trajectory: 1, speed: 30, arm: 50, fielding: 40, catching: 30, eye: 25 },
      pitching: { velocity: vel, control: ctrl, pitches, stamina: stam, mentalToughness: mental, arm: 60, fielding: 40, catching: 30 },
      potential: { overall: "C" },
      salary: 5000, contractYears: 2, careerBattingStats: {}, careerPitchingStats: {},
    } as Player,
  };
}

interface SimResult {
  pa: number; ab: number; hits: number; hr: number; k: number; bb: number; hbp: number;
  singles: number; doubles: number; triples: number; sf: number;
  gb: number; fb: number; ld: number; pu: number;
  dp: number; errors: number;
}

function simulate(batter: Player, pitcher: Player, numPA: number): SimResult {
  const r: SimResult = { pa: 0, ab: 0, hits: 0, hr: 0, k: 0, bb: 0, hbp: 0,
    singles: 0, doubles: 0, triples: 0, sf: 0, gb: 0, fb: 0, ld: 0, pu: 0, dp: 0, errors: 0 };
  const runners: RunnerState = { first: false, second: false, third: false };

  for (let i = 0; i < numPA; i++) {
    const outcome = resolvePlateAppearance({ batter, pitcher, runners, outs: 1, teamFielding: 50 });
    r.pa++;
    const res = outcome.result;
    if (res !== "walk" && res !== "hit_by_pitch" && res !== "sac_fly") r.ab++;
    if (["single", "double", "triple", "homerun", "infield_hit"].includes(res)) r.hits++;
    if (res === "single" || res === "infield_hit") r.singles++;
    if (res === "double") r.doubles++;
    if (res === "triple") r.triples++;
    if (res === "homerun") r.hr++;
    if (res === "strikeout") r.k++;
    if (res === "walk") r.bb++;
    if (res === "hit_by_pitch") r.hbp++;
    if (res === "sac_fly") r.sf++;
    if (res === "double_play") r.dp++;
    if (res === "error") r.errors++;
    if (outcome.battedBallType === "ground_ball") r.gb++;
    if (outcome.battedBallType === "fly_ball") r.fb++;
    if (outcome.battedBallType === "line_drive") r.ld++;
    if (outcome.battedBallType === "popup") r.pu++;
  }
  return r;
}

function fmt3(n: number) { return n.toFixed(3); }
function fmt2(n: number) { return n.toFixed(2); }
function fmt1(n: number) { return n.toFixed(1); }
function pct1(n: number) { return `${(n * 100).toFixed(1)}%`; }
function padR(s: string, n: number) { return s.padEnd(n); }
function padL(s: string, n: number) { return s.padStart(n); }

function calcPitcherStats(r: SimResult) {
  const totalOuts = r.ab - r.hits + r.sf + r.dp;
  const ip = totalOuts / 3;
  const avg = r.ab > 0 ? r.hits / r.ab : 0;
  const obp = r.pa > 0 ? (r.hits + r.bb + r.hbp) / r.pa : 0;
  const slg = r.ab > 0 ? (r.singles + r.doubles * 2 + r.triples * 3 + r.hr * 4) / r.ab : 0;
  const kPct = r.pa > 0 ? r.k / r.pa : 0;
  const bbPct = r.pa > 0 ? r.bb / r.pa : 0;
  const k9 = ip > 0 ? r.k / ip * 9 : 0;
  const bb9 = ip > 0 ? r.bb / ip * 9 : 0;
  const h9 = ip > 0 ? r.hits / ip * 9 : 0;
  const hr9 = ip > 0 ? r.hr / ip * 9 : 0;
  const whip = ip > 0 ? (r.hits + r.bb) / ip : 0;
  const babipDen = r.ab - r.k - r.hr + r.sf;
  const babip = babipDen > 0 ? (r.hits - r.hr) / babipDen : 0;
  const totalBip = r.gb + r.fb + r.ld + r.pu;
  const gbRate = totalBip > 0 ? r.gb / totalBip : 0;
  const ldRate = totalBip > 0 ? r.ld / totalBip : 0;
  const fbRate = totalBip > 0 ? r.fb / totalBip : 0;
  const hrFb = r.fb > 0 ? r.hr / r.fb : 0;
  const fip = ip > 0 ? (13 * r.hr + 3 * (r.bb + r.hbp) - 2 * r.k) / ip + 3.20 : 0;
  const kbb = r.bb > 0 ? r.k / r.bb : 0;
  // 簡易ERA推定
  const era = ip > 0 ? ((r.hits - r.hr) * 0.50 + r.hr * 1.40 + (r.bb + r.hbp) * 0.33) / ip * 9 : 0;

  return { ip, avg, obp, slg, kPct, bbPct, k9, bb9, h9, hr9, whip, babip,
    gbRate, ldRate, fbRate, hrFb, fip, kbb, era };
}

function calcBatterStats(r: SimResult) {
  const avg = r.ab > 0 ? r.hits / r.ab : 0;
  const obp = r.pa > 0 ? (r.hits + r.bb + r.hbp) / r.pa : 0;
  const slg = r.ab > 0 ? (r.singles + r.doubles * 2 + r.triples * 3 + r.hr * 4) / r.ab : 0;
  const ops = obp + slg;
  const iso = slg - avg;
  const kPct = r.pa > 0 ? r.k / r.pa : 0;
  const bbPct = r.pa > 0 ? r.bb / r.pa : 0;
  const hrPct = r.pa > 0 ? r.hr / r.pa : 0;
  const bbk = r.k > 0 ? r.bb / r.k : 0;
  const babipDen = r.ab - r.k - r.hr + r.sf;
  const babip = babipDen > 0 ? (r.hits - r.hr) / babipDen : 0;

  // wOBA (MLB 2023 weights)
  const woba = r.pa > 0
    ? (0.69 * r.bb + 0.72 * r.hbp + 0.87 * r.singles + 1.27 * r.doubles + 1.62 * r.triples + 2.10 * r.hr) / r.pa
    : 0;

  // 143試合換算 (PA≈550)
  const scale = 550 / r.pa;
  const abSeason = Math.round(r.ab * scale);

  return { avg, obp, slg, ops, iso, kPct, bbPct, hrPct, bbk, babip, woba,
    hitsSeason: Math.round(r.hits * scale),
    hrSeason: Math.round(r.hr * scale),
    doublesSeason: Math.round(r.doubles * scale),
    triplesSeason: Math.round(r.triples * scale),
    kSeason: Math.round(r.k * scale),
    bbSeason: Math.round(r.bb * scale),
    abSeason,
  };
}

// ============================================================
// 投手定義
// ============================================================
const pitchers = [
  makePitcher("エース",       155, 80, [{ type: "slider", level: 6 }, { type: "fork", level: 6 }, { type: "curve", level: 4 }], 80, 80),
  makePitcher("先発2番手",     150, 70, [{ type: "slider", level: 5 }, { type: "fork", level: 4 }, { type: "changeup", level: 4 }], 70, 60),
  makePitcher("平均的先発",     147, 55, [{ type: "slider", level: 5 }, { type: "curve", level: 4 }], 65, 55),
  makePitcher("先発5番手",     142, 45, [{ type: "slider", level: 3 }, { type: "curve", level: 3 }], 55, 45),
  makePitcher("炎上投手",      135, 30, [{ type: "curve", level: 2 }], 40, 30),
  makePitcher("ゴロ投手",      148, 60, [{ type: "sinker", level: 6 }, { type: "shoot", level: 5 }, { type: "slider", level: 4 }], 65, 55),
  makePitcher("奪三振投手",    158, 70, [{ type: "fork", level: 7 }, { type: "slider", level: 6 }], 55, 65),
  makePitcher("守護神",       155, 75, [{ type: "fork", level: 6 }, { type: "slider", level: 5 }], 35, 85),
];

const avgBatter = makeBatter("平均", 60, 55, 55, 55).player;

console.log(`⚾ 投手タイプ別成績 (各${NUM_PA}打席, vs 平均的打者[ミ60 パ55 眼55 走55])`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");

for (const { label, player: pitcher } of pitchers) {
  const p = pitcher.pitching!;
  const r = simulate(avgBatter, pitcher, NUM_PA);
  const s = calcPitcherStats(r);

  const pitchDesc = p.pitches.map(pp => {
    const names: Record<string, string> = {
      slider: "スラ", fork: "フォーク", curve: "カーブ", changeup: "チェンジ",
      sinker: "シンカー", shoot: "シュート", cutter: "カット", splitter: "スプリット",
    };
    return `${names[pp.type] ?? pp.type}${pp.level}`;
  }).join(" ");

  console.log(`  ■ ${padR(label, 10)} 球速${p.velocity}km/h  制球${p.control}  [${pitchDesc}]`);
  console.log(`    ┌─ 被打率  ${padL(fmt3(s.avg), 5)}    被出塁率  ${padL(fmt3(s.obp), 5)}    被長打率  ${padL(fmt3(s.slg), 5)}    BABIP  ${padL(fmt3(s.babip), 5)}`);
  console.log(`    ├─ K/9    ${padL(fmt2(s.k9), 5)}    BB/9     ${padL(fmt2(s.bb9), 5)}    H/9      ${padL(fmt2(s.h9), 5)}    HR/9   ${padL(fmt2(s.hr9), 5)}`);
  console.log(`    ├─ K%    ${padL(pct1(s.kPct), 6)}    BB%     ${padL(pct1(s.bbPct), 6)}    K/BB    ${padL(fmt2(s.kbb), 5)}    WHIP   ${padL(fmt2(s.whip), 5)}`);
  console.log(`    ├─ GB%   ${padL(pct1(s.gbRate), 6)}    FB%     ${padL(pct1(s.fbRate), 6)}    LD%     ${padL(pct1(s.ldRate), 6)}    HR/FB  ${padL(pct1(s.hrFb), 6)}`);
  console.log(`    └─ ERA推定 ${padL(fmt2(s.era), 5)}    FIP      ${padL(fmt2(s.fip), 5)}`);
  console.log("");
}

console.log("  📊 NPB参考値");
console.log("    エース級:    ERA 2.00-2.50  K/9 8-10   WHIP 0.90-1.05  被打率 .200-.220  FIP 2.50-3.00");
console.log("    平均先発:    ERA 3.50       K/9 7.0    WHIP 1.20       被打率 .250-.265  FIP 3.50");
console.log("    5番手級:     ERA 4.50-5.00  K/9 5-6    WHIP 1.40-1.50  被打率 .270-.285  FIP 4.00-4.50");
console.log("    守護神:      ERA 1.50-2.50  K/9 10-12  WHIP 0.80-1.00  セーブ35+");
console.log("");

// ============================================================
// 打者比較
// ============================================================
const avgPitcher = pitchers[2].player;

const batters = [
  makeBatter("首位打者候補", 90, 60, 75, 65),
  makeBatter("本塁打王候補", 55, 95, 50, 45),
  makeBatter("リードオフ",   75, 40, 80, 85),
  makeBatter("クリーンアップ", 70, 85, 60, 50),
  makeBatter("平均的選手",   60, 55, 55, 55),
  makeBatter("守備職人",    45, 30, 40, 50),
  makeBatter("投手(打席)",   25, 15, 20, 30),
];

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`⚾ 打者タイプ別成績 (各${NUM_PA}打席, vs 平均的先発[球速147 制球55 スラ5/カーブ4])`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");

for (const { label, player: batter } of batters) {
  const b = batter.batting;
  const r = simulate(batter, avgPitcher, NUM_PA);
  const s = calcBatterStats(r);

  const sbEstimate = b.speed >= 70 ? Math.round((b.speed - 50) * 0.6) : Math.round(Math.max(0, b.speed - 30) * 0.2);

  console.log(`  ■ ${padR(label, 12)} ミート${padL(String(b.contact), 2)}  パワー${padL(String(b.power), 2)}  選球眼${padL(String(b.eye), 2)}  走力${padL(String(b.speed), 2)}`);
  console.log(`    ┌─ 打率   ${padL(fmt3(s.avg), 5)}    出塁率   ${padL(fmt3(s.obp), 5)}    長打率   ${padL(fmt3(s.slg), 5)}    OPS    ${padL(fmt3(s.ops), 5)}`);
  console.log(`    ├─ ISO    ${padL(fmt3(s.iso), 5)}    wOBA     ${padL(fmt3(s.woba), 5)}    BABIP    ${padL(fmt3(s.babip), 5)}`);
  console.log(`    ├─ K%    ${padL(pct1(s.kPct), 6)}    BB%     ${padL(pct1(s.bbPct), 6)}    BB/K    ${padL(fmt2(s.bbk), 5)}    HR%    ${padL(pct1(s.hrPct), 6)}`);
  console.log(`    └─ 143試合: ${s.hitsSeason}安打 ${s.doublesSeason}二塁打 ${s.triplesSeason}三塁打 ${s.hrSeason}本塁打 ${s.kSeason}三振 ${s.bbSeason}四球${sbEstimate > 0 ? ` ${sbEstimate}盗塁` : ""}`);
  console.log("");
}

console.log("  📊 NPB参考値");
console.log("    首位打者級:    AVG .330+  OPS .900+  wOBA .380+  150安打+ BB/K 0.80+");
console.log("    本塁打王級:    HR 35-45   ISO .250+  OPS .900+  wOBA .380+");
console.log("    リードオフ:    AVG .280+  OBP .370+  BB/K 0.60+ 30盗塁+ 安打150+");
console.log("    平均レギュラー: AVG .260   OPS .730   wOBA .320  HR 15  130安打");
console.log("    投手(打席):    AVG .120-.170  K% 35%+  OPS .350-.450");
console.log("");

// ============================================================
// 能力値→成績の対応表
// ============================================================
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚾ 能力値 → 成績への影響まとめ");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log("  【投手能力】");
console.log("  能力値            主な影響                     高い→           低い→");
console.log("  ──────────────────────────────────────────────────────────────────────────");
console.log("  球速(velocity)     K%, K/9                     奪三振増加        奪三振減少");
console.log("  制球(control)      BB%, 被打率, K%(微)          BB低下,被打率低下   BB増加,被打率上昇");
console.log("  変化球(pitches)    K%, 被打率, BABIP            K%上昇,芯外し↑    K%低下,痛打↑");
console.log("  シンカー/シュート   GB%                         ゴロ率上昇        変化なし");
console.log("  スタミナ(stamina)  投球回, 交代タイミング         長いイニング可     早期降板");
console.log("  精神力(mental)     ⚠️ 未反映(ピンチ時の変動予定)");
console.log("");
console.log("  【打者能力】");
console.log("  能力値            主な影響                     高い→           低い→");
console.log("  ──────────────────────────────────────────────────────────────────────────");
console.log("  ミート(contact)    K%, 打率, BABIP, LD%         K%低下,安打↑     K%上昇,安打↓");
console.log("  パワー(power)      HR, ISO, SLG, FB%, 二塁打     HR・長打↑        HR・長打↓");
console.log("  選球眼(eye)        BB%, OBP, BB/K              四球↑,出塁率↑    四球↓");
console.log("  走力(speed)        内野安打, 三塁打, 走者進塁     脚で稼ぐ安打↑    影響小");
console.log("  守備力(fielding)   チームBABIP                  BABIP低下(守備○)  BABIP上昇(守備×)");
console.log("  肩力(arm)          ⚠️ 未反映(守備AI側で使用予定)");
console.log("  捕球(catching)     ⚠️ 未反映(守備AI側で使用予定)");
