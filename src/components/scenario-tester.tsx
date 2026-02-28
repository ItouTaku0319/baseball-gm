"use client";

import { useState, useMemo } from "react";
import { generateScenarioLog, type ScenarioParams } from "@/engine/scenario-generator";
import { classifyBattedBallType } from "@/engine/simulation";
import { calcBallLanding } from "@/engine/fielding-ai";
import { BattedBallPopup } from "./batted-ball-trajectory";
import type { AtBatLog } from "@/models/league";

const battedBallNamesJa: Record<string, string> = {
  ground_ball: "ゴロ",
  fly_ball: "フライ",
  line_drive: "ライナー",
  popup: "ポップフライ",
};

const resultNamesJa: Record<string, string> = {
  single: "ヒット", double: "ツーベース", triple: "スリーベース",
  homerun: "ホームラン", groundout: "ゴロアウト", flyout: "フライアウト",
  lineout: "ライナーアウト", popout: "ポップアウト", doublePlay: "併殺打",
  sacrificeFly: "犠牲フライ", fieldersChoice: "FC", infieldHit: "内野安打",
  error: "エラー",
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

function resultColor(result: string): string {
  if (["single", "double", "triple", "homerun", "infieldHit"].includes(result)) return "text-yellow-300";
  if (result === "error") return "text-purple-400";
  return "text-gray-400";
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
];

export function ScenarioTester() {
  const [exitVelocity, setExitVelocity] = useState(130);
  const [launchAngle, setLaunchAngle] = useState(15);
  const [direction, setDirection] = useState(45);
  const [resultLog, setResultLog] = useState<AtBatLog | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  // リアルタイムプレビュー
  const preview = useMemo(() => {
    const ballType = classifyBattedBallType(launchAngle, exitVelocity);
    const landing = calcBallLanding(direction, launchAngle, exitVelocity);
    return {
      ballType,
      distance: Math.round(landing.distance * 10) / 10,
    };
  }, [exitVelocity, launchAngle, direction]);

  function handleExecute() {
    const log = generateScenarioLog({ exitVelocity, launchAngle, direction });
    setResultLog(log);
    setShowPopup(true);
  }

  function handleRandom() {
    const ev = 80 + Math.random() * 105; // 80-185
    const la = -15 + Math.random() * 85; // -15~70
    const dir = Math.random() * 90;      // 0-90
    setExitVelocity(Math.round(ev));
    setLaunchAngle(Math.round(la));
    setDirection(Math.round(dir));
  }

  function applyPreset(preset: Preset) {
    setExitVelocity(preset.params.exitVelocity);
    setLaunchAngle(preset.params.launchAngle);
    setDirection(preset.params.direction);
  }

  return (
    <div className="space-y-6">
      {/* パラメータスライダー */}
      <div className="bg-gray-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">打球パラメータ</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {/* 左カラム: スライダー */}
          <div className="space-y-4">
            {/* 初速 */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">初速</span>
                <span className="text-white font-mono tabular-nums">{exitVelocity} km/h</span>
              </div>
              <input
                type="range" min={80} max={185} value={exitVelocity}
                onChange={e => setExitVelocity(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>

            {/* 角度 */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">打球角度</span>
                <span className="text-white font-mono tabular-nums">{launchAngle}°</span>
              </div>
              <input
                type="range" min={-15} max={70} value={launchAngle}
                onChange={e => setLaunchAngle(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>

            {/* 方向 */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">方向</span>
                <span className="text-white font-mono tabular-nums">
                  {direction}° ({directionLabel(direction)})
                </span>
              </div>
              <input
                type="range" min={0} max={90} value={direction}
                onChange={e => setDirection(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>

          {/* 右カラム: プレビュー情報 */}
          <div className="flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">打球種</span>
                <span className="text-white">{battedBallNamesJa[preview.ballType] ?? preview.ballType}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">推定距離</span>
                <span className="text-white font-mono tabular-nums">{preview.distance}m</span>
              </div>
              {resultLog && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">結果</span>
                    <span className={resultColor(resultLog.result)}>
                      {resultNamesJa[resultLog.result] ?? resultLog.result}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">処理野手</span>
                    <span className="text-white">
                      {posNamesJa[resultLog.fielderPosition ?? 0] ?? "-"}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* ボタン */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleExecute}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors"
              >
                実行
              </button>
              <button
                onClick={handleRandom}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
              >
                ランダム
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* プリセット */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 結果履歴 */}
      {resultLog && !showPopup && (
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">
              {exitVelocity}km/h・{launchAngle}°・{direction}°({directionLabel(direction)})
              → {battedBallNamesJa[resultLog.battedBallType ?? ""] ?? ""}
              {" "}{resultLog.estimatedDistance}m
            </span>
            <button
              onClick={() => setShowPopup(true)}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
            >
              詳細を表示
            </button>
          </div>
        </div>
      )}

      {/* BattedBallPopup */}
      {showPopup && resultLog && (
        <BattedBallPopup
          log={resultLog}
          batterName="D50テスト打者"
          pitcherName="D50テスト投手"
          onClose={() => setShowPopup(false)}
        />
      )}
    </div>
  );
}
