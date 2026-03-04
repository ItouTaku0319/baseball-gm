"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { generateScenarioLog, type ScenarioParams } from "@/engine/scenario-generator";
import { classifyBattedBallType } from "@/engine/simulation";
import { calcBallLanding } from "@/engine/fielding-ai";
import { getFenceDistance } from "@/engine/simulation";
import type { AtBatLog } from "@/models/league";
import { resultNamesJa, resultColor, clampNum } from "./field-coords";
import { getBallFlightTime, getFieldBounceStateAtTime, getFenceArrivalTime, getFenceBounceBackStateAtTime, buildGroundBallTimeline, estimateDistance } from "./ball-physics";
import { usePlayAnimation } from "./use-play-animation";
import { PlayControls } from "./play-controls";
import { LargeFieldView } from "./field-view";
import { LargeSideView } from "./side-view";
import { PlayHud } from "./play-hud";

// ---- 定数 ----

const battedBallNamesJa: Record<string, string> = {
  ground_ball: "ゴロ",
  fly_ball: "フライ",
  line_drive: "ライナー",
  popup: "ポップフライ",
};

const posNamesJa: Record<number, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function directionLabel(dir: number): string {
  if (dir <= 15) return "LF線";
  if (dir <= 30) return "LF";
  if (dir <= 38) return "LF-CF";
  if (dir <= 52) return "CF";
  if (dir <= 60) return "CF-RF";
  if (dir <= 75) return "RF";
  return "RF線";
}

interface Preset {
  label: string;
  params: ScenarioParams;
}

const PRESETS: Preset[] = [
  { label: "SS方向ゴロ", params: { exitVelocity: 120, launchAngle: 3, direction: 30 } },
  { label: "CF方向ライナー", params: { exitVelocity: 140, launchAngle: 15, direction: 45 } },
  { label: "深いフライ", params: { exitVelocity: 150, launchAngle: 30, direction: 60 } },
  { label: "内外野間ゴロ", params: { exitVelocity: 130, launchAngle: 5, direction: 50 } },
  { label: "HR級弾丸", params: { exitVelocity: 170, launchAngle: 28, direction: 45 } },
  { label: "ポップフライ", params: { exitVelocity: 90, launchAngle: 60, direction: 45 } },
];

// ---- totalTime計算 ----

function calcTotalTime(log: AtBatLog): number {
  const exitVelocity = log.exitVelocity ?? 120;
  const launchAngle = log.launchAngle ?? 15;
  const direction = log.direction ?? 45;
  const estimatedDist = (log.estimatedDistance != null && log.estimatedDistance > 0)
    ? log.estimatedDistance
    : estimateDistance(exitVelocity, launchAngle);
  const isGrounder = launchAngle <= 0 || log.battedBallType === "ground_ball";
  const isHomerun = log.result === "homerun";
  const isCaughtFly = ["flyout", "lineout", "popout", "sacrificeFly"].includes(log.result);
  const fenceDistForDir = getFenceDistance(direction);
  const isFenceHit = !isHomerun && !isGrounder && !isCaughtFly && estimatedDist > fenceDistForDir;
  const rawPhysDist = (!isGrounder && launchAngle > 0) ? estimateDistance(exitVelocity, launchAngle) : 0;
  const distScale = rawPhysDist > 0 ? estimatedDist / rawPhysDist : 1;

  const lastAgentT = log.agentTimeline && log.agentTimeline.length > 0
    ? log.agentTimeline[log.agentTimeline.length - 1].t : 0;

  let ballTime: number;
  if (isGrounder) {
    const tl = buildGroundBallTimeline(exitVelocity, launchAngle, estimatedDist);
    ballTime = tl.totalTime;
  } else {
    const flightTime = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
    if (isHomerun || isCaughtFly) {
      ballTime = flightTime;
    } else if (isFenceHit) {
      const fenceArrival = getFenceArrivalTime(exitVelocity, Math.max(launchAngle, 5), direction, distScale);
      const fenceBounce = getFenceBounceBackStateAtTime(fenceDistForDir, direction, exitVelocity, launchAngle, 999);
      ballTime = Math.min(fenceArrival, flightTime) + (fenceBounce?.totalBounceTime ?? 1.0);
    } else {
      const bounceInfo = getFieldBounceStateAtTime(exitVelocity, Math.max(launchAngle, 5), direction, estimatedDist, 999, fenceDistForDir);
      ballTime = flightTime + (bounceInfo?.totalBounceTime ?? 0);
    }
  }

  // 送球タイムライン
  // agentTimelineにthrowBallデータがある場合は送球がタイムライン内で完結しているため
  // throwEndTの追加パディングは不要（二重送球修正と連動）
  let throwEndT = 0;
  const hasTimelineThrow = log.agentTimeline?.some(f => f.throwBall);
  if (log.throwPlays && log.agentTimeline && log.agentTimeline.length > 0 && !hasTimelineThrow) {
    const last = log.agentTimeline[log.agentTimeline.length - 1];
    let currentT = last.t + 0.35;
    for (const play of log.throwPlays) {
      const basePos = { home: { x: 0, y: 0 }, first: { x: 19.4, y: 19.4 }, second: { x: 0, y: 38.8 }, third: { x: -19.4, y: 19.4 } }[play.base] ?? { x: 0, y: 0 };
      const fromAgent = last.agents.find(a => a.pos === play.from);
      const fromPos = fromAgent ? { x: fromAgent.x, y: fromAgent.y } : { x: 0, y: 0 };
      const dx = basePos.x - fromPos.x;
      const dy = basePos.y - fromPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      currentT += dist / 38;
    }
    throwEndT = currentT + 0.3;
  }

  return Math.max(ballTime, lastAgentT, throwEndT);
}

