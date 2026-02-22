"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";

export default function SchedulePage() {
  const params = useParams();
  const { game, loadGame, simNext, simDay, simWeek, simToMyGame } =
    useGameStore();
  const [filter, setFilter] = useState<"all" | "my">("all");

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  if (!game) return <div className="p-8 text-gray-400">読み込み中...</div>;

  const season = game.currentSeason;
  const isRegularSeason = season.phase === "regular_season";
  const gamesPerDay = Math.floor(Object.keys(game.teams).length / 2);
  const currentDay = Math.floor(season.currentGameIndex / gamesPerDay) + 1;
  const totalDays = Math.ceil(season.schedule.length / gamesPerDay);

  // フィルタリング
  const filterFn = (s: (typeof season.schedule)[0]) =>
    filter === "all" ||
    s.homeTeamId === game.myTeamId ||
    s.awayTeamId === game.myTeamId;

  const recent = season.schedule
    .filter((s) => s.result !== null && filterFn(s))
    .slice(-10)
    .reverse();

  const upcoming = season.schedule
    .filter((s) => s.result === null && filterFn(s))
    .slice(0, 20);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/game/${game.id}`}
          className="text-gray-400 hover:text-white"
        >
          &larr; 戻る
        </Link>
        <h1 className="text-2xl font-bold">スケジュール</h1>
      </div>

      {/* シミュレーションボタン */}
      {isRegularSeason && (
        <div className="mb-6 p-5 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">
              第{currentDay}日 / 全{totalDays}日
            </span>
            <span
              className="text-sm font-mono text-gray-300"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(
                (season.currentGameIndex / season.schedule.length) * 100
              )}
              %
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{
                width: `${(season.currentGameIndex / season.schedule.length) * 100}%`,
              }}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <button
              onClick={simNext}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors"
            >
              次の1試合
            </button>
            <button
              onClick={simDay}
              className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-semibold transition-colors"
            >
              1日分
            </button>
            <button
              onClick={simWeek}
              className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-semibold transition-colors"
            >
              1週間分
            </button>
            <button
              onClick={simToMyGame}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold transition-colors"
            >
              自チームまで
            </button>
          </div>
        </div>
      )}

      {season.phase === "offseason" && (
        <div className="mb-6 p-5 bg-gray-800 rounded-lg border border-gray-700 text-center text-gray-400">
          シーズンが終了しました
        </div>
      )}

      {/* フィルター */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded text-sm transition-colors ${
            filter === "all"
              ? "bg-gray-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          全試合
        </button>
        <button
          onClick={() => setFilter("my")}
          className={`px-3 py-1.5 rounded text-sm transition-colors ${
            filter === "my"
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          自チームのみ
        </button>
      </div>

      {/* 最近の試合結果 */}
      {recent.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 text-gray-300">
            最近の試合結果
          </h2>
          <div className="space-y-2">
            {recent.map((entry) => {
              const home = game.teams[entry.homeTeamId];
              const away = game.teams[entry.awayTeamId];
              const result = entry.result!;
              const isMyGame =
                entry.homeTeamId === game.myTeamId ||
                entry.awayTeamId === game.myTeamId;

              let myResult: "win" | "loss" | "draw" | null = null;
              if (isMyGame) {
                const isHome = entry.homeTeamId === game.myTeamId;
                const myScore = isHome ? result.homeScore : result.awayScore;
                const opScore = isHome ? result.awayScore : result.homeScore;
                if (myScore > opScore) myResult = "win";
                else if (myScore < opScore) myResult = "loss";
                else myResult = "draw";
              }

              const resultBorder =
                myResult === "win"
                  ? "border-l-4 border-l-green-500"
                  : myResult === "loss"
                    ? "border-l-4 border-l-red-500"
                    : myResult === "draw"
                      ? "border-l-4 border-l-gray-500"
                      : "";

              return (
                <div
                  key={entry.id}
                  className={`p-4 bg-gray-800 rounded-lg border border-gray-700 ${resultBorder}`}
                >
                  {/* チーム名 & スコア */}
                  <div
                    className="flex items-center justify-center gap-4"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    <div className="flex items-center gap-2 min-w-[90px] justify-end">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: away?.color }}
                      />
                      <span
                        className={`font-medium ${
                          entry.awayTeamId === game.myTeamId
                            ? "text-blue-400 font-bold"
                            : "text-white"
                        }`}
                      >
                        {away?.shortName}
                      </span>
                    </div>
                    <div className="text-xl font-bold text-center min-w-[70px] text-white">
                      {result.awayScore}
                      <span className="text-gray-500 mx-1">-</span>
                      {result.homeScore}
                    </div>
                    <div className="flex items-center gap-2 min-w-[90px]">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: home?.color }}
                      />
                      <span
                        className={`font-medium ${
                          entry.homeTeamId === game.myTeamId
                            ? "text-blue-400 font-bold"
                            : "text-white"
                        }`}
                      >
                        {home?.shortName}
                      </span>
                    </div>
                  </div>
                  {/* イニングスコア */}
                  <div
                    className="mt-3 flex gap-0 text-xs justify-center"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {result.innings.map((inn, i) => (
                      <div
                        key={i}
                        className="text-center w-6 border-r border-gray-700/50 last:border-r-0"
                      >
                        <div className="text-gray-600 font-medium">
                          {i + 1}
                        </div>
                        <div className="text-gray-400">{inn.top}</div>
                        <div className="text-gray-400">{inn.bottom}</div>
                      </div>
                    ))}
                    <div className="text-center w-8 ml-1 font-bold text-gray-200">
                      <div className="text-gray-600 font-medium">計</div>
                      <div>{result.awayScore}</div>
                      <div>{result.homeScore}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 今後の試合 */}
      {upcoming.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 text-gray-300">
            今後の試合
          </h2>
          <div className="space-y-2">
            {upcoming.map((entry) => {
              const home = game.teams[entry.homeTeamId];
              const away = game.teams[entry.awayTeamId];
              const isMyGame =
                entry.homeTeamId === game.myTeamId ||
                entry.awayTeamId === game.myTeamId;
              return (
                <div
                  key={entry.id}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-colors hover:bg-gray-700/40 ${
                    isMyGame
                      ? "bg-blue-950/40 border border-blue-800"
                      : "bg-gray-800 border border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-[80px] justify-end">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: away?.color }}
                    />
                    <span className="text-white">{away?.shortName}</span>
                  </div>
                  <span className="text-gray-500">@</span>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: home?.color }}
                    />
                    <span className="text-white">{home?.shortName}</span>
                  </div>
                  {isMyGame && (
                    <span className="text-xs text-blue-400 ml-auto">★</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
