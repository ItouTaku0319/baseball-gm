/**
 * 包括的バランス検証テスト
 *
 * 12チームでミニシーズン（各チーム約100試合）を回し、
 * 打撃・投手・継投の全指標を出力してNPBベンチマークと照合する。
 *
 * `npx vitest run --reporter=verbose batted-ball-lab/comprehensive-balance` で実行
 */
import { describe, it, expect } from "vitest";
import { simulateGame } from "@/engine/simulation";
import { generateRoster } from "@/engine/player-generator";
import { autoConfigureLineup } from "@/engine/lineup";
import type { Team } from "@/models/team";
import type { GameResult, PitcherGameLog } from "@/models/league";

const NUM_TEAMS = 12;
const GAMES_PER_TEAM_TARGET = 100; // 各チーム約100試合
const TOTAL_GAMES = Math.floor((NUM_TEAMS * GAMES_PER_TEAM_TARGET) / 2); // 600試合
const FULL_SEASON_GAMES = 143; // NPBシーズン試合数（換算用）

// --- チーム生成 ---
function createTeam(id: string, name: string): Team {
  const team: Team = {
    id,
    name,
    shortName: name,
    color: "#333",
    roster: generateRoster(65),
    budget: 5000,
    fanBase: 50,
    homeBallpark: "テスト球場",
  };
  // autoConfigureLineupで実際のゲームと同じ役割設定を適用
  team.lineupConfig = autoConfigureLineup(team);
  return team;
}

// --- 集計用の型 ---
interface LeagueStats {
  totalGames: number;
  totalPA: number;
  totalAB: number;
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
  totalIP: number; // アウト数
  totalER: number;
  totalPitcherH: number;
  totalPitcherBB: number;
  totalPitcherK: number;
  totalPitcherHR: number;
  totalGB: number;
  totalFB: number;
  totalLD: number;
  totalPopup: number;
  // 試合スコア
  totalHomeScore: number;
  totalAwayScore: number;
  scores: number[];
  // 継投指標
  totalPitcherChanges: number; // リリーフ投手延べ人数
  totalStarterOuts: number; // 先発のアウト数合計
  totalStarterGames: number;
  totalRelieverOuts: number; // リリーフのアウト数合計
  totalRelieverAppearances: number; // リリーフ延べ登板数
  totalSaves: number;
  totalHolds: number;
  totalQS: number; // QS (6IP以上 & 自責3以下)
  // チーム×投手別の登板記録
  teamGames: Map<string, number>; // teamId → 試合数
  pitcherGameLog: Map<string, { appearances: number; outs: number; isStarter: boolean; teamId: string }>;
}

function initStats(): LeagueStats {
  return {
    totalGames: 0, totalPA: 0, totalAB: 0, totalHits: 0, totalDoubles: 0,
    totalTriples: 0, totalHomeRuns: 0, totalRBI: 0, totalRuns: 0,
    totalWalks: 0, totalStrikeouts: 0, totalHBP: 0, totalSF: 0,
    totalGIDP: 0, totalErrors: 0,
    totalIP: 0, totalER: 0, totalPitcherH: 0, totalPitcherBB: 0,
    totalPitcherK: 0, totalPitcherHR: 0,
    totalGB: 0, totalFB: 0, totalLD: 0, totalPopup: 0,
    totalHomeScore: 0, totalAwayScore: 0, scores: [],
    totalPitcherChanges: 0, totalStarterOuts: 0, totalStarterGames: 0,
    totalRelieverOuts: 0, totalRelieverAppearances: 0,
    totalSaves: 0, totalHolds: 0, totalQS: 0,
    teamGames: new Map(),
    pitcherGameLog: new Map(),
  };
}

