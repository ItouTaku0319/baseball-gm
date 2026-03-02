// 打球物理計算関数
// batted-ball-trajectory.tsx から抽出

import { GRAVITY, BAT_HEIGHT, DRAG_FACTOR, FLIGHT_TIME_FACTOR, GROUND_BALL_AVG_SPEED_RATIO } from "@/engine/physics-constants";
import { getFenceDistance, estimateDistance } from "@/engine/simulation";
import { toFieldSvg, clampNum } from "./field-coords";

export { estimateDistance };

// ---- 飛行時間計算 ----

export function getBallFlightTime(exitVelocityKmh: number, launchAngleDeg: number): number {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vy = v * Math.sin(theta);
  const rawTime = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * BAT_HEIGHT)) / GRAVITY;
  return rawTime * FLIGHT_TIME_FACTOR;
}

export function getGroundBallTime(exitVelocityKmh: number, distM: number): number {
  const vGround = (exitVelocityKmh / 3.6) * GROUND_BALL_AVG_SPEED_RATIO;
  return vGround > 0 ? distM / vGround : 2.0;
}

/** フライボールがフェンスの水平距離に到達する時刻を計算 */
export function getFenceArrivalTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  directionDeg: number,
  distScale: number = 1,
): number {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vx = v * Math.cos(theta);
  const fenceDist = getFenceDistance(directionDeg);
  const effectiveVx = vx * DRAG_FACTOR * distScale;
  if (effectiveVx <= 0) return Infinity;
  return fenceDist / effectiveVx;
}

// ---- フライ打球状態 ----

/** フライ打球の時刻tにおける状態（地面投影位置・高さ）を返す */
export function getBallStateAtTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  direction: number,
  t: number,
  distScale: number = 1,
  scale?: number,
  homeX?: number,
  homeY?: number,
): { groundPos: { x: number; y: number }; height: number } | null {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;

  const vx = v * Math.cos(theta);
  const vy = v * Math.sin(theta);

  const disc = vy * vy + 2 * GRAVITY * BAT_HEIGHT;
  if (disc < 0) return null;
  const tFlight = (vy + Math.sqrt(disc)) / GRAVITY * FLIGHT_TIME_FACTOR;
  if (t > tFlight + 0.001) return null;

  const horizontalDist = vx * Math.min(t, tFlight) * DRAG_FACTOR * distScale;
  const height = Math.max(0, BAT_HEIGHT + vy * t - 0.5 * GRAVITY * t * t);
  const groundPos = toFieldSvg(horizontalDist, direction, scale, homeX, homeY);

  return { groundPos, height };
}

// ---- フライ着地後バウンド ----

