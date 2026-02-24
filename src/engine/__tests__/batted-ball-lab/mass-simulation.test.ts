/**
 * 大規模シミュレーション統計テスト
 *
 * simulateGame を1000試合実行し、リーグ全体の統計をCSVに出力する。
 * `npx vitest run --reporter=verbose batted-ball-lab/mass-simulation` で実行
 */
import { describe, it, expect } from "vitest";
import { simulateGame } from "@/engine/simulation";
import { generateRoster } from "@/engine/player-generator";
import type { Team } from "@/models/team";
import type { PlayerGameStats, PitcherGameLog, GameResult } from "@/models/league";
import * as fs from "fs";
import * as path from "path";

const NUM_GAMES = 100000; // 10万試合 ≈ 約7,500,000打席

// --- チーム生成 ---
function createTeam(id: string, name: string): Team {
  return {
    id,
    name,
    shortName: name,
    color: "#333",
    roster: generateRoster(65),
    budget: 5000,
    fanBase: 50,
    homeBallpark: "テスト球場",
  };
}

// --- 集計用の型 ---
interface LeagueStats {
  totalGames: number;
  totalPA: number; // 打席数
  totalAB: number; // 打数
  totalHits: number;
  totalDoubles: number;
  totalTriples: number;
  totalHomeRuns: number;
  totalRBI: number;
  totalRuns: number;
  totalWalks: number;
  totalStrikeouts: number;
  totalHBP: number;
  totalSF: number;
  totalGIDP: number;
  totalErrors: number;

  // 投手
  totalIP: number; // イニング（アウト数）
  totalER: number;
  totalPitcherH: number;
  totalPitcherBB: number;
  totalPitcherK: number;
  totalPitcherHR: number;
  totalPitcherHBP: number;
  totalGB: number;
  totalFB: number;
  totalLD: number;
  totalPopup: number;

  // 試合
  totalHomeScore: number;
  totalAwayScore: number;
  scores: number[]; // 各チームの得点リスト

  // 選手別
  playerBatting: Map<string, AggBatting>;
  playerPitching: Map<string, AggPitching>;
}

interface AggBatting {
  games: number;
  pa: number;
  ab: number;
  hits: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  runs: number;
  bb: number;
  k: number;
  hbp: number;
  sf: number;
  gidp: number;
}

interface AggPitching {
  games: number;
  outs: number; // アウト数
  hits: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  hbp: number;
  gb: number;
  fb: number;
  ld: number;
  popup: number;
}

function newAggBatting(): AggBatting {
  return { games: 0, pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, runs: 0, bb: 0, k: 0, hbp: 0, sf: 0, gidp: 0 };
}

function newAggPitching(): AggPitching {
  return { games: 0, outs: 0, hits: 0, er: 0, bb: 0, k: 0, hr: 0, hbp: 0, gb: 0, fb: 0, ld: 0, popup: 0 };
}

