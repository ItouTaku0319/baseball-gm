"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { sortStandings } from "@/engine/season";

export default function GameDashboard() {
  const params = useParams();
  const {
    game,
    loadGame,
    startSeason,
    simNext,
    simDay,
    simWeek,
    simToMyGame,
  } = useGameStore();

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
  const totalGames = season.schedule.length;
  const playedGames = season.currentGameIndex;
  const gamesPerDay = Math.floor(Object.keys(game.teams).length / 2);
  const currentDay = Math.floor(playedGames / gamesPerDay) + 1;
  const totalDays = Math.ceil(totalGames / gamesPerDay);

  const phaseLabel = {
    preseason: "プレシーズン",
    regular_season: "レギュラーシーズン",
    playoffs: "プレーオフ",
    offseason: "オフシーズン",
  }[season.phase];

  const myRecord = season.standings[game.myTeamId];
  const myTotal = myRecord ? myRecord.wins + myRecord.losses : 0;
  const myPct =
    myTotal > 0
      ? (myRecord.wins / myTotal).toFixed(3).replace(/^0/, "")
      : ".000";

  // 自チームの次の試合を探す
  const myNextGame =
    season.phase === "regular_season"
      ? season.schedule
          .slice(season.currentGameIndex)
          .find(
            (s) =>
              s.homeTeamId === game.myTeamId ||
              s.awayTeamId === game.myTeamId
          )
      : null;

  // 次の試合が自チームの試合かどうか
  const nextEntry =
    season.phase === "regular_season" &&
    season.currentGameIndex < totalGames
      ? season.schedule[season.currentGameIndex]
      : null;
  const isMyGameNext =
    nextEntry &&
    (nextEntry.homeTeamId === game.myTeamId ||
      nextEntry.awayTeamId === game.myTeamId);

  // 自チームのリーグを特定
  const myLeague = season.leagues.find((l) =>
    l.teams.includes(game.myTeamId)
  );

  const menuItems = [
    {
      href: `/game/${game.id}/roster`,
      label: "ロスター",
      desc: "選手一覧・能力確認",
    },
    {
      href: `/game/${game.id}/standings`,
      label: "順位表",
      desc: "リーグ順位",
    },
    {
      href: `/game/${game.id}/schedule`,
      label: "スケジュール",
      desc: "試合日程・結果",
    },
    {
      href: `/game/${game.id}/draft`,
      label: "ドラフト",
      desc: "新人選手の獲得",
    },
    {
      href: `/game/${game.id}/trade`,
      label: "トレード",
      desc: "選手の交換",
    },
    {
      href: `/game/${game.id}/stats`,
      label: "成績",
      desc: "選手・チーム統計",
    },
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
            {season.year}年シーズン / {phaseLabel}
          </p>
        </div>
        <div
          className="text-right text-sm text-gray-400"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          第{currentDay}日 / {totalDays}日
        </div>
      </div>

      {/* チーム成績 */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">チーム成績</h2>
        <div
          className="grid grid-cols-4 gap-4 text-center"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <div>
            <div className="text-3xl font-bold text-blue-400">
              {myRecord?.wins ?? 0}
            </div>
            <div className="text-sm text-gray-400 mt-1">勝</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-red-400">
              {myRecord?.losses ?? 0}
            </div>
            <div className="text-sm text-gray-400 mt-1">敗</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-300">
              {myRecord?.draws ?? 0}
            </div>
            <div className="text-sm text-gray-400 mt-1">分</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-white font-mono">
              {myPct}
            </div>
            <div className="text-sm text-gray-400 mt-1">勝率</div>
          </div>
        </div>
      </div>

      {/* 試合進行パネル */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
        {season.phase === "preseason" && (
          <div className="text-center">
            <p className="text-gray-300 mb-4">
              {season.year}年シーズンの準備が整いました
            </p>
            <button
              onClick={startSeason}
              className="px-8 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg transition-colors"
            >
              シーズン開始
            </button>
          </div>
        )}

        {season.phase === "regular_season" && (
          <div>
            {/* プログレスバー */}
            <div className="mb-5">
              <div
                className="flex justify-between text-sm text-gray-300 mb-2"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <span>シーズン進行</span>
                <span>
                  {Math.round((playedGames / totalGames) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${(playedGames / totalGames) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* 自チーム次の試合 - メインアクション */}
            {myNextGame && (
              <div className="mb-5 p-5 bg-gray-700/50 rounded-lg border border-gray-600">
                <div className="text-xs text-gray-400 mb-3 text-center">
                  自チーム次の試合
                </div>
                <div className="flex items-center justify-center gap-5 text-xl mb-4">
                  <span
                    className={`flex items-center gap-2 ${
                      myNextGame.awayTeamId === game.myTeamId
                        ? "text-blue-400 font-bold"
                        : "text-white"
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{
                        backgroundColor:
                          game.teams[myNextGame.awayTeamId]?.color,
                      }}
                    />
                    {game.teams[myNextGame.awayTeamId]?.shortName}
                  </span>
                  <span className="text-gray-500 text-base">vs</span>
                  <span
                    className={`flex items-center gap-2 ${
                      myNextGame.homeTeamId === game.myTeamId
                        ? "text-blue-400 font-bold"
                        : "text-white"
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{
                        backgroundColor:
                          game.teams[myNextGame.homeTeamId]?.color,
                      }}
                    />
                    {game.teams[myNextGame.homeTeamId]?.shortName}
                  </span>
                </div>

                {isMyGameNext ? (
                  <button
                    onClick={simNext}
                    className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg transition-colors"
                  >
                    試合開始
                  </button>
                ) : (
                  <button
                    onClick={simToMyGame}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold text-lg transition-colors"
                  >
                    この試合まで進める
                  </button>
                )}
              </div>
            )}

            {/* その他の操作 */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={simDay}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-semibold transition-colors"
              >
                1日分
              </button>
              <button
                onClick={simWeek}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-semibold transition-colors"
              >
                1週間分
              </button>
              <button
                onClick={simNext}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors text-gray-300"
              >
                次の1試合
              </button>
            </div>
          </div>
        )}

        {season.phase === "offseason" && (
          <div className="text-center">
            <p className="text-2xl font-bold mb-2">シーズン終了</p>
            <p className="text-gray-400">
              {season.year}年シーズンが終了しました
            </p>
            <div
              className="mt-3 text-lg"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              最終成績: {myRecord?.wins ?? 0}勝 {myRecord?.losses ?? 0}敗{" "}
              {myRecord?.draws ?? 0}分
            </div>
          </div>
        )}
      </div>

      {/* メニュー */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-500 hover:bg-gray-700/50 transition-colors"
          >
            <div className="font-semibold text-white">{item.label}</div>
            <div className="text-xs text-gray-500 mt-1">{item.desc}</div>
          </Link>
        ))}
      </div>

      {/* 順位表 - セパ分割 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 自チームのリーグを先に表示 */}
        {[
          ...season.leagues.filter((l) => l.id === myLeague?.id),
          ...season.leagues.filter((l) => l.id !== myLeague?.id),
        ].map((league) => {
          const leagueTeamIds = new Set(league.teams);
          const leagueStandings = sortStandings(season.standings).filter(
            (r) => leagueTeamIds.has(r.teamId)
          );

          return (
            <div
              key={league.id}
              className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden"
            >
              <div
                className={`px-4 py-2.5 text-sm font-semibold ${
                  league.id === "central"
                    ? "bg-blue-950/50 text-blue-400"
                    : "bg-emerald-950/50 text-emerald-400"
                }`}
              >
                {league.name}
              </div>
              <table
                className="w-full"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-700">
                    <th className="text-left py-2 px-3 w-8">#</th>
                    <th className="text-left py-2 px-3">チーム</th>
                    <th className="text-right py-2 px-3">勝</th>
                    <th className="text-right py-2 px-3">敗</th>
                    <th className="text-right py-2 px-3">勝率</th>
                    <th className="text-right py-2 px-3">差</th>
                  </tr>
                </thead>
                <tbody>
                  {leagueStandings.map((record, i) => {
                    const team = game.teams[record.teamId];
                    const total = record.wins + record.losses;
                    const pct =
                      total > 0
                        ? (record.wins / total)
                            .toFixed(3)
                            .replace(/^0/, "")
                        : ".000";
                    const isMyTeam = record.teamId === game.myTeamId;
                    const topW = leagueStandings[0]?.wins ?? 0;
                    const topL = leagueStandings[0]?.losses ?? 0;
                    const gbVal =
                      (topW - record.wins + (record.losses - topL)) / 2;
                    const gb =
                      i === 0
                        ? "-"
                        : gbVal === Math.floor(gbVal)
                          ? `${gbVal}`
                          : gbVal.toFixed(1);

                    return (
                      <tr
                        key={record.teamId}
                        className={`border-b border-gray-700/30 text-sm ${
                          isMyTeam
                            ? "bg-blue-950/40"
                            : i % 2 === 1
                              ? "bg-gray-800/60"
                              : ""
                        }`}
                      >
                        <td className="py-2 px-3 text-gray-500 font-bold">
                          {i + 1}
                        </td>
                        <td className="py-2 px-3">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: team?.color }}
                            />
                            <span
                              className={`${isMyTeam ? "text-blue-400 font-bold" : "text-white"}`}
                            >
                              {team?.shortName}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-100">
                          {record.wins}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-100">
                          {record.losses}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-gray-100">
                          {pct}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-400">
                          {gb}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
        >
          タイトルに戻る
        </Link>
      </div>
    </div>
  );
}
