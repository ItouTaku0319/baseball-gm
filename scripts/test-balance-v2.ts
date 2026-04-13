#!/usr/bin/env tsx
// scripts/test-balance-v2.ts - v2エンジンのバランステスト

import { simulateGameV2, HIT_RESULTS, AB_RESULTS } from "../src/engine/v2/simulation-v2";
import { generateRoster } from "../src/engine/player-generator";
import type { Team, RosterLevel } from "../src/models/team";
import type { AtBatLog } from "../src/models/league";

// CLI引数パース
const args = process.argv.slice(2);
const gamesArg = args.find((a) => a.startsWith("--games="));
const NUM_GAMES = gamesArg ? parseInt(gamesArg.split("=")[1]) : 1000;

function createTestTeam(id: string, name: string): Team {
  const roster = generateRoster(65);
  const rosterLevels: Record<string, RosterLevel> = {};
  roster.forEach((p) => { rosterLevels[p.id] = "ichi_gun"; });
  return {
    id, name, shortName: name, color: "#0066cc",
    roster, budget: 500000, fanBase: 60,
    homeBallpark: "テスト球場", rosterLevels,
  };
}

// 集計
interface Stats {
  totalGames: number;
  totalPA: number;
  totalAB: number;
  totalHits: number;
  totalHR: number;
  totalK: number;
  totalBB: number;
  totalHBP: number;
  totalSF: number;
  total1B: number;
  total2B: number;
  total3B: number;
  totalGroundBallOuts: number;
  totalFlyBallOuts: number;
  totalRuns: number;
  // 打球タイプ
  bipGB: number;
  bipFB: number;
  bipLD: number;
  bipPU: number;
  // 打球タイプ別ヒット
  gbHits: number;
  fbHits: number;
  ldHits: number;
  puHits: number;
  // 結果別カウント
  resultCounts: Record<string, number>;
}

function emptyStats(): Stats {
  return {
    totalGames: 0, totalPA: 0, totalAB: 0, totalHits: 0, totalHR: 0,
    totalK: 0, totalBB: 0, totalHBP: 0, totalSF: 0,
    total1B: 0, total2B: 0, total3B: 0,
    totalGroundBallOuts: 0, totalFlyBallOuts: 0, totalRuns: 0,
    bipGB: 0, bipFB: 0, bipLD: 0, bipPU: 0,
    gbHits: 0, fbHits: 0, ldHits: 0, puHits: 0,
    resultCounts: {},
  };
}

// HIT_RESULTS, AB_RESULTS は simulation-v2 からimport済み

function aggregateLogs(logs: AtBatLog[], stats: Stats): void {
  for (const log of logs) {
    stats.totalPA++;
    stats.resultCounts[log.result] = (stats.resultCounts[log.result] ?? 0) + 1;

    if (AB_RESULTS.has(log.result)) stats.totalAB++;
    if (HIT_RESULTS.has(log.result)) stats.totalHits++;
    if (log.result === "homerun") stats.totalHR++;
    if (log.result === "single" || log.result === "infield_hit") stats.total1B++;
    if (log.result === "double") stats.total2B++;
    if (log.result === "triple") stats.total3B++;
    if (log.result === "strikeout") stats.totalK++;
    if (log.result === "walk") stats.totalBB++;
    if (log.result === "hit_by_pitch") stats.totalHBP++;
    if (log.result === "sac_fly") stats.totalSF++;

    // 打球タイプ集計
    const bbt = log.battedBallType;
    if (bbt === "ground_ball") {
      stats.bipGB++;
      if (HIT_RESULTS.has(log.result)) stats.gbHits++;
      if (["groundout", "double_play", "fielders_choice"].includes(log.result)) stats.totalGroundBallOuts++;
    }
    if (bbt === "fly_ball") {
      stats.bipFB++;
      if (HIT_RESULTS.has(log.result)) stats.fbHits++;
      if (["flyout", "sac_fly"].includes(log.result)) stats.totalFlyBallOuts++;
    }
    if (bbt === "line_drive") {
      stats.bipLD++;
      if (HIT_RESULTS.has(log.result)) stats.ldHits++;
    }
    if (bbt === "popup") {
      stats.bipPU++;
      if (HIT_RESULTS.has(log.result)) stats.puHits++;
    }
  }
}

// 判定ヘルパー
function check(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
function mark(ok: boolean): string { return ok ? "✅" : "❌"; }
function pad(s: string, len: number): string { return s.padEnd(len); }
function padL(s: string, len: number): string { return s.padStart(len); }
function fmt3(n: number): string { return n.toFixed(3); }
function fmt2(n: number): string { return n.toFixed(2); }
function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }

