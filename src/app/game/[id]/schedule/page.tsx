"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";

/** TODO: 試合シミュレーション実行機能を実装する */
export default function SchedulePage() {
  const params = useParams();
  const { game, loadGame } = useGameStore();

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  if (!game) return <div className="p-8 text-gray-400">読み込み中...</div>;

  const season = game.currentSeason;
  const upcoming = season.schedule
    .filter((s) => s.result === null)
    .slice(0, 20);
  const recent = season.schedule
    .filter((s) => s.result !== null)
    .slice(-10)
    .reverse();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/game/${game.id}`} className="text-gray-400 hover:text-white">← 戻る</Link>
        <h1 className="text-2xl font-bold">スケジュール</h1>
      </div>

      {recent.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 text-gray-300">最近の試合結果</h2>
          <div className="space-y-2">
            {recent.map((entry) => {
              const home = game.teams[entry.homeTeamId];
              const away = game.teams[entry.awayTeamId];
              return (
                <div key={entry.id} className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg text-sm">
                  <span>{away?.shortName}</span>
                  <span className="font-bold">{entry.result?.awayScore} - {entry.result?.homeScore}</span>
                  <span>{home?.shortName}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3 text-gray-300">今後の試合</h2>
      <div className="space-y-2">
        {upcoming.map((entry) => {
          const home = game.teams[entry.homeTeamId];
          const away = game.teams[entry.awayTeamId];
          const isMyGame = entry.homeTeamId === game.myTeamId || entry.awayTeamId === game.myTeamId;
          return (
            <div
              key={entry.id}
              className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                isMyGame ? "bg-blue-950/40 border border-blue-800" : "bg-gray-800"
              }`}
            >
              <span>{away?.shortName}</span>
              <span className="text-gray-500">@</span>
              <span>{home?.shortName}</span>
              {isMyGame && <span className="text-xs text-blue-400 ml-auto">★</span>}
            </div>
          );
        })}
      </div>

      <div className="mt-6 p-4 bg-gray-800/50 rounded-lg border border-dashed border-gray-600 text-center text-gray-500">
        TODO: 「試合を進める」ボタンでシミュレーション実行
      </div>
    </div>
  );
}
