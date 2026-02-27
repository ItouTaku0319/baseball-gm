import type { TeamRecord } from "./team";
import type { PitchType } from "./player";

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
  /** ポストシーズンシリーズ (optional) */
  playoffs?: PlayoffSeries[];
}

export type SeasonPhase =
  | "preseason"        // プレシーズン
  | "regular_season"   // レギュラーシーズン
  | "climax_first"     // CS 1stステージ
  | "climax_final"     // CS Finalステージ
  | "japan_series"     // 日本シリーズ
  | "offseason";       // シーズン終了後

/** 試合スケジュールの1エントリ */
export interface ScheduleEntry {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  /** 試合結果 (未実施ならnull) */
  result: GameResult | null;
}

/** 選手の1試合の打撃成績 */
export interface PlayerGameStats {
  playerId: string;
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
  hitByPitch?: number;       // 死球
  sacrificeFlies?: number;   // 犠牲フライ
  groundedIntoDP?: number;   // 併殺打
  sacrificeBunts?: number;   // 犠打数
  putOuts?: number;          // 刺殺
  assists?: number;          // 補殺
  errors?: number;           // 失策
  fieldingPosition?: number; // その試合での守備ポジション (1-9)
}

/** 投手の1試合の成績 */
export interface PitcherGameLog {
  playerId: string;
  inningsPitched: number; // アウト数 (3で1イニング)
  hits: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRunsAllowed: number;
  hitBatsmen?: number;       // 与死球
  sacrificeBuntsAllowed?: number; // 被犠打数
  groundBallOuts?: number;   // ゴロアウト数
  flyBallOuts?: number;      // フライアウト数
  groundBalls?: number;      // 全ゴロ打球数（安打・エラー含む）
  flyBalls?: number;         // 全フライ打球数（HR含む）
  lineDrives?: number;       // 全ライナー打球数
  popups?: number;           // 全ポップフライ数
  pitchCount?: number;       // 投球数
  isStarter?: boolean;       // 先発フラグ
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
  /** ホールド投手ID配列 */
  holdPitcherIds?: string[];
  /** 各選手の打撃成績 */
  playerStats: PlayerGameStats[];
  /** 投手成績 */
  pitcherStats: PitcherGameLog[];
  /** 打席ログ（診断モード時のみ） */
  atBatLogs?: AtBatLog[];
  /** 試合中に発生した故障 */
  injuries?: Array<{ playerId: string; injury: import("./player").Injury }>;
}

/** 野手の移動アクション */
export type FielderAction = "charge" | "retreat" | "lateral"
  | "cover_base" | "backup" | "relay" | "hold" | "field_ball";

/** 1野手の移動計画（可視化用） */
export interface FielderMovement {
  position: number;
  startPos: { x: number; y: number };
  targetPos: { x: number; y: number };
  action: FielderAction;
  startTime: number;
  speed: number;
}

/** 守備AI判定の全過程トレース */
export interface FieldingTrace {
  /** 着地計算結果 */
  landing: {
    position: { x: number; y: number };
    distance: number;
    flightTime: number;
    isGroundBall: boolean;
  };
  /** 各野手の評価 */
  fielders: Array<{
    position: number;
    role: string;
    defaultPos: { x: number; y: number };
    distanceToBall: number;
    timeToReach: number;
    ballArrivalTime: number;
    canReach: boolean;
    skill: { fielding: number; catching: number; arm: number; speed: number };
    distanceAtLanding?: number;
    posAtLanding?: { x: number; y: number };
  }>;
  /** 各野手の移動計画 */
  movements?: FielderMovement[];
  /** HR判定詳細 (フライ/ポップアップのみ) */
  hrCalc?: {
    rawDistance: number;
    fenceDistance: number;
    trajectory: number;
    carryFactor: number;
    effectiveDistance: number;
    ratio: number;
    heightAtFence?: number;
    fenceCleared?: boolean;
  };
  /** 結果判定の詳細 */
  resolution: {
    phase: string;
    bestFielderPos: number;
    fielderArrival: number;
    ballArrival: number;
    canReach: boolean;
    /** 捕球判定(フライ/ライナー) */
    catchMargin?: number;
    catchRate?: number;
    catchSuccess?: boolean;
    /** ゴロ送球判定 */
    secureTime?: number;
    transferTime?: number;
    throwDistance?: number;
    throwSpeed?: number;
    defenseTime?: number;
    runnerSpeed?: number;
    runnerTo1B?: number;
    isInfieldHit?: boolean;
    fieldingRate?: number;
    /** 長打進塁判定 */
    bouncePenalty?: number;
    pickupTime?: number;
    rollDistance?: number;
    totalFielderTime?: number;
    throwTo2B?: number;
    throwTo3B?: number;
    defenseTo2B?: number;
    defenseTo3B?: number;
    runnerTo2B?: number;
    runnerTo3B?: number;
    basesReached?: number;
    margin2B?: number;
    margin3B?: number;
    /** ゴロ経路インターセプト評価シーケンス */
    interceptSequence?: Array<{ pos: number; projDist: number; canIntercept: boolean; result?: string }>;
    /** フライ収束評価（複数野手の着地点距離） */
    convergers?: Array<{ pos: number; distAtLanding: number; canReach: boolean }>;
  };
}

/** 1打席のログ（診断用） */
export interface AtBatLog {
  inning: number;
  halfInning: "top" | "bottom";
  batterId: string;
  pitcherId: string;
  result: string;
  battedBallType: string | null;
  direction: number | null;
  launchAngle: number | null;
  exitVelocity: number | null;
  fielderPosition: number | null;
  estimatedDistance: number | null;
  basesBeforePlay: [boolean, boolean, boolean] | null;
  outsBeforePlay: number | null;
  pitchType?: PitchType;
  pitchLocation?: { x: number; y: number };
  pitchCountInAtBat?: number;
  fieldingTrace?: FieldingTrace;
}

/** 1イニングのスコア */
export interface InningScore {
  top: number;    // 表 (先攻) の得点
  bottom: number; // 裏 (後攻) の得点
}

/** ポストシーズンシリーズの種類 */
export type PlayoffSeriesType =
  | "climax_first_central"
  | "climax_first_pacific"
  | "climax_final_central"
  | "climax_final_pacific"
  | "japan_series";

/** ポストシーズンの1シリーズ */
export interface PlayoffSeries {
  id: string;
  type: PlayoffSeriesType;
  /** 上位チームID */
  team1Id: string;
  /** 下位チームID */
  team2Id: string;
  /** 上位チームのアドバンテージ勝利数 */
  team1Advantage: number;
  /** シリーズの試合 */
  games: ScheduleEntry[];
  /** チーム1の勝利数 (アドバンテージ含む) */
  team1Wins: number;
  /** チーム2の勝利数 */
  team2Wins: number;
  /** 勝利に必要な勝利数 */
  winsNeeded: number;
  /** 勝者チームID (確定していなければnull) */
  winnerId: string | null;
}
