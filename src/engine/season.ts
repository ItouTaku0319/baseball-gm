import type { Season, ScheduleEntry, League } from "@/models/league";
import type { TeamRecord } from "@/models/team";

/**
 * シーズン進行エンジン
 * スケジュール生成、シーズン進行、順位計算を行う
 */

/** ラウンドロビン方式でスケジュールを生成 */
export function generateSchedule(
  leagues: League[],
  gamesPerMatchup: number = 24
): ScheduleEntry[] {
  const schedule: ScheduleEntry[] = [];
  const allTeams = leagues.flatMap((l) => l.teams);

  // 総当たり: 各チームペアごとに gamesPerMatchup 試合
  for (let i = 0; i < allTeams.length; i++) {
    for (let j = i + 1; j < allTeams.length; j++) {
      const half = Math.floor(gamesPerMatchup / 2);
      // ホーム/アウェイを半分ずつ
      for (let k = 0; k < half; k++) {
        schedule.push({
          id: crypto.randomUUID(),
          homeTeamId: allTeams[i],
          awayTeamId: allTeams[j],
          result: null,
        });
      }
      for (let k = 0; k < gamesPerMatchup - half; k++) {
        schedule.push({
          id: crypto.randomUUID(),
          homeTeamId: allTeams[j],
          awayTeamId: allTeams[i],
          result: null,
        });
      }
    }
  }

  // シャッフル
  for (let i = schedule.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [schedule[i], schedule[j]] = [schedule[j], schedule[i]];
  }

  return schedule;
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
export function createSeason(
  year: number,
  leagues: League[],
  gamesPerMatchup?: number
): Season {
  const allTeamIds = leagues.flatMap((l) => l.teams);
  return {
    year,
    leagues,
    standings: initStandings(allTeamIds),
    schedule: generateSchedule(leagues, gamesPerMatchup),
    currentGameIndex: 0,
    phase: "preseason",
  };
}
