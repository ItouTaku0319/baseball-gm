"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import type { AtBatLog } from "@/models/league";
import type { Player, PitchType } from "@/models/player";
import { PITCH_TYPE_NAMES, PITCH_DIR_ORDER, POSITION_NAMES } from "@/models/player";
import type { GameState } from "@/models/game-state";

// ---- 球種カラー ----

const PITCH_COLORS: Record<PitchType, string> = {
  fastball: "#ef4444",
  slider: "#3b82f6",
  curve: "#22c55e",
  fork: "#a855f7",
  changeup: "#f59e0b",
  sinker: "#f97316",
  cutter: "#06b6d4",
  shoot: "#ec4899",
  splitter: "#8b5cf6",
  screwball: "#84cc16",
  knuckle: "#6b7280",
};

// ---- 結果分類ユーティリティ ----

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
  fieldersChoice: "FC",
  infieldHit: "内野安打",
  error: "エラー出塁",
};

function isHit(result: string): boolean {
  return ["single", "double", "triple", "homerun", "infieldHit", "error"].includes(result);
}

function resultColor(result: string): string {
  switch (result) {
    case "homerun": return "text-red-500 font-bold";
    case "triple": return "text-orange-400 font-semibold";
    case "double": return "text-orange-300";
    case "single": case "infieldHit": return "text-yellow-300";
    case "walk": return "text-blue-400";
    case "hitByPitch": return "text-cyan-400";
    case "error": return "text-purple-400";
    case "doublePlay": return "text-gray-600";
    default: return "text-gray-500";
  }
}

// 打数（打席）カウント: 四球・死球を除く
function isAtBat(result: string): boolean {
  return !["walk", "hitByPitch", "sacrificeFly"].includes(result);
}

// SVG座標変換: ストライクゾーン -1〜1 → SVG座標
function toSvgX(x: number): number {
  return 150 + x * 100;
}
function toSvgY(y: number): number {
  return 180 - y * 130;
}

// 9分割セル定義
const ZONE_CELLS = [
  { col: 0, row: 0, xMin: -1, xMax: -1/3, yMin: 1/3, yMax: 1 },
  { col: 1, row: 0, xMin: -1/3, xMax: 1/3, yMin: 1/3, yMax: 1 },
  { col: 2, row: 0, xMin: 1/3, xMax: 1, yMin: 1/3, yMax: 1 },
  { col: 0, row: 1, xMin: -1, xMax: -1/3, yMin: -1/3, yMax: 1/3 },
  { col: 1, row: 1, xMin: -1/3, xMax: 1/3, yMin: -1/3, yMax: 1/3 },
  { col: 2, row: 1, xMin: 1/3, xMax: 1, yMin: -1/3, yMax: 1/3 },
  { col: 0, row: 2, xMin: -1, xMax: -1/3, yMin: -1, yMax: -1/3 },
  { col: 1, row: 2, xMin: -1/3, xMax: 1/3, yMin: -1, yMax: -1/3 },
  { col: 2, row: 2, xMin: 1/3, xMax: 1, yMin: -1, yMax: -1/3 },
];

// 被打率の色付け
function avgBgColor(avg: number): string {
  if (avg > 0.35) return "#7f1d1d";   // 赤系
  if (avg >= 0.25) return "#713f12";  // 黄系
  return "#1e3a5f";                   // 青系
}

// ---- メインページ ----

export default function PitchingPage() {
  const params = useParams();
  const gameId = params.id as string;
  const { game, loadGame } = useGameStore();

  useEffect(() => {
    if (!game && gameId) loadGame(gameId);
  }, [game, gameId, loadGame]);

  if (!game) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <p className="text-gray-400">データ読込中...</p>
      </div>
    );
  }

  return <PitchingPageInner gameId={gameId} game={game} />;
}

