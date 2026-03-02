"use client";

import type { AtBatLog } from "@/models/league";
import { getFenceDistance } from "@/engine/simulation";
import { GRAVITY, BAT_HEIGHT, GROUND_BALL_AVG_SPEED_RATIO, FENCE_HEIGHT } from "@/engine/physics-constants";
import { clampNum, dotColor } from "./field-coords";
import { computeTrajectoryPoints, computeBouncePoints, computeFenceBounceBackPoints, getGroundBallTime, estimateDistance } from "./ball-physics";

// ---- サイドビュー（軌道・横から）大画面対応 ----

interface LargeSideViewProps {
  log: AtBatLog;
  currentTime: number;
  totalFlightTime: number;
  isFenceHit?: boolean;
  isCaughtFly?: boolean;
  className?: string;
}

export function LargeSideView({ log, currentTime, totalFlightTime, isFenceHit, isCaughtFly, className }: LargeSideViewProps) {
  if (log.exitVelocity === null || log.launchAngle === null) {
    return (
      <svg viewBox="0 0 450 200" className={`bg-gray-900 rounded-lg border border-gray-700 ${className ?? ""}`}>
        <text x="225" y="100" textAnchor="middle" fill="#6b7280" fontSize="12">軌道データなし</text>
      </svg>
    );
  }

  // ゴロ（角度0以下）
  if (log.launchAngle <= 0) {
    const totalDist = log.estimatedDistance ?? 0;
    const ev = log.exitVelocity;
    const angle = log.launchAngle;

    const restitution = 0.35;
    const friction = 0.85;
    const v = ev / 3.6;
    const absAngle = Math.abs(angle);
    const theta = Math.max(absAngle, 2) * Math.PI / 180;
    let vx = v * Math.cos(theta) * GROUND_BALL_AVG_SPEED_RATIO;
    let vy = v * Math.sin(theta) * 0.5;

    const tFirstDrop = Math.sqrt(2 * BAT_HEIGHT / GRAVITY);
    const xFirstDrop = vx * tFirstDrop;

    type BouncePoint = { x: number; y: number };
    const trajectory: BouncePoint[] = [];
    const steps = 20;

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * tFirstDrop;
      trajectory.push({ x: vx * t, y: BAT_HEIGHT - 0.5 * GRAVITY * t * t });
    }

    let cumX = xFirstDrop;
    for (let bounce = 0; bounce < 3; bounce++) {
      if (bounce === 0) {
        vy = Math.sqrt(2 * GRAVITY * BAT_HEIGHT) * restitution;
      }
      vx *= friction;
      const tBounce = 2 * vy / GRAVITY;
      if (tBounce < 0.01 || vy < 0.1) break;
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * tBounce;
        trajectory.push({ x: cumX + vx * t, y: vy * t - 0.5 * GRAVITY * t * t });
      }
      cumX += vx * tBounce;
      vy *= restitution;
    }

    if (cumX < totalDist) trajectory.push({ x: totalDist, y: 0 });

    const svgW = 450, svgH = 200;
    const padLeft = 35, padBottom = 25, padTop = 20, padRight = 20;
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

    const groundBallTotalTime = getGroundBallTime(ev, totalDist);
    const animProgress = groundBallTotalTime > 0 ? clampNum(currentTime / groundBallTotalTime, 0, 1) : 0;
    const easedProgress = animProgress * (2 - animProgress);
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

    const tickStep = xMax <= 30 ? 5 : xMax <= 60 ? 10 : 20;
    const ticks: number[] = [];
    for (let v = 0; v <= xMax; v += tickStep) ticks.push(v);

    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className={`bg-gray-900 rounded-lg border border-gray-700 ${className ?? ""}`}>
        <line x1={padLeft} y1={groundY} x2={svgW - padRight} y2={groundY} stroke="#4b5563" strokeWidth={1} />
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={groundY} stroke="#4b5563" strokeWidth={0.5} />
        {ticks.map(v => {
          const { sx } = toSvg(v, 0);
          return (
            <g key={v}>
              <line x1={sx} y1={groundY} x2={sx} y2={groundY + 4} stroke="#6b7280" strokeWidth={0.5} />
              <text x={sx} y={groundY + 15} textAnchor="middle" fill="#6b7280" fontSize="9">{v}</text>
            </g>
          );
        })}
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
        <polyline points={polyPoints} fill="none" stroke="#ef4444" strokeWidth={2} opacity={0.8} />
        {cumX < totalDist && (() => {
          const { sx: sx1, sy: sy1 } = toSvg(cumX, 0);
          const { sx: sx2, sy: sy2 } = toSvg(totalDist, 0);
          return <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.6} />;
        })()}
        {currentTime >= 0 && currentTime < groundBallTotalTime && (
          <circle cx={ballSvgX} cy={ballSvgY} r={4} fill="#ef4444" stroke="white" strokeWidth={1} />
        )}
        {totalDist > 0 && (() => {
          const { sx } = toSvg(totalDist, 0);
          return <text x={sx} y={groundY - 8} textAnchor="middle" fill="#22c55e" fontSize="11" fontWeight="bold">{Math.round(totalDist)}m</text>;
        })()}
      </svg>
    );
  }

  // フライ系
  const isCaught = isCaughtFly ?? false;
  const isFence = isFenceHit ?? false;

  const rawPoints = computeTrajectoryPoints(log.exitVelocity, log.launchAngle);
  const totalDist = log.estimatedDistance ?? estimateDistance(log.exitVelocity, log.launchAngle);
  const rawEndX = rawPoints.length > 0 ? rawPoints[rawPoints.length - 1].x : 1;
  const xStretch = rawEndX > 0 ? totalDist / rawEndX : 1;
  const allPoints = rawPoints.map(p => ({ x: p.x * xStretch, y: p.y }));

  const fenceDist = log.direction !== null ? getFenceDistance(log.direction) : 100;
  const points = isFence ? allPoints.filter(p => p.x <= fenceDist + 1) : allPoints;
  const maxY = Math.max(...allPoints.map(p => p.y));

  const svgW = 450, svgH = 200;
  const padLeft = 35, padBottom = 25, padTop = 20, padRight = 20;
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

  const isFenceViaBounce = !isFence && isFenceHit;
  const bouncePoints = (() => {
    if (isHR || isCaught) return [];
    if (isFence && lastPoint) {
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
    return computeBouncePoints(lastPoint, log.exitVelocity!, log.launchAngle!, 2, isFenceViaBounce ? fenceDist : undefined);
  })();

  const bouncePolyline = bouncePoints.length > 0
    ? (() => {
        const startX = isFence ? fenceDist : (lastPoint?.x ?? totalDist);
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
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className={`bg-gray-900 rounded-lg border border-gray-700 ${className ?? ""}`}>
      {xLabels.map(x => {
        const { sx } = toSvgCoord(x, 0);
        return <line key={x} x1={sx} y1={padTop} x2={sx} y2={groundSy} stroke="#374151" strokeWidth="0.5" />;
      })}
      <line x1={padLeft} y1={groundSy} x2={svgW - padRight} y2={groundSy} stroke="#6b7280" strokeWidth="1" />
      {fenceSx >= padLeft && fenceSx <= svgW - padRight && (
        <line x1={fenceSx} y1={fenceTopSy} x2={fenceSx} y2={fenceBottomSy} stroke="#f59e0b" strokeWidth="2" />
      )}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" opacity={isAnimating ? 0.35 : 1} />
      {bouncePolyline && (
        <polyline points={bouncePolyline} fill="none" stroke={color} strokeWidth="1.5" opacity={isAnimating ? 0.25 : 0.5} />
      )}
      {showRollLine && (() => {
        const { sx: sx1, sy: sy1 } = toSvgCoord(bounceEndX, 0);
        const { sx: sx2, sy: sy2 } = toSvgCoord(totalDist, 0);
        return <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity={isAnimating ? 0.2 : 0.4} />;
      })()}
      <circle cx={peakSx} cy={peakSy} r="3" fill={color} opacity={isAnimating ? 0.35 : 1} />
      <text x={peakSx} y={peakSy - 6} textAnchor="middle" fill="#d1d5db" fontSize="9">{peak.y.toFixed(1)}m</text>
      <circle cx={landSx} cy={groundSy} r="4" fill={color} opacity={isAnimating ? 0.35 : 1} />
      {xLabels.map(x => {
        const { sx } = toSvgCoord(x, 0);
        return <text key={x} x={sx} y={groundSy + 14} textAnchor="middle" fill="#9ca3af" fontSize="9">{x}</text>;
      })}
      <text x={padLeft - 5} y={padTop + 5} textAnchor="end" fill="#9ca3af" fontSize="8">{yMax.toFixed(0)}m</text>
      <text x={padLeft - 5} y={groundSy + 3} textAnchor="end" fill="#9ca3af" fontSize="8">0</text>
      <text x={landSx} y={groundSy - 8} textAnchor="middle" fill="#d1d5db" fontSize="10" fontWeight="bold">{totalDist.toFixed(0)}m</text>
      {sideBallPos && (
        <circle cx={sideBallPos.sx} cy={sideBallPos.sy} r={4} fill="white" stroke="#ef4444" strokeWidth="1" />
      )}
    </svg>
  );
}
