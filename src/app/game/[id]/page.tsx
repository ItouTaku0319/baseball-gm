"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { sortStandings } from "@/engine/season";
import { getActivePlayoffSeries } from "@/engine/playoffs";
import { calculateAwards } from "@/engine/awards";
import { processContractRenewal } from "@/engine/offseason";
import { runSpringCamp, type CampReport } from "@/engine/preseason";
import { initDraft } from "@/engine/draft";
import { createSeason } from "@/engine/season";
import { autoConfigureLineup } from "@/engine/lineup";
import type { PlayoffSeries } from "@/models/league";
import type { OffseasonPhase } from "@/models/game-state";

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
    simPlayoffGame,
    simAllPlayoffs,
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

  const phaseLabel: Record<string, string> = {
    preseason: "プレシーズン",
    regular_season: "レギュラーシーズン",
    climax_first: "CS 1stステージ",
    climax_final: "CS Finalステージ",
    japan_series: "日本シリーズ",
    offseason: "オフシーズン",
  };

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

  const isPostseason =
    season.phase === "climax_first" ||
    season.phase === "climax_final" ||
    season.phase === "japan_series";

  const activeSeries = isPostseason ? getActivePlayoffSeries(game) : [];

  const menuItems = [
    {
      href: `/game/${game.id}/lineup`,
      label: "打順・ローテ",
      desc: "打順・先発ローテ・リリーフ設定",
    },
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
    {
      href: `/game/${game.id}/analytics`,
      label: "打球分析",
      desc: "打球データ・バランス診断",
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
            {season.year}年シーズン / {phaseLabel[season.phase] ?? season.phase}
          </p>
        </div>
        {season.phase === "regular_season" && (
          <div
            className="text-right text-sm text-gray-400"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            第{currentDay}日 / {totalDays}日
          </div>
        )}
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
          <PreseasonPanel game={game} onStartSeason={startSeason} />
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

            {/* 自チーム次の試合 */}
            {myNextGame && (
              <div className="mb-5 p-5 bg-gray-700/50 rounded-lg border border-gray-600">
                <div className="text-xs text-gray-400 mb-3 text-center">
                  自チーム次の試合
                </div>
                <div className="flex items-center justify-center gap-5 text-xl mb-4">
                  <TeamBadge
                    teamId={myNextGame.awayTeamId}
                    teams={game.teams}
                    myTeamId={game.myTeamId}
                  />
                  <span className="text-gray-500 text-base">vs</span>
                  <TeamBadge
                    teamId={myNextGame.homeTeamId}
                    teams={game.teams}
                    myTeamId={game.myTeamId}
                  />
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

        {/* ポストシーズン */}
        {isPostseason && (
          <div>
            <h3 className="text-xl font-bold text-center mb-4 text-yellow-400">
              {phaseLabel[season.phase]}
            </h3>

            {/* シリーズ一覧 */}
            <div className="space-y-4 mb-6">
              {activeSeries.map((series) => (
                <PlayoffSeriesCard
                  key={series.id}
                  series={series}
                  teams={game.teams}
                  myTeamId={game.myTeamId}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={simPlayoffGame}
                className="py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition-colors"
              >
                次の1試合
              </button>
              <button
                onClick={simAllPlayoffs}
                className="py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold transition-colors"
              >
                全試合一括
              </button>
            </div>
          </div>
        )}

        {season.phase === "offseason" && (
          <OffseasonPanel game={game} />
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

      {/* 順位表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

// ── Preseason Panel ──

function PreseasonPanel({
  game,
  onStartSeason,
}: {
  game: import("@/models/game-state").GameState;
  onStartSeason: () => void;
}) {
  const { setGame, saveGame } = useGameStore();
  const [campReport, setCampReport] = useState<CampReport | null>(null);
  const [campDone, setCampDone] = useState(false);

  const handleCamp = () => {
    const result = runSpringCamp(game);
    setGame(result.state);
    setTimeout(() => saveGame(), 50);
    const myReport = result.reports[game.myTeamId];
    setCampReport(myReport || { improvements: [], declines: [] });
    setCampDone(true);
  };

  return (
    <div className="text-center">
      <p className="text-xl font-bold mb-2">
        {game.currentSeason.year}年 プレシーズン
      </p>

      {!campDone ? (
        <div>
          <p className="text-gray-300 mb-4">
            春季キャンプで選手の成長・衰退が適用されます
          </p>
          <button
            onClick={handleCamp}
            className="px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-bold text-lg transition-colors"
          >
            春季キャンプ開始
          </button>
        </div>
      ) : (
        <div>
          {campReport && (
            <div className="mb-4 text-left max-w-lg mx-auto">
              {campReport.improvements.length > 0 && (
                <div className="mb-3 p-3 bg-green-900/20 rounded-lg border border-green-900/50">
                  <h4 className="text-sm font-semibold text-green-400 mb-1">成長</h4>
                  <div className="space-y-0.5">
                    {campReport.improvements.slice(0, 8).map((item, i) => (
                      <div key={i} className="text-sm text-gray-300">
                        <span className="text-white">{item.playerName}</span>{" "}
                        <span className="text-green-400">{item.detail}</span>
                      </div>
                    ))}
                    {campReport.improvements.length > 8 && (
                      <div className="text-xs text-gray-500">
                        ...他{campReport.improvements.length - 8}人
                      </div>
                    )}
                  </div>
                </div>
              )}
              {campReport.declines.length > 0 && (
                <div className="mb-3 p-3 bg-red-900/20 rounded-lg border border-red-900/50">
                  <h4 className="text-sm font-semibold text-red-400 mb-1">衰退</h4>
                  <div className="space-y-0.5">
                    {campReport.declines.slice(0, 5).map((item, i) => (
                      <div key={i} className="text-sm text-gray-300">
                        <span className="text-white">{item.playerName}</span>{" "}
                        <span className="text-red-400">{item.detail}</span>
                      </div>
                    ))}
                    {campReport.declines.length > 5 && (
                      <div className="text-xs text-gray-500">
                        ...他{campReport.declines.length - 5}人
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-gray-300 mb-4">シーズン開始の準備が整いました</p>
          <div className="flex gap-3 justify-center">
            <Link
              href={`/game/${game.id}/lineup`}
              className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition-colors"
            >
              打順・ローテ確認
            </Link>
            <Link
              href={`/game/${game.id}/roster`}
              className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition-colors"
            >
              ロスター確認
            </Link>
            <button
              onClick={onStartSeason}
              className="px-8 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg transition-colors"
            >
              シーズン開始
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Offseason Panel ──

function OffseasonPanel({ game }: { game: import("@/models/game-state").GameState }) {
  const { setGame, saveGame } = useGameStore();
  const offState = game.offseasonState;
  const currentPhase: OffseasonPhase = offState?.phase ?? "awards";
  const season = game.currentSeason;
  const myRecord = season.standings[game.myTeamId];

  const phases: { key: OffseasonPhase; label: string }[] = [
    { key: "awards", label: "表彰式" },
    { key: "contract", label: "契約更改" },
    { key: "draft", label: "ドラフト" },
    { key: "completed", label: "完了" },
  ];

  const handleAwards = () => {
    const awards = calculateAwards(game);
    const newGame = {
      ...game,
      offseasonState: {
        ...offState,
        phase: "awards" as const,
        awards,
      },
      awardsHistory: [...(game.awardsHistory || []), awards],
      updatedAt: new Date().toISOString(),
    };
    setGame(newGame);
    setTimeout(() => saveGame(), 50);
  };

  const handleContracts = () => {
    const result = processContractRenewal(game);
    const newGame = {
      ...result.state,
      offseasonState: {
        ...game.offseasonState,
        phase: "contract" as const,
        contractResults: { retired: result.retired, renewed: result.renewed },
      },
    };
    setGame(newGame);
    setTimeout(() => saveGame(), 50);
  };

  const handleGoToDraft = () => {
    const standings = sortStandings(game.currentSeason.standings);
    const draftState = initDraft(standings, 5);
    const newGame = {
      ...game,
      offseasonState: {
        ...game.offseasonState,
        phase: "draft" as const,
        draftState,
      },
      updatedAt: new Date().toISOString(),
    };
    setGame(newGame);
    setTimeout(() => saveGame(), 50);
  };

  const handleComplete = () => {
    const newGame = {
      ...game,
      offseasonState: {
        ...game.offseasonState,
        phase: "completed" as const,
      },
      updatedAt: new Date().toISOString(),
    };
    setGame(newGame);
    setTimeout(() => saveGame(), 50);
  };

  return (
    <div>
      <p className="text-2xl font-bold mb-2 text-center">オフシーズン</p>
      <div
        className="text-center text-lg mb-4"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {season.year}年 最終成績: {myRecord?.wins ?? 0}勝 {myRecord?.losses ?? 0}敗{" "}
        {myRecord?.draws ?? 0}分
      </div>

      {/* 日本シリーズ結果 */}
      {season.playoffs && (() => {
        const js = season.playoffs.find((s) => s.type === "japan_series");
        if (!js?.winnerId) return null;
        const winnerTeam = game.teams[js.winnerId];
        return (
          <div className="mb-4 p-3 bg-yellow-900/30 rounded-lg border border-yellow-700/50 text-center">
            <span className="text-yellow-400 font-bold">日本シリーズ優勝: </span>
            <span
              className="w-3 h-3 rounded-full inline-block mx-1"
              style={{ backgroundColor: winnerTeam?.color }}
            />
            <span className="font-bold text-white">{winnerTeam?.name}</span>
            <span className="text-gray-400 text-sm ml-2">
              ({js.team1Wins}-{js.team2Wins})
            </span>
          </div>
        );
      })()}

      {/* プログレス */}
      <div className="flex gap-1 mb-6">
        {phases.map((p) => (
          <div
            key={p.key}
            className={`flex-1 text-center py-2 rounded text-sm font-semibold ${
              currentPhase === p.key
                ? "bg-blue-600 text-white"
                : phases.findIndex((x) => x.key === currentPhase) >
                  phases.findIndex((x) => x.key === p.key)
                ? "bg-green-900/50 text-green-400"
                : "bg-gray-700 text-gray-500"
            }`}
          >
            {p.label}
          </div>
        ))}
      </div>

      {/* 各ステップの内容 */}
      {(!offState || !offState.awards) && currentPhase === "awards" && (
        <div className="text-center">
          <p className="text-gray-300 mb-4">シーズンタイトルの発表</p>
          <button
            onClick={handleAwards}
            className="px-8 py-3 bg-yellow-600 hover:bg-yellow-500 rounded-lg font-bold text-lg transition-colors"
          >
            表彰式を開始
          </button>
        </div>
      )}

      {offState?.awards && currentPhase === "awards" && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {["central", "pacific"].map((leagueId) => {
              const leagueAwards =
                leagueId === "central" ? offState.awards!.central : offState.awards!.pacific;
              return (
                <div key={leagueId} className="bg-gray-700/30 rounded-lg p-3">
                  <h4 className={`text-sm font-semibold mb-2 ${
                    leagueId === "central" ? "text-blue-400" : "text-emerald-400"
                  }`}>
                    {leagueId === "central" ? "セ・リーグ" : "パ・リーグ"}
                  </h4>
                  <div className="space-y-1">
                    {leagueAwards.map((a) => (
                      <div key={a.title} className="text-sm flex justify-between">
                        <span className="text-gray-400">{a.title}</span>
                        <span className="text-white">
                          {a.playerName}{" "}
                          <span className="text-gray-500">{a.value}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {offState.awards!.japanSeriesMvp && (
            <div className="text-center mb-4 text-sm">
              <span className="text-yellow-400">日本シリーズMVP: </span>
              <span className="text-white">{offState.awards!.japanSeriesMvp.playerName}</span>
            </div>
          )}
          <div className="text-center">
            <button
              onClick={handleContracts}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors"
            >
              契約更改へ
            </button>
          </div>
        </div>
      )}

      {currentPhase === "contract" && (
        <div>
          {offState?.contractResults ? (
            <div>
              {offState.contractResults.retired.length > 0 && (
                <div className="mb-4 p-3 bg-red-900/20 rounded-lg border border-red-900/50">
                  <h4 className="text-sm font-semibold text-red-400 mb-1">退団選手</h4>
                  <p className="text-sm text-gray-300">
                    {offState.contractResults.retired.join("、")}
                  </p>
                </div>
              )}
              {offState.contractResults.renewed.length > 0 && (
                <div className="mb-4 p-3 bg-blue-900/20 rounded-lg border border-blue-900/50">
                  <h4 className="text-sm font-semibold text-blue-400 mb-1">契約更新</h4>
                  <p className="text-sm text-gray-300">
                    {offState.contractResults.renewed.join("、")}
                  </p>
                </div>
              )}
              <p className="text-gray-400 text-sm mb-4 text-center">
                全選手の加齢・成長/衰退が適用されました
              </p>
              <div className="text-center">
                <button
                  onClick={handleGoToDraft}
                  className="px-8 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition-colors"
                >
                  ドラフトへ
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-gray-300 mb-4">契約更改と選手の加齢処理を行います</p>
              <button
                onClick={handleContracts}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors"
              >
                契約更改を実行
              </button>
            </div>
          )}
        </div>
      )}

      {currentPhase === "draft" && (
        <div className="text-center">
          <p className="text-gray-300 mb-4">
            ドラフト画面で新人選手を指名しましょう
          </p>
          <Link
            href={`/game/${game.id}/draft`}
            className="inline-block px-8 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition-colors"
          >
            ドラフト画面へ
          </Link>
          <button
            onClick={handleComplete}
            className="block mx-auto mt-3 px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
          >
            ドラフトをスキップ
          </button>
        </div>
      )}

      {currentPhase === "completed" && (
        <div className="text-center">
          <p className="text-gray-300 mb-4">
            オフシーズンの全工程が完了しました。次のシーズンに進みましょう。
          </p>
          <button
            onClick={() => {
              // 翌シーズンに遷移
              const nextYear = game.currentSeason.year + 1;
              const newSeason = createSeason(nextYear, game.currentSeason.leagues);
              // 全チームのlineupConfigを再構成
              const newTeams = { ...game.teams };
              for (const [teamId, team] of Object.entries(newTeams)) {
                newTeams[teamId] = {
                  ...team,
                  lineupConfig: autoConfigureLineup(team),
                };
              }
              const newGame = {
                ...game,
                teams: newTeams,
                currentSeason: newSeason,
                seasonHistory: [...game.seasonHistory, game.currentSeason],
                offseasonState: undefined,
                updatedAt: new Date().toISOString(),
              };
              setGame(newGame);
              setTimeout(() => saveGame(), 50);
            }}
            className="px-8 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg transition-colors"
          >
            {game.currentSeason.year + 1}年シーズンへ
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helper Components ──

function TeamBadge({
  teamId,
  teams,
  myTeamId,
}: {
  teamId: string;
  teams: Record<string, import("@/models/team").Team>;
  myTeamId: string;
}) {
  const team = teams[teamId];
  const isMy = teamId === myTeamId;
  return (
    <span
      className={`flex items-center gap-2 ${
        isMy ? "text-blue-400 font-bold" : "text-white"
      }`}
    >
      <span
        className="w-4 h-4 rounded-full"
        style={{ backgroundColor: team?.color }}
      />
      {team?.shortName}
    </span>
  );
}

function PlayoffSeriesCard({
  series,
  teams,
  myTeamId,
}: {
  series: PlayoffSeries;
  teams: Record<string, import("@/models/team").Team>;
  myTeamId: string;
}) {
  const team1 = teams[series.team1Id];
  const team2 = teams[series.team2Id];
  const isFinished = !!series.winnerId;

  const seriesTypeLabel: Record<string, string> = {
    climax_first_central: "CS 1st セ・リーグ",
    climax_first_pacific: "CS 1st パ・リーグ",
    climax_final_central: "CS Final セ・リーグ",
    climax_final_pacific: "CS Final パ・リーグ",
    japan_series: "日本シリーズ",
  };

  const playedGames = series.games.filter((g) => g.result).length;

  return (
    <div
      className={`p-4 rounded-lg border ${
        isFinished
          ? "bg-gray-700/30 border-gray-600"
          : "bg-gray-700/50 border-yellow-700/50"
      }`}
    >
      <div className="text-xs text-gray-400 mb-2">
        {seriesTypeLabel[series.type] ?? series.type}
        {series.team1Advantage > 0 && (
          <span className="ml-2 text-yellow-500">
            ({team1?.shortName}に{series.team1Advantage}勝アドバンテージ)
          </span>
        )}
      </div>

      <div
        className="flex items-center justify-between"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: team1?.color }}
          />
          <span
            className={`font-semibold ${
              series.team1Id === myTeamId ? "text-blue-400" : "text-white"
            } ${series.winnerId === series.team1Id ? "underline" : ""}`}
          >
            {team1?.shortName}
          </span>
        </div>
        <div className="text-2xl font-bold font-mono">
          <span
            className={
              series.team1Wins > series.team2Wins
                ? "text-blue-400"
                : "text-gray-300"
            }
          >
            {series.team1Wins}
          </span>
          <span className="text-gray-500 mx-2">-</span>
          <span
            className={
              series.team2Wins > series.team1Wins
                ? "text-blue-400"
                : "text-gray-300"
            }
          >
            {series.team2Wins}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`font-semibold ${
              series.team2Id === myTeamId ? "text-blue-400" : "text-white"
            } ${series.winnerId === series.team2Id ? "underline" : ""}`}
          >
            {team2?.shortName}
          </span>
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: team2?.color }}
          />
        </div>
      </div>

      {/* 試合結果一覧 */}
      {playedGames > 0 && (
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {series.games
            .filter((g) => g.result)
            .map((g, gi) => {
              const r = g.result!;
              const team1IsHome = g.homeTeamId === series.team1Id;
              const team1Score = team1IsHome ? r.homeScore : r.awayScore;
              const team2Score = team1IsHome ? r.awayScore : r.homeScore;
              return (
                <span
                  key={gi}
                  className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  G{gi + 1}: {team1Score}-{team2Score}
                </span>
              );
            })}
        </div>
      )}

      {isFinished && (
        <div className="mt-2 text-sm text-yellow-400 font-semibold">
          {teams[series.winnerId!]?.shortName} 勝利
        </div>
      )}
    </div>
  );
}