/** フライ着地後のバウンドフェーズの状態を返す（フィールドビュー用） */
export function getFieldBounceStateAtTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  direction: number,
  landingDist: number,
  tAfterLanding: number,
  fenceDist?: number,
  scale?: number,
  homeX?: number,
  homeY?: number,
): { groundPos: { x: number; y: number }; bounceHeight: number; firstBounceMaxH: number; totalBounceTime: number; isOnGround: boolean; hitFence?: boolean; fenceHitTime?: number } | null {
  const restitution = 0.3;
  const friction = 0.8;

  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vx = v * Math.cos(theta) * DRAG_FACTOR;
  const vyInit = v * Math.sin(theta);

  const disc = vyInit * vyInit + 2 * GRAVITY * BAT_HEIGHT;
  if (disc < 0) return null;
  const tFlight = (vyInit + Math.sqrt(disc)) / GRAVITY * FLIGHT_TIME_FACTOR;
  const vyLanding = Math.abs(vyInit - GRAVITY * tFlight);

  // 各バウンドを列挙
  const maxBounces = 3;
  let currentVy = vyLanding * restitution;
  let currentVx = vx * friction;
  let cumHorizontalDist = 0;
  let cumTime = 0;

  const firstBounceMaxH = (currentVy * currentVy) / (2 * GRAVITY);

  type BounceInterval = { tStart: number; tEnd: number; vy0: number; vx0: number; horizStart: number };
  const intervals: BounceInterval[] = [];

  const maxDistToFence = fenceDist != null ? fenceDist - landingDist : Infinity;

  for (let b = 0; b < maxBounces; b++) {
    const tBounce = 2 * currentVy / GRAVITY;
    if (tBounce < 0.02 || currentVy < 0.3) break;
    const bounceHorizDist = currentVx * tBounce;
    if (cumHorizontalDist + bounceHorizDist > maxDistToFence) {
      const distRemaining = maxDistToFence - cumHorizontalDist;
      const tToFence = currentVx > 0 ? distRemaining / currentVx : 0;
      intervals.push({
        tStart: cumTime,
        tEnd: cumTime + tToFence,
        vy0: currentVy,
        vx0: currentVx,
        horizStart: cumHorizontalDist,
      });
      cumTime += tToFence;
      cumHorizontalDist = maxDistToFence;
      break;
    }
    intervals.push({
      tStart: cumTime,
      tEnd: cumTime + tBounce,
      vy0: currentVy,
      vx0: currentVx,
      horizStart: cumHorizontalDist,
    });
    cumTime += tBounce;
    cumHorizontalDist += bounceHorizDist;
    currentVy *= restitution;
    currentVx *= friction;
  }

  const hitFence = fenceDist != null && cumHorizontalDist >= maxDistToFence - 0.01;

  // フェンス跳ね返りフェーズ
  if (hitFence) {
    const fenceHitTime = cumTime;
    const wallRestitution = 0.25;
    const reboundVx = currentVx * wallRestitution;
    const reboundVy = 2.0;
    const t1 = 2 * reboundVy / GRAVITY;
    const dist1 = reboundVx * t1;
    const secondVy = reboundVy * 0.3;
    const secondVx = reboundVx * 0.4;
    const t2 = 2 * secondVy / GRAVITY;
    const dist2 = secondVx * t2;
    const wallRollTime = 0.3;
    const wallRollDist = 0.5;
    const reboundTotalTime = t1 + t2 + wallRollTime;
    const totalBounceTime = fenceHitTime + reboundTotalTime;

    if (tAfterLanding < fenceHitTime) {
      for (const interval of intervals) {
        if (tAfterLanding >= interval.tStart && tAfterLanding < interval.tEnd) {
          const tLocal = tAfterLanding - interval.tStart;
          const bounceHeight = interval.vy0 * tLocal - 0.5 * GRAVITY * tLocal * tLocal;
          const horizDist = interval.horizStart + interval.vx0 * tLocal;
          const totalDist = landingDist + Math.min(horizDist, maxDistToFence);
          const isOnGround = tLocal < 0.03 || (interval.tEnd - interval.tStart - tLocal) < 0.03;
          return {
            groundPos: toFieldSvg(totalDist, direction, scale, homeX, homeY),
            bounceHeight: Math.max(0, bounceHeight),
            firstBounceMaxH,
            totalBounceTime,
            isOnGround,
            hitFence: true,
            fenceHitTime,
          };
        }
      }
    }

    const tAfterFence = tAfterLanding - fenceHitTime;
    let reboundDist: number;
    let reboundHeight: number;
    if (tAfterFence <= t1) {
      reboundDist = reboundVx * tAfterFence;
      reboundHeight = Math.max(0, reboundVy * tAfterFence - 0.5 * GRAVITY * tAfterFence * tAfterFence);
    } else if (tAfterFence <= t1 + t2) {
      const t = tAfterFence - t1;
      reboundDist = dist1 + secondVx * t;
      reboundHeight = Math.max(0, secondVy * t - 0.5 * GRAVITY * t * t);
    } else {
      const rollProgress = Math.min((tAfterFence - t1 - t2) / wallRollTime, 1);
      reboundDist = dist1 + dist2 + wallRollDist * rollProgress;
      reboundHeight = 0;
    }

    const finalDist = Math.max(0, fenceDist! - reboundDist);
    return {
      groundPos: toFieldSvg(finalDist, direction, scale, homeX, homeY),
      bounceHeight: reboundHeight,
      firstBounceMaxH,
      totalBounceTime,
      isOnGround: reboundHeight < 0.05,
      hitFence: true,
      fenceHitTime,
    };
  }

  // フェンスに到達しない通常バウンド
  const rollDist = cumHorizontalDist * 0.15;
  const rollSpeed = Math.max(currentVx, 1);
  const rollTime = rollDist > 0 ? Math.min(rollDist / rollSpeed, 0.5) : 0;
  const totalBounceTime = cumTime + rollTime;

  for (const interval of intervals) {
    if (tAfterLanding >= interval.tStart && tAfterLanding < interval.tEnd) {
      const tLocal = tAfterLanding - interval.tStart;
      const bounceHeight = interval.vy0 * tLocal - 0.5 * GRAVITY * tLocal * tLocal;
      const horizDist = interval.horizStart + interval.vx0 * tLocal;
      const totalDist = landingDist + horizDist;
      const isOnGround = tLocal < 0.03 || (interval.tEnd - interval.tStart - tLocal) < 0.03;
      return {
        groundPos: toFieldSvg(totalDist, direction, scale, homeX, homeY),
        bounceHeight: Math.max(0, bounceHeight),
        firstBounceMaxH,
        totalBounceTime,
        isOnGround,
      };
    }
  }

  if (tAfterLanding >= cumTime && tAfterLanding <= totalBounceTime) {
    const rollProgress = rollTime > 0 ? Math.min((tAfterLanding - cumTime) / rollTime, 1) : 1;
    const totalDist = landingDist + cumHorizontalDist + rollDist * rollProgress;
    return {
      groundPos: toFieldSvg(totalDist, direction, scale, homeX, homeY),
      bounceHeight: 0,
      firstBounceMaxH,
      totalBounceTime,
      isOnGround: true,
    };
  }

  const totalDist = landingDist + cumHorizontalDist + rollDist;
  return {
    groundPos: toFieldSvg(totalDist, direction, scale, homeX, homeY),
    bounceHeight: 0,
    firstBounceMaxH,
    totalBounceTime,
    isOnGround: true,
  };
}

