"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import {
  PITCH_TYPE_NAMES,
  POSITION_NAMES,
  THROW_HAND_NAMES,
  BAT_SIDE_NAMES,
} from "@/models/player";
import type { PitchRepertoire } from "@/models/player";

/** 能力値(1-100)のグレード文字を返す */
function abilityGrade(val: number): string {
  if (val >= 90) return "S";
  if (val >= 80) return "A";
  if (val >= 70) return "B";
  if (val >= 60) return "C";
  if (val >= 50) return "D";
  if (val >= 40) return "E";
  if (val >= 30) return "F";
  return "G";
}

/** グレード文字のTailwindクラス */
function gradeColor(grade: string): string {
  switch (grade) {
    case "S": return "text-red-500 font-bold";
    case "A": return "text-red-400";
    case "B": return "text-orange-400";
    case "C": return "text-yellow-400";
    case "D": return "text-lime-400";
    case "E": return "text-green-500";
    case "F": return "text-blue-400";
    default:  return "text-gray-500";
  }
}

/** 球速(km/h)のグレード文字を返す */
function velocityGrade(v: number): string {
  if (v >= 155) return "S";
  if (v >= 150) return "A";
  if (v >= 145) return "B";
  if (v >= 140) return "C";
  if (v >= 135) return "D";
  if (v >= 130) return "E";
  if (v >= 125) return "F";
  return "G";
}

/** 潜在能力グレードのTailwindクラス */
function potentialColor(grade: string): string {
  switch (grade) {
    case "S": return "text-red-500 font-bold";
    case "A": return "text-red-400";
    case "B": return "text-orange-400";
    case "C": return "text-yellow-400";
    case "D": return "text-lime-400";
    default:  return "text-gray-500";
  }
}

/** 能力値セル: 数値(白) + グレード文字(色付き) */
function AbilityCell({ val }: { val: number }) {
  const grade = abilityGrade(val);
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-gray-100">{val}</span>
      <span className={`text-xs ${gradeColor(grade)}`}>{grade}</span>
    </span>
  );
}

/** 球速セル: 数値のみ (グレード色で着色) */
function VelocityCell({ val }: { val: number }) {
  const grade = velocityGrade(val);
  return (
    <span className={gradeColor(grade)}>{val}km</span>
  );
}

/** 変化量のTailwind色クラス */
function pitchLevelColor(level: number): string {
  if (level >= 6) return "text-red-400 font-bold";
  if (level >= 5) return "text-orange-400";
  if (level >= 4) return "text-yellow-400";
  if (level >= 3) return "text-lime-400";
  if (level >= 2) return "text-cyan-400";
  return "text-cyan-300";
}

/** 球種テーブルセル: テキスト表示 */
function PitchList({ pitches }: { pitches: PitchRepertoire[] }) {
  if (pitches.length === 0) return <span className="text-gray-600">-</span>;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {pitches.map((p) => (
        <span key={p.type} className="whitespace-nowrap">
          <span className="text-gray-400">{PITCH_TYPE_NAMES[p.type]}</span>
          <span className={`ml-0.5 ${pitchLevelColor(p.level)}`}>{p.level}</span>
        </span>
      ))}
    </div>
  );
}

