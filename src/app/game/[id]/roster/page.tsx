"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";

function abilityColor(val: number): string {
  if (val >= 80) return "text-yellow-400 font-bold";
  if (val >= 65) return "text-green-400";
  if (val >= 50) return "text-gray-100";
  if (val >= 35) return "text-orange-400";
  return "text-red-400";
}

function potentialColor(grade: string): string {
  switch (grade) {
    case "S":
      return "text-yellow-400 font-bold";
    case "A":
      return "text-green-400 font-bold";
    case "B":
      return "text-blue-400";
    case "C":
      return "text-orange-400";
    default:
      return "text-gray-500";
  }
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
    <div className="max-w-5xl mx-auto p-6">
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
              <th className="py-3 px-3 text-right text-gray-400">変化球</th>
              <th className="py-3 px-3 text-right text-gray-400">スタミナ</th>
              <th className="py-3 px-3 text-right text-gray-400">精神</th>
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
                  {p.throwHand}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.pitching?.velocity ?? 0)}`}
                >
                  {p.pitching?.velocity}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.pitching?.control ?? 0)}`}
                >
                  {p.pitching?.control}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.pitching?.breaking ?? 0)}`}
                >
                  {p.pitching?.breaking}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.pitching?.stamina ?? 0)}`}
                >
                  {p.pitching?.stamina}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.pitching?.mentalToughness ?? 0)}`}
                >
                  {p.pitching?.mentalToughness}
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
              <th className="py-3 px-3 text-center text-gray-400">Pos</th>
              <th className="py-3 px-3 text-center text-gray-400">打</th>
              <th className="py-3 px-3 text-right text-gray-400">ミート</th>
              <th className="py-3 px-3 text-right text-gray-400">パワー</th>
              <th className="py-3 px-3 text-right text-gray-400">走力</th>
              <th className="py-3 px-3 text-right text-gray-400">守備</th>
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
                  {p.position}
                </td>
                <td className="py-2.5 px-3 text-center text-gray-300">
                  {p.batSide}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.batting.contact)}`}
                >
                  {p.batting.contact}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.batting.power)}`}
                >
                  {p.batting.power}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.batting.speed)}`}
                >
                  {p.batting.speed}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.batting.fielding)}`}
                >
                  {p.batting.fielding}
                </td>
                <td
                  className={`py-2.5 px-3 text-right ${abilityColor(p.batting.eye)}`}
                >
                  {p.batting.eye}
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
