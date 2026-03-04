"use client";

import { useMemo } from "react";
import type { AtBatLog } from "@/models/league";
import { getFenceDistance } from "@/engine/simulation";
import { DEFAULT_FIELDER_POSITIONS } from "@/engine/fielding-ai";
import type { AgentTimelineEntry, AgentState, ThrowPlay, RunnerSnapshot, ThrowBallSnapshot } from "@/engine/fielding-agent-types";
import { BASE_POSITIONS } from "@/engine/fielding-agent-types";
import { toFieldSvg, fieldXYtoSvg, clampNum, dotColor } from "./field-coords";
import { getBallFlightTime, getBallStateAtTime, getFieldBounceStateAtTime, getFenceBounceBackStateAtTime, getGroundBallStateAtTime, getFenceArrivalTime, estimateDistance } from "./ball-physics";

// ---- 大画面フィールドビュー定数 ----

const SCALE = 3.0;
const HOME_X = 250;
const HOME_Y = 460;
const VIEW_SIZE = 500;

// 大画面用座標変換
function toSvg(distM: number, dirDeg: number) {
  return toFieldSvg(distM, dirDeg, SCALE, HOME_X, HOME_Y);
}
function xyToSvg(fx: number, fy: number) {
  return fieldXYtoSvg(fx, fy, SCALE, HOME_X, HOME_Y);
}

// 塁座標 (大画面)
const HOME = { x: HOME_X, y: HOME_Y };
const FIRST = toSvg(27.431, 90);
const SECOND = toSvg(27.431 * Math.SQRT2, 45);
const THIRD = toSvg(27.431, 0);
const BASE_SVG: Record<number, { x: number; y: number }> = {
  0: HOME, 1: FIRST, 2: SECOND, 3: THIRD,
};

// ---- 野手状態 ----

const AGENT_STATE_COLOR: Record<AgentState, string> = {
  READY: "rgba(100,180,255,0.7)",
  REACTING: "#facc15",
  PURSUING: "#f97316",
  FIELDING: "#22c55e",
  THROWING: "#ef4444",
  COVERING: "#a855f7",
  BACKING_UP: "#a855f7",
  HOLDING: "rgba(100,180,255,0.7)",
  SECURING: "#22c55e",
  RECEIVING: "#a855f7",
  RETRIEVING: "#f97316",
  RELAYING: "#a855f7",
  RETURNING: "rgba(100,180,255,0.55)",
};

const AGENT_STATE_LABEL_JA: Record<AgentState, string> = {
  READY: "",
  REACTING: "反応",
  PURSUING: "追球",
  FIELDING: "捕球",
  THROWING: "送球",
  COVERING: "カバー",
  BACKING_UP: "バック",
  HOLDING: "",
  SECURING: "保持",
  RECEIVING: "待機",
  RETRIEVING: "回収",
  RELAYING: "中継",
  RETURNING: "帰還",
};

const POS_SHORT_JA: Record<number, string> = {
  1: "投", 2: "捕", 3: "一", 4: "二", 5: "三", 6: "遊", 7: "左", 8: "中", 9: "右",
};

const RUNNER_STATE_COLOR: Record<string, string> = {
  RUNNING: "#22c55e",
  TAGGED_UP: "#22c55e",
  ROUNDING: "#22c55e",
  LEADING: "#86efac",
  SAFE: "#3b82f6",
  OUT: "#ef4444",
  HOLDING: "#86efac",
  WAITING_TAG: "#fbbf24",
  DECIDING: "#fbbf24",
  RETREATING: "#f97316",
};

// ---- 野手外挿 ----
const POST_CATCH_SPEED = 7.0;

// REACTINGリーン（身を乗り出し）を座標に反映
function withReactingLean(ag: AgentTimelineEntry["agents"][0]): AgentTimelineEntry["agents"][0] {
  if (ag.state !== "REACTING" || ag.perceivedX == null || ag.perceivedY == null) return ag;
  const pdx = ag.perceivedX - ag.x;
  const pdy = ag.perceivedY - ag.y;
  const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
  if (pdist <= 0.1) return ag;
  const lean = Math.min(1.5, pdist * 0.03);
  return { ...ag, x: ag.x + (pdx / pdist) * lean, y: ag.y + (pdy / pdist) * lean };
}

function extrapolateAgent(ag: AgentTimelineEntry["agents"][0], dt: number): AgentTimelineEntry["agents"][0] {
  if (ag.state !== "COVERING" && ag.state !== "BACKING_UP" && ag.state !== "PURSUING") return ag;
  const dx = ag.targetX - ag.x;
  const dy = ag.targetY - ag.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.3) return { ...ag, x: ag.targetX, y: ag.targetY };
  const move = Math.min(POST_CATCH_SPEED * dt, dist);
  return { ...ag, x: ag.x + (dx / dist) * move, y: ag.y + (dy / dist) * move };
}

