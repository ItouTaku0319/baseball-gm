/**
 * 打撃バランス検証スクリプト
 * npx tsx scripts/test-balance.ts で実行
 */

import { simulateGame } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import { autoConfigureLineup, autoAssignRosterLevels } from "../src/engine/lineup";
import type { Team } from "../src/models/team";
import type { PlayerGameStats } from "../src/models/league";
import type { Player } from "../src/models/player";

// --- チーム生成 ---
function createTestTeam(id: string, name: string): Team {
  const roster = generateRoster(65);
  const team: Team = {
    id,
    name,
    shortName: name.slice(0, 2),
    color: "#2563EB",
    homeBallpark: "テスト球場",
    budget: 5000,
    fanBase: 60,
    roster,
  };
  const rosterLevels = autoAssignRosterLevels(team);
  const lineupConfig = autoConfigureLineup({ ...team, rosterLevels });
  return { ...team, rosterLevels, lineupConfig };
}

// --- 集計用の型 ---
interface TeamStats {
  pa: number;   // 打席数
  ab: number;   // 打数
  h: number;    // 安打
  hr: number;   // 本塁打
  r: number;    // 得点
  k: number;    // 三振
  bb: number;   // 四球
}

function emptyTeamStats(): TeamStats {
  return { pa: 0, ab: 0, h: 0, hr: 0, r: 0, k: 0, bb: 0 };
}

function addPlayerStats(total: TeamStats, ps: PlayerGameStats): void {
  total.ab += ps.atBats;
  total.h += ps.hits;
  total.hr += ps.homeRuns;
  total.r += ps.runs;
  total.k += ps.strikeouts;
  total.bb += ps.walks;
  // PA = AB + BB + HBP + SF
  total.pa += ps.atBats + ps.walks + (ps.hitByPitch ?? 0) + (ps.sacrificeFlies ?? 0);
}

// --- メイン処理 ---
const GAMES = 20;

const teamA = createTestTeam("team-a", "テストチームA");
const teamB = createTestTeam("team-b", "テストチームB");

const totalHome = emptyTeamStats();
const totalAway = emptyTeamStats();

// 選手別累積成績 (全試合)
const playerStatsMap = new Map<string, { name: string; r: number; hr: number }>();

// ロスターから選手名マップを作成
const playerNameMap = new Map<string, string>();
for (const p of [...teamA.roster, ...teamB.roster]) {
  playerNameMap.set(p.id, p.name);
}

for (let i = 0; i < GAMES; i++) {
  // ホーム/アウェイを交互に入れ替えて偏りをなくす
  const [home, away] = i % 2 === 0 ? [teamA, teamB] : [teamB, teamA];
  const result = simulateGame(home, away);

  // ホーム攻撃 = home側の打者成績
  for (const ps of result.playerStats) {
    // ホーム打者かアウェイ打者かはrosterで判定
    const isHome = home.roster.some((p: Player) => p.id === ps.playerId);
    const target = isHome ? totalHome : totalAway;
    addPlayerStats(target, ps);

    // 選手別累積
    const name = playerNameMap.get(ps.playerId) ?? ps.playerId;
    const existing = playerStatsMap.get(ps.playerId) ?? { name, r: 0, hr: 0 };
    existing.r += ps.runs;
    existing.hr += ps.homeRuns;
    playerStatsMap.set(ps.playerId, existing);
  }
}

// --- 両チーム合算 ---
const total: TeamStats = {
  pa: totalHome.pa + totalAway.pa,
  ab: totalHome.ab + totalAway.ab,
  h: totalHome.h + totalAway.h,
  hr: totalHome.hr + totalAway.hr,
  r: totalHome.r + totalAway.r,
  k: totalHome.k + totalAway.k,
  bb: totalHome.bb + totalAway.bb,
};

// --- 指標計算 ---
const avg = total.ab > 0 ? total.h / total.ab : 0;
const hrPerGame = total.hr / GAMES;
const rPerGame = total.r / GAMES;
const kPct = total.pa > 0 ? (total.k / total.pa) * 100 : 0;
const bbPct = total.pa > 0 ? (total.bb / total.pa) * 100 : 0;

// --- 出力 ---
console.log(`\n=== 打撃バランス検証 (${GAMES}試合) ===`);
console.log(`チーム打率  : .${avg.toFixed(3).slice(2)}`);
console.log(`HR/試合     : ${hrPerGame.toFixed(1)}`);
console.log(`R/試合      : ${rPerGame.toFixed(1)}`);
console.log(`K%          : ${kPct.toFixed(1)}%`);
console.log(`BB%         : ${bbPct.toFixed(1)}%`);
console.log(`R合計: ${total.r} vs HR合計: ${total.hr} → ${total.r > total.hr ? "OK (R > HR)" : "NG (R <= HR)"}`);

// 選手別 R vs HR 上位5人 (HR順)
const topPlayers = [...playerStatsMap.values()]
  .filter((p) => p.hr > 0 || p.r > 0)
  .sort((a, b) => b.hr - a.hr)
  .slice(0, 5);

console.log("\n選手別 R vs HR (HR上位5人):");
for (const p of topPlayers) {
  const ok = p.r >= p.hr;
  console.log(`  ${p.name.padEnd(10)} R=${String(p.r).padStart(3)}  HR=${String(p.hr).padStart(3)}  ${ok ? "OK (R >= HR)" : "NG (R < HR)"}`);
}

// --- 詳細内訳 ---
console.log("\n--- 詳細内訳 ---");
console.log(`打席(PA)    : ${total.pa}`);
console.log(`打数(AB)    : ${total.ab}`);
console.log(`安打(H)     : ${total.h}`);
console.log(`本塁打(HR)  : ${total.hr}`);
console.log(`得点(R)     : ${total.r}`);
console.log(`三振(K)     : ${total.k}`);
console.log(`四球(BB)    : ${total.bb}`);
console.log(`AB/試合     : ${(total.ab / GAMES).toFixed(1)}`);
