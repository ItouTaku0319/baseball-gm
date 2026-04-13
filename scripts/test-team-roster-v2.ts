#!/usr/bin/env tsx
// 1チームの全選手成績一覧（1シーズン、能力値+成績）→ MDファイル出力

import { resolvePlateAppearance, type PAContext, type RunnerState, type PAResult } from "../src/engine/v2/outcome-resolver";
import { advanceRunners, getOutsFromResult, HIT_RESULTS, AB_RESULTS, type BaseRunners } from "../src/engine/v2/simulation-v2";
import { generateRoster } from "../src/engine/player-generator";
import { TEAM_TEMPLATES } from "../src/data/teams";
import type { Team, RosterLevel } from "../src/models/team";
import type { Player } from "../src/models/player";
import * as fs from "fs";

// ============================================================
// 投手運用
// ============================================================
interface PitchingStaff {
  starters: Player[]; relievers: Player[]; closer: Player;
  starterIndex: number; consecutiveDays: Map<string, number>;
}
function buildPitchingStaff(roster: Player[]): PitchingStaff {
  const pitchers = roster.filter(p => p.isPitcher && p.pitching).sort((a, b) =>
    ((b.pitching?.stamina ?? 0) * 2 + (b.pitching?.control ?? 0)) - ((a.pitching?.stamina ?? 0) * 2 + (a.pitching?.control ?? 0)));
  const starters = pitchers.slice(0, 6);
  const reliefPool = pitchers.slice(6).sort((a, b) =>
    ((b.pitching?.velocity ?? 0) + (b.pitching?.control ?? 0)) - ((a.pitching?.velocity ?? 0) + (a.pitching?.control ?? 0)));
  return { starters, relievers: reliefPool.slice(1, 8), closer: reliefPool[0] ?? starters[5], starterIndex: 0, consecutiveDays: new Map() };
}
function getStarterForGame(staff: PitchingStaff): Player { return staff.starters[staff.starterIndex++ % staff.starters.length]; }
function getAvailableReliever(staff: PitchingStaff, used: Set<string>): Player | null {
  for (const r of staff.relievers) { if (!used.has(r.id) && (staff.consecutiveDays.get(r.id) ?? 0) < 2) return r; }
  for (const r of staff.relievers) { if (!used.has(r.id)) return r; }
  return null;
}
function getCloser(staff: PitchingStaff, used: Set<string>): Player | null {
  if (used.has(staff.closer.id) || (staff.consecutiveDays.get(staff.closer.id) ?? 0) >= 2) return null;
  return staff.closer;
}
function advanceDay(staff: PitchingStaff, used: Set<string>): void {
  for (const [id] of staff.consecutiveDays) { if (!used.has(id)) staff.consecutiveDays.delete(id); }
  for (const id of used) { staff.consecutiveDays.set(id, (staff.consecutiveDays.get(id) ?? 0) + 1); }
}

// ============================================================
// 試合シミュレーション
// ============================================================
interface BLog { pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; k: number; hbp: number; sf: number; dp: number; }
interface PLog { g: number; gs: number; outs: number; h: number; er: number; bb: number; k: number; hra: number; hbp: number; }
function simHalfInning(batters: Player[], batIdx: { v: number }, pitcher: Player, bLog: Map<string, BLog>, pLog: Map<string, PLog>): number {
  let outs = 0, runs = 0;
  const rn: BaseRunners = { first: null, second: null, third: null };
  while (outs < 3) {
    const bat = batters[batIdx.v % batters.length]; batIdx.v++;
    const rs: RunnerState = { first: !!rn.first, second: !!rn.second, third: !!rn.third };
    const o = resolvePlateAppearance({ batter: bat, pitcher, runners: rs, outs, teamFielding: 50 });
    if (!bLog.has(bat.id)) bLog.set(bat.id, { pa:0,ab:0,h:0,d:0,t:0,hr:0,bb:0,k:0,hbp:0,sf:0,dp:0 });
    const bl = bLog.get(bat.id)!;
    bl.pa++; if (AB_RESULTS.has(o.result)) bl.ab++; if (HIT_RESULTS.has(o.result)) bl.h++;
    if (o.result==="double") bl.d++; if (o.result==="triple") bl.t++; if (o.result==="homerun") bl.hr++;
    if (o.result==="walk") bl.bb++; if (o.result==="strikeout") bl.k++; if (o.result==="hit_by_pitch") bl.hbp++;
    if (o.result==="sac_fly") bl.sf++; if (o.result==="double_play") bl.dp++;
    const pl = pLog.get(pitcher.id)!;
    if (o.result==="strikeout") pl.k++; if (o.result==="walk") pl.bb++; if (o.result==="hit_by_pitch") pl.hbp++;
    if (o.result==="homerun") { pl.hra++; pl.h++; }
    if (["single","double","triple","infield_hit"].includes(o.result)) pl.h++;
    const outsAdded = getOutsFromResult(o.result); outs += outsAdded; pl.outs += outsAdded;
    const adv = advanceRunners(rn, o.result, bat);
    Object.assign(rn, adv.newRunners); const scoredCount = adv.scored.length; runs += scoredCount;
    if (scoredCount > 0 && o.result !== "error") pl.er += scoredCount;
    if (outs >= 3) break;
  }
  return runs;
}

