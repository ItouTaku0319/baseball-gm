/** 守備位置 */
export type Position =
  | "P"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "CF"
  | "RF";

/** 投球の利き手 */
export type ThrowHand = "L" | "R";

/** 打席の利き手 */
export type BatSide = "L" | "R" | "S"; // S = Switch

/** 選手の能力値 (1-100) */
export interface BatterAbilities {
  /** ミート力 (打率に影響) */
  contact: number;
  /** パワー (長打力に影響) */
  power: number;
  /** 走力 (盗塁・内野安打に影響) */
  speed: number;
  /** 守備力 */
  fielding: number;
  /** 選球眼 (四球率に影響) */
  eye: number;
}

export interface PitcherAbilities {
  /** 球速 (奪三振に影響) */
  velocity: number;
  /** コントロール (四球率に影響) */
  control: number;
  /** 変化球 (被打率に影響) */
  breaking: number;
  /** スタミナ (先発の持続力に影響) */
  stamina: number;
  /** 対左打者/右打者 */
  mentalToughness: number;
}

/** 選手のポテンシャル (成長可能な上限) */
export interface PlayerPotential {
  overall: "S" | "A" | "B" | "C" | "D";
}

/** 打者のシーズン成績 */
export interface BatterSeasonStats {
  games: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  runs: number;
  walks: number;
  strikeouts: number;
  stolenBases: number;
  caughtStealing: number;
  errors: number;
}

/** 投手のシーズン成績 */
export interface PitcherSeasonStats {
  games: number;
  gamesStarted: number;
  wins: number;
  losses: number;
  saves: number;
  holds: number;
  inningsPitched: number; // アウト数で管理 (3で1イニング)
  hits: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRunsAllowed: number;
}

/** 選手データ */
export interface Player {
  id: string;
  name: string;
  age: number;
  position: Position;
  /** 投手も兼任可能な場合 */
  isPitcher: boolean;
  throwHand: ThrowHand;
  batSide: BatSide;
  /** 打撃能力 */
  batting: BatterAbilities;
  /** 投手能力 (投手のみ) */
  pitching: PitcherAbilities | null;
  /** 成長ポテンシャル */
  potential: PlayerPotential;
  /** 年俸 (万円) */
  salary: number;
  /** 契約残年数 */
  contractYears: number;
  /** 通算成績 (年ごと) */
  careerBattingStats: Record<number, BatterSeasonStats>;
  careerPitchingStats: Record<number, PitcherSeasonStats>;
}

/** 打率を計算 */
export function calcBattingAverage(stats: BatterSeasonStats): number {
  if (stats.atBats === 0) return 0;
  return stats.hits / stats.atBats;
}

/** 防御率を計算 */
export function calcERA(stats: PitcherSeasonStats): number {
  if (stats.inningsPitched === 0) return 0;
  const innings = stats.inningsPitched / 3;
  return (stats.earnedRuns / innings) * 9;
}

/** 空の打者成績を生成 */
export function emptyBatterStats(): BatterSeasonStats {
  return {
    games: 0,
    atBats: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    rbi: 0,
    runs: 0,
    walks: 0,
    strikeouts: 0,
    stolenBases: 0,
    caughtStealing: 0,
    errors: 0,
  };
}

/** 空の投手成績を生成 */
export function emptyPitcherStats(): PitcherSeasonStats {
  return {
    games: 0,
    gamesStarted: 0,
    wins: 0,
    losses: 0,
    saves: 0,
    holds: 0,
    inningsPitched: 0,
    hits: 0,
    earnedRuns: 0,
    walks: 0,
    strikeouts: 0,
    homeRunsAllowed: 0,
  };
}
