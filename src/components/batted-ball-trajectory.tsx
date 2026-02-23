"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

// ---- 守備デフォルト位置 ----

const FIELDER_DEFAULT_POS: Record<number, { dist: number; dir: number }> = {
  1: { dist: 16, dir: 45 },
  2: { dist: 2,  dir: 45 },
  3: { dist: 25, dir: 80 },
  4: { dist: 35, dir: 62 },
  5: { dist: 25, dir: 10 },
  6: { dist: 35, dir: 28 },
  7: { dist: 80, dir: 10 },
  8: { dist: 85, dir: 45 },
  9: { dist: 80, dir: 80 },
};

// ---- 走者進塁数 ----

function getRunnerAdvancement(result: string): number {
  switch (result) {
    case "homerun": return 4;
    case "triple": return 3;
    case "double": return 2;
    case "single":
    case "infieldHit":
    case "error":
    case "fieldersChoice": return 1;
    case "walk":
    case "hitByPitch": return 1;
    case "sacrificeFly": return 1;
    default: return 0;
  }
}

// ---- アニメーションフック ----

function usePlayAnimation(duration: number = 2500) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const animRef = useRef<number | null>(null);

  const play = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setPlaying(true);
    setProgress(0);
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const p = Math.min(elapsed / duration, 1);
      setProgress(p);
      if (p < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        setPlaying(false);
      }
    };
    animRef.current = requestAnimationFrame(animate);
  }, [duration]);

  useEffect(() => {
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  return { progress, playing, play };
}

// ---- フィールドビュー（俯瞰・アニメーション対応） ----

interface AnimatedFieldViewProps {
  log: AtBatLog;
  progress: number;
  playing: boolean;
}

function AnimatedFieldView({ log, progress, playing }: AnimatedFieldViewProps) {
  const fencePoints = Array.from({ length: 19 }, (_, i) => {
    const deg = i * 5;
    const dist = getFenceDistance(deg);
    return toFieldSvg(dist, deg);
  });
  const fencePath = fencePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  // ダイヤモンド（塁間27.431m）
  const home = { x: 150, y: 280 };
  const first = toFieldSvg(27.431, 90);
  const second = toFieldSvg(27.431 * Math.SQRT2, 45);
  const third = toFieldSvg(27.431, 0);
  const diamondPath = `M ${home.x} ${home.y} L ${first.x.toFixed(1)} ${first.y.toFixed(1)} L ${second.x.toFixed(1)} ${second.y.toFixed(1)} L ${third.x.toFixed(1)} ${third.y.toFixed(1)} Z`;

  // 塁座標配列 [ホーム, 1塁, 2塁, 3塁]
  const baseCoords = [home, first, second, third];

  // 打球落下地点
  let dot: { x: number; y: number } | null = null;
  if (log.direction !== null && log.estimatedDistance != null && log.estimatedDistance > 0) {
    dot = toFieldSvg(log.estimatedDistance, log.direction);
  }

  // ボール位置（アニメーション 0.1-0.5 でホーム→落下地点）
  let ballPos: { x: number; y: number } | null = null;
  if (playing && dot && progress >= 0.1 && progress <= 0.6) {
    const t = clampNum((progress - 0.1) / 0.4, 0, 1);
    ballPos = lerp(home, dot, t);
  }

  // 守備選手のアニメーション（0.4-0.7 でデフォルト位置→落下地点）
  const fielderProgress = clampNum((progress - 0.4) / 0.3, 0, 1);

  // 走者アニメーション（0.5-0.9）
  const runnerProgress = clampNum((progress - 0.5) / 0.4, 0, 1);
  const advance = getRunnerAdvancement(log.result);

  // アウトカウント表示（3つのドット）
  const outsBeforePlay = log.outsBeforePlay ?? null;

  return (
    <svg viewBox="0 0 300 300" className="w-full bg-gray-900 rounded border border-gray-700">
      {/* フィールド背景 */}
      <rect x="0" y="0" width="300" height="300" fill="#111827" />
      {/* 外野グラス */}
      <path d={fencePath + ` L ${home.x} ${home.y} Z`} fill="#14532d" opacity="0.5" />
      {/* 内野ダート */}
      <path d={diamondPath} fill="#92400e" opacity="0.4" />
      {/* フェンス */}
      <path d={fencePath} fill="none" stroke="#6b7280" strokeWidth="1.5" />
      {/* ダイヤモンド */}
      <path d={diamondPath} fill="none" stroke="#9ca3af" strokeWidth="1" />
      {/* 各塁 */}
      {[home, first, second, third].map((p, i) => (
        <rect key={i} x={p.x - 3} y={p.y - 3} width="6" height="6" fill="#e5e7eb" transform={`rotate(45 ${p.x} ${p.y})`} />
      ))}

      {/* 守備選手 */}
      {Object.entries(FIELDER_DEFAULT_POS).map(([posStr, coord]) => {
        const pos = Number(posStr);
        const defaultP = toFieldSvg(coord.dist, coord.dir);
        const isActive = pos === log.fielderPosition;
        let displayP = defaultP;
        if (isActive && playing && dot) {
          displayP = lerp(defaultP, dot, fielderProgress);
        }
        return (
          <g key={pos}>
            <circle
              cx={displayP.x}
              cy={displayP.y}
              r={4}
              fill={isActive ? "#f97316" : "#374151"}
              stroke="#9ca3af"
              strokeWidth="0.8"
            />
            <text
              x={displayP.x}
              y={displayP.y + 1}
              textAnchor="middle"
              fill="white"
              fontSize="5"
              dominantBaseline="middle"
            >
              {pos}
            </text>
          </g>
        );
      })}

      {/* 走者 */}
      {log.basesBeforePlay && log.basesBeforePlay.map((occupied, baseIdx) => {
        if (!occupied) return null;
        const baseNum = baseIdx + 1; // 1塁=1, 2塁=2, 3塁=3
        const from = baseCoords[baseNum];
        const targetBase = Math.min(baseNum + advance, 4);
        // 4はホームに帰る（ホームランや押し出しでホームに戻る）
        const to = targetBase >= 4 ? home : baseCoords[targetBase];
        const runnerPos = (playing && advance > 0) ? lerp(from, to, runnerProgress) : from;
        return (
          <circle
            key={baseIdx}
            cx={runnerPos.x}
            cy={runnerPos.y}
            r={3.5}
            fill="#22c55e"
            stroke="white"
            strokeWidth="0.8"
          />
        );
      })}

      {/* 打者走者（アニメーション中: ホーム→1塁方向） */}
      {playing && advance > 0 && (
        <circle
          cx={lerp(home, first, clampNum(runnerProgress, 0, 1)).x}
          cy={lerp(home, first, clampNum(runnerProgress, 0, 1)).y}
          r={3.5}
          fill="#3b82f6"
          stroke="white"
          strokeWidth="0.8"
        />
      )}

      {/* 打球落下地点（静的・アニメーションしていない場合） */}
      {dot && !playing && (
        <>
          <line x1={home.x} y1={home.y} x2={dot.x} y2={dot.y} stroke={dotColor(log.result)} strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
          <circle cx={dot.x} cy={dot.y} r="5" fill={dotColor(log.result)} opacity="0.9" />
          <circle cx={dot.x} cy={dot.y} r="5" fill="none" stroke="white" strokeWidth="0.8" opacity="0.5" />
        </>
      )}

      {/* ボール（アニメーション中） */}
      {ballPos && (
        <circle
          cx={ballPos.x}
          cy={ballPos.y}
          r={2.5}
          fill="white"
          stroke="#ef4444"
          strokeWidth="0.8"
        />
      )}

      {/* アウトカウント表示 */}
      {outsBeforePlay !== null && (
        <g>
          <text x="10" y="12" fill="#9ca3af" fontSize="7">アウト</text>
          {[0, 1, 2].map(i => (
            <circle
              key={i}
              cx={10 + i * 10}
              cy={20}
              r={3.5}
              fill={i < outsBeforePlay ? "#6b7280" : "none"}
              stroke="#9ca3af"
              strokeWidth="1"
            />
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
  const dragFactor = 0.87;

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

function SideView({ log }: { log: AtBatLog }) {
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

  // SVGスケーリング
  const svgW = 350, svgH = 180;
  const padLeft = 30, padBottom = 25, padTop = 20, padRight = 20;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const xMax = totalDist + 15;
  const yMax = maxY + 5;

  const toSvg = (x: number, y: number) => ({
    sx: padLeft + (x / xMax) * plotW,
    sy: padTop + plotH - (y / yMax) * plotH,
  });

  const pathD = points.map((p, i) => {
    const { sx, sy } = toSvg(p.x, p.y);
    return `${i === 0 ? "M" : "L"} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  }).join(" ");

  // フェンス位置
  const fenceDist = log.direction !== null ? getFenceDistance(log.direction) : 100;
  const fenceH = 4;
  const { sx: fenceSx } = toSvg(fenceDist, 0);
  const { sy: fenceTopSy } = toSvg(fenceDist, fenceH);
  const { sy: fenceBottomSy } = toSvg(fenceDist, 0);

  // 最高到達点
  const peakIdx = points.reduce((best, p, i) => (p.y > points[best].y ? i : best), 0);
  const peak = points[peakIdx];
  const { sx: peakSx, sy: peakSy } = toSvg(peak.x, peak.y);

  // 着地点
  const { sx: landSx } = toSvg(totalDist, 0);
  const { sy: groundSy } = toSvg(0, 0);

  const color = dotColor(log.result);

  // X軸ラベル（50m刻み）
  const xLabels: number[] = [];
  for (let x = 0; x <= xMax; x += 50) xLabels.push(x);

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full bg-gray-900 rounded border border-gray-700">
      {/* グリッド線 */}
      {xLabels.map(x => {
        const { sx } = toSvg(x, 0);
        return <line key={x} x1={sx} y1={padTop} x2={sx} y2={groundSy} stroke="#374151" strokeWidth="0.5" />;
      })}
      {/* 地面 */}
      <line x1={padLeft} y1={groundSy} x2={svgW - padRight} y2={groundSy} stroke="#6b7280" strokeWidth="1" />
      {/* フェンス */}
      {fenceSx >= padLeft && fenceSx <= svgW - padRight && (
        <line x1={fenceSx} y1={fenceTopSy} x2={fenceSx} y2={fenceBottomSy} stroke="#f59e0b" strokeWidth="2" />
      )}
      {/* 軌道 */}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
      {/* 最高到達点 */}
      <circle cx={peakSx} cy={peakSy} r="3" fill={color} />
      <text x={peakSx} y={peakSy - 6} textAnchor="middle" fill="#d1d5db" fontSize="8">
        {peak.y.toFixed(1)}m
      </text>
      {/* 着地点 */}
      <circle cx={landSx} cy={groundSy} r="4" fill={color} />
      {/* X軸ラベル */}
      {xLabels.map(x => {
        const { sx } = toSvg(x, 0);
        return (
          <text key={x} x={sx} y={groundSy + 12} textAnchor="middle" fill="#9ca3af" fontSize="8">
            {x}
          </text>
        );
      })}
      {/* Y軸（距離） */}
      <text x={padLeft - 5} y={padTop + 5} textAnchor="end" fill="#9ca3af" fontSize="8">
        {yMax.toFixed(0)}m
      </text>
      <text x={padLeft - 5} y={groundSy + 3} textAnchor="end" fill="#9ca3af" fontSize="8">0</text>
      {/* 飛距離ラベル */}
      <text x={landSx} y={groundSy - 6} textAnchor="middle" fill="#d1d5db" fontSize="9" fontWeight="bold">
        {totalDist.toFixed(0)}m
      </text>
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
  const { progress, playing, play } = usePlayAnimation(2500);

  // インプレー打球かどうか（アニメーション可能かどうか）
  const hasFieldData = log.direction !== null && log.estimatedDistance != null && log.estimatedDistance > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl border border-gray-600"
        onClick={e => e.stopPropagation()}
      >
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
        <div
          className="grid grid-cols-5 gap-3 mb-4 text-sm"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">結果</div>
            <div className={`font-bold text-xs ${resultColor(log.result)}`}>
              {resultNamesJa[log.result] ?? log.result}
            </div>
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
            <div className="text-white font-bold">
              {log.estimatedDistance != null ? `${Math.round(log.estimatedDistance)}m` : "-"}
            </div>
          </div>
        </div>

        {/* SVGビュー */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-gray-400 text-xs mb-1 text-center">フィールドビュー</div>
            <AnimatedFieldView log={log} progress={progress} playing={playing} />
          </div>
          <div>
            <div className="text-gray-400 text-xs mb-1 text-center">軌道（横から）</div>
            <SideView log={log} />
          </div>
        </div>

        {/* 再生ボタン */}
        {hasFieldData && (
          <div className="mt-3 text-center">
            <button
              onClick={play}
              disabled={playing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
            >
              {playing ? "再生中..." : "▶ プレー再生"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
