/**
 * ランナーエージェント — 統一ティックループ用
 *
 * 打球発生の瞬間からランナーを生成し、毎ティック自律的に判断・移動する。
 * 既存のinitRunners / decideExtraBase / decideTagup / decideGroundAdvance を
 * 統一ループ対応に拡張する。
 */
import type { Player } from "../models/player";
import type {
  Vec2,
  BallTrajectory,
  RunnerAgent,
  RunnerState,
  FielderAgent,
  ThrowBallState,
  UnifiedBallState,
} from "./fielding-agent-types";
import {
  BASE_POSITIONS,
  BASE_LENGTH,
  BASE_NAMES,
  vec2Distance,
  clamp,
  gaussianRandom,
} from "./fielding-agent-types";
import {
  RUNNER_SPEED_BASE,
  RUNNER_SPEED_SCALE,
  RUNNER_LEAD_DISTANCE,
  RUNNER_LEAD_SPEED,
  RUNNER_RETREAT_SPEED_RATIO,
} from "./physics-constants";

// --- ヘルパー ---

function getBasePosition(baseNum: number): Vec2 {
  const name = BASE_NAMES[baseNum];
  const pos = name ? BASE_POSITIONS[name] : BASE_POSITIONS.home;
  return { x: pos.x, y: pos.y };
}

function calcRunnerSpeed(player: Player): number {
  return RUNNER_SPEED_BASE + (player.batting.speed / 100) * RUNNER_SPEED_SCALE;
}

function makeRunnerSkill(player: Player) {
  return {
    speed: player.batting.speed,
    baseRunning: player.batting.baseRunning ?? 50,
  };
}

// --- 塁位置定数テーブル ---

interface BaseRunners {
  first: Player | null;
  second: Player | null;
  third: Player | null;
}

/**
 * 打球発生時にランナーを初期化する（統一ループ Phase 0 用）。
 * 全ランナーをHOLDING状態で塁上に配置する。
 * 打者は含まない（打者の追加はcatchSuccess確定後に行う）。
 */
export function initRunnersAtBatStart(
  bases: BaseRunners
): RunnerAgent[] {
  const runners: RunnerAgent[] = [];

  if (bases.first) {
    runners.push({
      player: bases.first,
      state: "HOLDING",
      currentPos: { ...BASE_POSITIONS.first },
      fromBase: 1,
      targetBase: 1,
      speed: calcRunnerSpeed(bases.first),
      progress: 0,
      isBatter: false,
      isForced: false,
      skill: makeRunnerSkill(bases.first),
      originalBase: 1,
    });
  }

  if (bases.second) {
    runners.push({
      player: bases.second,
      state: "HOLDING",
      currentPos: { ...BASE_POSITIONS.second },
      fromBase: 2,
      targetBase: 2,
      speed: calcRunnerSpeed(bases.second),
      progress: 0,
      isBatter: false,
      isForced: false,
      skill: makeRunnerSkill(bases.second),
      originalBase: 2,
    });
  }

  if (bases.third) {
    runners.push({
      player: bases.third,
      state: "HOLDING",
      currentPos: { ...BASE_POSITIONS.third },
      fromBase: 3,
      targetBase: 3,
      speed: calcRunnerSpeed(bases.third),
      progress: 0,
      isBatter: false,
      isForced: false,
      skill: makeRunnerSkill(bases.third),
      originalBase: 3,
    });
  }

  return runners;
}

/**
 * ランナーの知覚状態を更新する。
 * ボールの位置・フェーズ・野手の動きを見て判断材料を更新する。
 *
 * 現在はstub（Stage 4で実装）。
 */
export function updateRunnerPerception(
  _runner: RunnerAgent,
  _ball: UnifiedBallState,
  _agents: readonly FielderAgent[],
  _t: number
): void {
  // Stage 4で実装: ランナーがボール・野手の位置を知覚する
}

/**
 * ランナーの毎ティック自律判断。
 * 現在の状態・ボール状況・野手配置に基づいて次のアクションを決定する。
 *
 * 現在はstub（Stage 4で実装）。
 */