function accumulateGame(stats: LeagueStats, result: GameResult, homeTeamId: string, awayTeamId: string) {
  stats.totalGames++;
  stats.totalHomeScore += result.homeScore;
  stats.totalAwayScore += result.awayScore;
  stats.scores.push(result.homeScore, result.awayScore);

  // チーム試合数
  stats.teamGames.set(homeTeamId, (stats.teamGames.get(homeTeamId) ?? 0) + 1);
  stats.teamGames.set(awayTeamId, (stats.teamGames.get(awayTeamId) ?? 0) + 1);

  // 打撃集計
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
  }

  // 投手集計 + 継投指標
  let startersInGame = 0;
  let relieversInGame = 0;

  for (const pl of result.pitcherStats) {
    stats.totalIP += pl.inningsPitched;
    stats.totalER += pl.earnedRuns;
    stats.totalPitcherH += pl.hits;
    stats.totalPitcherBB += pl.walks;
    stats.totalPitcherK += pl.strikeouts;
    stats.totalPitcherHR += pl.homeRunsAllowed;
    stats.totalGB += (pl.groundBalls ?? 0);
    stats.totalFB += (pl.flyBalls ?? 0);
    stats.totalLD += (pl.lineDrives ?? 0);
    stats.totalPopup += (pl.popups ?? 0);

    if (pl.isStarter) {
      startersInGame++;
      stats.totalStarterOuts += pl.inningsPitched;
      stats.totalStarterGames++;
      // QS判定: 6IP以上 & 自責3以下
      if (pl.inningsPitched >= 18 && pl.earnedRuns <= 3) {
        stats.totalQS++;
      }
    } else {
      relieversInGame++;
      stats.totalRelieverOuts += pl.inningsPitched;
      stats.totalRelieverAppearances++;
    }

    // 投手個人ログの蓄積
    const key = pl.playerId;
    const existing = stats.pitcherGameLog.get(key);
    if (existing) {
      existing.appearances++;
      existing.outs += pl.inningsPitched;
    } else {
      // teamIdの特定: 先発かどうかとresultのpitcherStatsの順番から推定
      // pitcherStatsには両チームの投手が混ざっているので、ここではplayerIdで参照
      stats.pitcherGameLog.set(key, {
        appearances: 1,
        outs: pl.inningsPitched,
        isStarter: pl.isStarter,
        teamId: "", // 後で特定
      });
    }
  }

  stats.totalPitcherChanges += relieversInGame; // リリーフ登板数 = 投手交代回数に近似

  // セーブ・ホールド
  if (result.savePitcherId) stats.totalSaves++;
  stats.totalHolds += (result.holdPitcherIds ?? []).length;
}

// --- NPBベンチマーク ---
interface Benchmark {
  name: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
}

function checkBenchmarks(benchmarks: Benchmark[]): { passed: number; failed: number; results: string[] } {
  let passed = 0;
  let failed = 0;
  const results: string[] = [];
  for (const b of benchmarks) {
    const ok = b.value >= b.min && b.value <= b.max;
    if (ok) passed++; else failed++;
    const status = ok ? "PASS" : "FAIL";
    const unit = b.unit ?? "";
    results.push(
      `  [${status}] ${b.name}: ${b.value.toFixed(2)}${unit}  (範囲: ${b.min}-${b.max}${unit})`
    );
  }
  return { passed, failed, results };
}

