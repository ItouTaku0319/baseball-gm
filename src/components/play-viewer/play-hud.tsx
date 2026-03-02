"use client";

import type { AtBatLog } from "@/models/league";
import { resultNamesJa, resultColor } from "./field-coords";

const battedBallNamesJa: Record<string, string> = {
  ground_ball: "ゴロ",
  fly_ball: "フライ",
  line_drive: "ライナー",
  popup: "ポップフライ",
};

const posShortJa: Record<number, string> = {
  1: "投手", 2: "捕手", 3: "一塁手", 4: "二塁手", 5: "三塁手", 6: "遊撃手", 7: "左翼手", 8: "中堅手", 9: "右翼手",
};

interface PlayHudProps {
  log: AtBatLog;
  currentTime: number;
  /** 捕球/着地が発生した時刻 (Infinity=まだ) */
  catchTime: number;
}

export function PlayHud({ log, currentTime, catchTime }: PlayHudProps) {
  const ev = log.exitVelocity;
  const la = log.launchAngle;
  const dist = log.estimatedDistance;
  const isFinished = currentTime >= catchTime || currentTime < 0;

  return (
    <div className="absolute top-2 right-2 bg-gray-900/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs space-y-1 min-w-[140px] border border-gray-700/50 pointer-events-none">
      {ev != null && (
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">打球速度</span>
          <span className="text-white font-mono tabular-nums">{ev.toFixed(1)} km/h</span>
        </div>
      )}
      {la != null && (
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">打球角度</span>
          <span className="text-white font-mono tabular-nums">{la.toFixed(1)}°</span>
        </div>
      )}
      {log.battedBallType && (
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">打球種</span>
          <span className="text-white">{battedBallNamesJa[log.battedBallType] ?? log.battedBallType}</span>
        </div>
      )}
      {dist != null && dist > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">飛距離</span>
          <span className="text-white font-mono tabular-nums">{Math.round(dist)}m</span>
        </div>
      )}
      {/* 結果は捕球/着地後に表示 */}
      {isFinished && (
        <>
          <div className="border-t border-gray-600 my-1" />
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">結果</span>
            <span className={`font-semibold ${resultColor(log.result)}`}>
              {resultNamesJa[log.result] ?? log.result}
            </span>
          </div>
          {log.fielderPosition != null && log.result !== "homerun" && (
            <div className="flex justify-between gap-4">
              <span className="text-gray-400">捕球</span>
              <span className="text-white">{posShortJa[log.fielderPosition] ?? `${log.fielderPosition}`}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
