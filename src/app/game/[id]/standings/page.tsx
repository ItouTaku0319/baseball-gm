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
        <Link
          href={`/game/${game.id}`}
          className="text-gray-400 hover:text-white"
        >
          &larr; 戻る
        </Link>
        <h1 className="text-2xl font-bold">順位表</h1>
        <span className="text-gray-500 text-sm">{season.year}年</span>
      </div>

      {season.leagues.map((league) => {
        const leagueTeamIds = new Set(league.teams);
        const leagueStandings = sortStandings(season.standings).filter((r) =>
          leagueTeamIds.has(r.teamId)
        );

        return (
          <div key={league.id} className="mb-8">
            <h2
              className={`text-lg font-semibold mb-3 ${
                league.id === "central" ? "text-blue-400" : "text-emerald-400"
              }`}
            >
              {league.name}
            </h2>
            <div className="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700">
              <table
                className="w-full whitespace-nowrap"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <thead>
                  <tr className="border-b-2 border-gray-600 bg-gray-900 text-xs uppercase tracking-wider">
                    <th className="py-3 px-3 text-left text-gray-400 w-10">
                      #
                    </th>
                    <th className="py-3 px-3 text-left text-gray-400">
                      チーム
                    </th>
                    <th className="py-3 px-3 text-right text-gray-400">勝</th>
                    <th className="py-3 px-3 text-right text-gray-400">敗</th>
                    <th className="py-3 px-3 text-right text-gray-400">分</th>
                    <th className="py-3 px-3 text-right text-gray-400">
                      勝率
                    </th>
                    <th className="py-3 px-3 text-right text-gray-400">
                      ゲーム差
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leagueStandings.map((record, i) => {
                    const team = game.teams[record.teamId];
                    const total = record.wins + record.losses;
                    const pct =
                      total > 0
                        ? (record.wins / total).toFixed(3).replace(/^0/, "")
                        : ".000";
                    const isMyTeam = record.teamId === game.myTeamId;
                    const topWins = leagueStandings[0]?.wins ?? 0;
                    const topLosses = leagueStandings[0]?.losses ?? 0;
                    const gbVal =
                      (topWins - record.wins + (record.losses - topLosses)) / 2;
                    const gb =
                      i === 0
                        ? "-"
                        : gbVal === Math.floor(gbVal)
                          ? `${gbVal}`
                          : gbVal.toFixed(1);

                    return (
                      <tr
                        key={record.teamId}
                        className={`border-b border-gray-700/30 transition-colors hover:bg-gray-700/40 ${
                          isMyTeam
                            ? "bg-blue-950/40"
                            : i % 2 === 1
                              ? "bg-gray-800/60"
                              : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 font-bold text-gray-500">
                          {i + 1}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: team?.color }}
                            />
                            <span className="font-medium text-white">
                              {team?.name}
                            </span>
                            {isMyTeam && (
                              <span className="text-xs text-blue-400">
                                ★
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-100">
                          {record.wins}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-100">
                          {record.losses}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-100">
                          {record.draws}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-gray-100">
                          {pct}
                        </td>
                        <td className="py-2.5 px-3 text-right text-gray-400">
                          {gb}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