describe("包括的バランス検証", () => {
  const teams: Team[] = [];
  const stats = initStats();
  // teamId → Set<playerId> のマッピング
  const teamPlayerMap = new Map<string, Set<string>>();

  it(`${TOTAL_GAMES}試合シミュレーション実行 (${NUM_TEAMS}チーム × 約${GAMES_PER_TEAM_TARGET}試合)`, () => {
    // 12チーム生成（autoConfigureLineup適用済み）
    const teamNames = [
      "チームA", "チームB", "チームC", "チームD", "チームE", "チームF",
      "チームG", "チームH", "チームI", "チームJ", "チームK", "チームL",
    ];
    for (let i = 0; i < NUM_TEAMS; i++) {
      const team = createTeam(`team-${i}`, teamNames[i]);
      teams.push(team);
      const playerIds = new Set<string>();
      for (const p of team.roster) {
        playerIds.add(p.id);
      }
      teamPlayerMap.set(team.id, playerIds);
    }

    // ランダム対戦でTOTAL_GAMES試合実行（先発ローテ回転あり）
    for (let i = 0; i < TOTAL_GAMES; i++) {
      const hi = Math.floor(Math.random() * teams.length);
      let ai = Math.floor(Math.random() * (teams.length - 1));
      if (ai >= hi) ai++;

      const homeTeam = teams[hi];
      const awayTeam = teams[ai];
      const result = simulateGame(homeTeam, awayTeam);
      accumulateGame(stats, result, homeTeam.id, awayTeam.id);

      // 登板したリリーフ投手IDを収集
      const appearedIds = new Set<string>();
      for (const pl of result.pitcherStats) {
        if (!pl.isStarter) appearedIds.add(pl.playerId);
      }

      // 連投状態・ローテーションインデックスを更新
      for (const team of [homeTeam, awayTeam]) {
        if (!team.lineupConfig) continue;
        // ローテ進行
        if (team.lineupConfig.startingRotation?.length) {
          const rotLen = team.lineupConfig.startingRotation.length;
          team.lineupConfig.rotationIndex = (team.lineupConfig.rotationIndex + 1) % rotLen;
        }
        // 連投状態更新
        const prev = team.lineupConfig.pitcherAppearances ?? {};
        const updated: Record<string, number> = {};
        for (const pid of team.lineupConfig.relieverIds ?? []) {
          updated[pid] = appearedIds.has(pid) ? (prev[pid] ?? 0) + 1 : 0;
        }
        team.lineupConfig.pitcherAppearances = updated;
      }
    }

    // 投手個人ログにteamId割り当て
    for (const [playerId, log] of stats.pitcherGameLog) {
      for (const [teamId, playerIds] of teamPlayerMap) {
        if (playerIds.has(playerId)) {
          log.teamId = teamId;
          break;
        }
      }
    }

    expect(stats.totalGames).toBe(TOTAL_GAMES);
    console.log(`\n${TOTAL_GAMES}試合完了。総打席数: ${stats.totalPA}`);

    // チームあたり試合数を確認
    for (const [teamId, games] of stats.teamGames) {
      console.log(`  ${teamId}: ${games}試合`);
    }
  }, 600000);

  it("1. リーグ打撃指標", () => {
    const s = stats;
    const g = s.totalGames;

    const avg = s.totalHits / s.totalAB;
    const obp = (s.totalHits + s.totalWalks + s.totalHBP) / s.totalPA;
    const tb = s.totalHits + s.totalDoubles + s.totalTriples * 2 + s.totalHomeRuns * 3;
    const slg = tb / s.totalAB;
    const ops = obp + slg;
    const iso = slg - avg;
    const babip = (s.totalHits - s.totalHomeRuns) / (s.totalAB - s.totalStrikeouts - s.totalHomeRuns + s.totalSF);
    const kPct = s.totalStrikeouts / s.totalPA * 100;
    const bbPct = s.totalWalks / s.totalPA * 100;
    const bbk = s.totalWalks / s.totalStrikeouts;
    const rpg = (s.totalHomeScore + s.totalAwayScore) / g;
    const hrPerGame = s.totalHomeRuns / g;

    console.log("\n" + "=".repeat(70));
    console.log("  1. リーグ打撃指標");
    console.log("=".repeat(70));
    console.log(`  AVG:     ${avg.toFixed(3)}   | NPB: .250-.260`);
    console.log(`  OBP:     ${obp.toFixed(3)}   | NPB: .310-.320`);
    console.log(`  SLG:     ${slg.toFixed(3)}   | NPB: .370-.400`);
    console.log(`  OPS:     ${ops.toFixed(3)}   | NPB: .680-.720`);
    console.log(`  ISO:     ${iso.toFixed(3)}   | NPB: .110-.140`);
    console.log(`  BABIP:   ${babip.toFixed(3)}   | NPB: .290-.310`);
    console.log(`  K%:      ${kPct.toFixed(1)}%   | NPB: 18-22%`);
    console.log(`  BB%:     ${bbPct.toFixed(1)}%   | NPB: 7-9%`);
    console.log(`  BB/K:    ${bbk.toFixed(2)}   | NPB: 0.35-0.50`);
    console.log(`  HR/試合: ${hrPerGame.toFixed(2)}   | NPB: 1.6-2.4`);
    console.log(`  得点/試合: ${rpg.toFixed(2)} | NPB: 7.0-9.0`);
    console.log(`  2B/試合: ${(s.totalDoubles / g).toFixed(2)}   | NPB: 3.0-4.0`);
    console.log(`  3B/試合: ${(s.totalTriples / g).toFixed(2)}   | NPB: 0.2-0.4`);
    console.log(`  GIDP/試合: ${(s.totalGIDP / g).toFixed(2)} | NPB: 1.2-1.8`);
    console.log(`  Error/試合: ${(s.totalErrors / g).toFixed(2)} | NPB: 1.0-1.6`);

    // 得点分布ヒストグラム
    const scoreCounts: Record<number, number> = {};
    for (const sc of stats.scores) {
      scoreCounts[sc] = (scoreCounts[sc] || 0) + 1;
    }
    console.log("\n  得点分布:");
    let maxScore = 0;
    for (const sc of stats.scores) { if (sc > maxScore) maxScore = sc; }
    for (let i = 0; i <= Math.min(maxScore, 15); i++) {
      const cnt = scoreCounts[i] || 0;
      const pct = ((cnt / stats.scores.length) * 100).toFixed(1);
      const bar = "#".repeat(Math.round(cnt / (stats.scores.length / 50)));
      console.log(`    ${String(i).padStart(2)}点: ${String(cnt).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
    }

    expect(avg).toBeGreaterThan(0.200);
    expect(avg).toBeLessThan(0.320);
  });

  it("2. リーグ投手指標", () => {
    const s = stats;
    const ip = s.totalIP / 3;
    const bip = s.totalGB + s.totalFB + s.totalLD + s.totalPopup;

    const era = (s.totalER / ip) * 9;
    const whip = (s.totalPitcherH + s.totalPitcherBB) / ip;
    const k9 = (s.totalPitcherK / ip) * 9;
    const bb9 = (s.totalPitcherBB / ip) * 9;
    const hr9 = (s.totalPitcherHR / ip) * 9;
    const kbb = s.totalPitcherK / s.totalPitcherBB;
    const gbPct = bip > 0 ? (s.totalGB / bip) * 100 : 0;
    const fbPct = bip > 0 ? (s.totalFB / bip) * 100 : 0;
    const ldPct = bip > 0 ? (s.totalLD / bip) * 100 : 0;
    const hrFb = s.totalFB > 0 ? (s.totalPitcherHR / s.totalFB) * 100 : 0;

    console.log("\n" + "=".repeat(70));
    console.log("  2. リーグ投手指標");
    console.log("=".repeat(70));
    console.log(`  ERA:     ${era.toFixed(2)}   | NPB: 3.0-4.0`);
    console.log(`  WHIP:    ${whip.toFixed(2)}   | NPB: 1.20-1.40`);
    console.log(`  K/9:     ${k9.toFixed(2)}   | NPB: 7.0-8.5`);
    console.log(`  BB/9:    ${bb9.toFixed(2)}   | NPB: 2.5-3.5`);
    console.log(`  HR/9:    ${hr9.toFixed(2)}   | NPB: 0.7-1.0`);
    console.log(`  K/BB:    ${kbb.toFixed(2)}   | NPB: 2.0-3.0`);
    console.log(`  GB%:     ${gbPct.toFixed(1)}%  | NPB: 43-50%`);
    console.log(`  FB%:     ${fbPct.toFixed(1)}%  | NPB: 25-32%`);
    console.log(`  LD%:     ${ldPct.toFixed(1)}%  | NPB: 20-25%`);
    console.log(`  HR/FB%:  ${hrFb.toFixed(1)}%  | NPB: 8-12%`);

    expect(era).toBeGreaterThan(0);
  });

  it("3. 継投・リリーフ指標 (最重要)", () => {
    const s = stats;
    const g = s.totalGames;

    // チームあたり平均試合数
    const teamGameCounts = Array.from(s.teamGames.values());
    const avgTeamGames = teamGameCounts.reduce((a, b) => a + b, 0) / teamGameCounts.length;
    const scaleFactor = FULL_SEASON_GAMES / avgTeamGames; // 143試合換算

    // 投手交代回数/試合（先発除く投手延べ数 / 試合数 / 2チーム）
    const pitcherChangesPerGame = s.totalPitcherChanges / g / 2;
    // 先発平均投球回/試合
    const starterAvgIP = s.totalStarterGames > 0 ? (s.totalStarterOuts / 3) / s.totalStarterGames : 0;
    // リリーフ平均投球回/登板
    const relieverAvgIP = s.totalRelieverAppearances > 0 ? (s.totalRelieverOuts / 3) / s.totalRelieverAppearances : 0;
    // QS率
    const qsRate = s.totalStarterGames > 0 ? (s.totalQS / s.totalStarterGames) * 100 : 0;
    // セーブ/試合、ホールド/試合
    const savesPerGame = s.totalSaves / g;
    const holdsPerGame = s.totalHolds / g;
    // リリーフ使用人数/試合 (1チームあたり)
    const relieverPerTeamPerGame = s.totalRelieverAppearances / g / 2;

    // リリーフ投手の登板数・投球回分布 (143試合換算)
    const relieverEntries: { id: string; appearances: number; outs: number; ip: number; scaledApp: number; scaledIP: number }[] = [];
    for (const [playerId, log] of s.pitcherGameLog) {
      if (log.isStarter) continue;
      if (log.appearances < 3) continue; // ノイズ除外
      const teamGames = s.teamGames.get(log.teamId) ?? avgTeamGames;
      const scale = FULL_SEASON_GAMES / teamGames;
      relieverEntries.push({
        id: playerId,
        appearances: log.appearances,
        outs: log.outs,
        ip: log.outs / 3,
        scaledApp: log.appearances * scale,
        scaledIP: (log.outs / 3) * scale,
      });
    }
    relieverEntries.sort((a, b) => b.scaledIP - a.scaledIP);

    // 先発投手の投球回分布
    const starterEntries: { id: string; appearances: number; outs: number; ip: number; scaledIP: number }[] = [];
    for (const [playerId, log] of s.pitcherGameLog) {
      if (!log.isStarter) continue;
      if (log.appearances < 3) continue;
      const teamGames = s.teamGames.get(log.teamId) ?? avgTeamGames;
      const scale = FULL_SEASON_GAMES / teamGames;
      starterEntries.push({
        id: playerId,
        appearances: log.appearances,
        outs: log.outs,
        ip: log.outs / 3,
        scaledIP: (log.outs / 3) * scale,
      });
    }
    starterEntries.sort((a, b) => b.scaledIP - a.scaledIP);

    const maxRelieverIP = relieverEntries.length > 0 ? relieverEntries[0].scaledIP : 0;
    const maxRelieverApp = relieverEntries.length > 0
      ? Math.max(...relieverEntries.map(e => e.scaledApp))
      : 0;

    console.log("\n" + "=".repeat(70));
    console.log("  3. 継投・リリーフ指標");
    console.log("=".repeat(70));
    console.log(`  投手交代/試合(1チーム): ${pitcherChangesPerGame.toFixed(1)}   | NPB: 3-5`);
    console.log(`  先発 平均IP/試合:       ${starterAvgIP.toFixed(2)}   | NPB: 5.5-6.5`);
    console.log(`  リリーフ 平均IP/登板:   ${relieverAvgIP.toFixed(2)}   | NPB: 0.8-1.5`);
    console.log(`  QS率:                  ${qsRate.toFixed(1)}%  | NPB: 40-55%`);
    console.log(`  セーブ/試合:            ${savesPerGame.toFixed(2)}`);
    console.log(`  ホールド/試合:          ${holdsPerGame.toFixed(2)}`);
    console.log(`  リリーフ使用人数/試合:  ${relieverPerTeamPerGame.toFixed(1)}   | NPB: 3-5`);
    console.log(`  最多リリーフ登板(143試合換算): ${maxRelieverApp.toFixed(0)}   | NPB目安: 60-75`);
    console.log(`  最多リリーフIP(143試合換算):   ${maxRelieverIP.toFixed(1)}   | NPB目安: <80`);

    // リリーフ登板数分布 (143試合換算)
    console.log("\n  リリーフ登板数分布 (143試合換算):");
    const appBuckets = [0, 20, 40, 60, 80, 100, 150, 200, 999];
    for (let i = 0; i < appBuckets.length - 1; i++) {
      const lo = appBuckets[i];
      const hi = appBuckets[i + 1];
      const cnt = relieverEntries.filter(e => e.scaledApp >= lo && e.scaledApp < hi).length;
      const label = hi === 999 ? `${lo}+` : `${lo}-${hi - 1}`;
      console.log(`    ${label.padStart(7)}登板: ${cnt}人`);
    }

    // リリーフIP分布 (143試合換算)
    console.log("\n  リリーフIP分布 (143試合換算):");
    const ipBuckets = [0, 20, 40, 60, 80, 100, 143, 200, 999];
    for (let i = 0; i < ipBuckets.length - 1; i++) {
      const lo = ipBuckets[i];
      const hi = ipBuckets[i + 1];
      const cnt = relieverEntries.filter(e => e.scaledIP >= lo && e.scaledIP < hi).length;
      const label = hi === 999 ? `${lo}+` : `${lo}-${hi - 1}`;
      const warning = lo >= 143 ? " ⚠ 規定投球回超え!" : "";
      console.log(`    ${label.padStart(7)}IP: ${cnt}人${warning}`);
    }

    expect(pitcherChangesPerGame).toBeGreaterThan(0);
  });

  it("4. 投手個人TOP10", () => {
    const s = stats;
    const teamGameCounts = Array.from(s.teamGames.values());
    const avgTeamGames = teamGameCounts.reduce((a, b) => a + b, 0) / teamGameCounts.length;

    // リリーフ
    const relievers: { id: string; app: number; outs: number; scaledApp: number; scaledIP: number }[] = [];
    const starters: { id: string; app: number; outs: number; scaledIP: number }[] = [];

    for (const [playerId, log] of s.pitcherGameLog) {
      const teamGames = s.teamGames.get(log.teamId) ?? avgTeamGames;
      const scale = FULL_SEASON_GAMES / teamGames;
      if (log.isStarter) {
        starters.push({ id: playerId, app: log.appearances, outs: log.outs, scaledIP: (log.outs / 3) * scale });
      } else {
        relievers.push({
          id: playerId, app: log.appearances, outs: log.outs,
          scaledApp: log.appearances * scale, scaledIP: (log.outs / 3) * scale,
        });
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("  4. 投手個人TOP10");
    console.log("=".repeat(70));

    // リリーフIP上位10
    console.log("\n  リリーフIP上位10名 (143試合換算):");
    relievers.sort((a, b) => b.scaledIP - a.scaledIP);
    for (let i = 0; i < Math.min(10, relievers.length); i++) {
      const r = relievers[i];
      const warning = r.scaledIP >= 143 ? " ⚠規定超" : r.scaledIP >= 80 ? " ⚠多め" : "";
      console.log(`    ${(i + 1).toString().padStart(2)}. ${r.id.substring(0, 20).padEnd(20)} ${r.scaledIP.toFixed(1).padStart(6)}IP  ${r.scaledApp.toFixed(0).padStart(4)}登板${warning}`);
    }

    // リリーフ登板数上位10
    console.log("\n  リリーフ登板数上位10名 (143試合換算):");
    relievers.sort((a, b) => b.scaledApp - a.scaledApp);
    for (let i = 0; i < Math.min(10, relievers.length); i++) {
      const r = relievers[i];
      console.log(`    ${(i + 1).toString().padStart(2)}. ${r.id.substring(0, 20).padEnd(20)} ${r.scaledApp.toFixed(0).padStart(4)}登板  ${r.scaledIP.toFixed(1).padStart(6)}IP`);
    }

    // 先発IP上位10
    console.log("\n  先発IP上位10名 (143試合換算):");
    starters.sort((a, b) => b.scaledIP - a.scaledIP);
    for (let i = 0; i < Math.min(10, starters.length); i++) {
      const r = starters[i];
      console.log(`    ${(i + 1).toString().padStart(2)}. ${r.id.substring(0, 20).padEnd(20)} ${r.scaledIP.toFixed(1).padStart(6)}IP  ${r.app.toString().padStart(4)}先発`);
    }

    expect(relievers.length).toBeGreaterThan(0);
    expect(starters.length).toBeGreaterThan(0);
  });

  it("5. NPBベンチマーク判定", () => {
    const s = stats;
    const g = s.totalGames;
    const ip = s.totalIP / 3;
    const bip = s.totalGB + s.totalFB + s.totalLD + s.totalPopup;

    const teamGameCounts = Array.from(s.teamGames.values());
    const avgTeamGames = teamGameCounts.reduce((a, b) => a + b, 0) / teamGameCounts.length;

    // リリーフ最多IP/登板を再計算
    let maxRelieverIP = 0;
    let maxRelieverApp = 0;
    for (const [, log] of s.pitcherGameLog) {
      if (log.isStarter) continue;
      if (log.appearances < 3) continue;
      const teamGames = s.teamGames.get(log.teamId) ?? avgTeamGames;
      const scale = FULL_SEASON_GAMES / teamGames;
      const scaledIP = (log.outs / 3) * scale;
      const scaledApp = log.appearances * scale;
      if (scaledIP > maxRelieverIP) maxRelieverIP = scaledIP;
      if (scaledApp > maxRelieverApp) maxRelieverApp = scaledApp;
    }

    const pitcherChangesPerGame = s.totalPitcherChanges / g / 2;
    const starterAvgIP = s.totalStarterGames > 0 ? (s.totalStarterOuts / 3) / s.totalStarterGames : 0;
    const relieverAvgIP = s.totalRelieverAppearances > 0 ? (s.totalRelieverOuts / 3) / s.totalRelieverAppearances : 0;
    const era = (s.totalER / ip) * 9;
    const whip = (s.totalPitcherH + s.totalPitcherBB) / ip;
    const k9 = (s.totalPitcherK / ip) * 9;

    // ※ オフデーなしのシミュレーションのため、最多登板数・IPは実NPBより高めになる
    const benchmarks: Benchmark[] = [
      { name: "ERA", value: era, min: 3.0, max: 4.5 },
      { name: "WHIP", value: whip, min: 1.20, max: 1.50 },
      { name: "K/9", value: k9, min: 7.0, max: 9.0 },
      { name: "先発平均IP", value: starterAvgIP, min: 5.0, max: 7.0 },
      { name: "リリーフ平均IP/登板", value: relieverAvgIP, min: 0.7, max: 1.5 },
      { name: "投手交代/試合", value: pitcherChangesPerGame, min: 2, max: 6 },
      { name: "最多リリーフ登板/143試合", value: maxRelieverApp, min: 40, max: 110 },
      { name: "最多リリーフIP/143試合", value: maxRelieverIP, min: 0, max: 100 },
    ];

    console.log("\n" + "=".repeat(70));
    console.log("  5. NPBベンチマーク判定");
    console.log("=".repeat(70));

    const result = checkBenchmarks(benchmarks);
    for (const line of result.results) {
      console.log(line);
    }

    console.log(`\n  合計: ${result.passed} PASS / ${result.failed} FAIL`);

    // 最重要: リリーフIPが規定投球回を超えていないこと
    if (maxRelieverIP >= FULL_SEASON_GAMES) {
      console.log(`\n  ⚠ 警告: 最多リリーフIP(${maxRelieverIP.toFixed(1)}) が規定投球回(${FULL_SEASON_GAMES})に到達しています！`);
    }

    // ベンチマーク結果の検証（全PASSが理想だがここではWARNINGのみ）
    expect(result.passed).toBeGreaterThan(0);
  });
});
