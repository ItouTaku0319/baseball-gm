import type { TeamRecord } from "./team";

/** リーグ構成 */
export interface League {
  id: string;
  name: string;
  teams: string[]; // team IDs
}

/** シーズンデータ */
export interface Season {
  year: number;
  leagues: League[];
  /** 全チームの成績 */
  standings: Record<string, TeamRecord>;
  /** スケジュール */
  schedule: ScheduleEntry[];
  /** 現在の日付インデックス (何試合目まで進んだか) */
  currentGameIndex: number;
  /** シーズンフェーズ */
  phase: SeasonPhase;
}

export type SeasonPhase =
  | "preseason"      // オフシーズン (ドラフト, FA, トレード)
  | "regular_season" // レギュラーシーズン
  | "playoffs"       // プレーオフ (クライマックスシリーズ的な)
  | "offseason";     // シーズン終了後

/** 試合スケジュールの1エントリ */
export interface ScheduleEntry {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  /** 試合結果 (未実施ならnull) */
  result: GameResult | null;
}

/** 試合結果 */
export interface GameResult {
  homeScore: number;
  awayScore: number;
  /** イニングごとのスコア */
  innings: InningScore[];
  /** 勝利投手ID */
  winningPitcherId: string | null;
  /** 敗戦投手ID */
  losingPitcherId: string | null;
  /** セーブ投手ID */
  savePitcherId: string | null;
}

/** 1イニングのスコア */
export interface InningScore {
  top: number;    // 表 (先攻) の得点
  bottom: number; // 裏 (後攻) の得点
}