// ============================================================
// メイン
// ============================================================
function main() {
  const targetName = process.argv[2] ?? "東京";
  console.log("⚾ 1シーズンシミュレーション実行中...");

  const teams = new Map<string, Team>();
  const staffs = new Map<string, PitchingStaff>();
  const lineups = new Map<string, Player[]>();
  const cIds: string[] = [], pIds: string[] = [];

  for (const t of TEAM_TEMPLATES) {
    const roster = generateRoster(65);
    const rl: Record<string, RosterLevel> = {};
    roster.forEach(p => { rl[p.id] = "ichi_gun"; });
    const team: Team = { id: t.id, name: t.name, shortName: t.shortName, color: t.color, roster, budget: 500000, fanBase: 60, homeBallpark: t.homeBallpark, rosterLevels: rl };
    teams.set(t.id, team);
    staffs.set(t.id, buildPitchingStaff(team.roster));
    const batters = team.roster.filter(p => !p.isPitcher).sort((a, b) => (b.batting.contact+b.batting.power+b.batting.speed)-(a.batting.contact+a.batting.power+a.batting.speed));
    lineups.set(t.id, batters.slice(0, 9));
    if (t.league === "central") cIds.push(t.id); else pIds.push(t.id);
  }

  const games: { hId: string; aId: string }[] = [];
  for (const ids of [cIds, pIds]) for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) for (let g=0;g<25;g++) games.push(g%2===0?{hId:ids[i],aId:ids[j]}:{hId:ids[j],aId:ids[i]});
  for (const c of cIds) for (const p of pIds) for (let g=0;g<3;g++) games.push(g%2===0?{hId:c,aId:p}:{hId:p,aId:c});
  for (let i=games.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [games[i],games[j]]=[games[j],games[i]]; }

  const bStats = new Map<string, BLog>();
  const pStats = new Map<string, PLog>();
  for (const [,team] of teams) for (const p of team.roster) {
    if (p.isPitcher) pStats.set(p.id, { g:0,gs:0,outs:0,h:0,er:0,bb:0,k:0,hra:0,hbp:0 });
  }

  let wins = 0, losses = 0, draws = 0, rs = 0, ra = 0;
  const targetId = [...teams.entries()].find(([,t]) => t.shortName === targetName)?.[0] ?? cIds[0];

  for (const game of games) {
    const hLineup = lineups.get(game.hId)!;
    const aLineup = lineups.get(game.aId)!;
    const hStaff = staffs.get(game.hId)!;
    const aStaff = staffs.get(game.aId)!;
    const hStarter = getStarterForGame(hStaff);
    const aStarter = getStarterForGame(aStaff);
    const hUsed = new Set([hStarter.id]);
    const aUsed = new Set([aStarter.id]);
    if (!pStats.has(hStarter.id)) pStats.set(hStarter.id, {g:0,gs:0,outs:0,h:0,er:0,bb:0,k:0,hra:0,hbp:0});
    if (!pStats.has(aStarter.id)) pStats.set(aStarter.id, {g:0,gs:0,outs:0,h:0,er:0,bb:0,k:0,hra:0,hbp:0});
    pStats.get(hStarter.id)!.g++; pStats.get(hStarter.id)!.gs++;
    pStats.get(aStarter.id)!.g++; pStats.get(aStarter.id)!.gs++;
    let hP = hStarter, aP = aStarter;
    let homeScore = 0, awayScore = 0;
    const hBI = { v: 0 }, aBI = { v: 0 };
    for (let inn = 1; inn <= 12; inn++) {
      if (inn >= 7 && inn <= 9) {
        const nr = inn === 9 ? getCloser(hStaff, hUsed) : getAvailableReliever(hStaff, hUsed);
        if (nr) { hP = nr; hUsed.add(nr.id); if (!pStats.has(nr.id)) pStats.set(nr.id,{g:0,gs:0,outs:0,h:0,er:0,bb:0,k:0,hra:0,hbp:0}); pStats.get(nr.id)!.g++; }
      }
      awayScore += simHalfInning(aLineup, aBI, hP, bStats, pStats);
      if (inn >= 9 && homeScore > awayScore) break;
      if (inn >= 7 && inn <= 9) {
        const nr = inn === 9 ? getCloser(aStaff, aUsed) : getAvailableReliever(aStaff, aUsed);
        if (nr) { aP = nr; aUsed.add(nr.id); if (!pStats.has(nr.id)) pStats.set(nr.id,{g:0,gs:0,outs:0,h:0,er:0,bb:0,k:0,hra:0,hbp:0}); pStats.get(nr.id)!.g++; }
      }
      homeScore += simHalfInning(hLineup, hBI, aP, bStats, pStats);
      if (inn >= 9 && homeScore > awayScore) break;
      if (inn >= 9 && homeScore !== awayScore) break;
    }
    advanceDay(hStaff, hUsed); advanceDay(aStaff, aUsed);
    if (game.hId === targetId || game.aId === targetId) {
      const isHome = game.hId === targetId;
      const my = isHome ? homeScore : awayScore;
      const op = isHome ? awayScore : homeScore;
      if (my > op) wins++; else if (my < op) losses++; else draws++;
      rs += my; ra += op;
    }
  }

  // ============================================================
  // MD出力
  // ============================================================
  const targetTeam = teams.get(targetId)!;
  const staff = staffs.get(targetId)!;
  const lineup = lineups.get(targetId)!;
  const f3 = (n: number) => n.toFixed(3);
  const f2 = (n: number) => n.toFixed(2);

  const lines: string[] = [];
  const L = (s: string) => lines.push(s);

  L(`# ${targetTeam.name} ${new Date().getFullYear()}年シーズン成績`);
  L("");
  L(`**${wins}勝 ${losses}敗 ${draws}分** (勝率 .${((wins/(wins+losses||1))*1000).toFixed(0).padStart(3,"0")})`);
  L(`得点 ${rs} (${f2(rs/143)}/試合) / 失点 ${ra} (${f2(ra/143)}/試合)`);
  L("");

  // 野手
  L("## 野手成績");
  L("");
  L("### 能力値");
  L("");
  L("| # | 選手名 | Pos | 年齢 | ミート | パワー | 走力 | 選球眼 | 守備 | 肩 | 捕球 |");
  L("|--:|--------|:---:|-----:|-------:|-------:|-----:|-------:|-----:|---:|-----:|");
  lineup.forEach((p, i) => {
    const b = p.batting;
    L(`| ${i+1} | ${p.name} | ${p.position} | ${p.age} | ${b.contact} | ${b.power} | ${b.speed} | ${b.eye} | ${b.fielding} | ${b.arm} | ${b.catching} |`);
  });

  L("");
  L("### シーズン成績");
  L("");
  L("| # | 選手名 | 打率 | PA | AB | 安打 | 2B | 3B | HR | BB | K | OBP | SLG | OPS | ISO | K% | BB% |");
  L("|--:|--------|-----:|---:|---:|-----:|---:|---:|---:|---:|--:|----:|----:|----:|----:|---:|----:|");
  lineup.forEach((p, i) => {
    const b = bStats.get(p.id);
    if (!b || b.pa === 0) return;
    const avg = b.ab > 0 ? b.h / b.ab : 0;
    const s1 = b.h - b.d - b.t - b.hr;
    const obp = b.pa > 0 ? (b.h + b.bb + b.hbp) / b.pa : 0;
    const slg = b.ab > 0 ? (s1 + b.d*2 + b.t*3 + b.hr*4) / b.ab : 0;
    const kp = b.pa > 0 ? (b.k / b.pa * 100) : 0;
    const bp = b.pa > 0 ? (b.bb / b.pa * 100) : 0;
    L(`| ${i+1} | ${p.name} | ${f3(avg)} | ${b.pa} | ${b.ab} | ${b.h} | ${b.d} | ${b.t} | ${b.hr} | ${b.bb} | ${b.k} | ${f3(obp)} | ${f3(slg)} | ${f3(obp+slg)} | ${f3(slg-avg)} | ${kp.toFixed(1)}% | ${bp.toFixed(1)}% |`);
  });

  // 先発投手
  L("");
  L("## 先発投手成績");
  L("");
  L("### 能力値");
  L("");
  L("| 選手名 | 年齢 | 球速 | 制球 | スタミナ | 精神力 | 球種 |");
  L("|--------|-----:|-----:|-----:|--------:|-------:|------|");
  for (const p of staff.starters) {
    const pit = p.pitching!;
    const pitchNames: Record<string,string> = { slider:"スライダー",fork:"フォーク",curve:"カーブ",changeup:"チェンジアップ",sinker:"シンカー",shoot:"シュート",cutter:"カット",splitter:"スプリット",knuckle:"ナックル",screwball:"スクリュー" };
    const pitchStr = pit.pitches.map(pp => `${pitchNames[pp.type]??pp.type}${pp.level}`).join(", ");
    L(`| ${p.name} | ${p.age} | ${pit.velocity} | ${pit.control} | ${pit.stamina} | ${pit.mentalToughness} | ${pitchStr} |`);
  }

  L("");
  L("### シーズン成績");
  L("");
  L("| 選手名 | 登板 | 先発 | 投球回 | ERA | 被安 | 被HR | K | BB | K/9 | BB/9 | WHIP | FIP |");
  L("|--------|-----:|-----:|-------:|----:|-----:|-----:|--:|---:|----:|-----:|-----:|----:|");
  for (const p of staff.starters) {
    const s = pStats.get(p.id);
    if (!s) continue;
    const ip = s.outs / 3;
    const era = ip > 0 ? s.er / ip * 9 : 0;
    const k9 = ip > 0 ? s.k / ip * 9 : 0;
    const bb9 = ip > 0 ? s.bb / ip * 9 : 0;
    const whip = ip > 0 ? (s.h + s.bb) / ip : 0;
    const fip = ip > 0 ? (13*s.hra + 3*(s.bb+s.hbp) - 2*s.k) / ip + 3.20 : 0;
    const ipStr = `${Math.floor(ip)}.${s.outs % 3}`;
    L(`| ${p.name} | ${s.g} | ${s.gs} | ${ipStr} | ${f2(era)} | ${s.h} | ${s.hra} | ${s.k} | ${s.bb} | ${f2(k9)} | ${f2(bb9)} | ${f2(whip)} | ${f2(fip)} |`);
  }

  // リリーフ投手
  L("");
  L("## リリーフ投手成績");
  L("");
  L("### 能力値");
  L("");
  L("| 役割 | 選手名 | 年齢 | 球速 | 制球 | 精神力 | 球種 |");
  L("|------|--------|-----:|-----:|-----:|-------:|------|");
  const closerId = staff.closer.id;
  const allRelievers = [staff.closer, ...staff.relievers];
  for (const p of allRelievers) {
    if (!pStats.get(p.id) || pStats.get(p.id)!.g === 0) continue;
    const pit = p.pitching!;
    const pitchNames: Record<string,string> = { slider:"スライダー",fork:"フォーク",curve:"カーブ",changeup:"チェンジアップ",sinker:"シンカー",shoot:"シュート",cutter:"カット",splitter:"スプリット",knuckle:"ナックル",screwball:"スクリュー" };
    const pitchStr = pit.pitches.map(pp => `${pitchNames[pp.type]??pp.type}${pp.level}`).join(", ");
    const role = p.id === closerId ? "守護神" : "中継ぎ";
    L(`| ${role} | ${p.name} | ${p.age} | ${pit.velocity} | ${pit.control} | ${pit.mentalToughness} | ${pitchStr} |`);
  }

  L("");
  L("### シーズン成績");
  L("");
  L("| 役割 | 選手名 | 登板 | 投球回 | ERA | 被安 | 被HR | K | BB | K/9 | WHIP | FIP |");
  L("|------|--------|-----:|-------:|----:|-----:|-----:|--:|---:|----:|-----:|----:|");
  for (const p of allRelievers) {
    const s = pStats.get(p.id);
    if (!s || s.g === 0) continue;
    const pit = p.pitching!;
    const ip = s.outs / 3;
    const era = ip > 0 ? s.er / ip * 9 : 0;
    const k9 = ip > 0 ? s.k / ip * 9 : 0;
    const whip = ip > 0 ? (s.h + s.bb) / ip : 0;
    const fip = ip > 0 ? (13*s.hra + 3*(s.bb+s.hbp) - 2*s.k) / ip + 3.20 : 0;
    const ipStr = `${Math.floor(ip)}.${s.outs % 3}`;
    const role = p.id === closerId ? "守護神" : "中継ぎ";
    L(`| ${role} | ${p.name} | ${s.g} | ${ipStr} | ${f2(era)} | ${s.h} | ${s.hra} | ${s.k} | ${s.bb} | ${f2(k9)} | ${f2(whip)} | ${f2(fip)} |`);
  }

  L("");

  const outPath = "scripts/team-roster-result.md";
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`✅ ${outPath} に出力しました`);
  console.log(`   チーム: ${targetTeam.name} / ${wins}勝${losses}敗${draws}分`);
}

main();