// ---- フェンス直撃跳ね返り ----

/** フェンス直撃後の跳ね返り状態を返す（フィールドビュー用） */
export function getFenceBounceBackStateAtTime(
  fenceDist: number,
  direction: number,
  exitVelocityKmh: number,
  launchAngleDeg: number,
  tAfterFenceHit: number,
  scale?: number,
  homeX?: number,
  homeY?: number,
): { groundPos: { x: number; y: number }; bounceHeight: number; totalBounceTime: number } | null {
  const v = exitVelocityKmh / 3.6;
  const theta = Math.max(launchAngleDeg, 5) * Math.PI / 180;
  const vx = v * Math.cos(theta) * DRAG_FACTOR;

  const fenceRestitution = 0.25;
  const reboundVx = vx * fenceRestitution;
  const reboundVy = 2.5;

  const t1 = 2 * reboundVy / GRAVITY;
  const dist1 = reboundVx * t1;

  const secondVy = reboundVy * 0.3;
  const secondVx = reboundVx * 0.5;
  const t2 = 2 * secondVy / GRAVITY;
  const dist2 = secondVx * t2;

  const rollTime = 0.3;
  const rollDist = 1.0;

  const totalBounceTime = t1 + t2 + rollTime;

  if (tAfterFenceHit < 0) return null;

  let dist: number;
  let height: number;

  if (tAfterFenceHit <= t1) {
    const t = tAfterFenceHit;
    dist = fenceDist - reboundVx * t;
    height = Math.max(0, reboundVy * t - 0.5 * GRAVITY * t * t);
  } else if (tAfterFenceHit <= t1 + t2) {
    const t = tAfterFenceHit - t1;
    dist = fenceDist - dist1 - secondVx * t;
    height = Math.max(0, secondVy * t - 0.5 * GRAVITY * t * t);
  } else {
    const rollProgress = Math.min((tAfterFenceHit - t1 - t2) / rollTime, 1);
    dist = fenceDist - dist1 - dist2 - rollDist * rollProgress;
    height = 0;
  }

  return {
    groundPos: toFieldSvg(Math.max(0, dist), direction, scale, homeX, homeY),
    bounceHeight: Math.max(0, height),
    totalBounceTime,
  };
}

/** フェンス直撃後の跳ね返り軌道ポイントを計算（サイドビュー用） */
export function computeFenceBounceBackPoints(
  fenceDist: number,
  exitVelocityKmh: number,
  launchAngleDeg: number,
  heightAtFence: number,
): { x: number; y: number }[] {
  const v = exitVelocityKmh / 3.6;
  const theta = Math.max(launchAngleDeg, 5) * Math.PI / 180;
  const vx = v * Math.cos(theta) * DRAG_FACTOR * FLIGHT_TIME_FACTOR;

  const fenceRestitution = 0.25;
  const reboundVx = vx * fenceRestitution;

  const points: { x: number; y: number }[] = [];

  const tDrop = Math.sqrt(2 * Math.max(heightAtFence, 0) / GRAVITY);
  const dropSteps = 10;
  for (let i = 0; i <= dropSteps; i++) {
    const t = (i / dropSteps) * tDrop;
    points.push({
      x: fenceDist - reboundVx * t,
      y: Math.max(0, heightAtFence - 0.5 * GRAVITY * t * t),
    });
  }

  let cumX = fenceDist - reboundVx * tDrop;
  const bounceRestitution = 0.3;
  let vy = Math.sqrt(2 * GRAVITY * Math.max(heightAtFence, 0.5)) * bounceRestitution;
  let currentVx = reboundVx * 0.8;

  for (let b = 0; b < 2; b++) {
    const tBounce = 2 * vy / GRAVITY;
    if (tBounce < 0.02 || vy < 0.2) break;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * tBounce;
      points.push({
        x: cumX - currentVx * t,
        y: Math.max(0, vy * t - 0.5 * GRAVITY * t * t),
      });
    }
    cumX -= currentVx * tBounce;
    vy *= bounceRestitution;
    currentVx *= 0.7;
  }

  return points;
}