export function runnerAutonomousDecide(
  _runner: RunnerAgent,
  _ball: UnifiedBallState,
  _agents: readonly FielderAgent[],
  _t: number,
  _rng: () => number
): void {
  // Stage 4で実装:
  // - HOLDING中のリード拡大（LEADING遷移）
  // - フライ捕球時の帰塁（RETREATING遷移）
  // - ゴロ時のフォース走塁開始判断
}

/**
 * ランナーをリード状態に遷移させる（塁からリード距離分だけ前進）。
 * Stage 4で有効化される。
 */
export function startLeading(
  runner: RunnerAgent,
  _trajectory: BallTrajectory
): void {
  if (runner.state !== "HOLDING") return;
  runner.state = "LEADING" as RunnerState;

  // リード方向: 現在の塁→次の塁方向に RUNNER_LEAD_DISTANCE だけ
  const nextBase = runner.fromBase + 1;
  if (nextBase > 4) return;
  const fromPos = getBasePosition(runner.fromBase);
  const toPos = getBasePosition(nextBase);
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return;
  const leadFraction = RUNNER_LEAD_DISTANCE / dist;
  runner.currentPos.x = fromPos.x + dx * leadFraction;
  runner.currentPos.y = fromPos.y + dy * leadFraction;
}

/**
 * ランナーを帰塁状態に遷移させる（フライ捕球時）。
 * Stage 4で有効化される。
 */
export function startRetreating(runner: RunnerAgent): void {
  if (runner.state !== "LEADING") return;
  runner.state = "RETREATING" as RunnerState;

  // 帰塁目標: 元の塁
  const basePos = getBasePosition(runner.fromBase);
  runner.targetBase = runner.fromBase;
  runner.currentPos.x = runner.currentPos.x; // 現在位置から帰塁
  runner.currentPos.y = runner.currentPos.y;
}

/**
 * リード中のランナーを移動させる。
 * Stage 4で使用される。
 */
export function moveLeadingRunner(runner: RunnerAgent, dt: number): void {
  if (runner.state !== "LEADING") return;

  const nextBase = runner.fromBase + 1;
  if (nextBase > 4) return;
  const fromPos = getBasePosition(runner.fromBase);
  const toPos = getBasePosition(nextBase);
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return;

  // リード目標位置
  const leadFraction = RUNNER_LEAD_DISTANCE / dist;
  const targetX = fromPos.x + dx * leadFraction;
  const targetY = fromPos.y + dy * leadFraction;

  // リード速度で移動
  const diffX = targetX - runner.currentPos.x;
  const diffY = targetY - runner.currentPos.y;
  const diffDist = Math.sqrt(diffX * diffX + diffY * diffY);
  if (diffDist < 0.05) return;

  const moveDist = RUNNER_LEAD_SPEED * dt;
  if (moveDist >= diffDist) {
    runner.currentPos.x = targetX;
    runner.currentPos.y = targetY;
  } else {
    runner.currentPos.x += (diffX / diffDist) * moveDist;
    runner.currentPos.y += (diffY / diffDist) * moveDist;
  }
}

/**
 * 帰塁中のランナーを移動させる。
 * Stage 4で使用される。
 */
export function moveRetreatingRunner(runner: RunnerAgent, dt: number): void {
  if (runner.state !== "RETREATING") return;

  const basePos = getBasePosition(runner.fromBase);
  const dx = basePos.x - runner.currentPos.x;
  const dy = basePos.y - runner.currentPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) {
    // 帰塁完了 → WAITING_TAG に遷移
    runner.currentPos.x = basePos.x;
    runner.currentPos.y = basePos.y;
    runner.state = "WAITING_TAG";
    return;
  }

  const retreatSpeed = runner.speed * RUNNER_RETREAT_SPEED_RATIO;
  const moveDist = retreatSpeed * dt;
  if (moveDist >= dist) {
    runner.currentPos.x = basePos.x;
    runner.currentPos.y = basePos.y;
    runner.state = "WAITING_TAG";
  } else {
    runner.currentPos.x += (dx / dist) * moveDist;
    runner.currentPos.y += (dy / dist) * moveDist;
  }
}
