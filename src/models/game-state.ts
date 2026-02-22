import type { Team } from "./team";
import type { Season } from "./league";
import type { DraftState } from "@/engine/draft";

/** オフシーズンのサブフェーズ */
export type OffseasonPhase = "awards" | "contract" | "draft" | "completed";

/** 表彰タイトル */
export interface AwardEntry {
  title: string;
  playerId: string;
  playerName: string;
  teamId: string;
  value: string;
}

/** 表彰結果 */
export interface SeasonAwards {
  year: number;
  /** リーグ別タイトル */
  central: AwardEntry[];
  pacific: AwardEntry[];
  /** 日本シリーズMVP */
  japanSeriesMvp?: AwardEntry;
}

/** ゲーム全体の保存データ */
export interface GameState {
  id: string;
  /** プレイヤーが管理するチームのID */
  myTeamId: string;
  /** 全チームデータ */
  teams: Record<string, Team>;
  /** 現在のシーズン */
  currentSeason: Season;
  /** シーズン履歴 */
  seasonHistory: Season[];
  /** ゲーム作成日時 */
  createdAt: string;
  /** 最終更新日時 */
  updatedAt: string;
  /** オフシーズンの進行状態 */
  offseasonState?: {
    phase: OffseasonPhase;
    awards?: SeasonAwards;
    contractResults?: { retired: string[]; renewed: string[] };
    draftState?: DraftState;
  };
  /** 表彰履歴 */
  awardsHistory?: SeasonAwards[];
}
