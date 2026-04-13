#!/usr/bin/env tsx
// v2エンジン: 4シーズンシミュレーション
// 先発6人ローテ + 中継ぎ7人体制、3連投なしの運用で指標検証

import { resolvePlateAppearance, type PAContext, type RunnerState, type PAResult, type BattedBallType } from "../src/engine/v2/outcome-resolver";
import { advanceRunners, getOutsFromResult, HIT_RESULTS, AB_RESULTS, type BaseRunners } from "../src/engine/v2/simulation-v2";
import { generateRoster } from "../src/engine/player-generator";
import { TEAM_TEMPLATES } from "../src/data/teams";
import type { Team, RosterLevel } from "../src/models/team";
import type { Player } from "../src/models/player";

// ============================================================
// 投手運用
// ============================================================

interface PitchingStaff {
  starters: Player[];       // 6人ローテ
  relievers: Player[];      // 7人 (セットアップ3 + 中継ぎ4)
  closer: Player;           // 守護神
  starterIndex: number;     // 次の先発
  /** 連投日数 (playerId → 連投数) */
  consecutiveDays: Map<string, number>;
}

function buildPitchingStaff(roster: Player[]): PitchingStaff {
  const pitchers = roster.filter(p => p.isPitcher && p.pitching).sort((a, b) => {
    const sa = (a.pitching?.stamina ?? 0) * 2 + (a.pitching?.control ?? 0);
    const sb = (b.pitching?.stamina ?? 0) * 2 + (b.pitching?.control ?? 0);
    return sb - sa;
  });
  const starters = pitchers.slice(0, 6);
  const reliefPool = pitchers.slice(6).sort((a, b) => {
    const sa = (a.pitching?.velocity ?? 0) + (a.pitching?.control ?? 0);
    const sb = (b.pitching?.velocity ?? 0) + (b.pitching?.control ?? 0);
    return sb - sa;
  });
  const closer = reliefPool[0] ?? starters[5];
  const relievers = reliefPool.slice(1, 8);

  return { starters, relievers, closer, starterIndex: 0, consecutiveDays: new Map() };
}

function getStarterForGame(staff: PitchingStaff): Player {
  const p = staff.starters[staff.starterIndex % staff.starters.length];
  staff.starterIndex++;
  return p;
}

function getAvailableReliever(staff: PitchingStaff, usedIds: Set<string>): Player | null {
  for (const r of staff.relievers) {
    if (usedIds.has(r.id)) continue;
    const consec = staff.consecutiveDays.get(r.id) ?? 0;
    if (consec >= 2) continue; // 3連投防止
    return r;
  }
  // フォールバック: 連投制限を無視して未使用の投手
  for (const r of staff.relievers) {
    if (!usedIds.has(r.id)) return r;
  }
  return null;
}

function getCloser(staff: PitchingStaff, usedIds: Set<string>): Player | null {
  if (usedIds.has(staff.closer.id)) return null;
  const consec = staff.consecutiveDays.get(staff.closer.id) ?? 0;
  if (consec >= 2) return null;
  return staff.closer;
}

function advanceDay(staff: PitchingStaff, usedToday: Set<string>): void {
  for (const [id, days] of staff.consecutiveDays) {
    if (!usedToday.has(id)) {
      staff.consecutiveDays.delete(id);
    }
  }
  for (const id of usedToday) {
    staff.consecutiveDays.set(id, (staff.consecutiveDays.get(id) ?? 0) + 1);
  }
}

// ============================================================
// 1試合シミュレーション（投手運用込み）
// ============================================================

interface GameLog {
  homeScore: number; awayScore: number;
  // 打者・投手成績はIDでマップ
  batterPA: Map<string, BatterGameLog>;
  pitcherLog: Map<string, PitcherGameLog>;
}
interface BatterGameLog {
  pa: number; ab: number; hits: number; doubles: number; triples: number; hr: number;
  bb: number; k: number; hbp: number; sf: number; dp: number;
}
interface PitcherGameLog {
  isStarter: boolean; outs: number; hits: number; er: number;
  bb: number; k: number; hrAllowed: number; hbp: number;
  gb: number; fb: number; ld: number; pu: number;
}

function emptyBatterLog(): BatterGameLog {
  return { pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, hbp: 0, sf: 0, dp: 0 };
}
function emptyPitcherLog(starter: boolean): PitcherGameLog {
  return { isStarter: starter, outs: 0, hits: 0, er: 0, bb: 0, k: 0, hrAllowed: 0, hbp: 0, gb: 0, fb: 0, ld: 0, pu: 0 };
}