function runGames(numGames: number, useDH: boolean): { stats: Stats; elapsed: string } {
  const start = Date.now();
  const stats = emptyStats();
  const ROTATE_EVERY = 100;
  let teamA = createTestTeam("team-a", "テストA");
  let teamB = createTestTeam("team-b", "テストB");

  for (let i = 0; i < numGames; i++) {
    if (i > 0 && i % ROTATE_EVERY === 0) {
      teamA = createTestTeam("team-a", "テストA");
      teamB = createTestTeam("team-b", "テストB");
    }
    const result = simulateGameV2(teamA, teamB, { collectAtBatLogs: true, useDH });
    stats.totalGames++;
    stats.totalRuns += result.homeScore + result.awayScore;

    if (result.atBatLogs) {
      aggregateLogs(result.atBatLogs, stats);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  return { stats, elapsed };
}

function calcMetrics(stats: Stats) {
  const avg = stats.totalAB > 0 ? stats.totalHits / stats.totalAB : 0;
  const hrPerGame = stats.totalGames > 0 ? stats.totalHR / stats.totalGames : 0;
  const kPct = stats.totalPA > 0 ? (stats.totalK / stats.totalPA) * 100 : 0;
  const bbPct = stats.totalPA > 0 ? (stats.totalBB / stats.totalPA) * 100 : 0;
  const babipDenom = stats.totalAB - stats.totalK - stats.totalHR + stats.totalSF;
  const babip = babipDenom > 0 ? (stats.totalHits - stats.totalHR) / babipDenom : 0;
  const goao = stats.totalFlyBallOuts > 0 ? stats.totalGroundBallOuts / stats.totalFlyBallOuts : 0;
  const runsPerGame = stats.totalRuns / stats.totalGames;

  const totalBIP = stats.bipGB + stats.bipFB + stats.bipLD + stats.bipPU;
  const gbPct = totalBIP > 0 ? (stats.bipGB / totalBIP) * 100 : 0;
  const fbPct = totalBIP > 0 ? (stats.bipFB / totalBIP) * 100 : 0;
  const ldPct = totalBIP > 0 ? (stats.bipLD / totalBIP) * 100 : 0;
  const puPct = totalBIP > 0 ? (stats.bipPU / totalBIP) * 100 : 0;
  const iffbPct = (stats.bipFB + stats.bipPU) > 0
    ? (stats.bipPU / (stats.bipFB + stats.bipPU)) * 100 : 0;
  const hrFb = stats.bipFB > 0 ? (stats.totalHR / stats.bipFB) * 100 : 0;

  const gbHitRate = stats.bipGB > 0 ? (stats.gbHits / stats.bipGB) * 100 : 0;
  const fbHitRate = stats.bipFB > 0 ? (stats.fbHits / stats.bipFB) * 100 : 0;
  const ldHitRate = stats.bipLD > 0 ? (stats.ldHits / stats.bipLD) * 100 : 0;

  const slg = stats.totalAB > 0
    ? (stats.total1B + stats.total2B * 2 + stats.total3B * 3 + stats.totalHR * 4) / stats.totalAB : 0;
  const obp = (stats.totalPA > 0)
    ? (stats.totalHits + stats.totalBB + stats.totalHBP) / stats.totalPA : 0;
  const ops = obp + slg;
  const iso = slg - avg;

  return { avg, hrPerGame, kPct, bbPct, babip, goao, runsPerGame,
    gbPct, fbPct, ldPct, puPct, iffbPct, hrFb,
    gbHitRate, fbHitRate, ldHitRate, totalBIP,
    slg, obp, ops, iso };
}

function printReport(label: string, stats: Stats, elapsed: string, runsTarget: [number, number]) {
  const m = calcMetrics(stats);

  const avgOk = check(m.avg, 0.240, 0.280);
  const hrOk = check(m.hrPerGame, 1.0, 1.6);
  const kOk = check(m.kPct, 15, 25);
  const bbOk = check(m.bbPct, 6.5, 12);
  const babipOk = check(m.babip, 0.280, 0.320);
  const goaoOk = check(m.goao, 0.75, 1.3);
  const gbOk = check(m.gbPct, 40, 50);
  const fbOk = check(m.fbPct, 28, 40);
  const ldOk = check(m.ldPct, 17, 24);
  const hrFbOk = check(m.hrFb, 5, 16);
  const runsOk = check(m.runsPerGame, runsTarget[0], runsTarget[1]);

  console.log("");
  console.log(`⚾ ${label} (${stats.totalGames}試合)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`実行時間: ${elapsed}秒`);
  console.log("");

  console.log("📊 基本指標");
  console.log(`  ${pad("得点/試合", 12)} ${padL(fmt2(m.runsPerGame), 6)}  (${runsTarget[0]}-${runsTarget[1]})  ${mark(runsOk)}`);
  console.log(`  ${pad("チーム打率", 12)} ${padL(fmt3(m.avg), 6)}  (.240-.280)  ${mark(avgOk)}`);
  console.log(`  ${pad("HR/試合", 12)} ${padL(fmt2(m.hrPerGame), 6)}  (1.0-1.5)   ${mark(hrOk)}`);
  console.log(`  ${pad("K%", 12)} ${padL(fmtPct(m.kPct), 6)}  (15-25%)    ${mark(kOk)}`);
  console.log(`  ${pad("BB%", 12)} ${padL(fmtPct(m.bbPct), 6)}  (6.5-12%)   ${mark(bbOk)}`);
  console.log(`  ${pad("BABIP", 12)} ${padL(fmt3(m.babip), 6)}  (.280-.320)  ${mark(babipOk)}`);
  console.log(`  ${pad("GO/AO", 12)} ${padL(fmt2(m.goao), 6)}  (0.75-1.3)  ${mark(goaoOk)}`);
  console.log(`  ${pad("OBP", 12)} ${padL(fmt3(m.obp), 6)}  (.320-.350)`);
  console.log(`  ${pad("SLG", 12)} ${padL(fmt3(m.slg), 6)}  (.380-.430)`);
  console.log(`  ${pad("OPS", 12)} ${padL(fmt3(m.ops), 6)}  (.700-.780)`);
  console.log(`  ${pad("ISO", 12)} ${padL(fmt3(m.iso), 6)}  (.120-.170)`);
  console.log("");

  console.log("📊 打球タイプ");
  console.log(`  ${pad("GB%", 8)} ${padL(fmtPct(m.gbPct), 6)}  ${mark(gbOk)}  ${pad("FB%", 8)} ${padL(fmtPct(m.fbPct), 6)}  ${mark(fbOk)}`);
  console.log(`  ${pad("LD%", 8)} ${padL(fmtPct(m.ldPct), 6)}  ${mark(ldOk)}  ${pad("PU%", 8)} ${padL(fmtPct(m.puPct), 6)}`);
  console.log(`  ${pad("IFFB%", 8)} ${padL(fmtPct(m.iffbPct), 6)}       ${pad("HR/FB", 8)} ${padL(fmtPct(m.hrFb), 6)}  ${mark(hrFbOk)}`);
  console.log(`  ヒット率: GB=${fmtPct(m.gbHitRate)} FB=${fmtPct(m.fbHitRate)} LD=${fmtPct(m.ldHitRate)}`);
  console.log("");

  const allOk = avgOk && hrOk && kOk && bbOk && babipOk && goaoOk && gbOk && fbOk && ldOk && hrFbOk && runsOk;
  if (allOk) {
    console.log("判定: ✅ 全指標正常");
  } else {
    const failed: string[] = [];
    if (!runsOk) failed.push(`得点=${fmt2(m.runsPerGame)}`);
    if (!avgOk) failed.push(`AVG=${fmt3(m.avg)}`);
    if (!hrOk) failed.push(`HR/G=${fmt2(m.hrPerGame)}`);
    if (!kOk) failed.push(`K%=${fmtPct(m.kPct)}`);
    if (!bbOk) failed.push(`BB%=${fmtPct(m.bbPct)}`);
    if (!babipOk) failed.push(`BABIP=${fmt3(m.babip)}`);
    if (!goaoOk) failed.push(`GO/AO=${fmt2(m.goao)}`);
    if (!gbOk) failed.push(`GB%=${fmtPct(m.gbPct)}`);
    if (!fbOk) failed.push(`FB%=${fmtPct(m.fbPct)}`);
    if (!ldOk) failed.push(`LD%=${fmtPct(m.ldPct)}`);
    if (!hrFbOk) failed.push(`HR/FB=${fmtPct(m.hrFb)}`);
    console.log(`判定: ❌ 問題あり: ${failed.join(", ")}`);
  }
  return allOk;
}

function main() {
  console.log(`⚾ v2エンジン バランステスト (DH有り/無し比較, 各${NUM_GAMES}試合)`);

  // DH有り (パ・リーグ / AL 相当)
  const dhResult = runGames(NUM_GAMES, true);
  const dhOk = printReport("DH有り (パ・リーグ)", dhResult.stats, dhResult.elapsed, [8, 10.5]);

  // DH無し (セ・リーグ / NL 相当)
  const noDhResult = runGames(NUM_GAMES, false);
  // テストチームの投手打撃能力は実データより高め(overall=45)なので、得点上限に余裕を持たせる
  const noDhOk = printReport("DH無し (セ・リーグ)", noDhResult.stats, noDhResult.elapsed, [7, 9.5]);

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`総合判定: ${dhOk && noDhOk ? "✅ 両モード正常" : "❌ 問題あり"}`);

  if (!dhOk || !noDhOk) process.exit(1);
}

main();
