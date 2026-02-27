/**
 * エージェントベース守備AI — 型定義
 */
import type { Player } from "../models/player";
import type { FielderAction, FieldingTrace, AtBatLog } from "../models/league";

// --- 基本 ---
export interface Vec2 {
  x: number;
  y: number;
}

export type BallType = "ground_ball" | "line_drive" | "fly_ball" | "popup";

export type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// --- ボール軌道 ---
export interface BallTrajectory {
  readonly landingPos: Vec2;
  readonly landingDistance: number;
  readonly flightTime: number;
  readonly isGroundBall: boolean;
  readonly maxHeight: number;
  readonly direction: number;
  readonly ballType: BallType;
  readonly groundSpeed?: number; // ゴロの平均地上速度(m/s)
  getPositionAt(t: number): Vec2;
  getHeightAt(t: number): number;
  /** ゴロの瞬時速度(m/s)。フライは0を返す */
  getSpeedAt(t: number): number;
  isOnGround(t: number): boolean;
}

// --- エージェント ---
export type AgentState =
  | "READY"
  | "REACTING"
  | "PURSUING"
  | "COVERING"
  | "BACKING_UP"
  | "HOLDING"
  | "FIELDING"
  | "THROWING";

export interface FielderAgent {
  readonly pos: FielderPosition;
  readonly player: Player;
  state: AgentState;
  currentPos: Vec2;
  targetPos: Vec2;
  currentSpeed: number;
  readonly maxSpeed: number;
  reactionRemaining: number;
  readonly baseReactionTime: number;
  perceivedLanding: { position: Vec2; confidence: number };
  hasCalled: boolean;
  hasYielded: boolean;
  action: FielderAction;
  readonly skill: {
    fielding: number;
    catching: number;
    arm: number;
    speed: number;
  };
  /** ゴロ: 経路インターセプト点 */
  interceptPoint?: Vec2;
  /** ゴロ: ボールがインターセプト点に到達する時刻 */
  interceptBallTime?: number;
  distanceAtArrival: number;
  arrivalTime: number;
  /** 捕球試行の結果（あれば） */
  catchResult?: CatchResult;
}

// --- コールオフ優先度 ---
// 値が大きいほど優先 (呼び込み権限が高い)
export const CALLOFF_PRIORITY: Record<FielderPosition, number> = {
  2: 1,
  1: 2,
  3: 3,
  5: 4,
  4: 5,
  6: 6,
  7: 7,
  9: 7,
  8: 7, // CF（LF/RFと同優先度、距離で決定）
};

// --- 捕球 ---
export type CatchType = "standard" | "diving" | "running" | "ground_field";

export interface CatchResult {
  success: boolean;
  catchType: CatchType;
  catchRate: number;
  agentPos: FielderPosition;
}

// --- タイムライン ---
export interface AgentSnapshot {
  pos: FielderPosition;
  state: AgentState;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  action: FielderAction;
  perceivedX?: number;
  perceivedY?: number;
  effectiveRange?: number;
}

export interface AgentTimelineEntry {
  t: number;
  ballPos: Vec2;
  ballHeight: number;
  agents: AgentSnapshot[];
}

// --- シミュレーションオプション ---
export interface AgentSimOptions {
  /** 0=ノイズなし(決定的)、1.0=通常 */
  perceptionNoise?: number;
  collectTimeline?: boolean;
  /** カスタム乱数(テスト用) */
  random?: () => number;
}

// --- 塁位置定数 ---
export const BASE_POSITIONS = {
  home: { x: 0, y: 0 } as Vec2,
  first: { x: 19.4, y: 19.4 } as Vec2,
  second: { x: 0, y: 38.8 } as Vec2,
  third: { x: -19.4, y: 19.4 } as Vec2,
} as const;

export const BASE_LENGTH = 27.4; // 塁間距離(m)

/** 塁番号→名前マッピング */
export const BASE_NAMES: Record<number, keyof typeof BASE_POSITIONS> = {
  1: "first",
  2: "second",
  3: "third",
  4: "home",
};

// --- 結果（PO/A/E記録を含む） ---

/** 送球1本分のPO/A記録情報 */
export interface ThrowPlay {
  from: FielderPosition;
  to: FielderPosition;
  base: keyof typeof BASE_POSITIONS;
}

/** AtBatResult の再定義（simulation.ts内部型をミラー） */
export type AtBatResult =
  | "single"
  | "double"
  | "triple"
  | "homerun"
  | "walk"
  | "hitByPitch"
  | "strikeout"
  | "groundout"
  | "flyout"
  | "lineout"
  | "popout"
  | "doublePlay"
  | "sacrificeFly"
  | "fieldersChoice"
  | "infieldHit"
  | "error"
  | "sacrifice_bunt"
  | "bunt_hit"
  | "bunt_out";

export interface AgentFieldingResult {
  result: AtBatResult;
  fielderPos: FielderPosition;
  trace?: FieldingTrace;
  /** 刺殺者 */
  putOutPos?: FielderPosition;
  /** 補殺者（複数可: DP等） */
  assistPos?: FielderPosition[];
  /** エラー者 */
  errorPos?: FielderPosition;
  /** 送球チェーン（空配列=無補殺刺殺、undefined=従来パス） */
  throwPlays?: ThrowPlay[];
  /** エージェントタイムライン (collectTimeline=true の場合のみ) */
  agentTimeline?: AgentTimelineEntry[];
}

// --- ユーティリティ ---
export function vec2Distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Box-Muller変換 (rng注入対応) */
export function gaussianRandom(
  mean: number,
  stdDev: number,
  rng: () => number = Math.random
): number {
  const u1 = rng();
  const u2 = rng();
  const z =
    Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}
