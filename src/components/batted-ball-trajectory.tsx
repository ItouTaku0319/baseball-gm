"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { AtBatLog } from "@/models/league";
import { getFenceDistance, estimateDistance } from "@/engine/simulation";

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
  const g = 9.8;
  const h = 1.2;
  const vy = v * Math.sin(theta);
  return (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
}

function getGroundBallTime(exitVelocityKmh: number, distM: number): number {
  const vGround = (exitVelocityKmh / 3.6) * 0.7;
  return vGround > 0 ? distM / vGround : 2.0;
}

/** フライボールがフェンスの水平距離に到達する時刻を計算 */
function getFenceArrivalTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  directionDeg: number
): number {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vx = v * Math.cos(theta);
  const dragFactor = 0.61;
  const fenceDist = getFenceDistance(directionDeg);
  if (vx * dragFactor <= 0) return Infinity;
  return fenceDist / (vx * dragFactor);
}

/** フライ打球の時刻tにおける状態（地面投影位置・高さ）を返す */
function getBallStateAtTime(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  direction: number,
  t: number,
): { groundPos: { x: number; y: number }; height: number } | null {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const g = 9.8;
  const h0 = 1.2;
  const dragFactor = 0.61;

  const vx = v * Math.cos(theta);
  const vy = v * Math.sin(theta);

  const disc = vy * vy + 2 * g * h0;
  if (disc < 0) return null;
  const tFlight = (vy + Math.sqrt(disc)) / g;
  if (t > tFlight + 0.001) return null;

  const horizontalDist = vx * Math.min(t, tFlight) * dragFactor;
  const height = Math.max(0, h0 + vy * t - 0.5 * g * t * t);
  const groundPos = toFieldSvg(horizontalDist, direction);

  return { groundPos, height };
}

/** ゴロ打球の時刻tにおける地面位置を返す */
function getGroundBallStateAtTime(
  direction: number,
  totalDist: number,
  t: number,
  totalTime: number,
): { groundPos: { x: number; y: number } } | null {
  if (t > totalTime + 0.001) return null;
  const progress = clampNum(t / totalTime, 0, 1);
  const easedProgress = progress * (2 - progress);
  const dist = totalDist * easedProgress;
  return { groundPos: toFieldSvg(dist, direction) };
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
}