function accumulateGame(stats: LeagueStats, result: GameResult) {
  stats.totalGames++;
  stats.totalHomeScore += result.homeScore;
  stats.totalAwayScore += result.awayScore;
  stats.scores.push(result.homeScore, result.awayScore);

  for (const ps of result.playerStats) {
    stats.totalAB += ps.atBats;
    stats.totalHits += ps.hits;
    stats.totalDoubles += ps.doubles;
    stats.totalTriples += ps.triples;
    stats.totalHomeRuns += ps.homeRuns;
    stats.totalRBI += ps.rbi;
    stats.totalRuns += ps.runs;
    stats.totalWalks += ps.walks;
    stats.totalStrikeouts += ps.strikeouts;
    stats.totalHBP += (ps.hitByPitch ?? 0);
    stats.totalSF += (ps.sacrificeFlies ?? 0);
    stats.totalGIDP += (ps.groundedIntoDP ?? 0);
    stats.totalErrors += (ps.errors ?? 0);
    stats.totalPA += ps.atBats + ps.walks + (ps.hitByPitch ?? 0) + (ps.sacrificeFlies ?? 0);

    let agg = stats.playerBatting.get(ps.playerId);
    if (!agg) { agg = newAggBatting(); stats.playerBatting.set(ps.playerId, agg); }
    agg.games++;
    agg.pa += ps.atBats + ps.walks + (ps.hitByPitch ?? 0) + (ps.sacrificeFlies ?? 0);
    agg.ab += ps.atBats;
    agg.hits += ps.hits;
    agg.doubles += ps.doubles;
    agg.triples += ps.triples;
    agg.hr += ps.homeRuns;
    agg.rbi += ps.rbi;
    agg.runs += ps.runs;
    agg.bb += ps.walks;
    agg.k += ps.strikeouts;
    agg.hbp += (ps.hitByPitch ?? 0);
    agg.sf += (ps.sacrificeFlies ?? 0);
    agg.gidp += (ps.groundedIntoDP ?? 0);
  }

  for (const pl of result.pitcherStats) {
    stats.totalIP += pl.inningsPitched;
    stats.totalER += pl.earnedRuns;
    stats.totalPitcherH += pl.hits;
    stats.totalPitcherBB += pl.walks;
    stats.totalPitcherK += pl.strikeouts;
    stats.totalPitcherHR += pl.homeRunsAllowed;
    stats.totalPitcherHBP += (pl.hitBatsmen ?? 0);
    stats.totalGB += (pl.groundBalls ?? 0);
    stats.totalFB += (pl.flyBalls ?? 0);
    stats.totalLD += (pl.lineDrives ?? 0);
    stats.totalPopup += (pl.popups ?? 0);

    let agg = stats.playerPitching.get(pl.playerId);
    if (!agg) { agg = newAggPitching(); stats.playerPitching.set(pl.playerId, agg); }
    agg.games++;
    agg.outs += pl.inningsPitched;
    agg.hits += pl.hits;
    agg.er += pl.earnedRuns;
    agg.bb += pl.walks;
    agg.k += pl.strikeouts;
    agg.hr += pl.homeRunsAllowed;
    agg.hbp += (pl.hitBatsmen ?? 0);
    agg.gb += (pl.groundBalls ?? 0);
    agg.fb += (pl.flyBalls ?? 0);
    agg.ld += (pl.lineDrives ?? 0);
    agg.popup += (pl.popups ?? 0);
  }
}

function initStats(): LeagueStats {
  return {
    totalGames: 0, totalPA: 0, totalAB: 0, totalHits: 0, totalDoubles: 0,
    totalTriples: 0, totalHomeRuns: 0, totalRBI: 0, totalRuns: 0,
    totalWalks: 0, totalStrikeouts: 0, totalHBP: 0, totalSF: 0,
    totalGIDP: 0, totalErrors: 0,
    totalIP: 0, totalER: 0, totalPitcherH: 0, totalPitcherBB: 0,
    totalPitcherK: 0, totalPitcherHR: 0, totalPitcherHBP: 0,
    totalGB: 0, totalFB: 0, totalLD: 0, totalPopup: 0,
    totalHomeScore: 0, totalAwayScore: 0, scores: [],
    playerBatting: new Map(), playerPitching: new Map(),
  };
}

