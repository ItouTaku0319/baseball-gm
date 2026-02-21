"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { sortStandings } from "@/engine/season";

export default function GameDashboard() {
  const params = useParams();
  const { game, loadGame } = useGameStore();

  useEffect(() => {
    if (!game && params.id) {
      loadGame(params.id as string);
    }
  }, [game, params.id, loadGame]);

  if (!game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">読み込み中...</p>
      </div>
    );
  }

  const myTeam = game.teams[game.myTeamId];
  const season = game.currentSeason;
  const standings = sortStandings(season.standings);
  const totalGames = season.schedule.length;
  const playedGames = season.schedule.filter((s) => s.result !== null).length;

  const menuItems = [
    { href: `/game/${game.id}/roster`, label: "ロスター", desc: "選手一覧・能力確認" },
    { href: `/game/${game.id}/standings`, label: "順位表", desc: "リーグ順位" },
    { href: `/game/${game.id}/schedule`, label: "スケジュール", desc: "試合日程・結果" },
    { href: `/game/${game.id}/draft`, label: "ドラフト", desc: "新人選手の獲得" },
    { href: `/game/${game.id}/trade`, label: "トレード", desc: "選手の交換" },
    { href: `/game/${game.id}/stats`, label: "成績", desc: "選手・チーム統計" },
  ];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <span
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: myTeam.color }}
            />
            {myTeam.name}
          </h1>
          <p className="text-gray-400 mt-1">
            {season.year}年シーズン / {season.phase === "preseason" ? "プレシーズン" : "レギュラーシーズン"}
          </p>
        </div>
        <div className="text-right text-sm text-gray-400">
          進行: {playedGames} / {totalGames} 試合
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
        <h2 className="text-lg font-semibold mb-3">チーム成績</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-3xl font-bold text-blue-400">
              {season.standings[game.myTeamId]?.wins ?? 0}
            </div>
            <div className="text-sm text-gray-400">勝</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-red-400">
              {season.standings[game.myTeamId]?.losses ?? 0}
            </div>
            <div className="text-sm text-gray-400">敗</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-300">
              {season.standings[game.myTeamId]?.draws ?? 0}
            </div>
            <div className="text-sm text-gray-400">分</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
          >
            <div className="font-semibold">{item.label}</div>
            <div className="text-xs text-gray-500 mt-1">{item.desc}</div>
          </Link>
        ))}
      </div>

      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold mb-3">順位表</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left py-2">#</th>
              <th className="text-left py-2">チーム</th>
              <th className="text-center py-2">勝</th>
              <th className="text-center py-2">敗</th>
              <th className="text-center py-2">勝率</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((record, i) => {
              const team = game.teams[record.teamId];
              const total = record.wins + record.losses;
              const pct = total > 0 ? (record.wins / total).toFixed(3) : ".000";
              const isMyTeam = record.teamId === game.myTeamId;
              return (
                <tr
                  key={record.teamId}
                  className={`border-b border-gray-700/50 ${isMyTeam ? "bg-blue-950/30" : ""}`}
                >
                  <td className="py-2 text-gray-500">{i + 1}</td>
                  <td className="py-2 flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: team?.color }}
                    />
                    {team?.shortName}
                    {isMyTeam && <span className="text-xs text-blue-400">★</span>}
                  </td>
                  <td className="py-2 text-center">{record.wins}</td>
                  <td className="py-2 text-center">{record.losses}</td>
                  <td className="py-2 text-center">{pct}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
        >
          タイトルに戻る
        </Link>
      </div>
    </div>
  );
}
