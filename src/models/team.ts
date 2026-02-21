import type { Player } from "./player";

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
