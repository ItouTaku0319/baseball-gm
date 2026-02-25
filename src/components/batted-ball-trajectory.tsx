"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { AtBatLog } from "@/models/league";
import { getFenceDistance, estimateDistance } from "@/engine/simulation";
import { GRAVITY, BAT_HEIGHT, DRAG_FACTOR, FLIGHT_TIME_FACTOR, GROUND_BALL_AVG_SPEED_RATIO, FENCE_HEIGHT } from "@/engine/physics-constants";

// ---- ユーティリティ ----

const resultNamesJa: Record<string, string> = {
  single: "ヒット",
  double: "ツーベース",
  triple: "スリーベース",
  homerun: "ホームラン",
  strikeout: "三振",
  walk: "四球",
  hitByPitch: "死球",
  groundout: "ゴロアウト",
  flyout: "フライアウト",
  lineout: "ライナーアウト",
  popout: "ポップアウト",
  doublePlay: "併殺打",
  sacrificeFly: "犠牲フライ",
  fieldersChoice: "フィルダースチョイス",
  infieldHit: "内野安打",
  error: "エラー出塁",
};

function resultColor(result: string): string {
  switch (result) {
    case "homerun": return "text-red-500 font-bold";
    case "triple": return "text-orange-400 font-semibold";
    case "double": return "text-orange-300";
    case "single": case "infieldHit": return "text-yellow-300";
    case "walk": return "text-blue-400";
    case "hitByPitch": return "text-cyan-400";
    case "error": return "text-purple-400";
    default: return "text-gray-400";
  }
}

function dotColor(result: string): string {
  switch (result) {
    case "homerun": return "#ef4444";
    case "double": case "triple": return "#fb923c";
    case "single": case "infieldHit": return "#eab308";
    case "walk": case "hitByPitch": return "#60a5fa";
    case "error": return "#a855f7";
    default: return "#6b7280";
  }
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ---- フィールド座標変換 ----

// direction: 0°=3B線(左), 45°=センター(上), 90°=1B線(右)
// SVG座標: homeX=150, homeY=280, センター=上方向
function toFieldSvg(distM: number, dirDeg: number): { x: number; y: number } {
  const scale = 1.8;
  const homeX = 150, homeY = 280;
  const angleRad = (135 - dirDeg) * Math.PI / 180;
  return {
    x: homeX + distM * scale * Math.cos(angleRad),
    y: homeY - distM * scale * Math.sin(angleRad),
  };
}

// ---- ベジェ曲線 ----

function quadBezier(
  from: { x: number; y: number },
  via: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
  };
}

// ---- 塁座標 ----

const HOME_COORD = { x: 150, y: 280 };
const FIRST_COORD = toFieldSvg(27.431, 90);
const SECOND_COORD = toFieldSvg(27.431 * Math.SQRT2, 45);
const THIRD_COORD = toFieldSvg(27.431, 0);

const BASE_COORDS: Record<number, { x: number; y: number }> = {
  0: HOME_COORD,
  1: FIRST_COORD,
  2: SECOND_COORD,
  3: THIRD_COORD,
};

// ---- フライの制御点 ----

function makeFlyVia(
  from: { x: number; y: number },
  to: { x: number; y: number },
  launchAngle: number
): { x: number; y: number } {
  const mid = lerp(from, to, 0.5);
  const heightOffset = Math.min(100, (launchAngle / 45) * 80);
  return { x: mid.x, y: mid.y - heightOffset };
}

// ---- 物理計算 ----

function getBallFlightTime(exitVelocityKmh: number, launchAngleDeg: number): number {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vy = v * Math.sin(theta);
  const rawTime = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * BAT_HEIGHT)) / GRAVITY;
  return rawTime * FLIGHT_TIME_FACTOR;
}

function getGroundBallTime(exitVelocityKmh: number, distM: number): number {
  const vGround = (exitVelocityKmh / 3.6) * GROUND_BALL_AVG_SPEED_RATIO;
  return vGround > 0 ? distM / vGround : 2.0;
}

/** フライボールがフェンスの水平距離に到達する時刻を計算 */
function getFenceArrivalTime(
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

/** フライ打球の時刻tにおける状態（地面投影位置・高さ）を返す */
function getBallStateAtTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  direction: number,
  t: number,
  distScale: number = 1,
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
  const groundPos = toFieldSvg(horizontalDist, direction);

  return { groundPos, height };
}

/** フライ着地後のバウンドフェーズの状態を返す（フィールドビュー用） */
function getFieldBounceStateAtTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  direction: number,
  landingDist: number,
  tAfterLanding: number,
  fenceDist?: number,
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

  // 最初のバウンドの最高高さ（ドットサイズ基準に使う）
  const firstBounceMaxH = (currentVy * currentVy) / (2 * GRAVITY);

  type BounceInterval = { tStart: number; tEnd: number; vy0: number; vx0: number; horizStart: number };
  const intervals: BounceInterval[] = [];

  // フェンスまでの残り距離
  const maxDistToFence = fenceDist != null ? fenceDist - landingDist : Infinity;

  for (let b = 0; b < maxBounces; b++) {
    const tBounce = 2 * currentVy / GRAVITY;
    if (tBounce < 0.02 || currentVy < 0.3) break;
    const bounceHorizDist = currentVx * tBounce;
    // このバウンドでフェンスに到達するかチェック
    if (cumHorizontalDist + bounceHorizDist > maxDistToFence) {
      // フェンス到達時刻を計算
      const distRemaining = maxDistToFence - cumHorizontalDist;
      const tToFence = currentVx > 0 ? distRemaining / currentVx : 0;
      // フェンス衝突時のバウンド高さ
      const hAtFence = currentVy * tToFence - 0.5 * GRAVITY * tToFence * tToFence;
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
    // フェンス跳ね返り: 壁反発で逆方向に低速バウンド
    const wallRestitution = 0.25;
    const reboundVx = currentVx * wallRestitution;
    const reboundVy = 2.0; // 壁当たりで少し跳ねる
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
      // フェンスに到達する前のバウンドフェーズ
      for (const interval of intervals) {
        if (tAfterLanding >= interval.tStart && tAfterLanding < interval.tEnd) {
          const tLocal = tAfterLanding - interval.tStart;
          const bounceHeight = interval.vy0 * tLocal - 0.5 * GRAVITY * tLocal * tLocal;
          const horizDist = interval.horizStart + interval.vx0 * tLocal;
          const totalDist = landingDist + Math.min(horizDist, maxDistToFence);
          const isOnGround = tLocal < 0.03 || (interval.tEnd - interval.tStart - tLocal) < 0.03;
          return {
            groundPos: toFieldSvg(totalDist, direction),
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

    // フェンス跳ね返り後
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
      groundPos: toFieldSvg(finalDist, direction),
      bounceHeight: reboundHeight,
      firstBounceMaxH,
      totalBounceTime,
      isOnGround: reboundHeight < 0.05,
      hitFence: true,
      fenceHitTime,
    };
  }

  // フェンスに到達しない通常バウンド
  // 短い転がりフェーズ（バウンド後の残勢で少しだけ転がる）
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
        groundPos: toFieldSvg(totalDist, direction),
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
      groundPos: toFieldSvg(totalDist, direction),
      bounceHeight: 0,
      firstBounceMaxH,
      totalBounceTime,
      isOnGround: true,
    };
  }

  const totalDist = landingDist + cumHorizontalDist + rollDist;
  return {
    groundPos: toFieldSvg(totalDist, direction),
    bounceHeight: 0,
    firstBounceMaxH,
    totalBounceTime,
    isOnGround: true,
  };
}

