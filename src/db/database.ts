import Dexie, { type Table } from "dexie";
import type { Team } from "@/models/team";
import type { ScheduleEntry, AtBatLog, League, SeasonPhase, PlayoffSeries } from "@/models/league";
import type { TeamRecord } from "@/models/team";
import type { OffseasonPhase, SeasonAwards } from "@/models/game-state";
import type { DraftState } from "@/engine/draft";

/** セーブデータのメタ情報 */
export interface SaveMeta {
  id: string;
  name: string;
  myTeamId: string;
  createdAt: string;
  updatedAt: string;
}

/** セーブデータのコア（teams, schedule除外） */
export interface SaveCore {
  id: string;
  myTeamId: string;
  /** currentSeasonからscheduleを除外したもの */
  currentSeason: {
    year: number;
    leagues: League[];
    standings: Record<string, TeamRecord>;
    currentGameIndex: number;
    phase: SeasonPhase;
    playoffs?: PlayoffSeries[];
  };
  /** seasonHistoryの各シーズンからscheduleを除外したもの */
  seasonHistory: {
    year: number;
    leagues: League[];
    standings: Record<string, TeamRecord>;
    currentGameIndex: number;
    phase: SeasonPhase;
    playoffs?: PlayoffSeries[];
  }[];
  offseasonState?: {
    phase: OffseasonPhase;
    awards?: SeasonAwards;
    contractResults?: { retired: string[]; renewed: string[] };
    draftState?: DraftState;
  };
  awardsHistory?: SeasonAwards[];
  createdAt: string;
  updatedAt: string;
}

/** チーム個別レコード */
export interface SaveTeamRecord {
  id: string;     // `${gameId}:${teamId}`
  gameId: string;
  teamId: string;
  data: Team;
}

/** スケジュール1日分 */
export interface SaveScheduleDay {
  id: string;  // `${gameId}:${seasonYear}:${dayIndex}`
  gameId: string;
  seasonYear: number;
  dayIndex: number;
  entries: ScheduleEntry[];
}

/** 打席ログ（1試合分） */
export interface SaveAtBatLogRecord {
  id: string;  // `${gameId}:${scheduleEntryId}`
  gameId: string;
  scheduleEntryId: string;
  logs: AtBatLog[];
}

class BaseballGMDatabase extends Dexie {
  saveMeta!: Table<SaveMeta, string>;
  saveCore!: Table<SaveCore, string>;
  saveTeams!: Table<SaveTeamRecord, string>;
  scheduleDays!: Table<SaveScheduleDay, string>;
  atBatLogs!: Table<SaveAtBatLogRecord, string>;

  constructor() {
    super("BaseballGM");
    this.version(1).stores({
      saveMeta: "id",
      saveCore: "id",
      saveTeams: "id, gameId",
      scheduleDays: "id, gameId, [gameId+seasonYear]",
      atBatLogs: "id, gameId",
    });
  }
}

export const db = new BaseballGMDatabase();
