import type { Player } from "./player";

/** 投手の役割 */
export type PitcherRole = "starter" | "setup" | "closer" | "middle_reliever";

/** 1軍/2軍の所属レベル */
export type RosterLevel = "ichi_gun" | "ni_gun";

/** 1軍上限 */
export const ICHI_GUN_MAX = 28;
/** ロスター上限 */
export const ROSTER_MAX = 70;
/** ロスターデフォルトサイズ */
export const ROSTER_DEFAULT = 65;

/** チームの打順・ローテーション設定 */
export interface TeamLineupConfig {
  /** 打順 (9人のplayerID) */
  battingOrder: string[];
  /** 先発ローテーション (5-6人のplayerID) */
  startingRotation: string[];
  /** 守護神のplayerID */
  closerId: string | null;
  /** セットアッパーのplayerID配列 */
  setupIds: string[];
  /** 次に投げる先発のインデックス */
  rotationIndex: number;
}

/** チームデータ */
export interface Team {
  id: string;
  name: string;
  shortName: string;
  /** チームカラー (hex) */
  color: string;
  /** 所属選手 */
  roster: Player[];
  /** 資金 (万円) */
  budget: number;
  /** ファン人気度 (1-100) */
  fanBase: number;
  /** 本拠地名 */
  homeBallpark: string;
  /** 打順・ローテ設定 (optional, 旧セーブ互換) */
  lineupConfig?: TeamLineupConfig;
  /** 各選手の1軍/2軍所属 (optional, 旧セーブ互換) */
  rosterLevels?: Record<string, RosterLevel>;
}

/** チームのシーズン成績 */
export interface TeamRecord {
  teamId: string;
  wins: number;
  losses: number;
  draws: number;
}

/** 勝率を計算 */
export function calcWinPct(record: TeamRecord): number {
  const total = record.wins + record.losses;
  if (total === 0) return 0;
  return record.wins / total;
}
