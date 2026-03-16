/**
 * 守備台本（Play Script）生成器
 *
 * 打球発生時に「誰が何をするか」を事前に決定する。
 * 野手の自律判断ではなく、野球のフォーメーション知識に基づく役割割り当て。
 *
 * Phase 1: ゴロのみ対応（最も頻度が高く、パターンも多い）
 */
import type {
  Vec2,
  BallTrajectory,
  FielderAgent,
  FielderPosition,
  AgentState,
} from "./fielding-agent-types";
import {
  vec2Distance,
  BASE_POSITIONS,
} from "./fielding-agent-types";
import type { FielderAction } from "../models/league";
import {
  AGENT_ACCELERATION_TIME,
  CATCH_REACH_BASE,
  CATCH_REACH_SKILL_FACTOR,
} from "./physics-constants";

// ====================================================================
// 型定義
// ====================================================================

/** 野手に割り当てる役割 */
export interface FielderAssignment {
  state: AgentState;
  targetPos: Vec2;
  action: FielderAction;
}

/** 送球計画 */
export interface ThrowPlan {
  /** 送球先の塁番号 (1=1B, 2=2B, 3=3B, 4=HOME) */
  primaryTarget: number;
  /** ダブルプレー時の2送球目 */
  dpTarget?: number;
  /** DP狙いかどうか */
  isDoublePlay: boolean;
}

/** 台本全体 */
export interface PlayScript {
  /** 9人の役割割り当て */
  assignments: Map<FielderPosition, FielderAssignment>;
  /** 捕球担当者 */
  primaryFielder: FielderPosition;
  /** 送球計画 */
  throwPlan: ThrowPlan;
}

/** ランナー状況（簡易） */
export interface RunnerSituation {
  first: boolean;
  second: boolean;
  third: boolean;
}

// ====================================================================
// 定数
// ====================================================================

/** ゴロのインターセプト計算用：野手の実効速度（加速考慮） */
const EFFECTIVE_SPEED_RATIO = 0.85;

/** DP狙いの初速下限 (km/h) — 遅いゴロではDP困難 */
const DP_MIN_EXIT_VELOCITY = 60;

// ====================================================================
// フォーメーションテーブル
// ====================================================================

/** フォーメーションアクション定義 */
type FormationAction =
  | "FIELD"
  | "COVER_1B"
  | "COVER_2B"
  | "COVER_3B"
  | "COVER_HOME"
  | "BACKUP_BALL"
  | "BACKUP_1B_THROW"
  | "BACKUP_2B_THROW"
  | "BACKUP_3B_THROW"
  | "AVOID_THROW_LINE"
  | "MINIMAL"
  | "HOLD"
  | "BACKUP_GENERAL";

/**
 * ランナー状況キー
 * none/R1/R2/R3/R12/R13/R23/R123
 */
type RunnerKey = "none" | "R1" | "R2" | "R3" | "R12" | "R13" | "R23" | "R123";

function getRunnerKey(runners: RunnerSituation): RunnerKey {
  const { first, second, third } = runners;
  if (!first && !second && !third) return "none";
  if (first && !second && !third) return "R1";
  if (!first && second && !third) return "R2";
  if (!first && !second && third) return "R3";
  if (first && second && !third) return "R12";
  if (first && !second && third) return "R13";
  if (!first && second && third) return "R23";
  return "R123";
}

/**
 * フォーメーションテーブル
 * key: `${runnerKey}-${primaryFielder}`
 * value: Record<FielderPosition, FormationAction>
 *
 * docs/grounder-formations.json の77パターンから抽出。
 * バリアントが複数ある場合は最もオーソドックスなものを採用。
 */