/** フェンス直撃後の跳ね返り状態を返す（フィールドビュー用） */
function getFenceBounceBackStateAtTime(
  fenceDist: number,
  direction: number,
  exitVelocityKmh: number,
  launchAngleDeg: number,
  tAfterFenceHit: number,
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
    groundPos: toFieldSvg(Math.max(0, dist), direction),
    bounceHeight: Math.max(0, height),
    totalBounceTime,
  };
}

/** フェンス直撃後の跳ね返り軌道ポイントを計算（サイドビュー用） */
function computeFenceBounceBackPoints(
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

  // フェンスからの落下 + 跳ね返り
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

/** ゴロ打球のバウンド物理をタイムライン化して返す */
function buildGroundBallTimeline(
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

  // 最初の落下: 打点から地面まで
  const tFirstDrop = Math.sqrt(2 * BAT_HEIGHT / GRAVITY);
  const xFirstDrop = vx * tFirstDrop;

  type Segment = { tStart: number; tEnd: number; xStart: number; vx: number; vy0: number; isDropPhase?: boolean };
  const segments: Segment[] = [];
  let cumTime = 0;
  let cumX = 0;

  // 最初の落下セグメント（打点→地面）
  segments.push({ tStart: 0, tEnd: tFirstDrop, xStart: 0, vx, vy0: 0, isDropPhase: true });
  cumTime = tFirstDrop;
  cumX = xFirstDrop;

  // バウンドの初速
  let vy = Math.sqrt(2 * GRAVITY * BAT_HEIGHT) * restitution;

  // 3回バウンド
  for (let bounce = 0; bounce < 3; bounce++) {
    vx *= friction;
    const tBounce = 2 * vy / GRAVITY;
    if (tBounce < 0.01 || vy < 0.1) break;
    segments.push({ tStart: cumTime, tEnd: cumTime + tBounce, xStart: cumX, vx, vy0: vy });
    cumTime += tBounce;
    cumX += vx * tBounce;
    vy *= restitution;
  }

  // 転がりフェーズ
  const rollDist = Math.max(0, totalDist - cumX);
  const rollSpeed = Math.max(vx * 0.6, 0.5);
  const rollTime = rollDist > 0 ? Math.min(rollDist / rollSpeed, 1.0) : 0;

  // 最初のバウンド最高高さ
  const firstBounceVy = Math.sqrt(2 * GRAVITY * BAT_HEIGHT) * restitution;
  const firstBounceMaxH = (firstBounceVy * firstBounceVy) / (2 * GRAVITY);

  return { segments, cumTime, cumX, rollDist, rollSpeed, rollTime, totalTime: cumTime + rollTime, firstBounceMaxH };
}

/** ゴロ打球の時刻tにおける状態を返す（バウンド物理） */
function getGroundBallStateAtTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  direction: number,
  totalDist: number,
  t: number,
): { groundPos: { x: number; y: number }; bounceHeight: number; firstBounceMaxH: number; isOnGround: boolean; totalTime: number } | null {
  const tl = buildGroundBallTimeline(exitVelocityKmh, launchAngleDeg, totalDist);
  if (tl.totalTime <= 0) return null;

  const tc = clampNum(t, 0, tl.totalTime);

  // セグメント判定
  for (const seg of tl.segments) {
    if (tc >= seg.tStart && tc < seg.tEnd) {
      const tLocal = tc - seg.tStart;
      const x = seg.xStart + seg.vx * tLocal;

      if (seg.isDropPhase) {
        // 打点からの落下: 高さ = BAT_HEIGHT - 0.5*g*t^2
        const h = Math.max(0, BAT_HEIGHT - 0.5 * GRAVITY * tLocal * tLocal);
        const isOnGround = tLocal < 0.02 || (seg.tEnd - seg.tStart - tLocal) < 0.02;
        return { groundPos: toFieldSvg(x, direction), bounceHeight: h, firstBounceMaxH: tl.firstBounceMaxH, isOnGround, totalTime: tl.totalTime };
      }

      // バウンドセグメント
      const h = Math.max(0, seg.vy0 * tLocal - 0.5 * GRAVITY * tLocal * tLocal);
      const isOnGround = tLocal < 0.03 || (seg.tEnd - seg.tStart - tLocal) < 0.03;
      return { groundPos: toFieldSvg(x, direction), bounceHeight: h, firstBounceMaxH: tl.firstBounceMaxH, isOnGround, totalTime: tl.totalTime };
    }
  }

  // 転がりフェーズ
  if (tc >= tl.cumTime) {
    const rollProgress = tl.rollTime > 0 ? Math.min((tc - tl.cumTime) / tl.rollTime, 1) : 1;
    const x = tl.cumX + tl.rollDist * rollProgress;
    return { groundPos: toFieldSvg(x, direction), bounceHeight: 0, firstBounceMaxH: tl.firstBounceMaxH, isOnGround: true, totalTime: tl.totalTime };
  }

  return { groundPos: toFieldSvg(totalDist, direction), bounceHeight: 0, firstBounceMaxH: tl.firstBounceMaxH, isOnGround: true, totalTime: tl.totalTime };
}

// ---- アニメーションフック ----