function getAgentFrameAtTime(timeline: AgentTimelineEntry[], t: number) {
  if (timeline.length === 0) return null;
  if (t <= timeline[0].t) return { ...timeline[0], agents: timeline[0].agents.map(withReactingLean) };
  if (t >= timeline[timeline.length - 1].t) {
    const last = timeline[timeline.length - 1];
    const elapsed = t - last.t;
    if (elapsed <= 0) return { ...last, agents: last.agents.map(withReactingLean) };
    return {
      ...last,
      t,
      agents: last.agents.map(ag => withReactingLean(extrapolateAgent(ag, elapsed))),
    };
  }
  for (let i = 0; i < timeline.length - 1; i++) {
    if (timeline[i].t <= t && t < timeline[i + 1].t) {
      const ratio = (t - timeline[i].t) / (timeline[i + 1].t - timeline[i].t);
      const a = timeline[i];
      const b = timeline[i + 1];
      return {
        t,
        ballPos: { x: a.ballPos.x + (b.ballPos.x - a.ballPos.x) * ratio, y: a.ballPos.y + (b.ballPos.y - a.ballPos.y) * ratio },
        ballHeight: a.ballHeight + (b.ballHeight - a.ballHeight) * ratio,
        agents: b.agents.map((ag, j) => {
          const prev = a.agents[j];
          if (!prev) return withReactingLean(ag);
          const pLean = withReactingLean(prev);
          const nLean = withReactingLean(ag);
          return {
            ...ag,
            x: pLean.x + (nLean.x - pLean.x) * ratio,
            y: pLean.y + (nLean.y - pLean.y) * ratio,
          };
        }),
        runners: b.runners ? b.runners.map((r, j) => {
          const prev = a.runners?.[j];
          if (!prev) return r;
          return {
            ...r,
            x: prev.x + (r.x - prev.x) * ratio,
            y: prev.y + (r.y - prev.y) * ratio,
          };
        }) : a.runners,
        throwBall: b.throwBall ?? a.throwBall,
      };
    }
  }
  return timeline[timeline.length - 1];
}

// ---- 送球タイムライン ----
const THROW_TRANSFER_TIME = 0.35;
const THROW_SPEED = 38;

interface ThrowSegment {
  fromSvg: { x: number; y: number };
  toSvg: { x: number; y: number };
  startTime: number;
  endTime: number;
  base: string;
}

function buildThrowTimeline(throwPlays: ThrowPlay[], agentTimeline: AgentTimelineEntry[]): ThrowSegment[] {
  if (throwPlays.length === 0 || agentTimeline.length === 0) return [];
  const lastFrame = agentTimeline[agentTimeline.length - 1];
  const segments: ThrowSegment[] = [];
  let currentT = lastFrame.t + THROW_TRANSFER_TIME;

  for (let i = 0; i < throwPlays.length; i++) {
    const play = throwPlays[i];
    let fromFieldPos: { x: number; y: number };
    if (i > 0) {
      const baseName = throwPlays[i - 1].base;
      const bp = BASE_POSITIONS[baseName];
      fromFieldPos = bp ? { x: bp.x, y: bp.y } : { x: 0, y: 0 };
      currentT += THROW_TRANSFER_TIME;
    } else {
      const fromAgent = lastFrame.agents.find(a => a.pos === play.from);
      fromFieldPos = fromAgent ? { x: fromAgent.x, y: fromAgent.y } : { x: 0, y: 0 };
    }
    const basePos = BASE_POSITIONS[play.base];
    const toFieldPos = basePos ? { x: basePos.x, y: basePos.y } : { x: 0, y: 0 };
    const dx = toFieldPos.x - fromFieldPos.x;
    const dy = toFieldPos.y - fromFieldPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const throwTime = dist / THROW_SPEED;

    segments.push({
      fromSvg: xyToSvg(fromFieldPos.x, fromFieldPos.y),
      toSvg: xyToSvg(toFieldPos.x, toFieldPos.y),
      startTime: currentT,
      endTime: currentT + throwTime,
      base: play.base,
    });
    currentT += throwTime;
  }
  return segments;
}

// ---- メインコンポーネント ----

export interface LargeFieldViewProps {
  log: AtBatLog;
  currentTime: number;
  totalTime: number;
  distScale?: number;
  className?: string;
}

