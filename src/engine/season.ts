import type { Season, ScheduleEntry, League } from "@/models/league";
import type { TeamRecord } from "@/models/team";

/**
 * シーズン進行エンジン
 * NPB風143試合制スケジュール生成、シーズン進行、順位計算を行う
 */

/**
 * NPB風143試合制スケジュールを生成
 *
 * - 同リーグ戦: 各対戦25試合 (5対戦 × 25 = 125試合/チーム)
 * - 交流戦: 他リーグ6チームと各3試合 (6対戦 × 3 = 18試合/チーム)
 * - 合計: 143試合/チーム, 858試合エントリ, 143日 (1日6試合)
 *
 * 日程: リーグ戦前半(60日) → 交流戦(18日) → リーグ戦後半(65日)
 */
export function generateSchedule(leagues: League[]): ScheduleEntry[] {
  const centralLeague = leagues.find((l) => l.id === "central")!;
  const pacificLeague = leagues.find((l) => l.id === "pacific")!;

  // 同リーグ戦ラウンド生成 (各125ラウンド × 3試合/ラウンド)
  const centralRounds = generateLeagueRounds(centralLeague.teams, 25);
  const pacificRounds = generateLeagueRounds(pacificLeague.teams, 25);

  // 交流戦日程生成 (18日 × 6試合/日)
  const interleagueDays = generateInterleagueDays(
    centralLeague.teams,
    pacificLeague.teams,
    3
  );

  // 日程構成: リーグ戦前半(60日) → 交流戦(18日) → リーグ戦後半(65日)
  const FIRST_HALF = 60;
  const schedule: ScheduleEntry[] = [];

  // 前半リーグ戦
  for (let day = 0; day < FIRST_HALF; day++) {
    schedule.push(...centralRounds[day], ...pacificRounds[day]);
  }

  // 交流戦
  for (const dayGames of interleagueDays) {
    schedule.push(...dayGames);
  }

  // 後半リーグ戦
  for (let day = FIRST_HALF; day < centralRounds.length; day++) {
    schedule.push(...centralRounds[day], ...pacificRounds[day]);
  }

  return schedule;
}

/**
 * リーグ内ラウンドロビンの全ラウンドを生成 (ローテーションアルゴリズム)
 *
 * 6チームで1チーム固定、残り5チームを回転させて各ラウンド3ペアを生成。
 * 5ラウンドで1サイクル(全15ペア各1回)、gamesPerMatchupサイクル繰り返す。
 */
function generateLeagueRounds(
  teamIds: string[],
  gamesPerMatchup: number
): ScheduleEntry[][] {
  const roundsPerCycle = teamIds.length - 1; // 5
  const rounds: ScheduleEntry[][] = [];
  const matchupCount: Record<string, number> = {};

  const fixed = teamIds[0];
  const rotating = teamIds.slice(1);

  for (let cycle = 0; cycle < gamesPerMatchup; cycle++) {
    for (let round = 0; round < roundsPerCycle; round++) {
      const dayGames: ScheduleEntry[] = [];

      // ローテーション: round回右回転
      const offset = round % rotating.length;
      const circle =
        offset === 0
          ? [...rotating]
          : [
              ...rotating.slice(rotating.length - offset),
              ...rotating.slice(0, rotating.length - offset),
            ];

      // ペアリング: fixed vs circle[last], circle[0] vs circle[last-1], ...
      const pairs: [string, string][] = [];
      pairs.push([fixed, circle[circle.length - 1]]);
      for (let k = 0; k < Math.floor(circle.length / 2); k++) {
        pairs.push([circle[k], circle[circle.length - 2 - k]]);
      }

      for (const [a, b] of pairs) {
        const key = [a, b].sort().join("-");
        const count = matchupCount[key] || 0;
        // H/Aを交互に割り当て
        const [home, away] = count % 2 === 0 ? [a, b] : [b, a];
        dayGames.push({
          id: crypto.randomUUID(),
          homeTeamId: home,
          awayTeamId: away,
          result: null,
        });
        matchupCount[key] = count + 1;
      }

      rounds.push(dayGames);
    }
  }

  return rounds;
}

/**
 * 交流戦日程を生成 (Latin square方式)
 *
 * 6×6の組み合わせを1日6試合(各チーム1試合)で消化。
 * 6日で全36マッチアップを1巡、gamesPerMatchup巡で完了。
 */
function generateInterleagueDays(
  centralTeams: string[],
  pacificTeams: string[],
  gamesPerMatchup: number
): ScheduleEntry[][] {
  const n = centralTeams.length;
  const days: ScheduleEntry[][] = [];
  const matchupCount: Map<string, number> = new Map();

  for (let round = 0; round < gamesPerMatchup; round++) {
    for (let day = 0; day < n; day++) {
      const dayGames: ScheduleEntry[] = [];
      for (let i = 0; i < n; i++) {
        const cTeam = centralTeams[i];
        const pTeam = pacificTeams[(i + day + round * 2) % n];
        const key = `${cTeam}-${pTeam}`;
        const count = matchupCount.get(key) || 0;
        // H/Aを交互に割り当て
        const [home, away] = count % 2 === 0 ? [cTeam, pTeam] : [pTeam, cTeam];
        dayGames.push({
          id: crypto.randomUUID(),
          homeTeamId: home,
          awayTeamId: away,
          result: null,
        });
        matchupCount.set(key, count + 1);
      }
      days.push(dayGames);
    }
  }

  return days;
}

/** 初期順位表を生成 */
export function initStandings(
  teamIds: string[]
): Record<string, TeamRecord> {
  const standings: Record<string, TeamRecord> = {};
  for (const id of teamIds) {
    standings[id] = { teamId: id, wins: 0, losses: 0, draws: 0 };
  }
  return standings;
}

/** 順位表をソート (勝率順) */
export function sortStandings(
  standings: Record<string, TeamRecord>
): TeamRecord[] {
  return Object.values(standings).sort((a, b) => {
    const aTotal = a.wins + a.losses;
    const bTotal = b.wins + b.losses;
    const aPct = aTotal > 0 ? a.wins / aTotal : 0;
    const bPct = bTotal > 0 ? b.wins / bTotal : 0;
    return bPct - aPct;
  });
}

/** 新しいシーズンを生成 */
export function createSeason(year: number, leagues: League[]): Season {
  const allTeamIds = leagues.flatMap((l) => l.teams);
  return {
    year,
    leagues,
    standings: initStandings(allTeamIds),
    schedule: generateSchedule(leagues),
    currentGameIndex: 0,
    phase: "preseason",
  };
}