// ---- ゴロ打球 ----

/** ゴロ打球のバウンド物理をタイムライン化して返す */
export function buildGroundBallTimeline(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  totalDist: number,
) {
  const restitution = 0.35;
  const friction = 0.85;

  const v = exitVelocityKmh / 3.6;
  const absAngle = Math.max(Math.abs(launchAngleDeg), 2);
  const theta = absAngle * Math.PI / 180;
  let vx = v * Math.cos(theta) * GROUND_BALL_AVG_SPEED_RATIO;

  const tFirstDrop = Math.sqrt(2 * BAT_HEIGHT / GRAVITY);
  const xFirstDrop = vx * tFirstDrop;

  type Segment = { tStart: number; tEnd: number; xStart: number; vx: number; vy0: number; isDropPhase?: boolean };
  const segments: Segment[] = [];
  let cumTime = 0;
  let cumX = 0;

  segments.push({ tStart: 0, tEnd: tFirstDrop, xStart: 0, vx, vy0: 0, isDropPhase: true });
  cumTime = tFirstDrop;
  cumX = xFirstDrop;

  let vy = Math.sqrt(2 * GRAVITY * BAT_HEIGHT) * restitution;

  for (let bounce = 0; bounce < 3; bounce++) {
    vx *= friction;
    const tBounce = 2 * vy / GRAVITY;
    if (tBounce < 0.01 || vy < 0.1) break;
    segments.push({ tStart: cumTime, tEnd: cumTime + tBounce, xStart: cumX, vx, vy0: vy });
    cumTime += tBounce;
    cumX += vx * tBounce;
    vy *= restitution;
  }

  const rollDist = Math.max(0, totalDist - cumX);
  const rollSpeed = Math.max(vx * 0.6, 0.5);
  const rollTime = rollDist > 0 ? Math.min(rollDist / rollSpeed, 1.0) : 0;

  const firstBounceVy = Math.sqrt(2 * GRAVITY * BAT_HEIGHT) * restitution;
  const firstBounceMaxH = (firstBounceVy * firstBounceVy) / (2 * GRAVITY);

  return { segments, cumTime, cumX, rollDist, rollSpeed, rollTime, totalTime: cumTime + rollTime, firstBounceMaxH };
}

/** ゴロ打球の時刻tにおける状態を返す（バウンド物理） */
export function getGroundBallStateAtTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  direction: number,
  totalDist: number,
  t: number,
  scale?: number,
  homeX?: number,
  homeY?: number,
): { groundPos: { x: number; y: number }; bounceHeight: number; firstBounceMaxH: number; isOnGround: boolean; totalTime: number } | null {
  const tl = buildGroundBallTimeline(exitVelocityKmh, launchAngleDeg, totalDist);
  if (tl.totalTime <= 0) return null;

  const tc = clampNum(t, 0, tl.totalTime);

  for (const seg of tl.segments) {
    if (tc >= seg.tStart && tc < seg.tEnd) {
      const tLocal = tc - seg.tStart;
      const x = seg.xStart + seg.vx * tLocal;

      if (seg.isDropPhase) {
        const h = Math.max(0, BAT_HEIGHT - 0.5 * GRAVITY * tLocal * tLocal);
        const isOnGround = tLocal < 0.02 || (seg.tEnd - seg.tStart - tLocal) < 0.02;
        return { groundPos: toFieldSvg(x, direction, scale, homeX, homeY), bounceHeight: h, firstBounceMaxH: tl.firstBounceMaxH, isOnGround, totalTime: tl.totalTime };
      }

      const h = Math.max(0, seg.vy0 * tLocal - 0.5 * GRAVITY * tLocal * tLocal);
      const isOnGround = tLocal < 0.03 || (seg.tEnd - seg.tStart - tLocal) < 0.03;
      return { groundPos: toFieldSvg(x, direction, scale, homeX, homeY), bounceHeight: h, firstBounceMaxH: tl.firstBounceMaxH, isOnGround, totalTime: tl.totalTime };
    }
  }

  if (tc >= tl.cumTime) {
    const rollProgress = tl.rollTime > 0 ? Math.min((tc - tl.cumTime) / tl.rollTime, 1) : 1;
    const x = tl.cumX + tl.rollDist * rollProgress;
    return { groundPos: toFieldSvg(x, direction, scale, homeX, homeY), bounceHeight: 0, firstBounceMaxH: tl.firstBounceMaxH, isOnGround: true, totalTime: tl.totalTime };
  }

  return { groundPos: toFieldSvg(totalDist, direction, scale, homeX, homeY), bounceHeight: 0, firstBounceMaxH: tl.firstBounceMaxH, isOnGround: true, totalTime: tl.totalTime };
}