function PitchingPageInner({ gameId, game }: { gameId: string; game: GameState }) {
  const season = game.currentSeason;
  const teamsRecord = game.teams;
  const myTeamId = game.myTeamId;
  const myTeam = teamsRecord[myTeamId];

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const team of Object.values(teamsRecord)) {
      for (const p of team.roster) map.set(p.id, p);
    }
    return map;
  }, [teamsRecord]);

  const myPitchers = useMemo(() => {
    return myTeam.roster.filter((p) => p.isPitcher);
  }, [myTeam]);

  // デフォルト投手: 先発ローテ1番手
  const defaultPitcherId = useMemo(() => {
    const rotationId = myTeam.lineupConfig?.startingRotation[0];
    if (rotationId) return rotationId;
    return myPitchers[0]?.id ?? "";
  }, [myTeam, myPitchers]);

  const [selectedPitcherId, setSelectedPitcherId] = useState<string>(defaultPitcherId);
  const [activePitchTypes, setActivePitchTypes] = useState<Set<PitchType> | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "hit" | "out">("all");
  const [logLimit, setLogLimit] = useState<number>(50);

  // 選択投手が変わったらフィルタリセット
  useEffect(() => {
    setActivePitchTypes(null);
    setOutcomeFilter("all");
    setLogLimit(50);
  }, [selectedPitcherId]);

  // pitchTypeがあるログを全スケジュールから収集
  const allAtBatLogs = useMemo(() => {
    const logs: AtBatLog[] = [];
    for (const entry of season.schedule) {
      if (!entry.result?.atBatLogs) continue;
      for (const log of entry.result.atBatLogs) {
        if (log.pitchType) logs.push(log);
      }
    }
    return logs;
  }, [season.schedule]);

  // 選択投手でフィルタ
  const pitcherLogs = useMemo(() => {
    return allAtBatLogs.filter((l) => l.pitcherId === selectedPitcherId);
  }, [allAtBatLogs, selectedPitcherId]);

  // 選択投手が持つ球種一覧
  const availablePitchTypes = useMemo(() => {
    const types = new Set<PitchType>();
    for (const log of pitcherLogs) {
      if (log.pitchType) types.add(log.pitchType);
    }
    return Array.from(types).sort((a, b) => (PITCH_DIR_ORDER[a] ?? 99) - (PITCH_DIR_ORDER[b] ?? 99));
  }, [pitcherLogs]);

  // 球種フィルタ初期化
  const effectiveActivePitchTypes = useMemo(() => {
    if (activePitchTypes !== null) return activePitchTypes;
    return new Set<PitchType>(availablePitchTypes);
  }, [activePitchTypes, availablePitchTypes]);

  // 球種・結果フィルタ適用後のログ
  const filteredLogs = useMemo(() => {
    return pitcherLogs.filter((l) => {
      if (l.pitchType && !effectiveActivePitchTypes.has(l.pitchType)) return false;
      if (outcomeFilter === "hit" && !isHit(l.result)) return false;
      if (outcomeFilter === "out") {
        const out = ["groundout", "flyout", "lineout", "popout", "doublePlay", "strikeout", "sacrificeFly", "fieldersChoice"].includes(l.result);
        if (!out) return false;
      }
      return true;
    });
  }, [pitcherLogs, effectiveActivePitchTypes, outcomeFilter]);

  // 球種別成績集計
  const pitchStats = useMemo(() => {
    const map = new Map<PitchType, { count: number; hits: number; atBats: number; strikeouts: number; walks: number; homeRuns: number }>();
    for (const log of filteredLogs) {
      if (!log.pitchType) continue;
      const pt = log.pitchType;
      if (!map.has(pt)) map.set(pt, { count: 0, hits: 0, atBats: 0, strikeouts: 0, walks: 0, homeRuns: 0 });
      const s = map.get(pt)!;
      s.count++;
      if (isHit(log.result)) s.hits++;
      if (isAtBat(log.result)) s.atBats++;
      if (log.result === "strikeout") s.strikeouts++;
      if (log.result === "walk") s.walks++;
      if (log.result === "homerun") s.homeRuns++;
    }
    // 球種表示順でソート
    return Array.from(map.entries())
      .sort(([a], [b]) => (PITCH_DIR_ORDER[a] ?? 99) - (PITCH_DIR_ORDER[b] ?? 99))
      .map(([type, s]) => ({ type, ...s }));
  }, [filteredLogs]);

  // 9分割コースヒートマップ集計
  const zoneStats = useMemo(() => {
    return ZONE_CELLS.map((cell) => {
      const cellLogs = filteredLogs.filter((l) => {
        if (!l.pitchLocation) return false;
        const { x, y } = l.pitchLocation;
        return x >= cell.xMin && x < cell.xMax && y >= cell.yMin && y < cell.yMax;
      });
      const total = cellLogs.length;
      const hits = cellLogs.filter((l) => isHit(l.result)).length;
      const atBats = cellLogs.filter((l) => isAtBat(l.result)).length;
      const avg = atBats > 0 ? hits / atBats : 0;
      return { ...cell, total, hits, atBats, avg };
    });
  }, [filteredLogs]);

  const selectedPitcher = playerMap.get(selectedPitcherId);
  const hasData = pitcherLogs.length > 0;
  const totalBalls = filteredLogs.length;

  const getName = (id: string) => playerMap.get(id)?.name ?? id;
  const fmt3 = (n: number) => n.toFixed(3).replace(/^0/, "");

  const togglePitchType = (pt: PitchType) => {
    const next = new Set(effectiveActivePitchTypes);
    if (next.has(pt)) {
      next.delete(pt);
    } else {
      next.add(pt);
    }
    setActivePitchTypes(next);
  };

  const allSelected = availablePitchTypes.every((pt) => effectiveActivePitchTypes.has(pt));
  const toggleAll = () => {
    if (allSelected) {
      setActivePitchTypes(new Set());
    } else {
      setActivePitchTypes(new Set(availablePitchTypes));
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto p-6">

        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href={`/game/${gameId}`}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          >
            ← ダッシュボード
          </Link>
          <h1 className="text-2xl font-bold text-white">投球分析</h1>
        </div>

        {/* フィルタバー */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6 space-y-3">
          {/* 投手セレクタ */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">投手:</label>
              <select
                value={selectedPitcherId}
                onChange={(e) => setSelectedPitcherId(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white max-w-[240px]"
              >
                {myPitchers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({POSITION_NAMES[p.position]})
                  </option>
                ))}
              </select>
            </div>

            {/* 結果フィルタ */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">結果:</span>
              <div className="flex gap-1">
                {(["all", "hit", "out"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setOutcomeFilter(f)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                      outcomeFilter === f
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                    }`}
                  >
                    {f === "all" ? "全て" : f === "hit" ? "ヒット" : "アウト"}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-sm text-gray-400" style={{ fontVariantNumeric: "tabular-nums" }}>
              対象: <span className="text-white">{totalBalls}</span> 球
            </div>
          </div>

          {/* 球種フィルタ */}
          {availablePitchTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-400">球種:</span>
              <button
                onClick={toggleAll}
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                  allSelected ? "bg-gray-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {allSelected ? "全解除" : "全選択"}
              </button>
              {availablePitchTypes.map((pt) => {
                const active = effectiveActivePitchTypes.has(pt);
                const color = PITCH_COLORS[pt];
                return (
                  <button
                    key={pt}
                    onClick={() => togglePitchType(pt)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
                      active ? "bg-gray-700 text-white" : "bg-gray-800 text-gray-500"
                    }`}
                    style={{ borderLeft: `3px solid ${active ? color : "#4b5563"}` }}
                  >
                    <span style={{ color: active ? color : "#6b7280" }}>●</span>
                    {PITCH_TYPE_NAMES[pt]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* データなし */}
        {!hasData ? (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-10 text-center">
            <p className="text-gray-400">
              投球データがありません。試合を進めるとデータが蓄積されます。
            </p>
          </div>
        ) : (
          <div className="space-y-6">

            {/* 上段: ストライクゾーン + 球種別成績 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* ストライクゾーンSVG */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
                <h2 className="text-base font-semibold mb-4 text-gray-200">
                  コース分布
                  {selectedPitcher && (
                    <span className="ml-2 text-sm font-normal text-gray-400">{selectedPitcher.name}</span>
                  )}
                </h2>
                <div className="flex justify-center">
                  <StrikeZoneSvg logs={filteredLogs} getName={getName} />
                </div>
              </div>

              {/* 球種別成績テーブル */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
                <h2 className="text-base font-semibold mb-4 text-gray-200">球種別成績</h2>
                {pitchStats.length === 0 ? (
                  <p className="text-gray-500 text-sm">データなし</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-700">
                          <th className="text-left py-2 px-2">球種</th>
                          <th className="text-right py-2 px-2">球数</th>
                          <th className="text-right py-2 px-2">割合</th>
                          <th className="text-right py-2 px-2">被打率</th>
                          <th className="text-right py-2 px-2">奪三振</th>
                          <th className="text-right py-2 px-2">四球</th>
                          <th className="text-right py-2 px-2">被HR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pitchStats.map((s) => {
                          const color = PITCH_COLORS[s.type];
                          const pct = totalBalls > 0 ? (s.count / totalBalls * 100).toFixed(1) : "0.0";
                          const avg = s.atBats > 0 ? fmt3(s.hits / s.atBats) : "---";
                          return (
                            <tr
                              key={s.type}
                              className="border-b border-gray-700/30"
                              style={{ borderLeft: `4px solid ${color}` }}
                            >
                              <td className="py-1.5 px-2 text-gray-200">
                                <span style={{ color }} className="mr-1">●</span>
                                {PITCH_TYPE_NAMES[s.type]}
                              </td>
                              <td className="py-1.5 px-2 text-right text-gray-200">{s.count.toLocaleString()}</td>
                              <td className="py-1.5 px-2 text-right text-gray-300">{pct}%</td>
                              <td className="py-1.5 px-2 text-right text-gray-200">{avg}</td>
                              <td className="py-1.5 px-2 text-right text-blue-400">{s.strikeouts}</td>
                              <td className="py-1.5 px-2 text-right text-yellow-400">{s.walks}</td>
                              <td className="py-1.5 px-2 text-right text-red-400">{s.homeRuns}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* 中段: 9分割コースヒートマップ */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h2 className="text-base font-semibold mb-4 text-gray-200">コース別被打率 (9分割)</h2>
              <div className="flex justify-center">
                <ZoneHeatmap zoneStats={zoneStats} fmt3={fmt3} />
              </div>
            </div>

            {/* 下段: 打席詳細ログ */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h2 className="text-base font-semibold mb-4 text-gray-200">
                打席詳細ログ ({filteredLogs.length.toLocaleString()}件)
              </h2>
              <PitchLogTable
                logs={filteredLogs}
                getName={getName}
                limit={logLimit}
                onLoadMore={() => setLogLimit((prev) => prev + 50)}
              />
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ---- ストライクゾーンSVG ----

interface TooltipState {
  x: number;
  y: number;
  pitchType: PitchType;
  result: string;
  batterId: string;
}

function StrikeZoneSvg({ logs, getName }: { logs: AtBatLog[]; getName: (id: string) => string }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const logsWithLocation = useMemo(() => {
    return logs.filter((l) => l.pitchLocation !== undefined && l.pitchType !== undefined);
  }, [logs]);

  return (
    <div className="relative">
      <svg viewBox="0 0 300 360" width={300} height={360} className="overflow-visible">
        {/* 背景 */}
        <rect x={0} y={0} width={300} height={360} fill="transparent" />

        {/* ゾーンラベル */}
        <text x={150} y={18} textAnchor="middle" fill="#888" fontSize={11}>高め</text>
        <text x={150} y={348} textAnchor="middle" fill="#888" fontSize={11}>低め</text>
        <text x={8} y={185} textAnchor="start" fill="#888" fontSize={11}>外角</text>
        <text x={270} y={185} textAnchor="start" fill="#888" fontSize={11}>内角</text>

        {/* ストライクゾーン矩形 */}
        <rect x={50} y={50} width={200} height={260} stroke="#888" strokeWidth={2} fill="none" />

        {/* 3×3グリッド線 */}
        {/* 縦線 */}
        <line x1={116.7} y1={50} x2={116.7} y2={310} stroke="#555" strokeWidth={0.5} strokeDasharray="4 4" />
        <line x1={183.3} y1={50} x2={183.3} y2={310} stroke="#555" strokeWidth={0.5} strokeDasharray="4 4" />
        {/* 横線 */}
        <line x1={50} y1={136.7} x2={250} y2={136.7} stroke="#555" strokeWidth={0.5} strokeDasharray="4 4" />
        <line x1={50} y1={223.3} x2={250} y2={223.3} stroke="#555" strokeWidth={0.5} strokeDasharray="4 4" />

        {/* 投球ドット */}
        {logsWithLocation.map((log, i) => {
          const loc = log.pitchLocation!;
          const pt = log.pitchType!;
          const sx = toSvgX(loc.x);
          const sy = toSvgY(loc.y);
          const color = PITCH_COLORS[pt] ?? "#888";
          return (
            <circle
              key={i}
              cx={sx}
              cy={sy}
              r={5}
              fill={color}
              opacity={0.7}
              className="cursor-pointer"
              onMouseEnter={() => setTooltip({ x: sx, y: sy, pitchType: pt, result: log.result, batterId: log.batterId })}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}

        {/* ツールチップ */}
        {tooltip && (() => {
          const tx = tooltip.x > 200 ? tooltip.x - 110 : tooltip.x + 10;
          const ty = tooltip.y < 80 ? tooltip.y + 10 : tooltip.y - 50;
          return (
            <g>
              <rect x={tx} y={ty} width={110} height={48} rx={4} fill="#1f2937" stroke="#4b5563" strokeWidth={1} />
              <text x={tx + 6} y={ty + 16} fill={PITCH_COLORS[tooltip.pitchType] ?? "#fff"} fontSize={10}>
                {PITCH_TYPE_NAMES[tooltip.pitchType]}
              </text>
              <text x={tx + 6} y={ty + 30} fill="#d1d5db" fontSize={10}>
                {resultNamesJa[tooltip.result] ?? tooltip.result}
              </text>
              <text x={tx + 6} y={ty + 44} fill="#9ca3af" fontSize={9}>
                {getName(tooltip.batterId)}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ---- 9分割ヒートマップ ----

interface ZoneStat {
  col: number;
  row: number;
  total: number;
  hits: number;
  atBats: number;
  avg: number;
}

function ZoneHeatmap({ zoneStats, fmt3 }: { zoneStats: ZoneStat[]; fmt3: (n: number) => string }) {
  // 3×3グリッド
  const rows = [0, 1, 2];
  const cols = [0, 1, 2];
  const colLabels = ["外角", "真ん中", "内角"];
  const rowLabels = ["高め", "真ん中", "低め"];

  return (
    <div>
      {/* 列ラベル */}
      <div className="grid grid-cols-3 gap-1 mb-1 w-[252px]">
        {colLabels.map((label) => (
          <div key={label} className="text-center text-xs text-gray-500">{label}</div>
        ))}
      </div>
      <div className="flex gap-2">
        {/* 行ラベル */}
        <div className="flex flex-col justify-around w-10">
          {rowLabels.map((label) => (
            <div key={label} className="text-xs text-gray-500 text-right">{label}</div>
          ))}
        </div>
        {/* グリッド */}
        <div className="grid grid-cols-3 gap-1 w-[240px]">
          {rows.flatMap((row) =>
            cols.map((col) => {
              const stat = zoneStats.find((z) => z.col === col && z.row === row);
              if (!stat) return <div key={`${row}-${col}`} className="w-[76px] h-[60px]" />;
              const bg = stat.atBats > 0 ? avgBgColor(stat.avg) : "#1f2937";
              return (
                <div
                  key={`${row}-${col}`}
                  className="flex flex-col items-center justify-center rounded border border-gray-600 w-[76px] h-[60px]"
                  style={{ backgroundColor: bg }}
                >
                  <span className="text-sm font-bold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {stat.atBats > 0 ? fmt3(stat.avg) : "---"}
                  </span>
                  <span className="text-xs text-gray-400 mt-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {stat.total}球
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
      {/* 凡例 */}
      <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: "#7f1d1d" }} />
          <span>.350以上</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: "#713f12" }} />
          <span>.250-.350</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: "#1e3a5f" }} />
          <span>.250未満</span>
        </div>
      </div>
    </div>
  );
}

// ---- 打席詳細ログテーブル ----

function PitchLogTable({
  logs,
  getName,
  limit,
  onLoadMore,
}: {
  logs: AtBatLog[];
  getName: (id: string) => string;
  limit: number;
  onLoadMore: () => void;
}) {
  const displayed = logs.slice(0, limit);

  return (
    <div>
      <div className="max-h-[480px] overflow-y-auto">
        <table className="w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead className="sticky top-0 bg-gray-800">
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-right py-2 px-2">回</th>
              <th className="text-left py-2 px-2">打者</th>
              <th className="text-left py-2 px-2">球種</th>
              <th className="text-right py-2 px-2">コース(x,y)</th>
              <th className="text-left py-2 px-2">結果</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((log, i) => {
              const pt = log.pitchType;
              const color = pt ? (PITCH_COLORS[pt] ?? "#888") : "#888";
              return (
                <tr
                  key={i}
                  className={`border-b border-gray-700/20 ${i % 2 === 1 ? "bg-gray-700/10" : ""}`}
                >
                  <td className="py-1 px-2 text-right text-gray-400">
                    {log.inning}{log.halfInning === "top" ? "表" : "裏"}
                  </td>
                  <td className="py-1 px-2 text-gray-200">{getName(log.batterId)}</td>
                  <td className="py-1 px-2 text-gray-200">
                    {pt ? (
                      <span className="flex items-center gap-1">
                        <span style={{ color }}>●</span>
                        {PITCH_TYPE_NAMES[pt]}
                      </span>
                    ) : "-"}
                  </td>
                  <td className="py-1 px-2 text-right text-gray-300">
                    {log.pitchLocation
                      ? `(${log.pitchLocation.x.toFixed(2)}, ${log.pitchLocation.y.toFixed(2)})`
                      : "-"}
                  </td>
                  <td className={`py-1 px-2 ${resultColor(log.result)}`}>
                    {resultNamesJa[log.result] ?? log.result}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {logs.length > limit && (
        <div className="text-center pt-3">
          <button
            onClick={onLoadMore}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300 transition-colors"
          >
            もっと見る ({displayed.length}/{logs.length.toLocaleString()}件表示中)
          </button>
        </div>
      )}
      {logs.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-4">
          フィルタ条件に合うデータがありません
        </p>
      )}
    </div>
  );
}