function AnimatedFieldView({ log, currentTime, totalTime, trailPoints }: AnimatedFieldViewProps) {
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

  const hasFieldData = log.direction !== null && log.estimatedDistance != null && log.estimatedDistance > 0;
  const isAnimating = currentTime >= 0;

  const direction = log.direction ?? 45;
  const exitVelocity = log.exitVelocity ?? 120;
  const launchAngle = log.launchAngle ?? 15;
  const estimatedDist = log.estimatedDistance ?? estimateDistance(exitVelocity, launchAngle);
  const isGrounder = (log.launchAngle ?? 15) <= 0 || log.battedBallType === "grounder";
  const isHomerun = log.result === "homerun";

  // 落下地点
  const dot = hasFieldData ? toFieldSvg(estimatedDist, direction) : null;

  // アニメーション中のボール状態
  let ballGroundPos: { x: number; y: number } | null = null;
  let ballHeight = 0;
  let shadowGroundPos: { x: number; y: number } | null = null;

  if (isAnimating && hasFieldData && currentTime <= totalTime) {
    if (isGrounder) {
      const state = getGroundBallStateAtTime(direction, estimatedDist, currentTime, totalTime);
      if (state) {
        ballGroundPos = state.groundPos;
        ballHeight = 0;
        shadowGroundPos = null;
      }
    } else {
      const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, currentTime);
      if (state) {
        ballGroundPos = state.groundPos;
        ballHeight = state.height;
        // 影は地面投影なので同じ位置（既に地面への投影計算済み）
        shadowGroundPos = state.groundPos;
      }
    }
  }

  // アニメーション中の軌跡ライン（currentTime/totalTime の割合で trailPoints を切り出す）
  const trailEnd = isAnimating && totalTime > 0
    ? Math.floor((clampNum(currentTime / totalTime, 0, 1)) * trailPoints.length)
    : (isAnimating ? trailPoints.length : 0);
  const visibleTrail = trailPoints.slice(0, trailEnd + 1);
  const trailPolyline = visibleTrail.length >= 2
    ? visibleTrail.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    : null;

  // フライ系: フライトの最高高さ（ドットサイズ計算用）
  let maxHeight = 0;
  if (!isGrounder && hasFieldData) {
    const tFlight = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
    const tPeak = Math.max(0, (exitVelocity / 3.6) * Math.sin(launchAngle * Math.PI / 180) / 9.8);
    const peak = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, Math.min(tPeak, tFlight));
    maxHeight = peak?.height ?? 10;
  }

  // ドットサイズ: 高さに応じて変化
  const ballRadius = isGrounder
    ? 2.5
    : Math.max(2, 2 + (maxHeight > 0 ? (ballHeight / maxHeight) * 4 : 0));

  // ホームラン: フェンス越えエフェクト
  const hrFenceDist = isHomerun && log.direction !== null ? getFenceDistance(log.direction) : null;
  const hrFencePos = hrFenceDist && log.direction !== null ? toFieldSvg(hrFenceDist, log.direction) : null;

  const fenceArrivalTime = useMemo(() => {
    if (!isHomerun || !hasFieldData || exitVelocity <= 0 || launchAngle <= 0 || log.direction === null) return Infinity;
    return getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), log.direction);
  }, [isHomerun, hasFieldData, exitVelocity, launchAngle, log.direction]);

  const ballBeyondFence = isHomerun && hrFenceDist && hasFieldData && ballGroundPos
    ? estimatedDist >= hrFenceDist && currentTime >= fenceArrivalTime
    : false;

  const outsBeforePlay = log.outsBeforePlay ?? null;

  // 静的表示（アニメーション非再生）の落下地点マーカー
  const showStaticDot = dot && !isAnimating;
  // アニメーション完了後の落下地点マーカー
  const showLandingDot = dot && isAnimating && currentTime >= totalTime;

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

      {/* アニメーション中の軌跡ライン */}
      {trailPolyline && (
        <polyline
          points={trailPolyline}
          fill="none"
          stroke={dotColor(log.result)}
          strokeWidth="1"
          strokeDasharray={isGrounder ? "2,2" : "none"}
          opacity="0.45"
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
          {/* フライ系: ボールの高さに応じた位置（SVGは俯瞰なのでサイズで高さを表現） */}
          {!isGrounder && ballHeight > 0.5 ? (
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
  const g = 9.8;
  const h = 1.2;
  const vx = v * Math.cos(theta);
  const vy = v * Math.sin(theta);
  const dragFactor = 0.61;

  const disc = vy * vy + 2 * g * h;
  if (disc < 0) return [{ x: 0, y: h }];
  const tFlight = (vy + Math.sqrt(disc)) / g;

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = (i / numPoints) * tFlight;
    points.push({
      x: vx * t * dragFactor,
      y: h + vy * t - 0.5 * g * t * t,
    });
  }
  return points;
}

interface SideViewProps {
  log: AtBatLog;
  currentTime: number;
  totalFlightTime: number;
}

function SideView({ log, currentTime, totalFlightTime }: SideViewProps) {
  if (log.exitVelocity === null || log.launchAngle === null || log.launchAngle <= 0) {
    return (
      <svg viewBox="0 0 350 180" className="w-full bg-gray-900 rounded border border-gray-700">
        <text x="175" y="95" textAnchor="middle" fill="#6b7280" fontSize="12">軌道データなし</text>
      </svg>
    );
  }

  const points = computeTrajectoryPoints(log.exitVelocity, log.launchAngle);
  const totalDist = log.estimatedDistance ?? estimateDistance(log.exitVelocity, log.launchAngle);
  const maxY = Math.max(...points.map(p => p.y));

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

  const fenceDist = log.direction !== null ? getFenceDistance(log.direction) : 100;
  const fenceH = 4;
  const { sx: fenceSx } = toSvgCoord(fenceDist, 0);
  const { sy: fenceTopSy } = toSvgCoord(fenceDist, fenceH);
  const { sy: fenceBottomSy } = toSvgCoord(fenceDist, 0);

  const peakIdx = points.reduce((best, p, i) => (p.y > points[best].y ? i : best), 0);
  const peak = points[peakIdx];
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
  const hasFieldData = log.direction !== null && log.estimatedDistance != null && log.estimatedDistance > 0;

  const exitVelocity = log.exitVelocity ?? 120;
  const launchAngle = log.launchAngle ?? 15;
  const direction = log.direction ?? 45;
  const estimatedDist = log.estimatedDistance ?? estimateDistance(exitVelocity, launchAngle);
  const isGrounder = launchAngle <= 0 || log.battedBallType === "grounder";
  const isHomerun = log.result === "homerun";

  // 総アニメーション時間
  const totalTime = useMemo(() => {
    if (!hasFieldData) return 0;
    if (isGrounder) return getGroundBallTime(exitVelocity, estimatedDist);
    // ホームランはフェンス越えを考慮した飛距離
    const hrDist = isHomerun && log.direction !== null ? getFenceDistance(log.direction) + 10 : estimatedDist;
    const effectiveDist = isHomerun ? hrDist : estimatedDist;
    // フライ時間は物理から、ただし最低でも推定距離/フライ時間を確認
    void effectiveDist; // used for clarity
    return getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
  }, [hasFieldData, isGrounder, isHomerun, exitVelocity, estimatedDist, launchAngle, log.direction]);

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
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * totalTime;
      if (isGrounder) {
        const state = getGroundBallStateAtTime(direction, estimatedDist, t, totalTime);
        if (state) points.push(state.groundPos);
      } else {
        const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, t);
        if (state) points.push(state.groundPos);
      }
    }
    return points;
  }, [hasFieldData, isGrounder, direction, estimatedDist, totalTime, exitVelocity, launchAngle]);

  const { currentTime, playing, play } = usePlayAnimation();
  const canAnimate = hasFieldData && totalTime > 0;

  // ポップアップ表示時に自動1回再生
  useEffect(() => {
    if (canAnimate) {
      const timer = setTimeout(() => play(totalTime), 300);
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
              currentTime={currentTime}
              totalTime={totalTime}
              trailPoints={trailPoints}
            />
          </div>
          <div>
            <div className="text-gray-400 text-xs mb-1 text-center">軌道（横から）</div>
            <SideView log={log} currentTime={currentTime} totalFlightTime={totalFlightTime} />
          </div>
        </div>

        {/* 再生コントロール */}
        {canAnimate && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              onClick={() => play(totalTime)}
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
