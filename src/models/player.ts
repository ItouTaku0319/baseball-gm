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

/** 守備位置の日本語表記 */
export const POSITION_NAMES: Record<Position, string> = {
  P: "投",
  C: "捕",
  "1B": "一",
  "2B": "二",
  "3B": "三",
  SS: "遊",
  LF: "左",
  CF: "中",
  RF: "右",
};

/** 投球の利き手 */
export type ThrowHand = "L" | "R";

/** 投球利き手の日本語表記 */
export const THROW_HAND_NAMES: Record<ThrowHand, string> = {
  L: "左",
  R: "右",
};

/** 打席の利き手 */
export type BatSide = "L" | "R" | "S"; // S = Switch

/** 打席利き手の日本語表記 */
export const BAT_SIDE_NAMES: Record<BatSide, string> = {
  L: "左",
  R: "右",
  S: "両",
};

/** 球種タイプ */
export type PitchType =
  | "slider"
  | "curve"
  | "fork"
  | "changeup"
  | "sinker"
  | "cutter"
  | "shoot"
  | "knuckle"
  | "screwball"
  | "splitter";

/** 球種の日本語名 */
export const PITCH_TYPE_NAMES: Record<PitchType, string> = {
  slider: "スライダー",
  curve: "カーブ",
  fork: "フォーク",
  changeup: "チェンジアップ",
  sinker: "シンカー",
  cutter: "カットボール",
  shoot: "シュート",
  knuckle: "ナックル",
  screwball: "スクリュー",
  splitter: "スプリット",
};

/** 球種の略称 */
export const PITCH_SHORT_NAMES: Record<PitchType, string> = {
  slider: "スラ",
  curve: "カーブ",
  fork: "フォーク",
  changeup: "チェンジ",
  sinker: "シンカー",
  cutter: "カット",
  shoot: "シュート",
  knuckle: "ナックル",
  screwball: "スクリュー",
  splitter: "スプリット",
};

/** 球種→方向矢印 */
export const PITCH_DIR_ARROWS: Record<PitchType, string> = {
  slider: "←", cutter: "←",
  curve: "↙", screwball: "↙",
  fork: "↓", changeup: "↓", splitter: "↓", knuckle: "↓",
  sinker: "↘",
  shoot: "→",
};

/** 球種の表示順 (方向順) */
export const PITCH_DIR_ORDER: Record<PitchType, number> = {
  slider: 0, cutter: 1,
  curve: 10, screwball: 11,
  fork: 20, changeup: 21, splitter: 22, knuckle: 23,
  sinker: 30,
  shoot: 40,
};

/** 球種と変化量 */
export interface PitchRepertoire {
  type: PitchType;
  /** 変化量 (1-7) */
  level: number;
}

/** 野手の能力値 (1-100) */
export interface BatterAbilities {
  /** ミート力 (打率に影響) */
  contact: number;
  /** パワー (長打力に影響) */
  power: number;
  /** 弾道 (1-4、打球角度の傾向に影響) */
  trajectory: number;
  /** 走力 (盗塁・内野安打に影響) */
  speed: number;
  /** 肩力 (送球に影響) */
  arm: number;
  /** 守備力 */
  fielding: number;
  /** 捕球 (エラー率に影響) */
  catching: number;
  /** 選球眼 (四球率に影響) */
  eye: number;
}

export interface PitcherAbilities {
  /** 球速 (120-165 km/h) */
  velocity: number;
  /** 制球 (1-100、四球率に影響) */
  control: number;
  /** 球種リスト */
  pitches: PitchRepertoire[];
  /** スタミナ (1-100、先発の持続力に影響) */
  stamina: number;
  /** 精神力 (1-100) */
  mentalToughness: number;
  /** 肩力 (1-100) */
  arm: number;
  /** 守備力 (1-100) */
  fielding: number;
  /** 捕球 (1-100) */
  catching: number;
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
  putOuts: number;         // 刺殺
  assists: number;         // 補殺
  hitByPitch: number;      // 死球
  sacrificeFlies: number;  // 犠牲フライ
  groundedIntoDP: number;  // 併殺打
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
  hitBatsmen: number;      // 与死球
  groundBallOuts: number;  // ゴロアウト数
  flyBallOuts: number;     // フライアウト数
  groundBalls: number;     // 全ゴロ打球数（安打・エラー含む）
  flyBalls: number;        // 全フライ打球数（HR含む）
  lineDrives: number;      // 全ライナー打球数
  popups: number;          // 全ポップフライ数
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
    putOuts: 0,
    assists: 0,
    hitByPitch: 0,
    sacrificeFlies: 0,
    groundedIntoDP: 0,
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
    hitBatsmen: 0,
    groundBallOuts: 0,
    flyBallOuts: 0,
    groundBalls: 0,
    flyBalls: 0,
    lineDrives: 0,
    popups: 0,
  };
}