function simulateGame(
  homeBatters: Player[], homeStaff: PitchingStaff,
  awayBatters: Player[], awayStaff: PitchingStaff,
): GameLog {
  const log: GameLog = { homeScore: 0, awayScore: 0, batterPA: new Map(), pitcherLog: new Map() };
  const homeUsedPitchers = new Set<string>();
  const awayUsedPitchers = new Set<string>();

  // 先発
  const homeStarter = getStarterForGame(homeStaff);
  const awayStarter = getStarterForGame(awayStaff);
  log.pitcherLog.set(homeStarter.id, emptyPitcherLog(true));
  log.pitcherLog.set(awayStarter.id, emptyPitcherLog(true));
  homeUsedPitchers.add(homeStarter.id);
  awayUsedPitchers.add(awayStarter.id);

  let homePitcher = homeStarter;
  let awayPitcher = awayStarter;
  let homeBatIdx = 0, awayBatIdx = 0;

  for (let inning = 1; inning <= 12; inning++) {
    // === 表（アウェイ攻撃） ===
    // 7回以降: 投手交代判定（ホーム投手側）
    if (inning === 7) {
      const r = getAvailableReliever(homeStaff, homeUsedPitchers);
      if (r) { homePitcher = r; homeUsedPitchers.add(r.id); log.pitcherLog.set(r.id, emptyPitcherLog(false)); }
    } else if (inning === 8) {
      const r = getAvailableReliever(homeStaff, homeUsedPitchers);
      if (r) { homePitcher = r; homeUsedPitchers.add(r.id); log.pitcherLog.set(r.id, emptyPitcherLog(false)); }
    } else if (inning === 9) {
      const c = getCloser(homeStaff, homeUsedPitchers);
      if (c) { homePitcher = c; homeUsedPitchers.add(c.id); log.pitcherLog.set(c.id, emptyPitcherLog(false)); }
      else {
        const r = getAvailableReliever(homeStaff, homeUsedPitchers);
        if (r) { homePitcher = r; homeUsedPitchers.add(r.id); log.pitcherLog.set(r.id, emptyPitcherLog(false)); }
      }
    }

    let outs = 0;
    let runners: BaseRunners = { first: null, second: null, third: null };
    let inningRuns = 0;
    while (outs < 3) {
      const batter = awayBatters[awayBatIdx % awayBatters.length];
      awayBatIdx++;
      const rs: RunnerState = { first: !!runners.first, second: !!runners.second, third: !!runners.third };
      const outcome = resolvePlateAppearance({ batter, pitcher: homePitcher, runners: rs, outs, teamFielding: 50 });

      // 記録
      if (!log.batterPA.has(batter.id)) log.batterPA.set(batter.id, emptyBatterLog());
      const bl = log.batterPA.get(batter.id)!;
      bl.pa++;
      if (AB_RESULTS.has(outcome.result)) bl.ab++;
      if (HIT_RESULTS.has(outcome.result)) bl.hits++;
      if (outcome.result === "double") bl.doubles++;
      if (outcome.result === "triple") bl.triples++;
      if (outcome.result === "homerun") bl.hr++;
      if (outcome.result === "walk") bl.bb++;
      if (outcome.result === "strikeout") bl.k++;
      if (outcome.result === "hit_by_pitch") bl.hbp++;
      if (outcome.result === "sac_fly") bl.sf++;
      if (outcome.result === "double_play") bl.dp++;

      const pl = log.pitcherLog.get(homePitcher.id)!;
      if (outcome.result === "strikeout") pl.k++;
      if (outcome.result === "walk") pl.bb++;
      if (outcome.result === "hit_by_pitch") pl.hbp++;
      if (outcome.result === "homerun") { pl.hrAllowed++; pl.hits++; }
      if (["single", "double", "triple", "infield_hit"].includes(outcome.result)) pl.hits++;
      if (outcome.battedBallType === "ground_ball") pl.gb++;
      if (outcome.battedBallType === "fly_ball") pl.fb++;
      if (outcome.battedBallType === "line_drive") pl.ld++;
      if (outcome.battedBallType === "popup") pl.pu++;

      const outsAdded = getOutsFromResult(outcome.result);
      outs += outsAdded;
      pl.outs += outsAdded;

      const adv = advanceRunners(runners, outcome.result, batter);
      runners = adv.newRunners;
      const scoredCount = adv.scored.length;
      inningRuns += scoredCount;
      if (scoredCount > 0 && outcome.result !== "error") pl.er += scoredCount;

      if (outs >= 3) break;
    }
    log.awayScore += inningRuns;

    // 9回裏以降サヨナラチェック
    if (inning >= 9 && log.homeScore > log.awayScore) break;

    // === 裏（ホーム攻撃） ===
    if (inning === 7) {
      const r = getAvailableReliever(awayStaff, awayUsedPitchers);
      if (r) { awayPitcher = r; awayUsedPitchers.add(r.id); log.pitcherLog.set(r.id, emptyPitcherLog(false)); }
    } else if (inning === 8) {
      const r = getAvailableReliever(awayStaff, awayUsedPitchers);
      if (r) { awayPitcher = r; awayUsedPitchers.add(r.id); log.pitcherLog.set(r.id, emptyPitcherLog(false)); }
    } else if (inning === 9) {
      const c = getCloser(awayStaff, awayUsedPitchers);
      if (c) { awayPitcher = c; awayUsedPitchers.add(c.id); log.pitcherLog.set(c.id, emptyPitcherLog(false)); }
      else {
        const r = getAvailableReliever(awayStaff, awayUsedPitchers);
        if (r) { awayPitcher = r; awayUsedPitchers.add(r.id); log.pitcherLog.set(r.id, emptyPitcherLog(false)); }
      }
    }

    outs = 0;
    runners = { first: null, second: null, third: null };
    inningRuns = 0;
    while (outs < 3) {
      const batter = homeBatters[homeBatIdx % homeBatters.length];
      homeBatIdx++;
      const rs: RunnerState = { first: !!runners.first, second: !!runners.second, third: !!runners.third };
      const outcome = resolvePlateAppearance({ batter, pitcher: awayPitcher, runners: rs, outs, teamFielding: 50 });

      if (!log.batterPA.has(batter.id)) log.batterPA.set(batter.id, emptyBatterLog());
      const bl = log.batterPA.get(batter.id)!;
      bl.pa++;
      if (AB_RESULTS.has(outcome.result)) bl.ab++;
      if (HIT_RESULTS.has(outcome.result)) bl.hits++;
      if (outcome.result === "double") bl.doubles++;
      if (outcome.result === "triple") bl.triples++;
      if (outcome.result === "homerun") bl.hr++;
      if (outcome.result === "walk") bl.bb++;
      if (outcome.result === "strikeout") bl.k++;
      if (outcome.result === "hit_by_pitch") bl.hbp++;
      if (outcome.result === "sac_fly") bl.sf++;
      if (outcome.result === "double_play") bl.dp++;

      const pl = log.pitcherLog.get(awayPitcher.id)!;
      if (outcome.result === "strikeout") pl.k++;
      if (outcome.result === "walk") pl.bb++;
      if (outcome.result === "hit_by_pitch") pl.hbp++;
      if (outcome.result === "homerun") { pl.hrAllowed++; pl.hits++; }
      if (["single", "double", "triple", "infield_hit"].includes(outcome.result)) pl.hits++;
      if (outcome.battedBallType === "ground_ball") pl.gb++;
      if (outcome.battedBallType === "fly_ball") pl.fb++;
      if (outcome.battedBallType === "line_drive") pl.ld++;
      if (outcome.battedBallType === "popup") pl.pu++;

      const outsAdded = getOutsFromResult(outcome.result);
      outs += outsAdded;
      pl.outs += outsAdded;

      const adv = advanceRunners(runners, outcome.result, batter);
      runners = adv.newRunners;
      const scoredCount = adv.scored.length;
      inningRuns += scoredCount;
      if (scoredCount > 0 && outcome.result !== "error") pl.er += scoredCount;

      if (outs >= 3) break;
      if (inning >= 9 && log.homeScore + inningRuns > log.awayScore) { outs = 3; break; } // サヨナラ
    }
    log.homeScore += inningRuns;
    if (inning >= 9 && log.homeScore > log.awayScore) break;
    if (inning >= 9 && log.homeScore !== log.awayScore) break;
  }

  // 連投管理
  advanceDay(homeStaff, homeUsedPitchers);
  advanceDay(awayStaff, awayUsedPitchers);

  return log;
}