// ---- コンポーネント ----

export interface ScenarioPanelProps {
  /** 外部から渡されたAtBatLog（打席ログモード用） */
  externalLog?: AtBatLog | null;
  /** 打者名（打席ログモード用） */
  batterName?: string;
  /** 投手名（打席ログモード用） */
  pitcherName?: string;
  /** 前/次の打席移動 */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function ScenarioPanel({
  externalLog,
  batterName,
  pitcherName,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: ScenarioPanelProps) {
  const [exitVelocity, setExitVelocity] = useState(130);
  const [launchAngle, setLaunchAngle] = useState(15);
  const [direction, setDirection] = useState(45);
  const [outs, setOuts] = useState(0);
  const [runnerFirst, setRunnerFirst] = useState(false);
  const [runnerSecond, setRunnerSecond] = useState(false);
  const [runnerThird, setRunnerThird] = useState(false);
  const [scenarioLog, setScenarioLog] = useState<AtBatLog | null>(null);
  const [mode, setMode] = useState<"scenario" | "atbat">(externalLog ? "atbat" : "scenario");

  // 外部ログが変わったらモード切替
  useEffect(() => {
    if (externalLog) setMode("atbat");
  }, [externalLog]);

  // 表示するlog
  const activeLog = mode === "atbat" && externalLog ? externalLog : scenarioLog;

  // プレビュー
  const preview = useMemo(() => {
    const ballType = classifyBattedBallType(launchAngle, exitVelocity);
    const landing = calcBallLanding(direction, launchAngle, exitVelocity);
    return { ballType, distance: Math.round(landing.distance * 10) / 10 };
  }, [exitVelocity, launchAngle, direction]);

  // totalTime計算
  const totalTime = useMemo(() => {
    if (!activeLog) return 0;
    return calcTotalTime(activeLog);
  }, [activeLog]);

  // フライ滞空時間
  const totalFlightTime = useMemo(() => {
    if (!activeLog) return 0;
    const ev = activeLog.exitVelocity ?? 120;
    const la = activeLog.launchAngle ?? 15;
    const isGrounder = la <= 0 || activeLog.battedBallType === "ground_ball";
    if (isGrounder) return 0;
    return getBallFlightTime(ev, Math.max(la, 5));
  }, [activeLog]);

  // distScale
  const distScale = useMemo(() => {
    if (!activeLog) return 1;
    const ev = activeLog.exitVelocity ?? 120;
    const la = activeLog.launchAngle ?? 15;
    const ed = activeLog.estimatedDistance ?? 0;
    const isGrounder = la <= 0 || activeLog.battedBallType === "ground_ball";
    if (isGrounder || la <= 0) return 1;
    const raw = estimateDistance(ev, la);
    return raw > 0 ? ed / raw : 1;
  }, [activeLog]);

  // フェンス直撃判定
  const isFenceHit = useMemo(() => {
    if (!activeLog) return false;
    const ev = activeLog.exitVelocity ?? 120;
    const la = activeLog.launchAngle ?? 15;
    const dir = activeLog.direction ?? 45;
    const ed = (activeLog.estimatedDistance != null && activeLog.estimatedDistance > 0) ? activeLog.estimatedDistance : estimateDistance(ev, la);
    const isGrounder = la <= 0 || activeLog.battedBallType === "ground_ball";
    const isHR = activeLog.result === "homerun";
    const isCaught = ["flyout", "lineout", "popout", "sacrificeFly"].includes(activeLog.result);
    return !isHR && !isGrounder && !isCaught && ed > getFenceDistance(dir);
  }, [activeLog]);

  const isCaughtFly = activeLog ? ["flyout", "lineout", "popout", "sacrificeFly"].includes(activeLog.result) : false;

  // catchTime
  const catchTime = useMemo(() => {
    if (!activeLog?.agentTimeline || activeLog.agentTimeline.length === 0) return Infinity;
    for (const frame of activeLog.agentTimeline) {
      if (frame.agents.some(a => a.state === "FIELDING")) return frame.t;
    }
    return Infinity;
  }, [activeLog]);

  // 再生速度
  const playbackSpeed = useMemo(() => {
    if (!activeLog) return 1;
    const ev = activeLog.exitVelocity ?? 120;
    return 0.7 + (clampNum(ev, 80, 180) - 80) / 100 * 0.7;
  }, [activeLog]);

  const animDuration = totalTime > 0 ? totalTime / playbackSpeed : 0;
  const anim = usePlayAnimation(animDuration);

  // シミュレーション時間（速度補正済み）
  const simTime = anim.currentTime >= 0 ? anim.currentTime * playbackSpeed : -1;

  // 実行
  const handleExecute = useCallback(() => {
    const log = generateScenarioLog({
      exitVelocity, launchAngle, direction, outs,
      runners: { first: runnerFirst, second: runnerSecond, third: runnerThird },
    });
    setScenarioLog(log);
    setMode("scenario");
  }, [exitVelocity, launchAngle, direction, outs, runnerFirst, runnerSecond, runnerThird]);

  // ランダム
  const handleRandom = useCallback(() => {
    const ev = 80 + Math.random() * 105;
    const la = -15 + Math.random() * 85;
    const dir = Math.random() * 90;
    setExitVelocity(Math.round(ev));
    setLaunchAngle(Math.round(la));
    setDirection(Math.round(dir));
  }, []);

  // プリセット
  const applyPreset = useCallback((preset: Preset) => {
    setExitVelocity(preset.params.exitVelocity);
    setLaunchAngle(preset.params.launchAngle);
    setDirection(preset.params.direction);
  }, []);

  // 実行後に自動再生
  useEffect(() => {
    if (activeLog && animDuration > 0) {
      const timer = setTimeout(() => anim.play(), 200);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLog, animDuration]);

  // キーボードショートカット
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") { e.preventDefault(); anim.togglePlay(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [anim]);

  return (
    <div className="space-y-4">
      {/* モード切替 */}
      {externalLog && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode("atbat")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
              mode === "atbat" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
            }`}
          >
            打席ログ
          </button>
          <button
            onClick={() => setMode("scenario")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
              mode === "scenario" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
            }`}
          >
            シナリオ
          </button>
        </div>
      )}

      {/* メインエリア */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* 左: フィールドビュー */}
        <div className="space-y-3">
          <div className="relative">
            {activeLog ? (
              <>
                <LargeFieldView
                  log={activeLog}
                  currentTime={simTime}
                  totalTime={totalTime}
                  distScale={distScale}
                  className="w-full"
                />
                <PlayHud log={activeLog} currentTime={simTime} catchTime={catchTime} />
              </>
            ) : (
              <div className="aspect-square bg-gray-800 rounded-lg border border-gray-700 flex items-center justify-center">
                <p className="text-gray-500 text-sm">「実行」で打球をシミュレーション</p>
              </div>
            )}
          </div>

          {/* サイドビュー */}
          {activeLog && (
            <LargeSideView
              log={activeLog}
              currentTime={simTime}
              totalFlightTime={totalFlightTime}
              isFenceHit={isFenceHit}
              isCaughtFly={isCaughtFly}
              className="w-full"
            />
          )}

          {/* 再生コントロール */}
          {activeLog && animDuration > 0 && (
            <PlayControls state={anim} actions={anim} />
          )}

          {/* 打席ログモード: 前/次ボタン */}
          {mode === "atbat" && externalLog && (
            <div className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2 border border-gray-700">
              <button
                onClick={onPrev}
                disabled={!hasPrev}
                className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
              >
                ← 前の打席
              </button>
              <div className="text-sm text-gray-300">
                <span className="text-blue-400 font-bold">{batterName ?? "打者"}</span>
                <span className="text-gray-500 mx-2">vs</span>
                <span className="text-gray-400">{pitcherName ?? "投手"}</span>
              </div>
              <button
                onClick={onNext}
                disabled={!hasNext}
                className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
              >
                次の打席 →
              </button>
            </div>
          )}
        </div>

        {/* 右: パラメータ / 結果 */}
        <div className="space-y-4">
          {/* シナリオモード: スライダー */}
          {mode === "scenario" && (
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">打球パラメータ</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">初速</span>
                    <span className="text-white font-mono tabular-nums">{exitVelocity} km/h</span>
                  </div>
                  <input type="range" min={80} max={185} value={exitVelocity}
                    onChange={e => setExitVelocity(Number(e.target.value))} className="w-full accent-blue-500" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">打球角度</span>
                    <span className="text-white font-mono tabular-nums">{launchAngle}°</span>
                  </div>
                  <input type="range" min={-15} max={70} value={launchAngle}
                    onChange={e => setLaunchAngle(Number(e.target.value))} className="w-full accent-blue-500" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">方向</span>
                    <span className="text-white font-mono tabular-nums">{direction}° ({directionLabel(direction)})</span>
                  </div>
                  <input type="range" min={0} max={90} value={direction}
                    onChange={e => setDirection(Number(e.target.value))} className="w-full accent-blue-500" />
                </div>
                {/* アウトカウント */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">アウト</span>
                    <span className="text-white font-mono tabular-nums">{outs}</span>
                  </div>
                  <div className="flex gap-2">
                    {[0, 1, 2].map(o => (
                      <button key={o} onClick={() => setOuts(o)}
                        className={`flex-1 py-1 rounded text-xs font-semibold transition-colors ${
                          outs === o ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                        }`}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
                {/* ランナー */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">ランナー</span>
                    <span className="text-white font-mono tabular-nums">
                      {!runnerFirst && !runnerSecond && !runnerThird ? "なし" :
                        [runnerFirst && "1B", runnerSecond && "2B", runnerThird && "3B"].filter(Boolean).join(",")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {([["1B", runnerFirst, setRunnerFirst], ["2B", runnerSecond, setRunnerSecond], ["3B", runnerThird, setRunnerThird]] as const).map(([label, on, set]) => (
                      <button key={label} onClick={() => (set as (v: boolean) => void)(!on)}
                        className={`flex-1 py-1 rounded text-xs font-semibold transition-colors ${
                          on ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* プレビュー */}
              <div className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">打球種</span>
                  <span className="text-white">{battedBallNamesJa[preview.ballType] ?? preview.ballType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">推定距離</span>
                  <span className="text-white font-mono tabular-nums">{preview.distance}m</span>
                </div>
              </div>

              {/* ボタン */}
              <div className="flex gap-2 mt-4">
                <button onClick={handleExecute}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors">
                  実行
                </button>
                <button onClick={handleRandom}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
                  ランダム
                </button>
              </div>

              {/* プリセット */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => applyPreset(p)}
                    className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 結果カード */}
          {activeLog && (
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">結果詳細</h3>
              <div className="space-y-2 text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                <div className="flex justify-between">
                  <span className="text-gray-400">結果</span>
                  <span className={`font-semibold ${resultColor(activeLog.result)}`}>
                    {resultNamesJa[activeLog.result] ?? activeLog.result}
                  </span>
                </div>
                {activeLog.exitVelocity != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">打球速度</span>
                    <span className="text-white">{activeLog.exitVelocity.toFixed(1)} km/h</span>
                  </div>
                )}
                {activeLog.launchAngle != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">打球角度</span>
                    <span className="text-white">{activeLog.launchAngle.toFixed(1)}°</span>
                  </div>
                )}
                {activeLog.direction != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">方向</span>
                    <span className="text-white">{activeLog.direction.toFixed(1)}° ({directionLabel(activeLog.direction)})</span>
                  </div>
                )}
                {activeLog.estimatedDistance != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">飛距離</span>
                    <span className="text-white font-bold">{Math.round(activeLog.estimatedDistance)}m</span>
                  </div>
                )}
                {activeLog.battedBallType && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">打球種</span>
                    <span className="text-white">{battedBallNamesJa[activeLog.battedBallType] ?? activeLog.battedBallType}</span>
                  </div>
                )}
                {activeLog.fielderPosition != null && activeLog.result !== "homerun" && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">処理野手</span>
                    <span className="text-white">{posNamesJa[activeLog.fielderPosition] ?? activeLog.fielderPosition}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