export default function RosterPage() {
  const params = useParams();
  const { game, loadGame } = useGameStore();

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  if (!game) return <div className="p-8 text-gray-400">読み込み中...</div>;

  const myTeam = game.teams[game.myTeamId];
  const pitchers = myTeam.roster.filter((p) => p.isPitcher);
  const batters = myTeam.roster.filter((p) => !p.isPitcher);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/game/${game.id}`}
          className="text-gray-400 hover:text-white"
        >
          &larr; 戻る
        </Link>
        <h1 className="text-2xl font-bold">ロスター</h1>
        <div className="flex items-center gap-2 text-gray-400">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: myTeam.color }}
          />
          <span>{myTeam.name}</span>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-3 text-blue-400">
        投手 ({pitchers.length})
      </h2>
      <div className="overflow-x-auto mb-8 bg-gray-800 rounded-lg border border-gray-700">
        <table
          className="w-full whitespace-nowrap"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <thead>
            <tr className="border-b-2 border-gray-600 bg-gray-900 text-xs uppercase tracking-wider">
              <th className="py-3 px-3 text-left text-gray-400">名前</th>
              <th className="py-3 px-3 text-right text-gray-400">年齢</th>
              <th className="py-3 px-3 text-center text-gray-400">投</th>
              <th className="py-3 px-3 text-right text-gray-400">球速</th>
              <th className="py-3 px-3 text-right text-gray-400">制球</th>
              <th className="py-3 px-3 text-left text-gray-400">球種</th>
              <th className="py-3 px-3 text-right text-gray-400">スタミナ</th>
              <th className="py-3 px-3 text-right text-gray-400">精神</th>
              <th className="py-3 px-3 text-right text-gray-400">肩力</th>
              <th className="py-3 px-3 text-right text-gray-400">守備</th>
              <th className="py-3 px-3 text-right text-gray-400">捕球</th>
              <th className="py-3 px-3 text-center text-gray-400">潜在</th>
            </tr>
          </thead>
          <tbody>
            {pitchers.map((p, i) => (
              <tr
                key={p.id}
                className={`border-b border-gray-700/30 transition-colors hover:bg-gray-700/40 ${
                  i % 2 === 1 ? "bg-gray-800/60" : ""
                }`}
              >
                <td className="py-2.5 px-3 font-medium text-white">
                  {p.name}
                </td>
                <td className="py-2.5 px-3 text-right text-gray-100">
                  {p.age}
                </td>
                <td className="py-2.5 px-3 text-center text-gray-300">
                  {THROW_HAND_NAMES[p.throwHand]}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <VelocityCell val={p.pitching?.velocity ?? 120} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.pitching?.control ?? 0} />
                </td>
                <td className="py-2.5 px-3">
                  <PitchList pitches={p.pitching?.pitches ?? []} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.pitching?.stamina ?? 0} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.pitching?.mentalToughness ?? 0} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.pitching?.arm ?? 50} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.pitching?.fielding ?? 50} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.pitching?.catching ?? 50} />
                </td>
                <td
                  className={`py-2.5 px-3 text-center ${potentialColor(p.potential.overall)}`}
                >
                  {p.potential.overall}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold mb-3 text-emerald-400">
        野手 ({batters.length})
      </h2>
      <div className="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700">
        <table
          className="w-full whitespace-nowrap"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <thead>
            <tr className="border-b-2 border-gray-600 bg-gray-900 text-xs uppercase tracking-wider">
              <th className="py-3 px-3 text-left text-gray-400">名前</th>
              <th className="py-3 px-3 text-right text-gray-400">年齢</th>
              <th className="py-3 px-3 text-center text-gray-400">位置</th>
              <th className="py-3 px-3 text-center text-gray-400">打</th>
              <th className="py-3 px-3 text-right text-gray-400">ミート</th>
              <th className="py-3 px-3 text-right text-gray-400">パワー</th>
              <th className="py-3 px-3 text-right text-gray-400">走力</th>
              <th className="py-3 px-3 text-right text-gray-400">肩力</th>
              <th className="py-3 px-3 text-right text-gray-400">守備</th>
              <th className="py-3 px-3 text-right text-gray-400">捕球</th>
              <th className="py-3 px-3 text-right text-gray-400">選球眼</th>
              <th className="py-3 px-3 text-center text-gray-400">潜在</th>
            </tr>
          </thead>
          <tbody>
            {batters.map((p, i) => (
              <tr
                key={p.id}
                className={`border-b border-gray-700/30 transition-colors hover:bg-gray-700/40 ${
                  i % 2 === 1 ? "bg-gray-800/60" : ""
                }`}
              >
                <td className="py-2.5 px-3 font-medium text-white">
                  {p.name}
                </td>
                <td className="py-2.5 px-3 text-right text-gray-100">
                  {p.age}
                </td>
                <td className="py-2.5 px-3 text-center text-gray-300">
                  {POSITION_NAMES[p.position]}
                </td>
                <td className="py-2.5 px-3 text-center text-gray-300">
                  {BAT_SIDE_NAMES[p.batSide]}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.batting.contact} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.batting.power} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.batting.speed} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.batting.arm ?? 50} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.batting.fielding} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.batting.catching ?? 50} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <AbilityCell val={p.batting.eye} />
                </td>
                <td
                  className={`py-2.5 px-3 text-center ${potentialColor(p.potential.overall)}`}
                >
                  {p.potential.overall}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