function usePlayAnimation() {
  const [currentTime, setCurrentTime] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const animRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const durationRef = useRef(0);

  const play = useCallback((duration: number) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    durationRef.current = duration;
    setPlaying(true);
    setCurrentTime(0);
    startRef.current = performance.now();
    const animate = (now: number) => {
      const elapsed = (now - startRef.current) / 1000;
      if (elapsed >= durationRef.current) {
        setCurrentTime(durationRef.current);
        setPlaying(false);
        return;
      }
      setCurrentTime(elapsed);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  return { currentTime, playing, play };
}

// ---- フィールドビュー ----

interface AnimatedFieldViewProps {
  log: AtBatLog;
  currentTime: number;
  totalTime: number;
  trailPoints: { x: number; y: number }[];
  distScale: number;
}

function AnimatedFieldView({ log, currentTime, totalTime, trailPoints, distScale }: AnimatedFieldViewProps) {
  const fencePoints = Array.from({ length: 19 }, (_, i) => {
    const deg = i * 5;
    const dist = getFenceDistance(deg);
    return toFieldSvg(dist, deg);
  });
  const fencePath = fencePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const home = HOME_COORD;
  const first = FIRST_COORD;
  const second = SECOND_COORD;
  const third = THIRD_COORD;
  const diamondPath = `M ${home.x} ${home.y} L ${first.x.toFixed(1)} ${first.y.toFixed(1)} L ${second.x.toFixed(1)} ${second.y.toFixed(1)} L ${third.x.toFixed(1)} ${third.y.toFixed(1)} Z`;

  const isAnimating = currentTime >= 0;

  const direction = log.direction ?? 45;
  const exitVelocity = log.exitVelocity ?? 120;
  const launchAngle = log.launchAngle ?? 15;
  // estimatedDistance が 0 や null の場合は再計算（旧データ互換）
  const estimatedDist = (log.estimatedDistance != null && log.estimatedDistance > 0)
    ? log.estimatedDistance
    : estimateDistance(exitVelocity, launchAngle);
  const hasFieldData = log.direction !== null && estimatedDist > 0;
  const isGrounder = (log.launchAngle ?? 15) <= 0 || log.battedBallType === "ground_ball";
  const isHomerun = log.result === "homerun";
  const isCaughtFly = ['flyout', 'lineout', 'popout', 'sacrificeFly'].includes(log.result);

  // 非HRフライでフェンス超え飛距離の場合、フェンス直撃なので着弾点をフェンスにキャップ
  const fenceDistForDir = direction != null ? getFenceDistance(direction) : 95;
  const isFenceHit = !isHomerun && !isGrounder && !isCaughtFly && estimatedDist > fenceDistForDir;
  const displayDist = (!isHomerun && !isGrounder && estimatedDist > fenceDistForDir)
    ? fenceDistForDir
    : estimatedDist;

  // 最終到達地点（バウンド+転がり後の位置）
  const finalPos = useMemo(() => {
    if (!hasFieldData) return null;
    if (isHomerun) return toFieldSvg(estimatedDist, direction);
    if (isCaughtFly) return toFieldSvg(displayDist, direction);
    if (isFenceHit) {
      const state = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, 999);
      return state?.groundPos ?? toFieldSvg(fenceDistForDir, direction);
    }
    if (isGrounder) {
      const state = getGroundBallStateAtTime(exitVelocity, launchAngle, direction, estimatedDist, 999);
      return state?.groundPos ?? toFieldSvg(estimatedDist, direction);
    }
    const bounceInfo = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, displayDist, 999, fenceDistForDir);
    return bounceInfo?.groundPos ?? toFieldSvg(displayDist, direction);
  }, [hasFieldData, isGrounder, isHomerun, isCaughtFly, isFenceHit, estimatedDist, displayDist, direction, exitVelocity, launchAngle, fenceDistForDir]);
  const dot = finalPos;

  // アニメーション中のボール状態
  let ballGroundPos: { x: number; y: number } | null = null;
  let ballHeight = 0;
  let shadowGroundPos: { x: number; y: number } | null = null;
  let isBouncePhase = false;
  let bounceFirstMaxH = 0;
  let bounceOnGround = false;
  let bounceFenceHitTime = -1; // バウンド中にフェンスに到達した時刻（-1=到達しない）

  const flightTime = isGrounder ? totalTime : getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));

  if (isAnimating && hasFieldData && currentTime <= totalTime) {
    if (isGrounder) {
      isBouncePhase = true;
      const state = getGroundBallStateAtTime(exitVelocity, launchAngle, direction, estimatedDist, currentTime);
      if (state) {
        ballGroundPos = state.groundPos;
        ballHeight = state.bounceHeight;
        bounceFirstMaxH = state.firstBounceMaxH;
        bounceOnGround = state.isOnGround;
        shadowGroundPos = state.bounceHeight > 0.05 ? state.groundPos : null;
      }
    } else if (isFenceHit) {
      // フェンス直撃: フェンスまでのフライ + フェンス跳ね返り
      const fenceArrival = getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale);
      const flightToFence = Math.min(fenceArrival, flightTime);

      if (currentTime <= flightToFence) {
        const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, currentTime, distScale);
        if (state) {
          ballGroundPos = state.groundPos;
          ballHeight = state.height;
          shadowGroundPos = state.groundPos;
        }
      } else {
        isBouncePhase = true;
        const tAfterFence = currentTime - flightToFence;
        const state = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, tAfterFence);
        if (state) {
          ballGroundPos = state.groundPos;
          ballHeight = state.bounceHeight;
          bounceFirstMaxH = 2.0;
          bounceOnGround = state.bounceHeight < 0.1;
          shadowGroundPos = state.groundPos;
        }
      }
    } else if (currentTime <= flightTime) {
      const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, currentTime, distScale);
      if (state) {
        ballGroundPos = state.groundPos;
        ballHeight = state.height;
        shadowGroundPos = state.groundPos;
      }
    } else if (!isHomerun && !isCaughtFly) {
      // バウンドフェーズ: 着地後の経過時間でバウンド位置を計算
      isBouncePhase = true;
      const tAfterLanding = currentTime - flightTime;
      const bounceState = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, displayDist, tAfterLanding, fenceDistForDir);
      if (bounceState) {
        ballGroundPos = bounceState.groundPos;
        ballHeight = bounceState.bounceHeight;
        bounceFirstMaxH = bounceState.firstBounceMaxH;
        bounceOnGround = bounceState.isOnGround;
        shadowGroundPos = bounceState.groundPos;
        // バウンドがフェンスに到達した場合、フェンス直撃エフェクトを表示するためフラグ設定
        if (bounceState.hitFence) {
          bounceFenceHitTime = flightTime + (bounceState.fenceHitTime ?? 0);
        }
      }
    }
  }

  // アニメーション中の軌跡ライン（currentTime/totalTime の割合で trailPoints を切り出す）
  // フライフェーズとバウンドフェーズの境界インデックスを計算
  // ゴロは全てバウンドフェーズ扱い（点線）
  // フェンス直撃時はフェンス到達時間を使用（自然落下時間と異なる）
  const effectiveFlightTime = isFenceHit
    ? Math.min(getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale), flightTime)
    : flightTime;
  const flightTrailRatio = isGrounder ? 0 : (totalTime > 0 ? effectiveFlightTime / totalTime : 1);
  const flightTrailEndIdx = Math.floor(flightTrailRatio * trailPoints.length);

  const trailEnd = isAnimating && totalTime > 0
    ? Math.floor((clampNum(currentTime / totalTime, 0, 1)) * trailPoints.length)
    : (isAnimating ? trailPoints.length : 0);

  // フライフェーズの軌跡（実線）
  const flightTrail = trailPoints.slice(0, Math.min(trailEnd + 1, flightTrailEndIdx + 1));
  const flightTrailPolyline = flightTrail.length >= 2
    ? flightTrail.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    : null;
  // バウンドフェーズの軌跡（点線）
  const bounceTrail = trailEnd > flightTrailEndIdx
    ? trailPoints.slice(flightTrailEndIdx, trailEnd + 1)
    : [];
  const bounceTrailPolyline = bounceTrail.length >= 2
    ? bounceTrail.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    : null;

  // フライ系: フライトの最高高さ（ドットサイズ計算用）
  let maxHeight = 0;
  if (!isGrounder && hasFieldData) {
    const tFlight = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
    const tPeak = Math.max(0, (exitVelocity / 3.6) * Math.sin(launchAngle * Math.PI / 180) / GRAVITY);
    const peak = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, Math.min(tPeak, tFlight), distScale);
    maxHeight = peak?.height ?? 10;
  }

  // ドットサイズ: 高さに応じて変化
  // バウンドフェーズはバウンド専用スケール（最初のバウンド最高点を基準にドットを大きく変化させる）
  // 初期落下フェーズでは ballHeight > firstBounceMaxH になるのでクランプ
  const bounceHeightRatio = bounceFirstMaxH > 0 ? clampNum(ballHeight / bounceFirstMaxH, 0, 1) : 0;
  const ballRadius = isBouncePhase
      ? 2 + bounceHeightRatio * 3.5
      : Math.max(2, 2 + (maxHeight > 0 ? (ballHeight / maxHeight) * 4 : 0));

  // ホームラン: フェンス越えエフェクト
  const hrFenceDist = isHomerun && log.direction !== null ? getFenceDistance(log.direction) : null;
  const hrFencePos = hrFenceDist && log.direction !== null ? toFieldSvg(hrFenceDist, log.direction) : null;

  const fenceArrivalTime = useMemo(() => {
    if (!isHomerun || !hasFieldData || exitVelocity <= 0 || launchAngle <= 0 || log.direction === null) return Infinity;
    return getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), log.direction, distScale);
  }, [isHomerun, hasFieldData, exitVelocity, launchAngle, log.direction, distScale]);

  const ballBeyondFence = isHomerun && hrFenceDist && hasFieldData && ballGroundPos
    ? estimatedDist >= hrFenceDist && currentTime >= fenceArrivalTime
    : false;

  const outsBeforePlay = log.outsBeforePlay ?? null;

  // 静的表示（アニメーション非再生）の落下地点マーカー
  const showStaticDot = dot && !isAnimating;
  // アニメーション完了後の落下地点マーカー
  const showLandingDot = dot && isAnimating && currentTime >= totalTime;

  // フェンス直撃エフェクト表示判定（直撃 or バウンド経由）
  const fenceHitEffectTime = isFenceHit ? (() => {
    const fa = getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale);
    return Math.min(fa, flightTime);
  })() : bounceFenceHitTime;

  return (
    <svg viewBox="0 0 300 300" className="w-full bg-gray-900 rounded border border-gray-700">
      <rect x="0" y="0" width="300" height="300" fill="#111827" />
      <path d={fencePath + ` L ${home.x} ${home.y} Z`} fill="#14532d" opacity="0.5" />
      <path d={diamondPath} fill="#92400e" opacity="0.4" />
      <path d={fencePath} fill="none" stroke="#6b7280" strokeWidth="1.5" />
      <path d={diamondPath} fill="none" stroke="#9ca3af" strokeWidth="1" />
      {[home, first, second, third].map((p, i) => (
        <rect key={i} x={p.x - 3} y={p.y - 3} width="6" height="6" fill="#e5e7eb" transform={`rotate(45 ${p.x} ${p.y})`} />
      ))}

      {/* 走者（塁上の走者を静的表示） */}
      {log.basesBeforePlay && log.basesBeforePlay.map((occupied, baseIdx) => {
        if (!occupied) return null;
        const p = BASE_COORDS[baseIdx + 1];
        return <circle key={baseIdx} cx={p.x} cy={p.y} r={3.5} fill="#22c55e" stroke="white" strokeWidth="0.8" />;
      })}

      {/* 静的落下地点（アニメーション非再生時） */}
      {showStaticDot && (
        <>
          <line x1={home.x} y1={home.y} x2={dot.x} y2={dot.y} stroke={dotColor(log.result)} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
          <circle cx={dot.x} cy={dot.y} r="5" fill={dotColor(log.result)} opacity="0.9" />
          <circle cx={dot.x} cy={dot.y} r="5" fill="none" stroke="white" strokeWidth="0.8" opacity="0.5" />
        </>
      )}

      {/* アニメーション中の軌跡ライン: フライフェーズ（実線） */}
      {flightTrailPolyline && (
        <polyline
          points={flightTrailPolyline}
          fill="none"
          stroke={dotColor(log.result)}
          strokeWidth="1"
          strokeDasharray={isGrounder ? "2,2" : "none"}
          opacity="0.45"
        />
      )}
      {/* アニメーション中の軌跡ライン: バウンドフェーズ（点線） */}
      {bounceTrailPolyline && (
        <polyline
          points={bounceTrailPolyline}
          fill="none"
          stroke={dotColor(log.result)}
          strokeWidth="1"
          strokeDasharray="3,3"
          opacity="0.35"
        />
      )}

      {/* フライ系: 影ドット（地面投影） */}
      {!isGrounder && shadowGroundPos && ballGroundPos && ballHeight > 0.5 && (
        <>
          {/* 高さを示す縦線（影→ボール方向に小さく） */}
          <line
            x1={shadowGroundPos.x}
            y1={shadowGroundPos.y}
            x2={shadowGroundPos.x}
            y2={shadowGroundPos.y - Math.min(ballHeight * 1.5, 20)}
            stroke="#9ca3af"
            strokeWidth="0.8"
            opacity="0.35"
          />
          {/* 影ドット */}
          <circle
            cx={shadowGroundPos.x}
            cy={shadowGroundPos.y}
            r={2}
            fill="#6b7280"
            opacity="0.4"
          />
        </>
      )}

      {/* ボール本体ドット（アニメーション中） */}
      {ballGroundPos && isAnimating && currentTime < totalTime && (
        <>
          {/* バウンドフェーズ: 着地衝撃リング + サイズ変化するドット */}
          {isBouncePhase ? (
            <>
              {/* 着地衝撃リング（地面に接触した瞬間に表示） */}
              {bounceOnGround && (
                <circle
                  cx={ballGroundPos.x}
                  cy={ballGroundPos.y}
                  r={5}
                  fill="none"
                  stroke={dotColor(log.result)}
                  strokeWidth="1"
                  opacity="0.5"
                />
              )}
              {/* バウンド中のボール（高さ=0付近は地面に、高い時は浮く） */}
              <circle
                cx={ballGroundPos.x}
                cy={ballGroundPos.y - bounceHeightRatio * 6}
                r={ballRadius}
                fill="white"
                stroke={dotColor(log.result)}
                strokeWidth="0.8"
                opacity="0.95"
              />
            </>
          ) : !isGrounder && ballHeight > 0.5 ? (
            /* フライ系: ボールの高さに応じた位置（SVGは俯瞰なのでサイズで高さを表現） */
            <circle
              cx={ballGroundPos.x}
              cy={ballGroundPos.y - Math.min(ballHeight * 1.5, 20)}
              r={ballRadius}
              fill="white"
              stroke={dotColor(log.result)}
              strokeWidth="0.8"
              opacity="0.95"
            />
          ) : (
            <circle
              cx={ballGroundPos.x}
              cy={ballGroundPos.y}
              r={ballRadius}
              fill={isGrounder ? "white" : dotColor(log.result)}
              stroke={isGrounder ? "#9ca3af" : "white"}
              strokeWidth="0.8"
              opacity="0.95"
            />
          )}
        </>
      )}

      {/* ホームラン: フェンス越えエフェクト */}
      {ballBeyondFence && hrFencePos && (
        <>
          {[0, 60, 120, 180, 240, 300].map((angleDeg, i) => {
            const rad = angleDeg * Math.PI / 180;
            const r = 8;
            return (
              <line
                key={i}
                x1={hrFencePos.x}
                y1={hrFencePos.y}
                x2={hrFencePos.x + r * Math.cos(rad)}
                y2={hrFencePos.y + r * Math.sin(rad)}
                stroke="#ef4444"
                strokeWidth="1.5"
                opacity="0.8"
              />
            );
          })}
        </>
      )}

      {/* フェンス直撃エフェクト（直撃 or バウンド経由） */}
      {fenceHitEffectTime >= 0 && isAnimating && (() => {
        if (currentTime >= fenceHitEffectTime && currentTime <= fenceHitEffectTime + 0.3) {
          const fencePos = toFieldSvg(fenceDistForDir, direction);
          return (
            <>
              <circle cx={fencePos.x} cy={fencePos.y} r={6} fill="none" stroke="#f59e0b" strokeWidth="2" opacity={0.8} />
              <circle cx={fencePos.x} cy={fencePos.y} r={3} fill="#f59e0b" opacity={0.6} />
            </>
          );
        }
        return null;
      })()}

      {/* アニメーション完了後の落下地点マーカー */}
      {showLandingDot && dot && (
        <>
          <circle cx={dot.x} cy={dot.y} r="5" fill={dotColor(log.result)} opacity="0.9" />
          <circle cx={dot.x} cy={dot.y} r="5" fill="none" stroke="white" strokeWidth="0.8" opacity="0.5" />
        </>
      )}

      {/* アウトカウント表示 */}
      {outsBeforePlay !== null && (
        <g>
          <text x="10" y="12" fill="#9ca3af" fontSize="7">アウト</text>
          {[0, 1, 2].map(i => (
            <circle key={i} cx={10 + i * 10} cy={20} r={3.5} fill={i < outsBeforePlay ? "#6b7280" : "none"} stroke="#9ca3af" strokeWidth="1" />
          ))}
        </g>
      )}
    </svg>
  );
}