describe("大規模シミュレーション統計", () => {
  const teams: Team[] = [];
  const stats = initStats();
  // 全選手のabilities参照用
  const allPlayers = new Map<string, { name: string; batting: any; pitching: any; isPitcher: boolean }>();

  it(`${NUM_GAMES}試合シミュレーション実行`, () => {
    // 12チーム生成
    const teamNames = ["チームA","チームB","チームC","チームD","チームE","チームF",
                       "チームG","チームH","チームI","チームJ","チームK","チームL"];
    for (const name of teamNames) {
      const team = createTeam(name.toLowerCase(), name);
      teams.push(team);
      for (const p of team.roster) {
        allPlayers.set(p.id, { name: p.name, batting: p.batting, pitching: p.pitching, isPitcher: p.isPitcher });
      }
    }

    // ランダムな対戦カードでN試合実行
    for (let i = 0; i < NUM_GAMES; i++) {
      const hi = Math.floor(Math.random() * teams.length);
      let ai = Math.floor(Math.random() * (teams.length - 1));
      if (ai >= hi) ai++;
      const result = simulateGame(teams[hi], teams[ai]);
      accumulateGame(stats, result);
    }

    expect(stats.totalGames).toBe(NUM_GAMES);
    console.log(`\n${NUM_GAMES}試合完了。総打席数: ${stats.totalPA}`);
  }, 300000);

  it("リーグ全体統計をコンソール出力", () => {
    const s = stats;
    const g = s.totalGames;
    const ip = s.totalIP / 3;
    const bip = s.totalGB + s.totalFB + s.totalLD + s.totalPopup;

    // 基本打撃指標
    const avg = s.totalHits / s.totalAB;
    const obp = (s.totalHits + s.totalWalks + s.totalHBP) / s.totalPA;
    const tb = s.totalHits + s.totalDoubles + s.totalTriples * 2 + s.totalHomeRuns * 3;
    const slg = tb / s.totalAB;
    const ops = obp + slg;
    const iso = slg - avg;
    const babip = (s.totalHits - s.totalHomeRuns) / (s.totalAB - s.totalStrikeouts - s.totalHomeRuns + s.totalSF);
    const kPct = s.totalStrikeouts / s.totalPA * 100;
    const bbPct = s.totalWalks / s.totalPA * 100;

    // 投手指標
    const era = (s.totalER / ip) * 9;
    const whip = (s.totalPitcherH + s.totalPitcherBB) / ip;
    const k9 = (s.totalPitcherK / ip) * 9;
    const bb9 = (s.totalPitcherBB / ip) * 9;
    const hr9 = (s.totalPitcherHR / ip) * 9;

    // 打球分布
    const gbPct = bip > 0 ? (s.totalGB / bip) * 100 : 0;
    const fbPct = bip > 0 ? (s.totalFB / bip) * 100 : 0;
    const ldPct = bip > 0 ? (s.totalLD / bip) * 100 : 0;
    const pfPct = bip > 0 ? (s.totalPopup / bip) * 100 : 0;
    const hrFb = s.totalFB > 0 ? (s.totalHomeRuns / s.totalFB) * 100 : 0;

    // 試合指標
    const rpg = (s.totalHomeScore + s.totalAwayScore) / g;
    const hrPerGame = s.totalHomeRuns / g;

    console.log("\n" + "=".repeat(70));
    console.log(`  リーグ全体統計 (${g}試合, ${s.totalPA}打席)`);
    console.log("=".repeat(70));

    console.log("\n--- 打撃指標 ---");
    console.log(`  打率(AVG):     ${avg.toFixed(3)}   | NPB参考: .250-.260`);
    console.log(`  出塁率(OBP):   ${obp.toFixed(3)}   | NPB参考: .310-.320`);
    console.log(`  長打率(SLG):   ${slg.toFixed(3)}   | NPB参考: .370-.400`);
    console.log(`  OPS:           ${ops.toFixed(3)}   | NPB参考: .680-.720`);
    console.log(`  ISO:           ${iso.toFixed(3)}   | NPB参考: .110-.140`);
    console.log(`  BABIP:         ${babip.toFixed(3)}   | NPB参考: .290-.310`);
    console.log(`  K%:            ${kPct.toFixed(1)}%   | NPB参考: 18-22%`);
    console.log(`  BB%:           ${bbPct.toFixed(1)}%   | NPB参考: 7-9%`);
    console.log(`  BB/K:          ${(s.totalWalks / s.totalStrikeouts).toFixed(2)}   | NPB参考: 0.35-0.50`);

    console.log("\n--- 試合指標 ---");
    console.log(`  得点/試合:     ${rpg.toFixed(2)}   | NPB参考: 7.0-9.0`);
    console.log(`  HR/試合:       ${hrPerGame.toFixed(2)}   | NPB参考: 1.6-2.4`);
    console.log(`  安打/試合:     ${(s.totalHits / g).toFixed(2)}`);
    console.log(`  2B/試合:       ${(s.totalDoubles / g).toFixed(2)}   | NPB参考: 3.0-4.0`);
    console.log(`  3B/試合:       ${(s.totalTriples / g).toFixed(2)}   | NPB参考: 0.2-0.4`);
    console.log(`  失策/試合:     ${(s.totalErrors / g).toFixed(2)}   | NPB参考: 1.0-1.6`);
    console.log(`  併殺/試合:     ${(s.totalGIDP / g).toFixed(2)}   | NPB参考: 1.2-1.8`);

    console.log("\n--- 投手指標 ---");
    console.log(`  ERA:           ${era.toFixed(2)}   | NPB参考: 3.50-4.00`);
    console.log(`  WHIP:          ${whip.toFixed(2)}   | NPB参考: 1.20-1.35`);
    console.log(`  K/9:           ${k9.toFixed(2)}   | NPB参考: 7.0-8.5`);
    console.log(`  BB/9:          ${bb9.toFixed(2)}   | NPB参考: 2.5-3.5`);
    console.log(`  HR/9:          ${hr9.toFixed(2)}   | NPB参考: 0.7-1.0`);

    console.log("\n--- 打球分布 (投手記録ベース) ---");
    console.log(`  ゴロ%:         ${gbPct.toFixed(1)}%   | NPB参考: 43-50%`);
    console.log(`  フライ%:       ${fbPct.toFixed(1)}%   | NPB参考: 25-32%`);
    console.log(`  ライナー%:     ${ldPct.toFixed(1)}%   | NPB参考: 20-25%`);
    console.log(`  ポップフライ%: ${pfPct.toFixed(1)}%   | NPB参考: 5-10%`);
    console.log(`  HR/FB%:        ${hrFb.toFixed(1)}%   | NPB参考: 8-12%`);
    console.log(`  BIP合計:       ${bip}`);

    // 得点分布
    const scoreCounts: Record<number, number> = {};
    for (const sc of stats.scores) {
      scoreCounts[sc] = (scoreCounts[sc] || 0) + 1;
    }
    console.log("\n--- 得点分布 ---");
    let maxScore = 0;
    for (const sc of stats.scores) { if (sc > maxScore) maxScore = sc; }
    for (let i = 0; i <= Math.min(maxScore, 15); i++) {
      const cnt = scoreCounts[i] || 0;
      const pct = ((cnt / stats.scores.length) * 100).toFixed(1);
      const bar = "█".repeat(Math.round(cnt / (stats.scores.length / 50)));
      console.log(`  ${String(i).padStart(2)}点: ${String(cnt).padStart(4)} (${pct.padStart(5)}%) ${bar}`);
    }
  });

  it("CSVファイル出力", () => {
    const outDir = path.resolve(__dirname, "../../../../tmp");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const s = stats;
    const g = s.totalGames;
    const ip = s.totalIP / 3;
    const bip = s.totalGB + s.totalFB + s.totalLD + s.totalPopup;

    // --- 1. リーグサマリーCSV ---
    const avg = s.totalHits / s.totalAB;
    const obp = (s.totalHits + s.totalWalks + s.totalHBP) / s.totalPA;
    const tb = s.totalHits + s.totalDoubles + s.totalTriples * 2 + s.totalHomeRuns * 3;
    const slg = tb / s.totalAB;
    const babip = (s.totalHits - s.totalHomeRuns) / (s.totalAB - s.totalStrikeouts - s.totalHomeRuns + s.totalSF);
    const kPct = s.totalStrikeouts / s.totalPA * 100;
    const bbPct = s.totalWalks / s.totalPA * 100;
    const era = (s.totalER / ip) * 9;
    const whip = (s.totalPitcherH + s.totalPitcherBB) / ip;
    const rpg = (s.totalHomeScore + s.totalAwayScore) / g;
    const hrPerGame = s.totalHomeRuns / g;

    const summaryRows = [
      ["指標", "値", "NPB参考値"],
      ["試合数", g, ""],
      ["総打席数", s.totalPA, ""],
      ["打率(AVG)", avg.toFixed(3), ".250-.260"],
      ["出塁率(OBP)", obp.toFixed(3), ".310-.320"],
      ["長打率(SLG)", slg.toFixed(3), ".370-.400"],
      ["OPS", (obp + slg).toFixed(3), ".680-.720"],
      ["ISO", (slg - avg).toFixed(3), ".110-.140"],
      ["BABIP", babip.toFixed(3), ".290-.310"],
      ["K%", kPct.toFixed(1) + "%", "18-22%"],
      ["BB%", bbPct.toFixed(1) + "%", "7-9%"],
      ["BB/K", (s.totalWalks / s.totalStrikeouts).toFixed(2), "0.35-0.50"],
      ["得点/試合", rpg.toFixed(2), "7.0-9.0"],
      ["HR/試合", hrPerGame.toFixed(2), "1.6-2.4"],
      ["2B/試合", (s.totalDoubles / g).toFixed(2), "3.0-4.0"],
      ["3B/試合", (s.totalTriples / g).toFixed(2), "0.2-0.4"],
      ["失策/試合", (s.totalErrors / g).toFixed(2), "1.0-1.6"],
      ["併殺/試合", (s.totalGIDP / g).toFixed(2), "1.2-1.8"],
      ["ERA", era.toFixed(2), "3.50-4.00"],
      ["WHIP", whip.toFixed(2), "1.20-1.35"],
      ["K/9", (s.totalPitcherK / ip * 9).toFixed(2), "7.0-8.5"],
      ["BB/9", (s.totalPitcherBB / ip * 9).toFixed(2), "2.5-3.5"],
      ["HR/9", (s.totalPitcherHR / ip * 9).toFixed(2), "0.7-1.0"],
      ["ゴロ%", (bip > 0 ? (s.totalGB / bip * 100) : 0).toFixed(1) + "%", "43-50%"],
      ["フライ%", (bip > 0 ? (s.totalFB / bip * 100) : 0).toFixed(1) + "%", "25-32%"],
      ["ライナー%", (bip > 0 ? (s.totalLD / bip * 100) : 0).toFixed(1) + "%", "20-25%"],
      ["ポップフライ%", (bip > 0 ? (s.totalPopup / bip * 100) : 0).toFixed(1) + "%", "5-10%"],
      ["HR/FB%", (s.totalFB > 0 ? (s.totalHomeRuns / s.totalFB * 100) : 0).toFixed(1) + "%", "8-12%"],
    ];
    const summaryCSV = "\uFEFF" + summaryRows.map(r => r.join(",")).join("\n");
    fs.writeFileSync(path.join(outDir, "league-summary.csv"), summaryCSV, "utf-8");

    // --- 2. 打者個人成績CSV (50打席以上) ---
    const batterRows: string[][] = [
      ["名前","投打","ミート","パワー","弾道","走力","選球眼",
       "試合","打席","打数","安打","2B","3B","HR","打点","得点","四球","三振","死球","犠飛","併殺",
       "打率","出塁率","長打率","OPS","ISO","K%","BB%"],
    ];
    for (const [pid, agg] of stats.playerBatting) {
      if (agg.pa < 50) continue;
      const p = allPlayers.get(pid);
      if (!p || p.isPitcher) continue;
      const ba = agg.hits / agg.ab;
      const ob = (agg.hits + agg.bb + agg.hbp) / agg.pa;
      const t = agg.hits + agg.doubles + agg.triples * 2 + agg.hr * 3;
      const sl = t / agg.ab;
      batterRows.push([
        p.name, "R",
        p.batting.contact, p.batting.power, p.batting.trajectory ?? 2, p.batting.speed, p.batting.eye,
        agg.games, agg.pa, agg.ab, agg.hits, agg.doubles, agg.triples, agg.hr,
        agg.rbi, agg.runs, agg.bb, agg.k, agg.hbp, agg.sf, agg.gidp,
        ba.toFixed(3), ob.toFixed(3), sl.toFixed(3), (ob + sl).toFixed(3),
        (sl - ba).toFixed(3),
        (agg.k / agg.pa * 100).toFixed(1) + "%",
        (agg.bb / agg.pa * 100).toFixed(1) + "%",
      ].map(String));
    }
    const batterCSV = "\uFEFF" + batterRows.map(r => r.join(",")).join("\n");
    fs.writeFileSync(path.join(outDir, "batter-stats.csv"), batterCSV, "utf-8");

    // --- 3. 投手個人成績CSV ---
    const pitcherRows: string[][] = [
      ["名前","球速","制球","球種数",
       "試合","投球回","被安打","自責点","四球","三振","被HR","与死球",
       "ゴロ","フライ","ライナー","PF",
       "ERA","WHIP","K/9","BB/9","HR/9","GB%","FB%"],
    ];
    for (const [pid, agg] of stats.playerPitching) {
      if (agg.outs < 9) continue; // 3イニング未満は除外
      const p = allPlayers.get(pid);
      if (!p || !p.pitching) continue;
      const pip = agg.outs / 3;
      const pBip = agg.gb + agg.fb + agg.ld + agg.popup;
      pitcherRows.push([
        p.name, p.pitching.velocity, p.pitching.control, p.pitching.pitches?.length ?? 0,
        agg.games, pip.toFixed(1), agg.hits, agg.er, agg.bb, agg.k, agg.hr, agg.hbp,
        agg.gb, agg.fb, agg.ld, agg.popup,
        (agg.er / pip * 9).toFixed(2),
        ((agg.hits + agg.bb) / pip).toFixed(2),
        (agg.k / pip * 9).toFixed(2),
        (agg.bb / pip * 9).toFixed(2),
        (agg.hr / pip * 9).toFixed(2),
        pBip > 0 ? (agg.gb / pBip * 100).toFixed(1) + "%" : "0%",
        pBip > 0 ? (agg.fb / pBip * 100).toFixed(1) + "%" : "0%",
      ].map(String));
    }
    const pitcherCSV = "\uFEFF" + pitcherRows.map(r => r.join(",")).join("\n");
    fs.writeFileSync(path.join(outDir, "pitcher-stats.csv"), pitcherCSV, "utf-8");

    console.log(`\nCSV出力完了:`);
    console.log(`  ${path.join(outDir, "league-summary.csv")}`);
    console.log(`  ${path.join(outDir, "batter-stats.csv")} (${batterRows.length - 1}人)`);
    console.log(`  ${path.join(outDir, "pitcher-stats.csv")} (${pitcherRows.length - 1}人)`);

    expect(batterRows.length).toBeGreaterThan(1);
    expect(pitcherRows.length).toBeGreaterThan(1);
  });
});