// ============================================================
// チーム生成・スケジュール
// ============================================================

function createTeam(t: { id: string; name: string; shortName: string; color: string; homeBallpark: string }): Team {
  const roster = generateRoster(65);
  const rosterLevels: Record<string, RosterLevel> = {};
  roster.forEach(p => { rosterLevels[p.id] = "ichi_gun"; });
  return { id: t.id, name: t.name, shortName: t.shortName, color: t.color, roster, budget: 500000, fanBase: 60, homeBallpark: t.homeBallpark, rosterLevels };
}

function selectLineup(team: Team): Player[] {
  const batters = team.roster.filter(p => !p.isPitcher);
  batters.sort((a, b) => (b.batting.contact + b.batting.power + b.batting.speed) - (a.batting.contact + a.batting.power + a.batting.speed));
  return batters.slice(0, 9);
}

interface ScheduleGame { homeId: string; awayId: string; }

function generateSchedule(centralIds: string[], pacificIds: string[]): ScheduleGame[] {
  const games: ScheduleGame[] = [];
  for (const ids of [centralIds, pacificIds]) {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        for (let g = 0; g < 25; g++)
          games.push(g % 2 === 0 ? { homeId: ids[i], awayId: ids[j] } : { homeId: ids[j], awayId: ids[i] });
  }
  for (const c of centralIds) for (const p of pacificIds)
    for (let g = 0; g < 3; g++)
      games.push(g % 2 === 0 ? { homeId: c, awayId: p } : { homeId: p, awayId: c });
  for (let i = games.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [games[i], games[j]] = [games[j], games[i]]; }
  return games;
}