export function LargeFieldView({ log, currentTime, totalTime, distScale = 1, className }: LargeFieldViewProps) {
  const agentTimeline = log.agentTimeline;

  // フェンスパス
  const fencePoints = Array.from({ length: 19 }, (_, i) => {
    const deg = i * 5;
    const dist = getFenceDistance(deg);
    return toSvg(dist, deg);
  });
  const fencePath = fencePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const diamondPath = `M ${HOME.x} ${HOME.y} L ${FIRST.x.toFixed(1)} ${FIRST.y.toFixed(1)} L ${SECOND.x.toFixed(1)} ${SECOND.y.toFixed(1)} L ${THIRD.x.toFixed(1)} ${THIRD.y.toFixed(1)} Z`;

  // 打球パラメータ
  const direction = log.direction ?? 45;
  const exitVelocity = log.exitVelocity ?? 120;
  const launchAngle = log.launchAngle ?? 15;
  const estimatedDist = (log.estimatedDistance != null && log.estimatedDistance > 0)
    ? log.estimatedDistance
    : estimateDistance(exitVelocity, launchAngle);
  const hasFieldData = log.direction !== null && estimatedDist > 0;
  const isGrounder = (log.launchAngle ?? 15) <= 0 || log.battedBallType === "ground_ball";
  const isHomerun = log.result === "homerun";
  const isCaughtFly = ["flyout", "lineout", "popout", "sacrificeFly"].includes(log.result);
  const fenceDistForDir = direction != null ? getFenceDistance(direction) : 95;
  const isFenceHit = !isHomerun && !isGrounder && !isCaughtFly && estimatedDist > fenceDistForDir;

  // 送球タイムライン
  // agentTimelineにthrowBallスナップショットがある場合はリアルタイム描画で送球を表示するため
  // throwSegments(タイムライン後の再アニメーション)はスキップ → 二重送球防止
  const throwSegments = useMemo(() => {
    if (!log.throwPlays || !agentTimeline || agentTimeline.length === 0) return [];
    if (agentTimeline.some(f => f.throwBall)) return [];
    return buildThrowTimeline(log.throwPlays, agentTimeline);
  }, [log.throwPlays, agentTimeline]);

  // 捕球時刻
  const catchTime = useMemo(() => {
    if (!agentTimeline || agentTimeline.length === 0) return Infinity;
    for (const frame of agentTimeline) {
      if (frame.agents.some(a => a.state === "FIELDING")) return frame.t;
    }
    return Infinity;
  }, [agentTimeline]);

  const isAnimating = currentTime >= 0;
  const ballCaught = agentTimeline && agentTimeline.length > 0 && currentTime >= catchTime;
  const flightTime = isGrounder ? totalTime : getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));

  // ---- ボール位置の計算 ----
  let ballSvgPos: { x: number; y: number } | null = null;
  let ballHeight = 0;
  let isBouncePhase = false;
  let bounceFirstMaxH = 0;
  let bounceOnGround = false;

  if (isAnimating && hasFieldData && currentTime <= totalTime && !ballCaught) {
    if (isGrounder) {
      isBouncePhase = true;
      const state = getGroundBallStateAtTime(exitVelocity, launchAngle, direction, estimatedDist, currentTime, SCALE, HOME_X, HOME_Y);
      if (state) {
        ballSvgPos = state.groundPos;
        ballHeight = state.bounceHeight;
        bounceFirstMaxH = state.firstBounceMaxH;
        bounceOnGround = state.isOnGround;
      }
    } else if (isFenceHit) {
      const fenceArrival = getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale);
      const flightToFence = Math.min(fenceArrival, flightTime);
      if (currentTime <= flightToFence) {
        const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, currentTime, distScale, SCALE, HOME_X, HOME_Y);
        if (state) { ballSvgPos = state.groundPos; ballHeight = state.height; }
      } else {
        isBouncePhase = true;
        const tAfterFence = currentTime - flightToFence;
        const state = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, tAfterFence, SCALE, HOME_X, HOME_Y);
        if (state) { ballSvgPos = state.groundPos; ballHeight = state.bounceHeight; bounceFirstMaxH = 2.0; bounceOnGround = state.bounceHeight < 0.1; }
      }
    } else if (currentTime <= flightTime) {
      const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, currentTime, distScale, SCALE, HOME_X, HOME_Y);
      if (state) { ballSvgPos = state.groundPos; ballHeight = state.height; }
    } else if (!isHomerun && !isCaughtFly) {
      isBouncePhase = true;
      const tAfterLanding = currentTime - flightTime;
      const bounceState = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, estimatedDist > fenceDistForDir ? fenceDistForDir : estimatedDist, tAfterLanding, fenceDistForDir, SCALE, HOME_X, HOME_Y);
      if (bounceState) { ballSvgPos = bounceState.groundPos; ballHeight = bounceState.bounceHeight; bounceFirstMaxH = bounceState.firstBounceMaxH; bounceOnGround = bounceState.isOnGround; }
    }
  }

  // ---- フライ高さ計算 ----
  let maxHeight = 0;
  if (!isGrounder && hasFieldData) {
    const tPeak = Math.max(0, (exitVelocity / 3.6) * Math.sin(launchAngle * Math.PI / 180) / 9.8);
    const peak = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, Math.min(tPeak, flightTime), distScale, SCALE, HOME_X, HOME_Y);
    maxHeight = peak?.height ?? 10;
  }

  const bounceHeightRatio = bounceFirstMaxH > 0 ? clampNum(ballHeight / bounceFirstMaxH, 0, 1) : 0;
  const ballRadius = isBouncePhase
    ? 4 + bounceHeightRatio * 7
    : Math.max(4, 4 + (maxHeight > 0 ? (ballHeight / maxHeight) * 8 : 0));

  // ---- 軌跡 ----
  const trailPoints = useMemo(() => {
    if (!hasFieldData) return [];
    const points: { x: number; y: number }[] = [];
    const steps = 80;
    if (isGrounder) {
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * totalTime;
        const state = getGroundBallStateAtTime(exitVelocity, launchAngle, direction, estimatedDist, t, SCALE, HOME_X, HOME_Y);
        if (state) points.push(state.groundPos);
      }
    } else {
      const flightSteps = isHomerun || isCaughtFly ? steps : Math.ceil(steps * (flightTime / totalTime));
      for (let i = 0; i <= flightSteps; i++) {
        const t = (i / flightSteps) * flightTime;
        const state = getBallStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, t, distScale, SCALE, HOME_X, HOME_Y);
        if (state) points.push(state.groundPos);
      }
      if (!isHomerun && !isCaughtFly) {
        const bounceTime = totalTime - flightTime;
        const bounceSteps = steps - flightSteps;
        const displayDist = estimatedDist > fenceDistForDir ? fenceDistForDir : estimatedDist;
        for (let i = 1; i <= bounceSteps; i++) {
          const tAfterLanding = (i / bounceSteps) * bounceTime;
          const bounceState = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, displayDist, tAfterLanding, fenceDistForDir, SCALE, HOME_X, HOME_Y);
          if (bounceState) points.push(bounceState.groundPos);
        }
      }
    }
    return points;
  }, [hasFieldData, isGrounder, isHomerun, isCaughtFly, direction, estimatedDist, totalTime, exitVelocity, launchAngle, distScale, fenceDistForDir, flightTime]);

  // 軌跡切り出し
  const effectiveBallTime = ballCaught ? catchTime : currentTime;
  const trailEnd = isAnimating && totalTime > 0
    ? Math.floor(clampNum(effectiveBallTime / totalTime, 0, 1) * trailPoints.length)
    : 0;
  const trailPolyline = trailEnd >= 2
    ? trailPoints.slice(0, trailEnd + 1).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
    : null;

  // ---- ホームランフェンス越え ----
  const hrFencePos = isHomerun && log.direction !== null ? toSvg(getFenceDistance(log.direction), log.direction) : null;
  const fenceArrivalTime = useMemo(() => {
    if (!isHomerun || !hasFieldData || exitVelocity <= 0 || launchAngle <= 0 || log.direction === null) return Infinity;
    return getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), log.direction, distScale);
  }, [isHomerun, hasFieldData, exitVelocity, launchAngle, log.direction, distScale]);
  const ballBeyondFence = isHomerun && hrFencePos && hasFieldData && ballSvgPos && currentTime >= fenceArrivalTime;

  // ---- フェンス直撃エフェクト ----
  const fenceHitEffectTime = isFenceHit ? (() => {
    const fa = getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale);
    return Math.min(fa, flightTime);
  })() : -1;

  const outsBeforePlay = log.outsBeforePlay ?? null;

  // ---- エージェントフレーム ----
  const frame = useMemo(() => {
    if (!agentTimeline || agentTimeline.length === 0) return null;
    return getAgentFrameAtTime(agentTimeline, isAnimating ? currentTime : agentTimeline[agentTimeline.length - 1].t);
  }, [agentTimeline, isAnimating, currentTime]);

  // 捕球者位置
  const catcherSvgPos = useMemo(() => {
    if (!agentTimeline || catchTime === Infinity) return null;
    const f = agentTimeline.find(fr => fr.t >= catchTime);
    if (!f) return null;
    const fielder = f.agents.find(a => a.state === "FIELDING");
    if (!fielder) return null;
    return xyToSvg(fielder.x, fielder.y);
  }, [agentTimeline, catchTime]);

  // フィールド構造用の座標計算
  const moundPos = toSvg(18.44, 45); // ピッチャーマウンド
  const dirtRadius = 30 * SCALE; // 内野ダートエリア半径(30m)

  // ファウルライン終点（フェンスまで）
  const foulLine1End = toSvg(getFenceDistance(90), 90); // 1塁側
  const foulLine3End = toSvg(getFenceDistance(0), 0);   // 3塁側

  // ウォーニングトラック（フェンス内側5m）
  const warningTrackPoints = Array.from({ length: 19 }, (_, i) => {
    const deg = i * 5;
    const dist = getFenceDistance(deg) - 5;
    return toSvg(Math.max(dist, 50), deg);
  });
  const warningTrackPath = warningTrackPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className={`bg-gray-900 rounded-lg border border-gray-700 ${className ?? ""}`}>
      <defs>
        {/* 芝ストライプパターン */}
        <pattern id="grassStripe" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="transparent" />
          <rect width="12" height="6" fill="rgba(255,255,255,0.06)" />
        </pattern>
        {/* ウォーニングトラック用クリップ */}
        <clipPath id="fieldClip">
          <path d={fencePath + ` L ${HOME.x} ${HOME.y} Z`} />
        </clipPath>
      </defs>

      <rect x="0" y="0" width={VIEW_SIZE} height={VIEW_SIZE} fill="#111827" />

      {/* フィールド芝 */}
      <path d={fencePath + ` L ${HOME.x} ${HOME.y} Z`} fill="#14532d" opacity="0.50" />
      <path d={fencePath + ` L ${HOME.x} ${HOME.y} Z`} fill="url(#grassStripe)" />

      {/* ウォーニングトラック（フェンス内側5mの帯） */}
      <path d={fencePath + ` L ${HOME.x} ${HOME.y} Z`} fill="none" />
      <g clipPath="url(#fieldClip)">
        <path
          d={fencePath + ` L ${HOME.x} ${HOME.y} Z`}
          fill="#78350f" opacity="0.15"
        />
        <path
          d={warningTrackPath + ` L ${HOME.x} ${HOME.y} Z`}
          fill="#14532d" opacity="0.50"
        />
        <path d={warningTrackPath + ` L ${HOME.x} ${HOME.y} Z`} fill="url(#grassStripe)" />
      </g>

      {/* 内野ダートエリア（半円弧） */}
      <circle cx={HOME.x} cy={HOME.y} r={dirtRadius} fill="#92400e" opacity="0.18" clipPath="url(#fieldClip)" />

      {/* ベースパス（土色ライン） */}
      <line x1={HOME.x} y1={HOME.y} x2={FIRST.x} y2={FIRST.y} stroke="#92400e" strokeWidth="3" opacity="0.30" />
      <line x1={FIRST.x} y1={FIRST.y} x2={SECOND.x} y2={SECOND.y} stroke="#92400e" strokeWidth="3" opacity="0.30" />
      <line x1={SECOND.x} y1={SECOND.y} x2={THIRD.x} y2={THIRD.y} stroke="#92400e" strokeWidth="3" opacity="0.30" />
      <line x1={THIRD.x} y1={THIRD.y} x2={HOME.x} y2={HOME.y} stroke="#92400e" strokeWidth="3" opacity="0.30" />

      {/* ダイヤモンド */}
      <path d={diamondPath} fill="#92400e" opacity="0.25" />

      {/* ファウルライン（白線、フェンスまで） */}
      <line x1={HOME.x} y1={HOME.y} x2={foulLine1End.x} y2={foulLine1End.y} stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
      <line x1={HOME.x} y1={HOME.y} x2={foulLine3End.x} y2={foulLine3End.y} stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />

      {/* マウンド */}
      <circle cx={moundPos.x} cy={moundPos.y} r={5} fill="#92400e" opacity="0.40" />
      <circle cx={moundPos.x} cy={moundPos.y} r={5} fill="none" stroke="#a16207" strokeWidth="0.8" opacity="0.30" />

      {/* フェンス・ダイヤモンド枠線 */}
      <path d={fencePath} fill="none" stroke="#6b7280" strokeWidth="1.8" />
      <path d={diamondPath} fill="none" stroke="#9ca3af" strokeWidth="1.2" />

      {/* 塁（ランナー状態で色変化） */}
      {[HOME, FIRST, SECOND, THIRD].map((p, i) => {
        const runners = (frame as AgentTimelineEntry & { runners?: RunnerSnapshot[] })?.runners;
        let baseColor = "#e5e7eb";
        let baseSize = 4;
        if (runners && isAnimating) {
          if (runners.some(r => r.targetBase === i && r.state === "SAFE")) { baseColor = "#3b82f6"; baseSize = 5; }
          else if (runners.some(r => r.targetBase === i && r.state === "OUT")) { baseColor = "#ef4444"; baseSize = 5; }
        }
        return (
          <rect key={i} x={p.x - baseSize} y={p.y - baseSize} width={baseSize * 2} height={baseSize * 2} fill={baseColor} transform={`rotate(45 ${p.x} ${p.y})`} />
        );
      })}

      {/* 野手 */}
      {(() => {
        if (frame) {
          return frame.agents.map((ag) => {
            const p = xyToSvg(ag.x, ag.y);
            const color = AGENT_STATE_COLOR[ag.state] ?? "rgba(100,180,255,0.7)";
            const label = AGENT_STATE_LABEL_JA[ag.state] ?? "";
            return (
              <g key={ag.pos}>
                {/* 追球/カバー矢印 */}
                {(ag.state === "PURSUING" || ag.state === "COVERING") && ag.targetX != null && ag.targetY != null && (
                  <line
                    x1={p.x} y1={p.y}
                    x2={xyToSvg(ag.targetX, ag.targetY).x}
                    y2={xyToSvg(ag.targetX, ag.targetY).y}
                    stroke={color} strokeWidth="1.0" strokeDasharray="3,3" opacity="0.45"
                  />
                )}
                {/* 野手ドット */}
                <circle cx={p.x} cy={p.y} r={9} fill={color} stroke="white" strokeWidth="1" opacity="0.85" />
                {/* ポジション略称 */}
                <text x={p.x} y={p.y + 3.5} textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">
                  {POS_SHORT_JA[ag.pos] ?? ag.pos}
                </text>
                {/* 状態ラベル */}
                {label && (
                  <text x={p.x} y={p.y + 15} textAnchor="middle" fill={color} fontSize="8" opacity="0.9">
                    {label}
                  </text>
                )}
              </g>
            );
          });
        }
        // デフォルト位置
        return Array.from(DEFAULT_FIELDER_POSITIONS.entries()).map(([pos, coord]) => {
          const p = xyToSvg(coord.x, coord.y);
          return (
            <g key={pos}>
              <circle cx={p.x} cy={p.y} r={9} fill="rgba(100,180,255,0.55)" stroke="rgba(100,180,255,0.9)" strokeWidth="1" />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fill="rgba(200,230,255,0.9)" fontSize="9" fontWeight="bold">
                {POS_SHORT_JA[pos] ?? pos}
              </text>
            </g>
          );
        });
      })()}

      {/* 走者（最前面描画 — 野手より上） */}
      {(() => {
        const runners = (frame as AgentTimelineEntry & { runners?: RunnerSnapshot[] })?.runners;
        if (runners && runners.length > 0 && isAnimating) {
          return runners.map((r, i) => {
            const p = xyToSvg(r.x, r.y);
            const color = RUNNER_STATE_COLOR[r.state] ?? "#86efac";
            const isOut = r.state === "OUT";
            const isSafe = r.state === "SAFE";
            return (
              <g key={`runner-${i}`}>
                {isOut && (
                  <>
                    <circle cx={p.x} cy={p.y} r={13} fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.35" />
                    <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="#ef4444" strokeWidth="2.5" opacity="0.6" />
                    {/* ×マーク */}
                    <line x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4} stroke="#ef4444" strokeWidth="2" opacity="0.8" />
                    <line x1={p.x + 4} y1={p.y - 4} x2={p.x - 4} y2={p.y + 4} stroke="#ef4444" strokeWidth="2" opacity="0.8" />
                  </>
                )}
                {isSafe && (
                  <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="#3b82f6" strokeWidth="2" opacity="0.5" />
                )}
                <circle cx={p.x} cy={p.y} r={7} fill={color} stroke="white" strokeWidth="1.5" opacity={isOut ? 0.7 : 1.0} />
                <text x={p.x} y={p.y + 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">R</text>
              </g>
            );
          });
        }
        if (log.basesBeforePlay) {
          return log.basesBeforePlay.map((occupied, baseIdx) => {
            if (!occupied) return null;
            const p = BASE_SVG[baseIdx + 1];
            return <circle key={baseIdx} cx={p.x} cy={p.y} r={7} fill="#22c55e" stroke="white" strokeWidth="1.5" />;
          });
        }
        return null;
      })()}

      {/* 軌跡 */}
      {trailPolyline && (
        <polyline
          points={trailPolyline}
          fill="none"
          stroke={dotColor(log.result)}
          strokeWidth="1.8"
          strokeDasharray={isGrounder ? "3,3" : "none"}
          opacity="0.65"
        />
      )}

      {/* フライの影 */}
      {!isGrounder && ballSvgPos && ballHeight > 0.5 && !ballCaught && (
        <>
          <line
            x1={ballSvgPos.x} y1={ballSvgPos.y}
            x2={ballSvgPos.x} y2={ballSvgPos.y - Math.min(ballHeight * 2, 30)}
            stroke="#9ca3af" strokeWidth="0.8" opacity="0.35"
          />
          <circle cx={ballSvgPos.x} cy={ballSvgPos.y} r={3} fill="#6b7280" opacity="0.4" />
        </>
      )}

      {/* ボール残像（直近2-3フレームの薄い円） */}
      {ballSvgPos && isAnimating && currentTime < totalTime && !ballCaught && trailEnd >= 3 && (
        <>
          {[3, 2, 1].map((offset, i) => {
            const idx = trailEnd - offset;
            if (idx < 0) return null;
            const pt = trailPoints[idx];
            if (!pt) return null;
            const opacity = 0.12 + i * 0.08;
            const r = ballRadius * (0.5 + i * 0.15);
            return <circle key={`afterimage-${i}`} cx={pt.x} cy={pt.y} r={r} fill={dotColor(log.result)} opacity={opacity} />;
          })}
        </>
      )}

      {/* ボール本体 */}
      {ballSvgPos && isAnimating && currentTime < totalTime && !ballCaught && (
        <>
          {isBouncePhase ? (
            <>
              {bounceOnGround && (
                <circle cx={ballSvgPos.x} cy={ballSvgPos.y} r={8} fill="none" stroke={dotColor(log.result)} strokeWidth="1.2" opacity="0.5" />
              )}
              <circle
                cx={ballSvgPos.x} cy={ballSvgPos.y - bounceHeightRatio * 8}
                r={ballRadius} fill="white" stroke={dotColor(log.result)} strokeWidth="1" opacity="0.95"
              />
            </>
          ) : !isGrounder && ballHeight > 0.5 ? (
            <>
              {/* グロウエフェクト（高い=大きく光る） */}
              {ballHeight > 5 && (
                <circle
                  cx={ballSvgPos.x} cy={ballSvgPos.y - Math.min(ballHeight * 2, 30)}
                  r={ballRadius + Math.min(ballHeight / maxHeight * 4, 4)}
                  fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2"
                />
              )}
              <circle
                cx={ballSvgPos.x} cy={ballSvgPos.y - Math.min(ballHeight * 2, 30)}
                r={ballRadius} fill="white" stroke={dotColor(log.result)} strokeWidth="1" opacity="0.95"
              />
            </>
          ) : (
            <circle
              cx={ballSvgPos.x} cy={ballSvgPos.y}
              r={ballRadius} fill={dotColor(log.result)} stroke="white" strokeWidth="1" opacity="0.95"
            />
          )}
        </>
      )}

      {/* ホームラン フェンス越えエフェクト */}
      {ballBeyondFence && hrFencePos && (
        <>
          {[0, 60, 120, 180, 240, 300].map((angleDeg, i) => {
            const rad = angleDeg * Math.PI / 180;
            const r = 12;
            return (
              <line key={i}
                x1={hrFencePos.x} y1={hrFencePos.y}
                x2={hrFencePos.x + r * Math.cos(rad)} y2={hrFencePos.y + r * Math.sin(rad)}
                stroke="#ef4444" strokeWidth="2" opacity="0.8"
              />
            );
          })}
        </>
      )}

      {/* フェンス直撃エフェクト */}
      {fenceHitEffectTime >= 0 && isAnimating && currentTime >= fenceHitEffectTime && currentTime <= fenceHitEffectTime + 0.3 && (() => {
        const fencePos = toSvg(fenceDistForDir, direction);
        return (
          <>
            <circle cx={fencePos.x} cy={fencePos.y} r={9} fill="none" stroke="#f59e0b" strokeWidth="2.5" opacity={0.8} />
            <circle cx={fencePos.x} cy={fencePos.y} r={4} fill="#f59e0b" opacity={0.6} />
          </>
        );
      })()}

      {/* 捕球後: ボール + 送球アニメーション */}
      {isAnimating && ballCaught && (() => {
        const elements: React.ReactNode[] = [];
        const tb = (frame as AgentTimelineEntry & { throwBall?: ThrowBallSnapshot })?.throwBall;

        if (throwSegments.length > 0) {
          // 旧パス: throwSegmentsベースのアニメーション（throwBallスナップショットがないログ用）
          const firstThrowStart = throwSegments[0].startTime;
          const lastThrowEnd = throwSegments[throwSegments.length - 1].endTime;
          const isHoldingBall = currentTime >= catchTime && currentTime < firstThrowStart;
          const throwDone = currentTime >= lastThrowEnd;

          if (isHoldingBall && catcherSvgPos) {
            elements.push(
              <circle key="held-ball" cx={catcherSvgPos.x} cy={catcherSvgPos.y} r={4} fill="white" stroke="#22c55e" strokeWidth="1.2" opacity="0.95" />
            );
          }

          for (let si = 0; si < throwSegments.length; si++) {
            const seg = throwSegments[si];
            if (currentTime >= seg.endTime) {
              const midX = (seg.fromSvg.x + seg.toSvg.x) / 2;
              const midY = (seg.fromSvg.y + seg.toSvg.y) / 2 - 8;
              elements.push(
                <path key={`throw-arc-${si}`}
                  d={`M ${seg.fromSvg.x} ${seg.fromSvg.y} Q ${midX} ${midY} ${seg.toSvg.x} ${seg.toSvg.y}`}
                  fill="none" stroke="#ef4444" strokeWidth="1.2" strokeDasharray="4,3" opacity="0.4"
                />
              );
              if (currentTime < seg.endTime + 0.3) {
                elements.push(
                  <circle key={`throw-arrive-${si}`} cx={seg.toSvg.x} cy={seg.toSvg.y} r={8} fill="none" stroke="#ef4444" strokeWidth="1.8" opacity={0.6} />
                );
              }
            }
            if (currentTime >= seg.startTime && currentTime < seg.endTime) {
              const ratio = (currentTime - seg.startTime) / (seg.endTime - seg.startTime);
              const midX = (seg.fromSvg.x + seg.toSvg.x) / 2;
              const midY = (seg.fromSvg.y + seg.toSvg.y) / 2 - 8;
              const bx = (1 - ratio) * (1 - ratio) * seg.fromSvg.x + 2 * (1 - ratio) * ratio * midX + ratio * ratio * seg.toSvg.x;
              const by = (1 - ratio) * (1 - ratio) * seg.fromSvg.y + 2 * (1 - ratio) * ratio * midY + ratio * ratio * seg.toSvg.y;
              elements.push(
                <circle key={`throw-ball-${si}`} cx={bx} cy={by} r={4} fill="#ef4444" stroke="white" strokeWidth="1" opacity="0.95" />
              );
              elements.push(
                <circle key={`throw-target-${si}`} cx={seg.toSvg.x} cy={seg.toSvg.y} r={6} fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
              );
            }
          }

          if (throwDone) {
            const lastSeg = throwSegments[throwSegments.length - 1];
            elements.push(
              <circle key="arrived-ball" cx={lastSeg.toSvg.x} cy={lastSeg.toSvg.y} r={4} fill="white" stroke="#ef4444" strokeWidth="1.2" opacity="0.9" />
            );
          }
        } else if (!tb) {
          // throwBallスナップショットモード: 送球中でないとき、frame.ballPosにボール表示
          if (frame) {
            const bp = xyToSvg(frame.ballPos.x, frame.ballPos.y);
            elements.push(
              <circle key="held-ball" cx={bp.x} cy={bp.y} r={4} fill="white" stroke="#22c55e" strokeWidth="1.2" opacity="0.95" />
            );
          } else if (catcherSvgPos) {
            elements.push(
              <circle key="held-ball" cx={catcherSvgPos.x} cy={catcherSvgPos.y} r={4} fill="white" stroke="#22c55e" strokeWidth="1.2" opacity="0.95" />
            );
          }
        }
        return elements;
      })()}

      {/* アウトカウント */}
      {outsBeforePlay !== null && (
        <g>
          <text x="14" y="18" fill="#9ca3af" fontSize="10">アウト</text>
          {[0, 1, 2].map(i => (
            <circle key={i} cx={14 + i * 14} cy={28} r={5} fill={i < outsBeforePlay ? "#6b7280" : "none"} stroke="#9ca3af" strokeWidth="1.2" />
          ))}
        </g>
      )}

      {/* 経過時間表示 */}
      {isAnimating && (
        <text x={VIEW_SIZE - 8} y={VIEW_SIZE - 8} textAnchor="end" fill="#9ca3af" fontSize="11" fontFamily="monospace">
          {currentTime.toFixed(2)}s
        </text>
      )}

      {/* 送球ボールスナップショット (Phase 2 ThrowBall) */}
      {(() => {
        const tb = (frame as AgentTimelineEntry & { throwBall?: ThrowBallSnapshot })?.throwBall;
        if (!tb || !isAnimating) return null;
        const fromP = xyToSvg(tb.fromX, tb.fromY);
        const toP = xyToSvg(tb.toX, tb.toY);
        const bx = fromP.x + (toP.x - fromP.x) * tb.progress;
        const by = fromP.y + (toP.y - fromP.y) * tb.progress;
        return (
          <g>
            {/* ターゲットマーカー */}
            <circle cx={toP.x} cy={toP.y} r={6} fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
            {/* 送球ボール */}
            <circle cx={bx} cy={by} r={4} fill="#ef4444" stroke="white" strokeWidth="1" opacity="0.95" />
          </g>
        );
      })()}
    </svg>
  );
}
