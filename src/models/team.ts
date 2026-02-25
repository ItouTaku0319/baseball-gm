import type { Player } from "./player";

/** 投手の役割 */
export type PitcherRole = "starter" | "setup" | "closer" | "middle_reliever";

/** 先発投手の起用方針 (6種) */
export type StarterUsagePolicy =
  | "complete_game" | "win_eligible" | "performance"
  | "stamina_save" | "opener" | "short_starter";

/** リリーフ投手の起用方針 (5種) */
export type RelieverUsagePolicy =
  | "closer" | "lead_only" | "close_game" | "behind_ok" | "mop_up";

/** 投手個別の起用設定 */
export interface PitcherUsageConfig {
  starterPolicy?: StarterUsagePolicy;
  relieverPolicy?: RelieverUsagePolicy;
  /** リリーフ用の最大イニング制限 (デフォルト1) */
  maxInnings?: number;
}

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
  /** 先発ローテーション (MAX 6人のplayerID) */
  startingRotation: string[];
  /** 明示的リリーフリスト (MAX 8人のplayerID) */
  relieverIds?: string[];
  /** 次に投げる先発のインデックス */
  rotationIndex: number;
  /** 投手個別の起用設定 (keyはplayerID) */
  pitcherUsages?: Record<string, PitcherUsageConfig>;
  /** リリーフ投手の連続登板日数 (playerId → 連続登板日数) */
  pitcherAppearances?: Record<string, number>;

  // 旧フィールド（後方互換、optional化）
  /** @deprecated pitcherUsagesに移行 */
  closerId?: string | null;
  /** @deprecated pitcherUsagesに移行 */
  setupIds?: string[];
  /** @deprecated pitcherUsagesに移行 */
  starterUsagePolicy?: StarterUsagePolicy;
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