// ============================================================
// 集計
// ============================================================

interface SeasonBatter {
  id: string; name: string; teamName: string; pos: string;
  pa: number; ab: number; hits: number; doubles: number; triples: number; hr: number;
  bb: number; k: number; hbp: number; sf: number; dp: number;
}
interface SeasonPitcher {
  id: string; name: string; teamName: string;
  games: number; gs: number; outs: number;
  hits: number; er: number; bb: number; k: number; hrAllowed: number; hbp: number;
  gb: number; fb: number; ld: number; pu: number;
}

function fmt3(n: number) { return n.toFixed(3); }
function fmt2(n: number) { return n.toFixed(2); }
function padR(s: string, n: number) { return s.padEnd(n); }
function padL(s: string, n: number) { return s.padStart(n); }
function chk(v: number, lo: number, hi: number) { return v >= lo && v <= hi ? "✅" : "❌"; }

// ============================================================
// メイン
// ============================================================

function main() {
  const NUM_SEASONS = 4;
  const start = Date.now();
  console.log(`⚾ v2エンジン ${NUM_SEASONS}シーズンシミュレーション (12チーム×143試合/シーズン)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 全シーズン集計
  const allBatters: SeasonBatter[] = [];
  const allPitchers: SeasonPitcher[] = [];
  let totalGames = 0, totalRuns = 0;

  for (let season = 1; season <= NUM_SEASONS; season++) {
    const teams = new Map<string, Team>();
    const staffs = new Map<string, PitchingStaff>();
    const lineups = new Map<string, Player[]>();
    const centralIds: string[] = [], pacificIds: string[] = [];

    for (const t of TEAM_TEMPLATES) {
      const team = createTeam(t);
      teams.set(t.id, team);
      staffs.set(t.id, buildPitchingStaff(team.roster));
      lineups.set(t.id, selectLineup(team));
      if (t.league === "central") centralIds.push(t.id); else pacificIds.push(t.id);
    }

    const schedule = generateSchedule(centralIds, pacificIds);

    // シーズン中の選手成績
    const sbMap = new Map<string, SeasonBatter>();
    const spMap = new Map<string, SeasonPitcher>();

    for (const [id, team] of teams) {
      for (const p of team.roster) {
        if (!p.isPitcher) {
          sbMap.set(p.id, { id: p.id, name: p.name, teamName: team.shortName, pos: p.position,
            pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, hbp: 0, sf: 0, dp: 0 });
        } else {
          spMap.set(p.id, { id: p.id, name: p.name, teamName: team.shortName,
            games: 0, gs: 0, outs: 0, hits: 0, er: 0, bb: 0, k: 0, hrAllowed: 0, hbp: 0,
            gb: 0, fb: 0, ld: 0, pu: 0 });
        }
      }
    }

    for (const game of schedule) {
      const homeLineup = lineups.get(game.homeId)!;
      const awayLineup = lineups.get(game.awayId)!;
      const homeStaff = staffs.get(game.homeId)!;
      const awayStaff = staffs.get(game.awayId)!;

      const log = simulateGame(homeLineup, homeStaff, awayLineup, awayStaff);
      totalGames++;
      totalRuns += log.homeScore + log.awayScore;

      for (const [pid, bl] of log.batterPA) {
        const s = sbMap.get(pid);
        if (!s) continue;
        s.pa += bl.pa; s.ab += bl.ab; s.hits += bl.hits; s.doubles += bl.doubles;
        s.triples += bl.triples; s.hr += bl.hr; s.bb += bl.bb; s.k += bl.k;
        s.hbp += bl.hbp; s.sf += bl.sf; s.dp += bl.dp;
      }
      for (const [pid, pl] of log.pitcherLog) {
        const s = spMap.get(pid);
        if (!s) continue;
        s.games++; if (pl.isStarter) s.gs++;
        s.outs += pl.outs; s.hits += pl.hits; s.er += pl.er; s.bb += pl.bb;
        s.k += pl.k; s.hrAllowed += pl.hrAllowed; s.hbp += pl.hbp;
        s.gb += pl.gb; s.fb += pl.fb; s.ld += pl.ld; s.pu += pl.pu;
      }
    }

    allBatters.push(...sbMap.values());
    allPitchers.push(...spMap.values());

    process.stdout.write(`  シーズン${season}完了 (${schedule.length}試合)\n`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  全${totalGames}試合完了 (${elapsed}秒)\n`);

  // ============================================================
  // リーグ全体指標
  // ============================================================
  const qualified = allBatters.filter(b => b.pa >= 400);
  let tPA = 0, tAB = 0, tH = 0, tHR = 0, tK = 0, tBB = 0, tHBP = 0, tSF = 0, t2B = 0, t3B = 0;
  for (const b of allBatters.filter(b => b.pa > 0)) {
    tPA += b.pa; tAB += b.ab; tH += b.hits; tHR += b.hr; tK += b.k; tBB += b.bb;
    tHBP += b.hbp; tSF += b.sf; t2B += b.doubles; t3B += b.triples;
  }
  const t1B = tH - t2B - t3B - tHR;
  const lgAVG = tAB > 0 ? tH / tAB : 0;
  const lgOBP = tPA > 0 ? (tH + tBB + tHBP) / tPA : 0;
  const lgSLG = tAB > 0 ? (t1B + t2B * 2 + t3B * 3 + tHR * 4) / tAB : 0;
  const lgBABIP = (tAB - tK - tHR + tSF) > 0 ? (tH - tHR) / (tAB - tK - tHR + tSF) : 0;

  console.log("📊 リーグ全体指標 (4シーズン平均)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const rpg = totalRuns / totalGames;
  const hrpg = tHR / totalGames;
  console.log(`  打率 ${fmt3(lgAVG)}  OBP ${fmt3(lgOBP)}  SLG ${fmt3(lgSLG)}  OPS ${fmt3(lgOBP + lgSLG)}  BABIP ${fmt3(lgBABIP)}`);
  console.log(`  K% ${(tK / tPA * 100).toFixed(1)}%  BB% ${(tBB / tPA * 100).toFixed(1)}%  HR/試合 ${fmt2(hrpg)}  得点/チーム試合 ${fmt2(rpg / 2)}`);
  console.log("");

  // ============================================================
  // 打者分布
  // ============================================================
  const bStats = qualified.map(b => {
    const avg = b.ab > 0 ? b.hits / b.ab : 0;
    const s1 = b.hits - b.doubles - b.triples - b.hr;
    const obp = b.pa > 0 ? (b.hits + b.bb + b.hbp) / b.pa : 0;
    const slg = b.ab > 0 ? (s1 + b.doubles * 2 + b.triples * 3 + b.hr * 4) / b.ab : 0;
    const woba = b.pa > 0 ? (0.69 * b.bb + 0.72 * b.hbp + 0.87 * s1 + 1.27 * b.doubles + 1.62 * b.triples + 2.10 * b.hr) / b.pa : 0;
    return { ...b, avg, obp, slg, ops: obp + slg, iso: slg - avg, woba, singles: s1 };
  });

  console.log("📊 打撃タイトル (規定400PA以上, 4シーズン各上位)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log("\n  【首位打者 TOP10】");
  console.log("  選手名        チーム  打率    PA   AB    安打  2B  3B  HR  OBP    SLG    OPS    wOBA");
  [...bStats].sort((a, b) => b.avg - a.avg).slice(0, 10).forEach(b => {
    console.log(`  ${padR(b.name, 12)} ${padR(b.teamName, 6)} ${fmt3(b.avg)}  ${padL(String(b.pa), 4)} ${padL(String(b.ab), 4)}  ${padL(String(b.hits), 4)} ${padL(String(b.doubles), 3)} ${padL(String(b.triples), 3)} ${padL(String(b.hr), 3)}  ${fmt3(b.obp)}  ${fmt3(b.slg)}  ${fmt3(b.ops)}  ${fmt3(b.woba)}`);
  });

  console.log("\n  【本塁打王 TOP10】");
  console.log("  選手名        チーム  HR   打率    ISO    OPS    K%     BB%");
  [...bStats].sort((a, b) => b.hr - a.hr).slice(0, 10).forEach(b => {
    console.log(`  ${padR(b.name, 12)} ${padR(b.teamName, 6)} ${padL(String(b.hr), 3)}  ${fmt3(b.avg)}  ${fmt3(b.iso)}  ${fmt3(b.ops)}  ${(b.k / b.pa * 100).toFixed(1).padStart(5)}%  ${(b.bb / b.pa * 100).toFixed(1).padStart(5)}%`);
  });

  console.log("\n  【最高出塁率 TOP5】");
  console.log("  選手名        チーム  OBP    BB   K    BB/K   打率    wOBA");
  [...bStats].sort((a, b) => b.obp - a.obp).slice(0, 5).forEach(b => {
    const bbk = b.k > 0 ? (b.bb / b.k).toFixed(2) : "-.--";
    console.log(`  ${padR(b.name, 12)} ${padR(b.teamName, 6)} ${fmt3(b.obp)}  ${padL(String(b.bb), 3)}  ${padL(String(b.k), 3)}  ${padL(bbk, 5)}  ${fmt3(b.avg)}  ${fmt3(b.woba)}`);
  });

  // 打者成績分布
  console.log("\n  【打者成績分布 (規定打席到達者)】");
  const avgBins = [0.300, 0.280, 0.260, 0.240, 0.220, 0.200, 0];
  console.log("  打率帯      人数   平均HR  平均OPS  平均K%   平均BB%");
  for (let i = 0; i < avgBins.length - 1; i++) {
    const hi = avgBins[i], lo = avgBins[i + 1];
    const inBin = bStats.filter(b => b.avg >= lo && b.avg < (i === 0 ? 1 : avgBins[i - 1]));
    // fix: use proper range
    const bin = bStats.filter(b => b.avg >= lo && (i === 0 ? b.avg >= hi : b.avg < hi));
    const actual = i === 0
      ? bStats.filter(b => b.avg >= hi)
      : bStats.filter(b => b.avg >= lo && b.avg < hi);
    if (actual.length === 0) continue;
    const avgHR = actual.reduce((s, b) => s + b.hr, 0) / actual.length;
    const avgOPS = actual.reduce((s, b) => s + b.ops, 0) / actual.length;
    const avgK = actual.reduce((s, b) => s + b.k / b.pa * 100, 0) / actual.length;
    const avgBB = actual.reduce((s, b) => s + b.bb / b.pa * 100, 0) / actual.length;
    const label = i === 0 ? `.300+  ` : `.${(lo * 1000).toFixed(0)}-.${((hi) * 1000).toFixed(0)}`;
    console.log(`  ${padR(label, 12)} ${padL(String(actual.length), 4)}  ${padL(fmt2(avgHR), 6)}  ${padL(fmt3(avgOPS), 6)}  ${padL(fmt2(avgK), 6)}%  ${padL(fmt2(avgBB), 6)}%`);
  }

  // PA/AB分析
  console.log("\n  【打席数分析 (NPB実データとの比較)】");
  const paValues = bStats.map(b => b.pa).sort((a, b) => b - a);
  const abValues = bStats.map(b => b.ab).sort((a, b) => b - a);
  const hitValues = bStats.map(b => b.hits).sort((a, b) => b - a);
  const paPerGame = bStats.length > 0 ? bStats.reduce((s, b) => s + b.pa, 0) / bStats.length / 143 : 0;
  const maxPA = paValues[0] ?? 0;
  const avgPA = bStats.reduce((s, b) => s + b.pa, 0) / bStats.length;
  const maxAB = abValues[0] ?? 0;
  const maxHits = hitValues[0] ?? 0;

  console.log("                  シミュ結果    NPB実データ(2019-2023)    判定");
  console.log("  ──────────────────────────────────────────────────────────────");
  console.log(`  最多PA          ${padL(String(maxPA), 4)}          650-680               ${chk(maxPA, 600, 700) }`);
  console.log(`  規定到達者平均PA ${padL(String(Math.round(avgPA)), 4)}          520-570               ${chk(avgPA, 480, 610)}`);
  console.log(`  PA/試合/人      ${padL(paPerGame.toFixed(2), 5)}         3.8-4.2               ${chk(paPerGame, 3.6, 4.4)}`);
  console.log(`  最多AB          ${padL(String(maxAB), 4)}          560-610               ${chk(maxAB, 520, 650)}`);
  console.log(`  最多安打        ${padL(String(maxHits), 4)}          165-185 (歴代最多210)   ${chk(maxHits, 155, 210)}`);

  // ============================================================
  // 投手分布
  // ============================================================
  const starters = allPitchers.filter(p => p.gs >= 15);
  const relievers = allPitchers.filter(p => p.gs < 5 && p.games >= 30);

  const pStats = (arr: SeasonPitcher[]) => arr.map(p => {
    const ip = p.outs / 3;
    const era = ip > 0 ? p.er / ip * 9 : 99;
    const k9 = ip > 0 ? p.k / ip * 9 : 0;
    const bb9 = ip > 0 ? p.bb / ip * 9 : 0;
    const h9 = ip > 0 ? p.hits / ip * 9 : 0;
    const hr9 = ip > 0 ? p.hrAllowed / ip * 9 : 0;
    const whip = ip > 0 ? (p.hits + p.bb) / ip : 99;
    const fip = ip > 0 ? (13 * p.hrAllowed + 3 * (p.bb + p.hbp) - 2 * p.k) / ip + 3.20 : 99;
    const kbb = p.bb > 0 ? p.k / p.bb : 0;
    const ipStr = `${Math.floor(ip)}.${p.outs % 3}`;
    const totalBip = p.gb + p.fb + p.ld + p.pu;
    const gbRate = totalBip > 0 ? p.gb / totalBip * 100 : 0;
    return { ...p, ip, era, k9, bb9, h9, hr9, whip, fip, kbb, ipStr, gbRate };
  });

  const starterStats = pStats(starters);
  const reliefStats = pStats(relievers);

  console.log("\n\n📊 投手成績 (先発15登板以上 / リリーフ30登板以上)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log("\n  【先発防御率 TOP10】");
  console.log("  選手名        チーム  ERA    IP     K/9   BB/9  HR/9  WHIP   FIP    GB%");
  [...starterStats].sort((a, b) => a.era - b.era).slice(0, 10).forEach(p => {
    console.log(`  ${padR(p.name, 12)} ${padR(p.teamName, 6)} ${padL(fmt2(p.era), 5)}  ${padL(p.ipStr, 6)}  ${padL(fmt2(p.k9), 5)} ${padL(fmt2(p.bb9), 5)} ${padL(fmt2(p.hr9), 5)}  ${padL(fmt2(p.whip), 5)}  ${padL(fmt2(p.fip), 5)}  ${padL(fmt2(p.gbRate), 5)}%`);
  });

  console.log("\n  【先発奪三振 TOP5】");
  console.log("  選手名        チーム  奪三振  IP     K/9   K/BB");
  [...starterStats].sort((a, b) => b.k - a.k).slice(0, 5).forEach(p => {
    console.log(`  ${padR(p.name, 12)} ${padR(p.teamName, 6)} ${padL(String(p.k), 4)}  ${padL(p.ipStr, 6)}  ${padL(fmt2(p.k9), 5)} ${padL(fmt2(p.kbb), 5)}`);
  });

  if (reliefStats.length > 0) {
    console.log("\n  【リリーフ防御率 TOP10】");
    console.log("  選手名        チーム  ERA    登板  IP     K/9   WHIP   FIP");
    [...reliefStats].sort((a, b) => a.era - b.era).slice(0, 10).forEach(p => {
      console.log(`  ${padR(p.name, 12)} ${padR(p.teamName, 6)} ${padL(fmt2(p.era), 5)}  ${padL(String(p.games), 3)}  ${padL(p.ipStr, 6)}  ${padL(fmt2(p.k9), 5)}  ${padL(fmt2(p.whip), 5)}  ${padL(fmt2(p.fip), 5)}`);
    });
  }

  // 先発成績分布
  console.log("\n  【先発成績分布】");
  const eraBins = [[0, 3], [3, 4], [4, 5], [5, 6], [6, 99]];
  console.log("  ERA帯     人数  平均IP   平均K/9  平均WHIP  平均FIP");
  for (const [lo, hi] of eraBins) {
    const bin = starterStats.filter(p => p.era >= lo && p.era < hi);
    if (bin.length === 0) continue;
    const avgIP = bin.reduce((s, p) => s + p.ip, 0) / bin.length;
    const avgK9 = bin.reduce((s, p) => s + p.k9, 0) / bin.length;
    const avgWHIP = bin.reduce((s, p) => s + p.whip, 0) / bin.length;
    const avgFIP = bin.reduce((s, p) => s + p.fip, 0) / bin.length;
    console.log(`  ${lo}.00-${hi === 99 ? "∞  " : hi + ".00"} ${padL(String(bin.length), 4)}  ${padL(fmt2(avgIP), 6)}  ${padL(fmt2(avgK9), 6)}   ${padL(fmt2(avgWHIP), 6)}   ${padL(fmt2(avgFIP), 6)}`);
  }

  // ============================================================
  // NPBベンチマーク
  // ============================================================
  const topAVG = [...bStats].sort((a, b) => b.avg - a.avg)[0];
  const topHR = [...bStats].sort((a, b) => b.hr - a.hr)[0];
  const topHits = [...bStats].sort((a, b) => b.hits - a.hits)[0];
  const topERA = [...starterStats].sort((a, b) => a.era - b.era)[0];
  const topKP = [...starterStats].sort((a, b) => b.k - a.k)[0];

  console.log("\n\n📊 NPBベンチマーク比較");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  // chkはトップレベルで定義済み
  console.log("  指標               シミュ結果     NPB参考       判定");
  console.log("  ──────────────────────────────────────────────────────");
  console.log(`  リーグ打率         ${fmt3(lgAVG)}          .255-.265     ${chk(lgAVG, 0.240, 0.280)}`);
  console.log(`  リーグOPS          ${fmt3(lgOBP + lgSLG)}          .710-.745     ${chk(lgOBP + lgSLG, 0.680, 0.780)}`);
  console.log(`  K%                 ${(tK / tPA * 100).toFixed(1)}%         18-22%        ${chk(tK / tPA * 100, 14, 26)}`);
  console.log(`  BB%                ${(tBB / tPA * 100).toFixed(1)}%         7-10%         ${chk(tBB / tPA * 100, 6, 12)}`);
  console.log(`  BABIP              ${fmt3(lgBABIP)}          .290-.310     ${chk(lgBABIP, 0.280, 0.320)}`);
  console.log(`  得点/チーム試合    ${fmt2(rpg / 2)}           3.5-4.5       ${chk(rpg / 2, 3.0, 5.0)}`);
  console.log(`  HR/試合(両チーム)  ${fmt2(hrpg)}           1.0-1.5       ${chk(hrpg, 0.8, 2.0)}`);
  console.log(`  首位打者           ${fmt3(topAVG?.avg ?? 0)}          .330-.350     ${chk(topAVG?.avg ?? 0, 0.320, 0.360)}`);
  console.log(`  本塁打王           ${topHR?.hr ?? 0}本            35-45本       ${chk(topHR?.hr ?? 0, 30, 50)}`);
  console.log(`  最多安打           ${topHits?.hits ?? 0}本           170-190本     ${chk(topHits?.hits ?? 0, 160, 200)}`);
  console.log(`  最優秀防御率       ${fmt2(topERA?.era ?? 99)}           2.00-2.50     ${chk(topERA?.era ?? 99, 1.50, 3.00)}`);
  console.log(`  最多奪三振(先発)   ${topKP?.k ?? 0}個           170-220個     ${chk(topKP?.k ?? 0, 150, 240)}`);
  console.log(`  先発平均IP         ${fmt2((starterStats.reduce((s, p) => s + p.ip, 0) / starterStats.length) || 0)}          120-180回     ${chk(starterStats.reduce((s, p) => s + p.ip, 0) / starterStats.length, 100, 190)}`);
  console.log("");
}

main();