const FORMATION_TABLE: Record<string, Record<number, FormationAction>> = {
  // ================================================================
  // ランナーなし (none)
  // ================================================================
  "none-1": { // Pゴロ
    1: "FIELD", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "BACKUP_BALL",
    5: "BACKUP_BALL", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "none-2": { // Cゴロ — 3B:ファンブルBU兼サードベースカバー
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "BACKUP_1B_THROW",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_1B_THROW",
  },
  "none-3": { // 1Bゴロ
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "FIELD", 4: "COVER_1B",
    5: "HOLD", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_BALL",
  },
  "none-4": { // 2Bゴロ
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "FIELD",
    5: "HOLD", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "none-5": { // 3Bゴロ — P:送球邪魔回避, 2B:悪送球カバーリング(→二塁), SS:3Bに近づきBU
    1: "AVOID_THROW_LINE", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "BACKUP_1B_THROW",
    5: "FIELD", 6: "BACKUP_BALL", 7: "BACKUP_BALL", 8: "BACKUP_1B_THROW", 9: "BACKUP_1B_THROW",
  },
  "none-6": { // SSゴロ — P:送球邪魔回避, 2B:悪送球カバーリング, 3B:SSに近づきBU
    1: "AVOID_THROW_LINE", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "BACKUP_1B_THROW",
    5: "BACKUP_BALL", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },

  // ================================================================
  // ランナー1塁のみ (R1) — DP体制
  // ================================================================
  "R1-1": { // Pゴロ
    1: "FIELD", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "BACKUP_2B_THROW",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R1-2": { // Cゴロ
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "BACKUP_2B_THROW",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_1B_THROW",
  },
  "R1-3": { // 1Bゴロ
    1: "COVER_1B", 2: "COVER_1B", 3: "FIELD", 4: "COVER_1B",
    5: "COVER_3B", 6: "COVER_2B", 7: "COVER_2B", 8: "COVER_2B", 9: "BACKUP_1B_THROW",
  },
  "R1-4": { // 2Bゴロ
    1: "COVER_1B", 2: "COVER_1B", 3: "COVER_1B", 4: "FIELD",
    5: "COVER_3B", 6: "COVER_2B", 7: "COVER_2B", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "R1-5": { // 3Bゴロ
    1: "AVOID_THROW_LINE", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "FIELD", 6: "COVER_3B", 7: "BACKUP_BALL", 8: "BACKUP_2B_THROW", 9: "BACKUP_2B_THROW",
  },
  "R1-6": { // SSゴロ
    1: "MINIMAL", 2: "COVER_1B", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "COVER_2B",
  },

  // ================================================================
  // ランナー2塁のみ (R2)
  // ================================================================
  "R2-1": { // Pゴロ
    1: "FIELD", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R2-2": { // Cゴロ
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "BACKUP_GENERAL",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_GENERAL", 9: "BACKUP_1B_THROW",
  },
  "R2-3": { // 1Bゴロ
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "FIELD", 4: "COVER_1B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_BALL",
  },
  "R2-4": { // 2Bゴロ
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "FIELD",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "R2-5": { // 3Bゴロ
    1: "COVER_3B", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "FIELD", 6: "COVER_3B", 7: "BACKUP_BALL", 8: "BACKUP_2B_THROW", 9: "BACKUP_1B_THROW",
  },
  "R2-6": { // SSゴロ
    1: "BACKUP_1B_THROW", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },

  // ================================================================
  // ランナー3塁のみ (R3) — 通常守備（前進守備は別枠）
  // ================================================================
  "R3-1": { // Pゴロ（通常: 一塁送球）
    1: "FIELD", 2: "COVER_HOME", 3: "COVER_1B", 4: "BACKUP_BALL",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R3-2": { // Cゴロ
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "BACKUP_1B_THROW",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_1B_THROW",
  },
  "R3-3": { // 1Bゴロ
    1: "COVER_1B", 2: "COVER_HOME", 3: "FIELD", 4: "COVER_1B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_BALL",
  },
  "R3-4": { // 2Bゴロ
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "FIELD",
    5: "BACKUP_BALL", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "R3-5": { // 3Bゴロ
    1: "BACKUP_BALL", 2: "COVER_HOME", 3: "COVER_1B", 4: "COVER_2B",
    5: "FIELD", 6: "COVER_3B", 7: "BACKUP_BALL", 8: "BACKUP_GENERAL", 9: "BACKUP_1B_THROW",
  },
  "R3-6": { // SSゴロ
    1: "BACKUP_1B_THROW", 2: "COVER_HOME", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },

  // ================================================================
  // ランナー1・2塁 (R12) — DP体制
  // ================================================================
  "R12-1": { // Pゴロ
    1: "FIELD", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "BACKUP_2B_THROW",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R12-2": { // Cゴロ
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_1B_THROW",
  },
  "R12-3": { // 1Bゴロ
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "FIELD", 4: "COVER_1B",
    5: "COVER_3B", 6: "COVER_2B", 7: "COVER_2B", 8: "COVER_2B", 9: "BACKUP_BALL",
  },
  "R12-4": { // 2Bゴロ
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "FIELD",
    5: "COVER_3B", 6: "COVER_2B", 7: "COVER_2B", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "R12-5": { // 3Bゴロ（var1: 三塁踏んで一塁 or var2: 二塁送球）
    1: "AVOID_THROW_LINE", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "FIELD", 6: "COVER_3B", 7: "BACKUP_BALL", 8: "BACKUP_2B_THROW", 9: "BACKUP_1B_THROW",
  },
  "R12-6": { // SSゴロ
    1: "MINIMAL", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "COVER_2B",
  },

  // ================================================================
  // ランナー1・3塁 (R13) — 通常守備
  // ================================================================
  "R13-1": { // Pゴロ
    1: "FIELD", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "BACKUP_BALL",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R13-2": { // Cゴロ（middleバリアント）
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "BACKUP_1B_THROW",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_1B_THROW", 9: "BACKUP_1B_THROW",
  },
  "R13-3": { // 1Bゴロ（middle）
    1: "COVER_1B", 2: "COVER_HOME", 3: "FIELD", 4: "COVER_1B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_GENERAL", 9: "BACKUP_BALL",
  },
  "R13-4": { // 2Bゴロ（middle）
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "FIELD",
    5: "COVER_3B", 6: "COVER_2B", 7: "COVER_2B", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "R13-5": { // 3Bゴロ（middle）
    1: "BACKUP_1B_THROW", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "FIELD", 6: "COVER_3B", 7: "BACKUP_BALL", 8: "BACKUP_GENERAL", 9: "BACKUP_1B_THROW",
  },
  "R13-6": { // SSゴロ（middle）
    1: "BACKUP_1B_THROW", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "COVER_2B",
  },

  // ================================================================
  // ランナー2・3塁 (R23) — 通常守備
  // ================================================================
  "R23-1": { // Pゴロ（middle）
    1: "FIELD", 2: "COVER_HOME", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R23-2": { // Cゴロ（middle）
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "BACKUP_1B_THROW",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R23-3": { // 1Bゴロ（middle）
    1: "COVER_1B", 2: "COVER_HOME", 3: "FIELD", 4: "COVER_1B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_GENERAL", 9: "BACKUP_BALL",
  },
  "R23-4": { // 2Bゴロ（middle）
    1: "COVER_1B", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "FIELD",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_1B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "R23-5": { // 3Bゴロ（middle）
    1: "AVOID_THROW_LINE", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "FIELD", 6: "COVER_3B", 7: "BACKUP_BALL", 8: "BACKUP_GENERAL", 9: "BACKUP_1B_THROW",
  },
  "R23-6": { // SSゴロ（middle）
    1: "AVOID_THROW_LINE", 2: "BACKUP_1B_THROW", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },

  // ================================================================
  // 満塁 (R123) — ホームゲッツー体制
  // ================================================================
  "R123-1": {
    1: "FIELD", 2: "COVER_HOME", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R123-2": {
    1: "BACKUP_BALL", 2: "FIELD", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
  "R123-3": {
    1: "COVER_1B", 2: "COVER_HOME", 3: "FIELD", 4: "COVER_1B",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_GENERAL", 9: "BACKUP_BALL",
  },
  "R123-4": {
    1: "COVER_1B", 2: "COVER_HOME", 3: "COVER_1B", 4: "FIELD",
    5: "COVER_3B", 6: "COVER_2B", 7: "BACKUP_3B_THROW", 8: "BACKUP_BALL", 9: "BACKUP_BALL",
  },
  "R123-5": {
    1: "AVOID_THROW_LINE", 2: "COVER_HOME", 3: "COVER_1B", 4: "COVER_2B",
    5: "FIELD", 6: "COVER_3B", 7: "BACKUP_BALL", 8: "BACKUP_2B_THROW", 9: "BACKUP_1B_THROW",
  },
  "R123-6": {
    1: "AVOID_THROW_LINE", 2: "COVER_HOME", 3: "COVER_1B", 4: "COVER_2B",
    5: "COVER_3B", 6: "FIELD", 7: "BACKUP_BALL", 8: "BACKUP_BALL", 9: "BACKUP_1B_THROW",
  },
};

/**
 * フォーメーションアクションをFielderAssignmentに変換する
 */
function actionToAssignment(
  action: FormationAction,
  agent: FielderAgent,
  trajectory: BallTrajectory,
  interceptTarget: Vec2,
): FielderAssignment {
  switch (action) {
    case "FIELD":
      return {
        state: "PURSUING",
        targetPos: interceptTarget,
        action: "charge",
      };

    case "COVER_1B":
      return {
        state: "COVERING",
        targetPos: { x: BASE_POSITIONS.first.x, y: BASE_POSITIONS.first.y },
        action: "cover_base",
      };

    case "COVER_2B":
      return {
        state: "COVERING",
        targetPos: { x: BASE_POSITIONS.second.x, y: BASE_POSITIONS.second.y },
        action: "cover_base",
      };

    case "COVER_3B":
      return {
        state: "COVERING",
        targetPos: { x: BASE_POSITIONS.third.x, y: BASE_POSITIONS.third.y },
        action: "cover_base",
      };

    case "COVER_HOME":
      return {
        state: "COVERING",
        targetPos: { x: BASE_POSITIONS.home.x, y: BASE_POSITIONS.home.y },
        action: "cover_base",
      };

    case "BACKUP_BALL": {
      // 内野手・投手: 打球に向かって前進（ファンブルフォロー）
      // 外野手: 打球の後方でバックアップ
      const isOutfielder = agent.pos >= 7 && agent.pos <= 9;
      const ballTarget = isOutfielder
        ? calcBackupPosition(trajectory, agent.pos)
        : calcApproachPosition(agent, trajectory);
      return {
        state: "BACKING_UP",
        targetPos: ballTarget,
        action: "backup",
      };
    }

    case "BACKUP_1B_THROW":
      return {
        state: "BACKING_UP",
        targetPos: calcThrowBackupPosition(1, interceptTarget),
        action: "backup",
      };

    case "BACKUP_2B_THROW":
      return {
        state: "BACKING_UP",
        targetPos: calcThrowBackupPosition(2, interceptTarget),
        action: "backup",
      };

    case "BACKUP_3B_THROW":
      return {
        state: "BACKING_UP",
        targetPos: calcThrowBackupPosition(3, interceptTarget),
        action: "backup",
      };

    case "AVOID_THROW_LINE": {
      // 送球ライン（捕球点→1塁）から外れた位置に移動
      const avoidPos = calcAvoidThrowLinePosition(interceptTarget, agent);
      return {
        state: "BACKING_UP",
        targetPos: avoidPos,
        action: "backup",
      };
    }

    case "MINIMAL":
    case "HOLD":
    case "BACKUP_GENERAL":
    default: {
      // 定位置付近でのドリフト
      const driftPos = calcDriftPosition(agent.pos, trajectory);
      return {
        state: "BACKING_UP",
        targetPos: driftPos,
        action: "backup",
      };
    }
  }
}

// ====================================================================
// メインエントリポイント
// ====================================================================

/**
 * ゴロの台本を生成する。
 * 内野を抜ける打球（誰も間に合わない）の場合は null を返す → 従来パスで処理。
 */
export function generateGroundBallScript(
  trajectory: BallTrajectory,
  agents: readonly FielderAgent[],
  runners: RunnerSituation,
  outs: number,
): PlayScript | null {
  // 1. 捕球候補の選定（内野手のみ）
  const { pos: primary, interceptTime } = selectPrimaryFielder(trajectory, agents);

  // 内野を抜ける打球の判定:
  // 野手がインターセプトする時刻がボール停止後（= 停止位置まで走る）で、
  // かつ停止位置が外野エリア（45m以上）→ 内野を抜けたヒット
  const INFIELD_DEPTH = 45; // 内野ゾーン境界(m)
  if (interceptTime > trajectory.flightTime && trajectory.landingDistance > INFIELD_DEPTH) {
    return null; // ヒット → 従来パスにフォールバック
  }

  // 2. 送球計画の決定
  const throwPlan = decideThrowPlan(primary, runners, outs, trajectory);

  // 3. 全野手の役割割り当て
  const assignments = assignRoles(primary, throwPlan, trajectory, agents, runners, outs);

  return { assignments, primaryFielder: primary, throwPlan };
}

// ====================================================================
// 捕球者選定
// ====================================================================

/**
 * ゴロの捕球担当を選定する。
 * 打球経路に最も早く到達できる内野手を選ぶ。
 * P(1)/C(2) は打球が近い場合のみ候補。
 */
function selectPrimaryFielder(
  trajectory: BallTrajectory,
  agents: readonly FielderAgent[],
): { pos: FielderPosition; interceptTime: number } {
  // 通常内野手(3B/SS/2B/1B)を優先、P/Cは近距離のみ
  const regularInfielders = agents.filter(a => a.pos >= 3 && a.pos <= 6);

  let bestPos: FielderPosition = 6; // デフォルト: SS
  let bestTime = Infinity;

  for (const agent of regularInfielders) {
    const time = estimateInterceptTime(agent, trajectory);
    if (time < bestTime) {
      bestTime = time;
      bestPos = agent.pos;
    }
  }

  // P/C は打球がマウンド付近(20m以内)の場合のみ候補
  if (trajectory.landingDistance < 20) {
    const pitcherCatcher = agents.filter(a => a.pos === 1 || a.pos === 2);
    for (const agent of pitcherCatcher) {
      const time = estimateInterceptTime(agent, trajectory);
      if (time < bestTime) {
        bestTime = time;
        bestPos = agent.pos;
      }
    }
  }

  return { pos: bestPos, interceptTime: bestTime };
}

/**
 * 野手がゴロの経路をインターセプトできる最短時間を推定する。
 * 小さい値 = より早くインターセプトできる = より良い。
 */
function estimateInterceptTime(
  agent: FielderAgent,
  trajectory: BallTrajectory,
): number {
  const maxTime = trajectory.flightTime + 3;
  const fielderSpeed = agent.maxSpeed * EFFECTIVE_SPEED_RATIO;
  const reactionTime = agent.baseReactionTime;

  // 最も早くインターセプトできる時刻を見つける
  for (let t = 0.1; t <= maxTime; t += 0.1) {
    const ballPos = trajectory.getPositionAt(t);
    const dist = vec2Distance(agent.currentPos, ballPos);
    const fielderTime = reactionTime + dist / fielderSpeed;

    if (fielderTime <= t) {
      return t; // この時刻で間に合う
    }
  }

  // 間に合わない場合 → ボール停止後に到達する時間を推定
  const dist = vec2Distance(agent.currentPos, trajectory.landingPos);
  return reactionTime + dist / fielderSpeed;
}

// ====================================================================
// 送球計画
// ====================================================================

/**
 * 送球先を決定する。
 * 野球の基本原則:
 * - フォースアウトを優先
 * - DP体制ならDP狙い
 * - 2アウト時は確実に一塁
 */
function decideThrowPlan(
  primaryFielder: FielderPosition,
  runners: RunnerSituation,
  outs: number,
  trajectory: BallTrajectory,
): ThrowPlan {
  const exitVel = trajectory.exitVelocity; // km/h
  const canDP = exitVel >= DP_MIN_EXIT_VELOCITY;

  // === 2アウト: 常に最も確実なアウトを取る ===
  if (outs === 2) {
    return { primaryTarget: 1, isDoublePlay: false };
  }

  // === 満塁: ホームゲッツー狙い ===
  if (runners.first && runners.second && runners.third) {
    if (primaryFielder <= 2 || primaryFielder === 5) {
      // P/C/3B: ホームに近い → ホーム送球
      return { primaryTarget: 4, dpTarget: 1, isDoublePlay: canDP };
    }
    // その他: 最寄りのフォースベース → 一塁
    return { primaryTarget: nearestForceBase(primaryFielder, runners), dpTarget: 1, isDoublePlay: canDP };
  }

  // === ランナー1塁: ダブルプレー体制 ===
  if (runners.first && !runners.second && !runners.third) {
    if (canDP) {
      return { primaryTarget: 2, dpTarget: 1, isDoublePlay: true };
    }
    // 遅いゴロ → 一塁のみ
    return { primaryTarget: 1, isDoublePlay: false };
  }

  // === ランナー1,2塁: 三塁or二塁経由のDP ===
  if (runners.first && runners.second) {
    if (primaryFielder === 5 || primaryFielder === 6) {
      // 3B/SS: 三塁に近い → 三塁踏んで一塁
      return { primaryTarget: 3, dpTarget: 1, isDoublePlay: canDP };
    }
    return { primaryTarget: 2, dpTarget: 1, isDoublePlay: canDP };
  }

  // === ランナー1,3塁 ===
  if (runners.first && runners.third) {
    // 基本はDP狙い（ホーム送球はリスク高い）
    return { primaryTarget: 2, dpTarget: 1, isDoublePlay: canDP };
  }

  // === ランナー3塁のみ（0-1アウト）===
  if (runners.third && !runners.first && !runners.second) {
    // 前進守備なら本塁送球、通常なら一塁
    return { primaryTarget: 1, isDoublePlay: false };
  }

  // === ランナー2塁のみ ===
  if (runners.second && !runners.first && !runners.third) {
    return { primaryTarget: 1, isDoublePlay: false };
  }

  // === ランナー2,3塁 ===
  if (runners.second && runners.third) {
    return { primaryTarget: 1, isDoublePlay: false };
  }

  // === ランナーなし: 一塁送球 ===
  return { primaryTarget: 1, isDoublePlay: false };
}

/** 捕球者に最も近いフォースベースを返す */
function nearestForceBase(pos: FielderPosition, runners: RunnerSituation): number {
  // フォースが成立するベース（低い番号から）
  const forceBases: number[] = [];
  if (runners.first) forceBases.push(2);
  if (runners.first && runners.second) forceBases.push(3);
  if (runners.first && runners.second && runners.third) forceBases.push(4);
  forceBases.push(1); // 打者走者は常にフォース

  // 捕球者のポジションから最も近いベースを選ぶ
  if (pos === 5 && forceBases.includes(3)) return 3;  // 3B→三塁
  if (pos === 6 && forceBases.includes(2)) return 2;  // SS→二塁
  if (pos === 4 && forceBases.includes(2)) return 2;  // 2B→二塁
  if (pos === 3 && forceBases.includes(1)) return 1;  // 1B→一塁
  if ((pos === 1 || pos === 2) && forceBases.includes(4)) return 4; // P/C→ホーム

  return 1; // デフォルト: 一塁
}

// ====================================================================
// 役割割り当て（テーブル駆動）
// ====================================================================

/**
 * 全9野手に役割を割り当てる。
 *
 * テーブル駆動ロジック:
 * 1. 捕球者(primary)はPURSUING
 * 2. 残り8人はFORMATION_TABLEから役割を決定
 * 3. テーブルに捕球者と重複するカバー割り当てがある場合はフォールバック
 */
function assignRoles(
  primaryFielder: FielderPosition,
  throwPlan: ThrowPlan,
  trajectory: BallTrajectory,
  agents: readonly FielderAgent[],
  runners: RunnerSituation,
  outs: number,
): Map<FielderPosition, FielderAssignment> {
  const assignments = new Map<FielderPosition, FielderAssignment>();

  // 捕球者のインターセプト点計算
  const primaryAgent = agents.find(a => a.pos === primaryFielder)!;
  const interceptTarget: Vec2 = findInterceptPoint(primaryAgent, trajectory);

  // 捕球者の割り当て
  assignments.set(primaryFielder, {
    state: "PURSUING",
    targetPos: interceptTarget,
    action: "charge",
  });

  // ランナー状況キー取得
  const runnerKey = getRunnerKey(runners);
  const tableKey = `${runnerKey}-${primaryFielder}`;
  const formation = FORMATION_TABLE[tableKey];

  if (!formation) {
    // テーブルにないケース（P/Cゴロでランナー状況が複雑など）はフォールバック
    assignFallback(primaryFielder, throwPlan, trajectory, agents, assignments, runners);
    return assignments;
  }

  // テーブルから各野手のアクションを決定
  for (const agent of agents) {
    if (agent.pos === primaryFielder) continue; // 捕球者はスキップ

    const action = formation[agent.pos] ?? "MINIMAL";
    const assignment = actionToAssignment(action, agent, trajectory, interceptTarget);

    // 同じベースへの重複カバーを防ぐ
    if (assignment.state === "COVERING") {
      const alreadyCovered = [...assignments.values()].some(
        a => a.state === "COVERING" &&
          Math.abs(a.targetPos.x - assignment.targetPos.x) < 2 &&
          Math.abs(a.targetPos.y - assignment.targetPos.y) < 2
      );
      if (alreadyCovered) {
        // 同じベースが既にカバー済み → バックアップに切り替え
        assignments.set(agent.pos, {
          state: "BACKING_UP",
          targetPos: calcDriftPosition(agent.pos, trajectory),
          action: "backup",
        });
        continue;
      }
    }

    assignments.set(agent.pos, assignment);
  }

  return assignments;
}

/**
 * テーブルにないケースのフォールバック（旧ロジック相当）
 */
function assignFallback(
  primaryFielder: FielderPosition,
  throwPlan: ThrowPlan,
  trajectory: BallTrajectory,
  agents: readonly FielderAgent[],
  assignments: Map<FielderPosition, FielderAssignment>,
  runners: RunnerSituation,
): void {
  const interceptTarget = (assignments.get(primaryFielder) as FielderAssignment).targetPos;

  // 送球先のベースカバー（最優先）
  const basesToCover = getBasesToCover(throwPlan, runners);
  for (const base of basesToCover) {
    const coverer = selectCoverer(base, primaryFielder, agents, assignments, trajectory);
    if (coverer) {
      assignments.set(coverer, {
        state: "COVERING",
        targetPos: getBasePosition(base),
        action: "cover_base",
      });
    }
  }

  // 打球方向の外野手がバックアップ
  const backupOutfielder = selectBackupOutfielder(trajectory, agents, assignments);
  if (backupOutfielder) {
    assignments.set(backupOutfielder, {
      state: "BACKING_UP",
      targetPos: calcBackupPosition(trajectory, backupOutfielder),
      action: "backup",
    });
  }

  // 送球先バックアップ
  if (throwPlan.primaryTarget === 1) {
    const rfPos = 9 as FielderPosition;
    if (!assignments.has(rfPos)) {
      assignments.set(rfPos, {
        state: "BACKING_UP",
        targetPos: calcThrowBackupPosition(1, interceptTarget),
        action: "backup",
      });
    }
  }

  // 残り野手
  for (const agent of agents) {
    if (assignments.has(agent.pos)) continue;
    assignments.set(agent.pos, {
      state: "BACKING_UP",
      targetPos: calcDriftPosition(agent.pos, trajectory),
      action: "backup",
    });
  }
}

// ====================================================================
// ベースカバー（フォールバック用）
// ====================================================================

function getBasesToCover(throwPlan: ThrowPlan, runners: RunnerSituation): number[] {
  const bases: number[] = [];
  bases.push(throwPlan.primaryTarget);
  if (throwPlan.isDoublePlay && throwPlan.dpTarget) {
    if (!bases.includes(throwPlan.dpTarget)) bases.push(throwPlan.dpTarget);
  }
  if (runners.second && !bases.includes(3)) bases.push(3);
  if (runners.third && !bases.includes(4)) bases.push(4);
  if (!bases.includes(1)) bases.push(1);
  return bases;
}

function selectCoverer(
  base: number,
  primaryFielder: FielderPosition,
  agents: readonly FielderAgent[],
  alreadyAssigned: Map<FielderPosition, FielderAssignment>,
  trajectory: BallTrajectory,
): FielderPosition | null {
  const available = (pos: FielderPosition) =>
    pos !== primaryFielder && !alreadyAssigned.has(pos);
  const direction = trajectory.direction;

  switch (base) {
    case 1:
      if (available(3)) return 3;
      if (available(1)) return 1;
      if (available(4)) return 4;
      return null;
    case 2:
      if (direction < 0) {
        if (available(4)) return 4;
        if (available(6)) return 6;
      } else {
        if (available(6)) return 6;
        if (available(4)) return 4;
      }
      return null;
    case 3:
      if (available(5)) return 5;
      if (available(6)) return 6;
      return null;
    case 4:
      if (available(2)) return 2;
      if (available(1)) return 1;
      return null;
    default:
      return null;
  }
}

function selectBackupOutfielder(
  trajectory: BallTrajectory,
  agents: readonly FielderAgent[],
  alreadyAssigned: Map<FielderPosition, FielderAssignment>,
): FielderPosition | null {
  const direction = trajectory.direction;
  const outfielders: FielderPosition[] = [];

  if (direction < -15) {
    outfielders.push(7, 8, 9);
  } else if (direction > 15) {
    outfielders.push(9, 8, 7);
  } else {
    outfielders.push(8, 7, 9);
  }

  for (const pos of outfielders) {
    if (!alreadyAssigned.has(pos)) return pos;
  }
  return null;
}

// ====================================================================
// 位置計算ユーティリティ
// ====================================================================

/** バックアップ位置: 捕球地点の後方 */
/**
 * 内野手・投手が打球に向かう位置を計算する（BACKUP_BALL用）。
 * 「自分でも処理するつもりで前進」＝打球地点に近づく。
 * ただし捕球者と重ならないよう、着地点の手前5m程度を目標にする。
 */
function calcApproachPosition(agent: FielderAgent, trajectory: BallTrajectory): Vec2 {
  const landing = trajectory.landingPos;
  const homePos = agent.homePos ?? agent.currentPos;
  const dx = landing.x - homePos.x;
  const dy = landing.y - homePos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: landing.x, y: landing.y };
  // 打球地点の手前5mを目標（捕球者と重ならない）
  const approachDist = Math.max(0, dist - 5);
  return {
    x: homePos.x + (dx / dist) * approachDist,
    y: homePos.y + (dy / dist) * approachDist,
  };
}

function calcBackupPosition(
  trajectory: BallTrajectory,
  fielder: FielderPosition,
): Vec2 {
  const landing = trajectory.landingPos;
  const dist = Math.sqrt(landing.x * landing.x + landing.y * landing.y);
  if (dist < 1) return { x: 0, y: 30 };
  const ratio = (dist + 15) / dist;
  return { x: landing.x * ratio, y: landing.y * ratio };
}

/**
 * 送球先ベース後方のバックアップ位置を計算する。
 */
function calcThrowBackupPosition(base: number, interceptPos?: Vec2): Vec2 {
  const basePos = getBasePosition(base);

  if (interceptPos) {
    const dx = basePos.x - interceptPos.x;
    const dy = basePos.y - interceptPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: basePos.x, y: basePos.y + 10 };
    return {
      x: basePos.x + (dx / dist) * 10,
      y: basePos.y + (dy / dist) * 10,
    };
  }

  const dist = Math.sqrt(basePos.x * basePos.x + basePos.y * basePos.y);
  if (dist < 1) return { x: 0, y: -10 };
  const ratio = (dist + 10) / dist;
  return { x: basePos.x * ratio, y: basePos.y * ratio };
}

/** 送球ラインを避ける位置（投手が送球ライン上に立たないよう） */
function calcAvoidThrowLinePosition(interceptTarget: Vec2, agent: FielderAgent): Vec2 {
  // 投手は送球ライン（捕球点→一塁）を横切らないように避ける。
  // マウンド付近に留まりつつ、打球方向にやや前進してファンブル対応。
  // 捕球点のxが負（三塁側）なら三塁側に寄る、正（一塁側）なら一塁側に寄る。
  const homePos = agent.homePos ?? { x: 0, y: 18.4 };
  const dx = interceptTarget.x - homePos.x;
  const dy = interceptTarget.y - homePos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: homePos.x, y: homePos.y };
  // 打球方向に4m程度だけ移動（全力で追わない）+ 送球ラインから横に3mオフセット
  const moveDist = Math.min(4, dist * 0.3);
  const moveX = homePos.x + (dx / dist) * moveDist;
  const moveY = homePos.y + (dy / dist) * moveDist;
  // 送球ラインから横にずれる（捕球点の反対側）
  const sideOffset = interceptTarget.x < 0 ? -3 : 3;
  return { x: moveX + sideOffset, y: moveY };
}

/** 打球方向に少しドリフトする位置 */
function calcDriftPosition(pos: FielderPosition, trajectory: BallTrajectory): Vec2 {
  const landing = trajectory.landingPos;
  const defPositions: Record<number, Vec2> = {
    1: { x: 0, y: 18 }, 2: { x: 0, y: 2 },
    3: { x: 20, y: 28 }, 4: { x: 8, y: 33 },
    5: { x: -19, y: 27 }, 6: { x: -12, y: 33 },
    7: { x: -30, y: 55 }, 8: { x: 0, y: 65 }, 9: { x: 30, y: 55 },
  };
  const home = defPositions[pos] ?? { x: 0, y: 20 };
  const dx = landing.x - home.x;
  const dy = landing.y - home.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: home.x, y: home.y };
  const driftDist = Math.min(5, dist * 0.3);
  return { x: home.x + (dx / dist) * driftDist, y: home.y + (dy / dist) * driftDist };
}

// ====================================================================
// ユーティリティ
// ====================================================================

/** ゴロの経路上で野手が最も早くインターセプトできる点を見つける */
function findInterceptPoint(
  agent: FielderAgent,
  trajectory: BallTrajectory,
): Vec2 {
  const maxTime = trajectory.flightTime + 3;
  const fielderSpeed = agent.maxSpeed * EFFECTIVE_SPEED_RATIO;
  const reactionTime = agent.baseReactionTime;

  for (let t = 0.1; t <= maxTime; t += 0.1) {
    const ballPos = trajectory.getPositionAt(t);
    const dist = vec2Distance(agent.currentPos, ballPos);
    const fielderTime = reactionTime + dist / fielderSpeed;

    if (fielderTime <= t) {
      return { x: ballPos.x, y: ballPos.y };
    }
  }

  return { x: trajectory.landingPos.x, y: trajectory.landingPos.y };
}

/** 塁番号からベース位置を返す */
function getBasePosition(base: number): Vec2 {
  switch (base) {
    case 1: return { x: BASE_POSITIONS.first.x, y: BASE_POSITIONS.first.y };
    case 2: return { x: BASE_POSITIONS.second.x, y: BASE_POSITIONS.second.y };
    case 3: return { x: BASE_POSITIONS.third.x, y: BASE_POSITIONS.third.y };
    case 4: return { x: BASE_POSITIONS.home.x, y: BASE_POSITIONS.home.y };
    default: return { x: 0, y: 0 };
  }
}
