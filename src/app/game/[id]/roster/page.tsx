"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";

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
        <Link href={`/game/${game.id}`} className="text-gray-400 hover:text-white">← 戻る</Link>
        <h1 className="text-2xl font-bold">ロスター - {myTeam.name}</h1>
      </div>

      <h2 className="text-lg font-semibold mb-3 text-blue-400">投手 ({pitchers.length})</h2>
      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left py-2">名前</th>
              <th className="text-center py-2">年齢</th>
              <th className="text-center py-2">投</th>
              <th className="text-center py-2">球速</th>
              <th className="text-center py-2">制球</th>
              <th className="text-center py-2">変化球</th>
              <th className="text-center py-2">スタミナ</th>
              <th className="text-center py-2">潜在</th>
            </tr>
          </thead>
          <tbody>
            {pitchers.map((p) => (
              <tr key={p.id} className="border-b border-gray-700/50">
                <td className="py-2">{p.name}</td>
                <td className="py-2 text-center">{p.age}</td>
                <td className="py-2 text-center">{p.throwHand}</td>
                <td className="py-2 text-center">{p.pitching?.velocity}</td>
                <td className="py-2 text-center">{p.pitching?.control}</td>
                <td className="py-2 text-center">{p.pitching?.breaking}</td>
                <td className="py-2 text-center">{p.pitching?.stamina}</td>
                <td className="py-2 text-center">{p.potential.overall}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold mb-3 text-emerald-400">野手 ({batters.length})</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left py-2">名前</th>
              <th className="text-center py-2">年齢</th>
              <th className="text-center py-2">Pos</th>
              <th className="text-center py-2">打</th>
              <th className="text-center py-2">ミート</th>
              <th className="text-center py-2">パワー</th>
              <th className="text-center py-2">走力</th>
              <th className="text-center py-2">守備</th>
              <th className="text-center py-2">選球眼</th>
              <th className="text-center py-2">潜在</th>
            </tr>
          </thead>
          <tbody>
            {batters.map((p) => (
              <tr key={p.id} className="border-b border-gray-700/50">
                <td className="py-2">{p.name}</td>
                <td className="py-2 text-center">{p.age}</td>
                <td className="py-2 text-center">{p.position}</td>
                <td className="py-2 text-center">{p.batSide}</td>
                <td className="py-2 text-center">{p.batting.contact}</td>
                <td className="py-2 text-center">{p.batting.power}</td>
                <td className="py-2 text-center">{p.batting.speed}</td>
                <td className="py-2 text-center">{p.batting.fielding}</td>
                <td className="py-2 text-center">{p.batting.eye}</td>
                <td className="py-2 text-center">{p.potential.overall}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