// ---- サイドビュー（軌道・横から） ----

function computeTrajectoryPoints(
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
  // 生の飛行時間を使うことで放物線がy=0に自然に到達する
  const tFlight = (vy + Math.sqrt(disc)) / GRAVITY;
  // 水平距離にはDRAG_FACTOR * FLIGHT_TIME_FACTORを適用してestimateDistance()と一致させる
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
function computeBouncePoints(
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
  // computeTrajectoryPointsと揃えてDRAG_FACTOR * FLIGHT_TIME_FACTORを適用
  const vx = v * Math.cos(theta) * DRAG_FACTOR * FLIGHT_TIME_FACTOR;

  const vyInit = v * Math.sin(theta);
  const disc = vyInit * vyInit + 2 * GRAVITY * BAT_HEIGHT;
  // 着地速度を正しく求めるため生の飛行時間を使用
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

      // フェンスに到達したらカットして跳ね返り開始
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

  // フェンス跳ね返りポイントを追加
  if (hitFence && fenceDist != null) {
    const wallRestitution = 0.25;
    const reboundVx = currentVx * wallRestitution;
    const reboundVy = 2.0;
    // 1st rebound bounce
    const t1 = 2 * reboundVy / GRAVITY;
    const steps1 = 10;
    for (let i = 1; i <= steps1; i++) {
      const t = (i / steps1) * t1;
      bouncePoints.push({
        x: fenceDist - reboundVx * t,
        y: reboundVy * t - 0.5 * GRAVITY * t * t,
      });
    }
    // 2nd small bounce
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

interface SideViewProps {
  log: AtBatLog;
  currentTime: number;
  totalFlightTime: number;
  isFenceHit?: boolean;
  isCaughtFly?: boolean;
}

function SideView({ log, currentTime, totalFlightTime, isFenceHit, isCaughtFly }: SideViewProps) {
  if (log.exitVelocity === null || log.launchAngle === null) {
    return (
      <svg viewBox="0 0 350 180" className="w-full bg-gray-900 rounded border border-gray-700">
        <text x="175" y="95" textAnchor="middle" fill="#6b7280" fontSize="12">軌道データなし</text>
      </svg>
    );
  }

  // ゴロ（角度0以下）の場合: バウンド物理シミュレーション
  if (log.launchAngle <= 0) {
    const totalDist = log.estimatedDistance ?? 0;
    const ev = log.exitVelocity;
    const angle = log.launchAngle;

    // 物理バウンドシミュレーション
    // 打点高さから低角度で飛び出し、地面でバウンド(最大3回)→転がり
    const restitution = 0.35; // 反発係数（野球場の土）
    const friction = 0.85; // バウンド時の水平速度維持率

    const v = ev / 3.6;
    // ゴロの角度は0〜-15°程度。地面に向かう角度をわずかに上方に補正して最初の着地を作る
    const absAngle = Math.abs(angle);
    const theta = Math.max(absAngle, 2) * Math.PI / 180; // 最低2°
    let vx = v * Math.cos(theta) * GROUND_BALL_AVG_SPEED_RATIO; // 地面摩擦で水平速度を落とす
    let vy = v * Math.sin(theta) * 0.5; // 最初のバウンドの初速は小さめ

    // 最初の落下: 打点高さから地面まで
    const tFirstDrop = Math.sqrt(2 * BAT_HEIGHT / GRAVITY);
    const xFirstDrop = vx * tFirstDrop;

    type BouncePoint = { x: number; y: number };
    const trajectory: BouncePoint[] = [];
    const steps = 20; // 各セグメントのサンプル数

    // 最初の落下セグメント（打点→地面）
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * tFirstDrop;
      trajectory.push({
        x: vx * t,
        y: BAT_HEIGHT - 0.5 * GRAVITY * t * t,
      });
    }

    // 3回バウンド
    let cumX = xFirstDrop;
    for (let bounce = 0; bounce < 3; bounce++) {
      vy = vy * restitution + (bounce === 0 ? Math.sqrt(2 * GRAVITY * BAT_HEIGHT) * restitution : vy);
      if (bounce === 0) {
        // 最初のバウンド: 落下衝撃からの反発
        vy = Math.sqrt(2 * GRAVITY * BAT_HEIGHT) * restitution;
      }
      vx *= friction;

      // バウンドの滞空時間: vy上昇→落下で y=0
      const tBounce = 2 * vy / GRAVITY;
      if (tBounce < 0.01 || vy < 0.1) break; // バウンドが微小なら終了

      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * tBounce;
        trajectory.push({
          x: cumX + vx * t,
          y: vy * t - 0.5 * GRAVITY * t * t,
        });
      }
      cumX += vx * tBounce;
      vy *= restitution; // 次のバウンドの初速
    }

    // 転がりフェーズ（残りの距離を地面上で移動）
    if (cumX < totalDist) {
      trajectory.push({ x: totalDist, y: 0 });
    }

    // 描画用スケーリング
    const svgW = 350, svgH = 180;
    const padLeft = 30, padBottom = 25, padTop = 20, padRight = 20;
    const plotW = svgW - padLeft - padRight;
    const plotH = svgH - padTop - padBottom;
    const lastX = trajectory.length > 0 ? trajectory[trajectory.length - 1].x : 0;
    const xMax = Math.max(totalDist + 10, lastX + 10);
    const yMax = Math.max(BAT_HEIGHT + 0.5, ...trajectory.map(p => p.y)) + 0.5;
    const groundY = padTop + plotH;

    const toSvg = (px: number, py: number) => ({
      sx: padLeft + (px / xMax) * plotW,
      sy: groundY - (py / yMax) * plotH,
    });

    const polyPoints = trajectory.map(p => {
      const { sx, sy } = toSvg(p.x, Math.max(0, p.y));
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    }).join(" ");

    // アニメーション: 軌道上の進捗でボール位置を補間
    const groundBallTotalTime = getGroundBallTime(ev, totalDist);
    const animProgress = groundBallTotalTime > 0 ? clampNum(currentTime / groundBallTotalTime, 0, 1) : 0;
    const easedProgress = animProgress * (2 - animProgress);
    // 軌道配列上の補間位置を求める
    const targetX = easedProgress * totalDist;
    let ballSvgX = padLeft, ballSvgY = groundY;
    for (let i = 1; i < trajectory.length; i++) {
      if (trajectory[i].x >= targetX) {
        const prev = trajectory[i - 1];
        const curr = trajectory[i];
        const segLen = curr.x - prev.x;
        const frac = segLen > 0 ? (targetX - prev.x) / segLen : 0;
        const interpY = prev.y + (curr.y - prev.y) * frac;
        const { sx, sy } = toSvg(targetX, Math.max(0, interpY));
        ballSvgX = sx;
        ballSvgY = sy;
        break;
      }
    }

    // X軸目盛り
    const tickStep = xMax <= 30 ? 5 : xMax <= 60 ? 10 : 20;
    const ticks: number[] = [];
    for (let v = 0; v <= xMax; v += tickStep) ticks.push(v);

    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full bg-gray-900 rounded border border-gray-700">
        {/* 地面 */}
        <line x1={padLeft} y1={groundY} x2={svgW - padRight} y2={groundY} stroke="#4b5563" strokeWidth={1} />
        {/* Y軸 */}
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={groundY} stroke="#4b5563" strokeWidth={0.5} />
        {/* X軸目盛り */}
        {ticks.map(v => {
          const { sx } = toSvg(v, 0);
          return (
            <g key={v}>
              <line x1={sx} y1={groundY} x2={sx} y2={groundY + 4} stroke="#6b7280" strokeWidth={0.5} />
              <text x={sx} y={groundY + 15} textAnchor="middle" fill="#6b7280" fontSize="9">{v}</text>
            </g>
          );
        })}
        {/* Y軸ラベル */}
        <text x={padLeft - 4} y={groundY - 2} textAnchor="end" fill="#6b7280" fontSize="8">0</text>
        {yMax >= 1 && (() => {
          const { sy } = toSvg(0, 1);
          return (
            <>
              <line x1={padLeft - 3} y1={sy} x2={padLeft} y2={sy} stroke="#6b7280" strokeWidth={0.5} />
              <text x={padLeft - 4} y={sy + 3} textAnchor="end" fill="#6b7280" fontSize="8">1m</text>
            </>
          );
        })()}
        {/* バウンド軌道 */}
        <polyline points={polyPoints} fill="none" stroke="#ef4444" strokeWidth={2} opacity={0.8} />
        {/* 転がりフェーズ（点線） */}
        {cumX < totalDist && (() => {
          const { sx: sx1, sy: sy1 } = toSvg(cumX, 0);
          const { sx: sx2, sy: sy2 } = toSvg(totalDist, 0);
          return <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.6} />;
        })()}
        {/* ボール（アニメーション中） */}
        {currentTime >= 0 && currentTime < groundBallTotalTime && (
          <circle cx={ballSvgX} cy={ballSvgY} r={4} fill="#ef4444" stroke="white" strokeWidth={1} />
        )}
        {/* 飛距離 */}
        {totalDist > 0 && (() => {
          const { sx } = toSvg(totalDist, 0);
          return <text x={sx} y={groundY - 8} textAnchor="middle" fill="#22c55e" fontSize="11" fontWeight="bold">{Math.round(totalDist)}m</text>;
        })()}
      </svg>
    );
  }

  const isCaught = isCaughtFly ?? false;
  const isFence = isFenceHit ?? false;

  const rawPoints = computeTrajectoryPoints(log.exitVelocity, log.launchAngle);
  const totalDist = log.estimatedDistance ?? estimateDistance(log.exitVelocity, log.launchAngle);
  // carryFactor適用後の飛距離に合わせて軌道の水平方向をスケーリング
  const rawEndX = rawPoints.length > 0 ? rawPoints[rawPoints.length - 1].x : 1;
  const xStretch = rawEndX > 0 ? totalDist / rawEndX : 1;
  const allPoints = rawPoints.map(p => ({ x: p.x * xStretch, y: p.y }));

  const fenceDist = log.direction !== null ? getFenceDistance(log.direction) : 100;

  // フェンス直撃時は軌道をフェンスまでに切り詰め
  const points = isFence ? allPoints.filter(p => p.x <= fenceDist + 1) : allPoints;

  const maxY = Math.max(...allPoints.map(p => p.y));

  const svgW = 350, svgH = 180;
  const padLeft = 30, padBottom = 25, padTop = 20, padRight = 20;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const xMax = totalDist + 15;
  const yMax = maxY + 5;

  const toSvgCoord = (x: number, y: number) => ({
    sx: padLeft + (x / xMax) * plotW,
    sy: padTop + plotH - (y / yMax) * plotH,
  });

  const pathD = points.map((p, i) => {
    const { sx, sy } = toSvgCoord(p.x, p.y);
    return `${i === 0 ? "M" : "L"} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  }).join(" ");

  const isHR = log.result === "homerun";
  const lastPoint = points[points.length - 1];

  // isFence: フライ直撃, isFenceViaB: バウンド経由でフェンス到達
  const isFenceViaBounce = !isFence && isFenceHit;
  const bouncePoints = (() => {
    if (isHR || isCaught) return [];
    if (isFence && lastPoint) {
      // フライ直撃: 軌道上でフェンス位置の高さを補間で求める
      let heightAtFence = 0;
      for (let i = 1; i < allPoints.length; i++) {
        if (allPoints[i].x >= fenceDist) {
          const prev = allPoints[i - 1];
          const curr = allPoints[i];
          const frac = (curr.x - prev.x) > 0 ? (fenceDist - prev.x) / (curr.x - prev.x) : 0;
          heightAtFence = prev.y + (curr.y - prev.y) * frac;
          break;
        }
      }
      return computeFenceBounceBackPoints(fenceDist, log.exitVelocity!, log.launchAngle!, heightAtFence);
    }
    if (!lastPoint) return [];
    // バウンド経由フェンス到達の場合はフェンス距離を渡す
    return computeBouncePoints(lastPoint, log.exitVelocity!, log.launchAngle!, 2, isFenceViaBounce ? fenceDist : undefined);
  })();

  const bouncePolyline = bouncePoints.length > 0
    ? (() => {
        const startX = isFence ? fenceDist : (lastPoint?.x ?? totalDist);
        // フェンス跳ね返りの場合は着地点がフェンス位置なのでそこから開始
        const startY = isFence ? (() => {
          let h = 0;
          for (let i = 1; i < allPoints.length; i++) {
            if (allPoints[i].x >= fenceDist) {
              const prev = allPoints[i - 1];
              const curr = allPoints[i];
              const frac = (curr.x - prev.x) > 0 ? (fenceDist - prev.x) / (curr.x - prev.x) : 0;
              h = prev.y + (curr.y - prev.y) * frac;
              break;
            }
          }
          return h;
        })() : 0;
        const { sx: startSx, sy: startSy } = toSvgCoord(startX, startY);
        const rest = bouncePoints.map(p => {
          const { sx, sy } = toSvgCoord(p.x, Math.max(0, p.y));
          return `${sx.toFixed(1)},${sy.toFixed(1)}`;
        });
        return [`${startSx.toFixed(1)},${startSy.toFixed(1)}`, ...rest].join(" ");
      })()
    : null;

  // バウンド後の転がり終端
  const bounceEndX = bouncePoints.length > 0 ? bouncePoints[bouncePoints.length - 1].x : lastPoint?.x ?? totalDist;
  const showRollLine = !isHR && !isCaught && !isFence && !isFenceViaBounce && bounceEndX < totalDist;

  const { sx: fenceSx } = toSvgCoord(fenceDist, 0);
  const { sy: fenceTopSy } = toSvgCoord(fenceDist, FENCE_HEIGHT);
  const { sy: fenceBottomSy } = toSvgCoord(fenceDist, 0);

  const peakIdx = allPoints.reduce((best, p, i) => (p.y > allPoints[best].y ? i : best), 0);
  const peak = allPoints[peakIdx];
  const { sx: peakSx, sy: peakSy } = toSvgCoord(peak.x, peak.y);

  const { sx: landSx } = toSvgCoord(totalDist, 0);
  const { sy: groundSy } = toSvgCoord(0, 0);

  const color = dotColor(log.result);

  const xLabels: number[] = [];
  for (let x = 0; x <= xMax; x += 50) xLabels.push(x);

  // ボールのサイドビュー位置（アニメーション中のフライ時のみ）
  let sideBallPos: { sx: number; sy: number } | null = null;
  if (currentTime >= 0 && totalFlightTime > 0 && currentTime <= totalFlightTime) {
    const t = clampNum(currentTime / totalFlightTime, 0, 1);
    const ptIdx = Math.min(Math.floor(t * points.length), points.length - 1);
    const pt = points[ptIdx];
    const { sx, sy } = toSvgCoord(pt.x, pt.y);
    sideBallPos = { sx, sy };
  }

  const isAnimating = currentTime >= 0;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full bg-gray-900 rounded border border-gray-700">
      {xLabels.map(x => {
        const { sx } = toSvgCoord(x, 0);
        return <line key={x} x1={sx} y1={padTop} x2={sx} y2={groundSy} stroke="#374151" strokeWidth="0.5" />;
      })}
      <line x1={padLeft} y1={groundSy} x2={svgW - padRight} y2={groundSy} stroke="#6b7280" strokeWidth="1" />
      {fenceSx >= padLeft && fenceSx <= svgW - padRight && (
        <line x1={fenceSx} y1={fenceTopSy} x2={fenceSx} y2={fenceBottomSy} stroke="#f59e0b" strokeWidth="2" />
      )}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" opacity={isAnimating ? 0.35 : 1} />
      {/* バウンド軌道（またはフェンス跳ね返り軌道） */}
      {bouncePolyline && (
        <polyline points={bouncePolyline} fill="none" stroke={color} strokeWidth="1.5" opacity={isAnimating ? 0.25 : 0.5} />
      )}
      {/* バウンド後の転がり（点線） */}
      {showRollLine && (() => {
        const { sx: sx1, sy: sy1 } = toSvgCoord(bounceEndX, 0);
        const { sx: sx2, sy: sy2 } = toSvgCoord(totalDist, 0);
        return <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity={isAnimating ? 0.2 : 0.4} />;
      })()}
      <circle cx={peakSx} cy={peakSy} r="3" fill={color} opacity={isAnimating ? 0.35 : 1} />
      <text x={peakSx} y={peakSy - 6} textAnchor="middle" fill="#d1d5db" fontSize="8">
        {peak.y.toFixed(1)}m
      </text>
      <circle cx={landSx} cy={groundSy} r="4" fill={color} opacity={isAnimating ? 0.35 : 1} />
      {xLabels.map(x => {
        const { sx } = toSvgCoord(x, 0);
        return (
          <text key={x} x={sx} y={groundSy + 12} textAnchor="middle" fill="#9ca3af" fontSize="8">{x}</text>
        );
      })}
      <text x={padLeft - 5} y={padTop + 5} textAnchor="end" fill="#9ca3af" fontSize="8">{yMax.toFixed(0)}m</text>
      <text x={padLeft - 5} y={groundSy + 3} textAnchor="end" fill="#9ca3af" fontSize="8">0</text>
      <text x={landSx} y={groundSy - 6} textAnchor="middle" fill="#d1d5db" fontSize="9" fontWeight="bold">
        {totalDist.toFixed(0)}m
      </text>
      {sideBallPos && (
        <circle cx={sideBallPos.sx} cy={sideBallPos.sy} r={3.5} fill="white" stroke="#ef4444" strokeWidth="1" />
      )}
    </svg>
  );
}

// ---- ポップアップコンテナ ----

export interface BattedBallPopupProps {
  log: AtBatLog;
  batterName: string;
  pitcherName: string;
  onClose: () => void;
}

export function BattedBallPopup({ log, batterName, pitcherName, onClose }: BattedBallPopupProps) {
  const exitVelocity = log.exitVelocity ?? 120;
  const launchAngle = log.launchAngle ?? 15;
  const direction = log.direction ?? 45;
  // estimatedDistance が 0 や null の場合は再計算（旧データ互換）
  const estimatedDist = (log.estimatedDistance != null && log.estimatedDistance > 0)
    ? log.estimatedDistance
    : estimateDistance(exitVelocity, launchAngle);
  const hasFieldData = log.direction !== null && estimatedDist > 0;
  const isGrounder = launchAngle <= 0 || log.battedBallType === "ground_ball";
  const isHomerun = log.result === "homerun";
  const isCaughtFly = ['flyout', 'lineout', 'popout', 'sacrificeFly'].includes(log.result);

  // carryFactor適用済みのestimatedDistと物理生距離の比率
  const rawPhysDist = (!isGrounder && launchAngle > 0) ? estimateDistance(exitVelocity, launchAngle) : 0;
  const distScale = rawPhysDist > 0 ? estimatedDist / rawPhysDist : 1;

  const fenceDistForDir = direction != null ? getFenceDistance(direction) : 95;
  const isFenceHit = !isHomerun && !isGrounder && !isCaughtFly && estimatedDist > fenceDistForDir;

  // バウンド経由でフェンスに到達するか判定
  const bounceFenceInfo = useMemo(() => {
    if (isFenceHit || isHomerun || isGrounder || isCaughtFly || !hasFieldData) return null;
    const info = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, estimatedDist, 999, fenceDistForDir);
    return info?.hitFence ? info : null;
  }, [isFenceHit, isHomerun, isGrounder, isCaughtFly, hasFieldData, exitVelocity, launchAngle, direction, estimatedDist, fenceDistForDir]);

  // SideViewに渡すフェンスヒットフラグ（直撃 or バウンド経由）
  const isFenceHitForSideView = isFenceHit || !!bounceFenceInfo;

  // 総アニメーション時間
  const totalTime = useMemo(() => {
    if (!hasFieldData) return 0;
    if (isGrounder) {
      const tl = buildGroundBallTimeline(exitVelocity, launchAngle, estimatedDist);
      return tl.totalTime;
    }
    const flightTime = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
    if (isHomerun || isCaughtFly) return flightTime;
    if (isFenceHit) {
      const fenceArrival = getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale);
      const fenceBounce = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, 999);
      return Math.min(fenceArrival, flightTime) + (fenceBounce?.totalBounceTime ?? 1.0);
    }
    // フライ系はバウンド＋転がり時間を加算（フェンス衝突込み）
    const bounceInfo = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, estimatedDist, 999, fenceDistForDir);
    const bounceAndRollTime = bounceInfo?.totalBounceTime ?? 0;
    return flightTime + bounceAndRollTime;
  }, [hasFieldData, isGrounder, isHomerun, isCaughtFly, isFenceHit, exitVelocity, estimatedDist, launchAngle, direction, distScale, fenceDistForDir]);

  // フライ時の滞空時間（SideView用）
  const totalFlightTime = useMemo(() => {
    if (!hasFieldData || isGrounder) return 0;
    return getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
  }, [hasFieldData, isGrounder, exitVelocity, launchAngle]);

  // 地面投影位置の事前計算
  const trailPoints = useMemo(() => {
    if (!hasFieldData) return [];
    const points: { x: number; y: number }[] = [];
    const steps = 60;

    if (isGrounder) {
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * totalTime;
        const state = getGroundBallStateAtTime(exitVelocity, launchAngle, direction, estimatedDist, t);
        if (state) points.push(state.groundPos);
      }
    } else {
      const flightTime = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
      if (isFenceHit) {
        // フライフェーズ: フェンスまで
        const fenceArrival = getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale);
        const flightToFence = Math.min(fenceArrival, flightTime);
        const fenceBounceForRatio = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, 999);
        const fenceTotalTime = flightToFence + (fenceBounceForRatio?.totalBounceTime ?? 1.0);
        const flightSteps = Math.max(1, Math.ceil(steps * (flightToFence / fenceTotalTime)));
        for (let i = 0; i <= flightSteps; i++) {
          const t = (i / flightSteps) * flightToFence;
          const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, t, distScale);
          if (state) points.push(state.groundPos);
        }
        // フェンス跳ね返りフェーズ
        const fenceBounce = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, 999);
        const bounceTime = fenceBounce?.totalBounceTime ?? 1.0;
        const bounceSteps = steps - flightSteps;
        for (let i = 1; i <= bounceSteps; i++) {
          const tAfterFence = (i / bounceSteps) * bounceTime;
          const state = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, tAfterFence);
          if (state) points.push(state.groundPos);
        }
      } else {
        // フライフェーズ
        const flightSteps = isHomerun || isCaughtFly ? steps : Math.ceil(steps * (flightTime / totalTime));
        for (let i = 0; i <= flightSteps; i++) {
          const t = (i / flightSteps) * flightTime;
          const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, t, distScale);
          if (state) points.push(state.groundPos);
        }
        // バウンドフェーズ（非ホームラン・非キャッチフライのみ）
        if (!isHomerun && !isCaughtFly) {
          const bounceTime = totalTime - flightTime;
          const bounceSteps = steps - flightSteps;
          for (let i = 1; i <= bounceSteps; i++) {
            const tAfterLanding = (i / bounceSteps) * bounceTime;
            const bounceState = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, estimatedDist, tAfterLanding, fenceDistForDir);
            if (bounceState) points.push(bounceState.groundPos);
          }
        }
      }
    }

    return points;
  }, [hasFieldData, isGrounder, isHomerun, isCaughtFly, isFenceHit, direction, estimatedDist, totalTime, exitVelocity, launchAngle, distScale, fenceDistForDir]);

  const { currentTime, playing, play } = usePlayAnimation();
  const canAnimate = hasFieldData && totalTime > 0;

  // 打球速度に応じた再生倍率（速い打球は速く、遅い打球はゆったり）
  // 140km/h基準で1.0x、170km/h→1.4x、100km/h→0.7x
  const playbackSpeed = useMemo(() => {
    if (exitVelocity <= 0) return 1;
    return 0.7 + (clampNum(exitVelocity, 80, 180) - 80) / 100 * 0.7;
  }, [exitVelocity]);

  const animDuration = totalTime / playbackSpeed;

  // ポップアップ表示時に自動1回再生
  useEffect(() => {
    if (canAnimate) {
      const timer = setTimeout(() => play(animDuration), 300);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAnimate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl border border-gray-600" onClick={e => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <span className="text-blue-400 font-bold">{batterName}</span>
            <span className="text-gray-400 mx-2">vs</span>
            <span className="text-gray-300">{pitcherName}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 打球データグリッド */}
        <div className="grid grid-cols-5 gap-3 mb-4 text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">結果</div>
            <div className={`font-bold text-xs ${resultColor(log.result)}`}>{resultNamesJa[log.result] ?? log.result}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">打球速度</div>
            <div className="text-white">{log.exitVelocity != null ? `${log.exitVelocity.toFixed(1)}km/h` : "-"}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">打球角度</div>
            <div className="text-white">{log.launchAngle != null ? `${log.launchAngle.toFixed(1)}°` : "-"}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">方向</div>
            <div className="text-white">{log.direction != null ? `${log.direction.toFixed(1)}°` : "-"}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">飛距離</div>
            <div className="text-white font-bold">{log.estimatedDistance != null ? `${Math.round(log.estimatedDistance)}m` : "-"}</div>
          </div>
        </div>

        {/* SVGビュー */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-gray-400 text-xs mb-1 text-center">フィールドビュー</div>
            <AnimatedFieldView
              log={log}
              currentTime={currentTime * playbackSpeed}
              totalTime={totalTime}
              trailPoints={trailPoints}
              distScale={distScale}
            />
          </div>
          <div>
            <div className="text-gray-400 text-xs mb-1 text-center">軌道（横から）</div>
            <SideView log={log} currentTime={currentTime * playbackSpeed} totalFlightTime={totalFlightTime} isFenceHit={isFenceHitForSideView} isCaughtFly={isCaughtFly} />
          </div>
        </div>

        {/* 再生コントロール */}
        {canAnimate && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              onClick={() => play(animDuration)}
              disabled={playing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
            >
              {playing ? "再生中..." : "▶ リプレー"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
