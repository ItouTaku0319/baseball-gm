/**
 * ボール軌道 — BallTrajectory 実装
 * calcBallLanding と完全互換の物理モデルで、時刻tにおける位置を返す
 */
import type { BallTrajectory, BallType, Vec2 } from "./fielding-agent-types";
import { clamp } from "./fielding-agent-types";
import {
  GRAVITY,
  BAT_HEIGHT,
  DRAG_FACTOR,
  FLIGHT_TIME_FACTOR,
  GROUND_BALL_ANGLE_THRESHOLD,
  GROUND_BALL_MAX_DISTANCE,
  GROUND_BALL_SPEED_FACTOR,
  GROUND_BALL_AVG_SPEED_RATIO,
  GROUND_BALL_BOUNCE_ANGLE_SCALE,
} from "./physics-constants";

/** 打球タイプ分類 (simulation.ts の classifyBattedBallType と完全一致) */
function classifyBallType(launchAngle: number, exitVelocity: number): BallType {
  if (launchAngle >= 50) return "popup";
  if (launchAngle < GROUND_BALL_ANGLE_THRESHOLD) return "ground_ball";
  // 10-19°: ライナー帯（低速・低角度の弱い打球はゴロ扱い）
  if (launchAngle < 20) {
    if (launchAngle < 12 && exitVelocity < 85) return "ground_ball";
    return "line_drive";
  }
  // 20°以上: フライ
  return "fly_ball";
}

/** BallTrajectory を生成 */
export function createBallTrajectory(
  direction: number,
  launchAngle: number,
  exitVelocity: number
): BallTrajectory {
  const ballType = classifyBallType(launchAngle, exitVelocity);
  const angleRad = ((direction - 45) * Math.PI) / 180;
  const v0 = exitVelocity / 3.6; // km/h → m/s
  const isGroundBall = launchAngle < GROUND_BALL_ANGLE_THRESHOLD;

  if (isGroundBall) {
    return createGroundBallTrajectory(
      direction,
      launchAngle,
      v0,
      angleRad,
      ballType
    );
  }
  return createFlyTrajectory(
    direction,
    launchAngle,
    v0,
    angleRad,
    ballType
  );
}

function createGroundBallTrajectory(
  direction: number,
  launchAngle: number,
  v0: number,
  angleRad: number,
  ballType: BallType
): BallTrajectory {
  // calcBallLanding 完全準拠
  const bounceFactor =
    launchAngle < 0
      ? Math.max(0.3, 1 + launchAngle / GROUND_BALL_BOUNCE_ANGLE_SCALE)
      : 1 - (launchAngle / GROUND_BALL_ANGLE_THRESHOLD) * 0.15;
  const maxDist =
    Math.min(GROUND_BALL_MAX_DISTANCE, v0 * GROUND_BALL_SPEED_FACTOR) *
    bounceFactor;
  const stopTime = maxDist / (v0 * GROUND_BALL_AVG_SPEED_RATIO);

  const pathDirX = Math.sin(angleRad);
  const pathDirY = Math.cos(angleRad);

  const landingPos: Vec2 = {
    x: maxDist * pathDirX,
    y: maxDist * pathDirY,
  };

  // 等減速モデル: v0_eff = 2 * maxDist / stopTime
  const v0Eff = stopTime > 0 ? (2 * maxDist) / stopTime : 0;

  return {
    landingPos,
    landingDistance: maxDist,
    flightTime: stopTime,
    isGroundBall: true,
    maxHeight: 0,
    direction,
    ballType,
    launchAngle,
    exitVelocity: v0 * 3.6, // m/s → km/h
    groundSpeed: stopTime > 0 ? maxDist / stopTime : 0,
    pathDirX,
    pathDirY,

    getPositionAt(t: number, out?: Vec2): Vec2 {
      const p = clamp(t / stopTime, 0, 1);
      const dist = maxDist * (2 * p - p * p);
      if (out) {
        out.x = dist * pathDirX;
        out.y = dist * pathDirY;
        return out;
      }
      return { x: dist * pathDirX, y: dist * pathDirY };
    },

    getHeightAt(_t: number): number {
      return 0;
    },

    getSpeedAt(t: number): number {
      if (t >= stopTime) return 0;
      return v0Eff * (1 - t / stopTime);
    },

    isOnGround(_t: number): boolean {
      return true;
    },
  };
}

function createFlyTrajectory(
  direction: number,
  launchAngle: number,
  v0: number,
  angleRad: number,
  ballType: BallType
): BallTrajectory {
  const theta = (launchAngle * Math.PI) / 180;
  const vy0 = v0 * Math.sin(theta);
  const vx = v0 * Math.cos(theta);

  const tUp = vy0 / GRAVITY;
  const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * GRAVITY);
  const tDown = Math.sqrt(2 * maxH / GRAVITY);
  const rawFlight = (tUp + tDown) * FLIGHT_TIME_FACTOR;
  const horizDist = vx * rawFlight * DRAG_FACTOR;

  // 水平速度は一定 (drag 込み)
  const hRate = rawFlight > 0 ? horizDist / rawFlight : 0;

  const pathDirX = Math.sin(angleRad);
  const pathDirY = Math.cos(angleRad);

  const landingPos: Vec2 = {
    x: horizDist * pathDirX,
    y: horizDist * pathDirY,
  };

  return {
    landingPos,
    landingDistance: horizDist,
    flightTime: rawFlight,
    isGroundBall: false,
    maxHeight: maxH,
    direction,
    ballType,
    launchAngle,
    exitVelocity: v0 * 3.6, // m/s → km/h

    getPositionAt(t: number, out?: Vec2): Vec2 {
      const tc = clamp(t, 0, rawFlight);
      const d = hRate * tc;
      let x = d * pathDirX;
      let y = d * pathDirY;
      // 着地後ロール
      if (t > rawFlight) {
        const roll = Math.min(5, (t - rawFlight) * 2);
        x += roll * pathDirX;
        y += roll * pathDirY;
      }
      if (out) {
        out.x = x;
        out.y = y;
        return out;
      }
      return { x, y };
    },

    getHeightAt(t: number): number {
      if (t >= rawFlight) return 0;
      // 時間を drag 前に逆マッピング
      const tPhys = t / FLIGHT_TIME_FACTOR;
      const h = BAT_HEIGHT + vy0 * tPhys - 0.5 * GRAVITY * tPhys * tPhys;
      return Math.max(0, h);
    },

    getSpeedAt(_t: number): number {
      // フライは瞬時地上速度を返さない (ゴロ専用)
      return 0;
    },

    isOnGround(t: number): boolean {
      return t >= rawFlight;
    },
  };
}
