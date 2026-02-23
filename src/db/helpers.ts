import type { GameState } from "@/models/game-state";
import type { Season, ScheduleEntry } from "@/models/league";
import type { Team } from "@/models/team";
import type { AtBatLog } from "@/models/league";
import type { SaveCore, SaveTeamRecord, SaveScheduleDay, SaveAtBatLogRecord, SaveMeta } from "./database";

/** Season からスケジュールを除外したコアデータを抽出 */
function stripSchedule(season: Season) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { schedule, ...rest } = season;
  return rest;
}

/** GameState → SaveMeta */
export function extractMeta(game: GameState): SaveMeta {
  return {
    id: game.id,
    name: `シーズン ${game.currentSeason.year}`,
    myTeamId: game.myTeamId,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

/** GameState → SaveCore (teams, schedule除外) */
export function extractCore(game: GameState): SaveCore {
  return {
    id: game.id,
    myTeamId: game.myTeamId,
    currentSeason: stripSchedule(game.currentSeason),
    seasonHistory: game.seasonHistory.map(stripSchedule),
    offseasonState: game.offseasonState,
    awardsHistory: game.awardsHistory,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

/** GameState → SaveTeamRecord[] */
export function extractTeams(game: GameState): SaveTeamRecord[] {
  return Object.entries(game.teams).map(([teamId, team]) => ({
    id: `${game.id}:${teamId}`,
    gameId: game.id,
    teamId,
    data: team,
  }));
}

/**
 * スケジュールを日単位に分割
 * 1日6試合（セ3+パ3）なので、6エントリごとに1日
 */
export function extractScheduleDays(
  gameId: string,
  season: Season
): SaveScheduleDay[] {
  const GAMES_PER_DAY = 6;
  const days: SaveScheduleDay[] = [];
  for (let i = 0; i < season.schedule.length; i += GAMES_PER_DAY) {
    const dayIndex = Math.floor(i / GAMES_PER_DAY);
    const entries = season.schedule.slice(i, i + GAMES_PER_DAY);
    days.push({
      id: `${gameId}:${season.year}:${dayIndex}`,
      gameId,
      seasonYear: season.year,
      dayIndex,
      entries,
    });
  }
  return days;
}

/**
 * 変更があった日のみ抽出（差分更新用）
 * lastSavedGameIndex 以降にresultが追加された日を返す
 */
export function getChangedScheduleDays(
  gameId: string,
  season: Season,
  lastSavedGameIndex: number
): SaveScheduleDay[] {
  const GAMES_PER_DAY = 6;
  const startDay = Math.floor(lastSavedGameIndex / GAMES_PER_DAY);
  const endDay = Math.floor(season.currentGameIndex / GAMES_PER_DAY);

  const days: SaveScheduleDay[] = [];
  for (let dayIndex = startDay; dayIndex <= endDay; dayIndex++) {
    const start = dayIndex * GAMES_PER_DAY;
    const entries = season.schedule.slice(start, start + GAMES_PER_DAY);
    if (entries.length > 0) {
      days.push({
        id: `${gameId}:${season.year}:${dayIndex}`,
        gameId,
        seasonYear: season.year,
        dayIndex,
        entries: entries.map(e => ({
          ...e,
          result: e.result ? { ...e.result, atBatLogs: undefined } : null,
        })),
      });
    }
  }
  return days;
}

/**
 * atBatLogsを抽出（scheduleEntryId単位）
 * resultにatBatLogsがあるエントリのみ
 */
export function extractAtBatLogs(
  gameId: string,
  schedule: ScheduleEntry[]
): SaveAtBatLogRecord[] {
  const records: SaveAtBatLogRecord[] = [];
  for (const entry of schedule) {
    if (entry.result?.atBatLogs && entry.result.atBatLogs.length > 0) {
      records.push({
        id: `${gameId}:${entry.id}`,
        gameId,
        scheduleEntryId: entry.id,
        logs: entry.result.atBatLogs,
      });
    }
  }
  return records;
}

/**
 * DB レコードから GameState を再構築
 */
export function rebuildGameState(
  core: SaveCore,
  teams: SaveTeamRecord[],
  currentScheduleDays: SaveScheduleDay[],
  historyScheduleDays: Map<number, SaveScheduleDay[]>,
  atBatLogRecords: SaveAtBatLogRecord[]
): GameState {
  // チームを再構築
  const teamsMap: Record<string, Team> = {};
  for (const t of teams) {
    teamsMap[t.teamId] = t.data;
  }

  // atBatLogsをentryId → logs のMapに変換
  const atBatLogsMap = new Map<string, AtBatLog[]>();
  for (const r of atBatLogRecords) {
    atBatLogsMap.set(r.scheduleEntryId, r.logs);
  }

  // スケジュールを再構築（日の順にソートして結合）
  const rebuildSchedule = (days: SaveScheduleDay[]): ScheduleEntry[] => {
    const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex);
    const entries: ScheduleEntry[] = [];
    for (const day of sorted) {
      for (const entry of day.entries) {
        const logs = atBatLogsMap.get(entry.id);
        if (logs && entry.result) {
          entries.push({
            ...entry,
            result: { ...entry.result, atBatLogs: logs },
          });
        } else {
          entries.push(entry);
        }
      }
    }
    return entries;
  };

  const currentSchedule = rebuildSchedule(currentScheduleDays);
  const currentSeason: Season = {
    ...core.currentSeason,
    schedule: currentSchedule,
  };

  const seasonHistory: Season[] = core.seasonHistory.map(sh => {
    const days = historyScheduleDays.get(sh.year) || [];
    return {
      ...sh,
      schedule: rebuildSchedule(days),
    };
  });

  return {
    id: core.id,
    myTeamId: core.myTeamId,
    teams: teamsMap,
    currentSeason,
    seasonHistory,
    createdAt: core.createdAt,
    updatedAt: core.updatedAt,
    offseasonState: core.offseasonState,
    awardsHistory: core.awardsHistory,
  };
}
