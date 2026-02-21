"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { sortStandings } from "@/engine/season";

export default function StandingsPage() {
  const params = useParams();
  const { game, loadGame } = useGameStore();

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  if (!game) return <div className="p-8 text-gray-400">読み込み中...</div>;

  const season = game.currentSeason;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/game/${game.id}`} className="text-gray-400 hover:text-white">← 戻る</Link>
        <h1 className="text-2xl font-bold">順位表 - {season.year}年</h1>
      </div>

      {season.leagues.map((league) => {
        const leagueTeamIds = new Set(league.teams);
        const leagueStandings = sortStandings(season.standings).filter((r) =>
          leagueTeamIds.has(r.teamId)
        );

        return (
          <div key={league.id} className="mb-8">
            <h2 className="text-lg font-semibold mb-3">{league.name}</h2>
            <table className="w-full text-sm bg-gray-800 rounded-lg overflow-hidden">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left p-3">#</th>
                  <th className="text-left p-3">チーム</th>
                  <th className="text-center p-3">勝</th>
                  <th className="text-center p-3">敗</th>
                  <th className="text-center p-3">分</th>
                  <th className="text-center p-3">勝率</th>
                  <th className="text-center p-3">差</th>
                </tr>
              </thead>
              <tbody>
                {leagueStandings.map((record, i) => {
                  const team = game.teams[record.teamId];
                  const total = record.wins + record.losses;
                  const pct = total > 0 ? (record.wins / total).toFixed(3) : ".000";
                  const isMyTeam = record.teamId === game.myTeamId;
                  const topWins = leagueStandings[0]?.wins ?? 0;
                  const topLosses = leagueStandings[0]?.losses ?? 0;
                  const gb = i === 0 ? "-" : (((topWins - record.wins) + (record.losses - topLosses)) / 2).toFixed(1);

                  return (
                    <tr key={record.teamId} className={`border-b border-gray-700/50 ${isMyTeam ? "bg-blue-950/30" : ""}`}>
                      <td className="p-3 text-gray-500">{i + 1}</td>
                      <td className="p-3 flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: team?.color }} />
                        {team?.name}
                        {isMyTeam && <span className="text-xs text-blue-400">★</span>}
                      </td>
                      <td className="p-3 text-center">{record.wins}</td>
                      <td className="p-3 text-center">{record.losses}</td>
                      <td className="p-3 text-center">{record.draws}</td>
                      <td className="p-3 text-center">{pct}</td>
                      <td className="p-3 text-center text-gray-400">{gb}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
