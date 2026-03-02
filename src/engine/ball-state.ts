/**
 * 統一ボール状態管理
 *
 * Phase 1/2 を統一ループで処理するためのボール状態モデル。
 * BallPhaseに応じたボール位置計算とフェーズ遷移を管理する。
 */
import type {
  Vec2,
  BallTrajectory,
  UnifiedBallState,
  BallPhase,
  FielderAgent,
  CatchResult,
  ThrowBallState,
} from "./fielding-agent-types";
import { vec2Distance } from "./fielding-agent-types";

/**
 * BallTrajectoryからUnifiedBallStateを初期化する。
 * 初期フェーズはIN_FLIGHT（打球飛行中）。
 */
export function createUnifiedBallState(
  trajectory: BallTrajectory,
  restPos: Vec2
): UnifiedBallState {
  const initialPos = trajectory.getPositionAt(0);
  return {
    phase: "IN_FLIGHT",
    trajectory,
    holder: null,
    throwState: null,
    currentPos: { x: initialPos.x, y: initialPos.y },
    currentHeight: trajectory.getHeightAt(0),
    currentSpeed: trajectory.exitVelocity * (1000 / 3600), // km/h → m/s
    restPos: { x: restPos.x, y: restPos.y },
  };
}

/**
 * ボール位置をフェーズに応じて更新する。
 * GC圧力削減のためcurrentPosを直接書き換える。
 */
export function updateBallPosition(
  ball: UnifiedBallState,
  t: number,
  posBuf: Vec2
): void {
  switch (ball.phase) {
    case "IN_FLIGHT": {
      ball.trajectory.getPositionAt(t, posBuf);
      ball.currentPos.x = posBuf.x;
      ball.currentPos.y = posBuf.y;
      ball.currentHeight = ball.trajectory.getHeightAt(t);
      if (ball.trajectory.isGroundBall) {
        ball.currentSpeed = ball.trajectory.getSpeedAt(t);
      }
      break;
    }
    case "ON_GROUND": {
      updateGroundBallPosition(ball, t, posBuf);
      ball.currentHeight = 0;
      break;
    }
    case "HELD": {
      if (ball.holder) {
        ball.currentPos.x = ball.holder.currentPos.x;
        ball.currentPos.y = ball.holder.currentPos.y;
        ball.currentHeight = 1.5; // 手の高さ
        ball.currentSpeed = 0;
      }
      break;
    }
    case "THROWN": {
      if (ball.throwState) {
        const progress = Math.min(
          1,
          Math.max(0, (t - ball.throwState.startTime) / (ball.throwState.arrivalTime - ball.throwState.startTime))
        );
        ball.currentPos.x = ball.throwState.fromPos.x + (ball.throwState.toPos.x - ball.throwState.fromPos.x) * progress;
        ball.currentPos.y = ball.throwState.fromPos.y + (ball.throwState.toPos.y - ball.throwState.fromPos.y) * progress;
        ball.currentHeight = 2.0 * Math.sin(Math.PI * progress); // 放物線近似
        ball.currentSpeed = ball.throwState.speed;
      }
      break;
    }
  }
}

/**
 * ボールのフェーズを遷移させる。
 * 明示的なフェーズ遷移のみを処理（自動遷移はtickループ側で判断）。
 */
export function transitionBallPhase(
  ball: UnifiedBallState,
  newPhase: BallPhase,
  options?: {
    holder?: FielderAgent;
    throwState?: ThrowBallState;
    catchResult?: CatchResult;
    catchTime?: number;
    catcherAgent?: FielderAgent;
  }
): void {
  ball.phase = newPhase;

  switch (newPhase) {
    case "HELD":
      ball.holder = options?.holder ?? null;
      ball.throwState = null;
      if (options?.catchResult) ball.catchResult = options.catchResult;
      if (options?.catchTime !== undefined) ball.catchTime = options.catchTime;
      if (options?.catcherAgent) ball.catcherAgent = options.catcherAgent;
      break;
    case "THROWN":
      ball.throwState = options?.throwState ?? null;
      ball.holder = null;
      break;
    case "ON_GROUND":
      ball.holder = null;
      ball.throwState = null;
      break;
    case "IN_FLIGHT":
      ball.holder = null;
      ball.throwState = null;
      break;
  }
}

/**
 * 着地後のボール地上位置を計算する（ON_GROUNDフェーズ用）。
 * ゴロ: trajectoryの等減速モデルを使用。
 * フライ/ライナー: 着弾後にrestPosへ向かってロール。
 */
function updateGroundBallPosition(
  ball: UnifiedBallState,
  t: number,
  posBuf: Vec2
): void {
  const trajectory = ball.trajectory;
  const restPos = ball.restPos;

  if (trajectory.isGroundBall) {
    const clampedT = Math.min(t, trajectory.flightTime);
    trajectory.getPositionAt(clampedT, posBuf);
    ball.currentPos.x = posBuf.x;
    ball.currentPos.y = posBuf.y;
    ball.currentSpeed = trajectory.getSpeedAt(t);
    return;
  }

  // フライ/ライナー着弾後のロール
  if (!restPos) {
    ball.currentPos.x = trajectory.landingPos.x;
    ball.currentPos.y = trajectory.landingPos.y;
    ball.currentSpeed = 0;
    return;
  }

  const timeSinceLanding = t - trajectory.flightTime;
  const rollDist = vec2Distance(trajectory.landingPos, restPos);
  if (rollDist < 0.5) {
    ball.currentPos.x = restPos.x;
    ball.currentPos.y = restPos.y;
    ball.currentSpeed = 0;
    return;
  }
  const avgRollSpeed = 3.0; // m/s (草地ロール平均速度)
  const totalRollTime = rollDist / avgRollSpeed;
  const progress = Math.min(1, timeSinceLanding / totalRollTime);
  const eased = 2 * progress - progress * progress; // 等減速曲線
  ball.currentPos.x = trajectory.landingPos.x + (restPos.x - trajectory.landingPos.x) * eased;
  ball.currentPos.y = trajectory.landingPos.y + (restPos.y - trajectory.landingPos.y) * eased;
  ball.currentSpeed = progress >= 1 ? 0 : avgRollSpeed * (1 - progress);
}