// ---- サイドビュー用 ----

export function computeTrajectoryPoints(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  numPoints: number = 30
): { x: number; y: number }[] {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vx = v * Math.cos(theta);
  const vy = v * Math.sin(theta);

  const disc = vy * vy + 2 * GRAVITY * BAT_HEIGHT;
  if (disc < 0) return [{ x: 0, y: BAT_HEIGHT }];
  const tFlight = (vy + Math.sqrt(disc)) / GRAVITY;
  const xScale = DRAG_FACTOR * FLIGHT_TIME_FACTOR;

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = (i / numPoints) * tFlight;
    points.push({
      x: vx * t * xScale,
      y: Math.max(0, BAT_HEIGHT + vy * t - 0.5 * GRAVITY * t * t),
    });
  }
  return points;
}

/** フライ着地後のバウンドポイントを計算する */
export function computeBouncePoints(
  lastPoint: { x: number; y: number },
  exitVelocityKmh: number,
  launchAngleDeg: number,
  maxBounces: number = 2,
  fenceDist?: number,
): { x: number; y: number }[] {
  const restitution = 0.3;
  const friction = 0.8;

  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vx = v * Math.cos(theta) * DRAG_FACTOR * FLIGHT_TIME_FACTOR;

  const vyInit = v * Math.sin(theta);
  const disc = vyInit * vyInit + 2 * GRAVITY * BAT_HEIGHT;
  const tFlight = disc >= 0 ? (vyInit + Math.sqrt(disc)) / GRAVITY : 0;
  const vyLanding = Math.abs(vyInit - GRAVITY * tFlight);

  let currentVy = vyLanding * restitution;
  let currentVx = vx * friction;
  const bouncePoints: { x: number; y: number }[] = [];
  let cumX = lastPoint.x;
  let hitFence = false;

  for (let b = 0; b < maxBounces; b++) {
    const tBounce = 2 * currentVy / GRAVITY;
    if (tBounce < 0.02 || currentVy < 0.3) break;

    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * tBounce;
      const px = cumX + currentVx * t;
      const py = currentVy * t - 0.5 * GRAVITY * t * t;

      if (fenceDist != null && px >= fenceDist) {
        bouncePoints.push({ x: fenceDist, y: Math.max(0, py) });
        hitFence = true;
        break;
      }
      bouncePoints.push({ x: px, y: py });
    }
    if (hitFence) break;
    cumX += currentVx * tBounce;
    currentVy *= restitution;
    currentVx *= friction;
  }

  if (hitFence && fenceDist != null) {
    const wallRestitution = 0.25;
    const reboundVx = currentVx * wallRestitution;
    const reboundVy = 2.0;
    const t1 = 2 * reboundVy / GRAVITY;
    const steps1 = 10;
    for (let i = 1; i <= steps1; i++) {
      const t = (i / steps1) * t1;
      bouncePoints.push({
        x: fenceDist - reboundVx * t,
        y: reboundVy * t - 0.5 * GRAVITY * t * t,
      });
    }
    const v2y = reboundVy * 0.3;
    const v2x = reboundVx * 0.4;
    const t2 = 2 * v2y / GRAVITY;
    const dist1 = reboundVx * t1;
    const steps2 = 6;
    for (let i = 1; i <= steps2; i++) {
      const t = (i / steps2) * t2;
      bouncePoints.push({
        x: fenceDist - dist1 - v2x * t,
        y: v2y * t - 0.5 * GRAVITY * t * t,
      });
    }
  }

  return bouncePoints;
}
