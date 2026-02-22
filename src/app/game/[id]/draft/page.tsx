"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { POSITION_NAMES, THROW_HAND_NAMES, BAT_SIDE_NAMES } from "@/models/player";
import type { Player } from "@/models/player";
import type { DraftState, DraftPick } from "@/engine/draft";
import {
  initDraft,
  getCurrentPickTeam,
  makePick,
  autoPickForCPU,
} from "@/engine/draft";
import { sortStandings } from "@/engine/season";

type SortKey = "overall" | "age" | "contact" | "power" | "speed" | "velocity";

export default function DraftPage() {
  const params = useParams();
  const { game, loadGame, setGame, saveGame } = useGameStore();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [filterPitcher, setFilterPitcher] = useState<"all" | "pitcher" | "batter">("all");
  const [autoRunning, setAutoRunning] = useState(false);

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  // ドラフトが保存されている場合復元、なければ初期化
  useEffect(() => {
    if (game && !draft) {
      if (game.offseasonState?.draftState) {
        setDraft(game.offseasonState.draftState);
      } else if (game.currentSeason.phase === "offseason") {
        const standings = sortStandings(game.currentSeason.standings);
        const newDraft = initDraft(standings, 5);
        setDraft(newDraft);
      }
    }
  }, [game, draft]);

  const saveDraftState = useCallback(
    (d: DraftState) => {
      if (!game) return;
      const newGame = {
        ...game,
        offseasonState: {
          ...(game.offseasonState || { phase: "draft" as const }),
          draftState: d,
        },
        updatedAt: new Date().toISOString(),
      };
      setGame(newGame);
      setTimeout(() => saveGame(), 50);
    },
    [game, setGame, saveGame]
  );

  const handlePick = useCallback(
    (playerId: string) => {
      if (!draft || !game) return;
      const newDraft = makePick(draft, playerId);
      setDraft(newDraft);

      // 指名した選手をチームに追加
      const pickedPlayer = draft.prospects.find((p) => p.id === playerId);
      if (pickedPlayer) {
        const currentTeamId = getCurrentPickTeam(draft);
        if (currentTeamId) {
          const team = game.teams[currentTeamId];
          const newTeams = {
            ...game.teams,
            [currentTeamId]: {
              ...team,
              roster: [...team.roster, pickedPlayer],
              rosterLevels: {
                ...(team.rosterLevels || {}),
                [pickedPlayer.id]: "ni_gun" as const,
              },
            },
          };
          const newGame = {
            ...game,
            teams: newTeams,
            offseasonState: {
              ...(game.offseasonState || { phase: "draft" as const }),
              draftState: newDraft,
            },
            updatedAt: new Date().toISOString(),
          };
          setGame(newGame);
          setTimeout(() => saveGame(), 50);
        }
      }
    },
    [draft, game, setGame, saveGame]
  );

  const runCPUPicks = useCallback(() => {
    if (!draft || !game) return;
    let currentDraft = draft;
    let currentTeams = { ...game.teams };

    // CPUの番が続く限り自動指名
    while (true) {
      const teamId = getCurrentPickTeam(currentDraft);
      if (!teamId) break;
      if (teamId === game.myTeamId) break;

      const prevDraft = currentDraft;
      const bestPlayer = [...currentDraft.prospects].sort((a, b) => {
        const aScore = a.isPitcher
          ? (((a.pitching?.velocity ?? 120) - 120) / 45) * 100 + (a.pitching?.control ?? 0)
          : a.batting.contact + a.batting.power + a.batting.speed;
        const bScore = b.isPitcher
          ? (((b.pitching?.velocity ?? 120) - 120) / 45) * 100 + (b.pitching?.control ?? 0)
          : b.batting.contact + b.batting.power + b.batting.speed;
        return bScore - aScore;
      })[0];

      if (!bestPlayer) break;

      currentDraft = makePick(currentDraft, bestPlayer.id);

      // チームに追加
      const team = currentTeams[teamId];
      currentTeams = {
        ...currentTeams,
        [teamId]: {
          ...team,
          roster: [...team.roster, bestPlayer],
          rosterLevels: {
            ...(team.rosterLevels || {}),
            [bestPlayer.id]: "ni_gun" as const,
          },
        },
      };
    }

    setDraft(currentDraft);
    const newGame = {
      ...game,
      teams: currentTeams,
      offseasonState: {
        ...(game.offseasonState || { phase: "draft" as const }),
        draftState: currentDraft,
      },
      updatedAt: new Date().toISOString(),
    };
    setGame(newGame);
    setTimeout(() => saveGame(), 50);
  }, [draft, game, setGame, saveGame]);

  // 自チームの番でない場合はCPUを自動進行
  useEffect(() => {
    if (!draft || !game) return;
    const teamId = getCurrentPickTeam(draft);
    if (teamId && teamId !== game.myTeamId) {
      const timer = setTimeout(runCPUPicks, 300);
      return () => clearTimeout(timer);
    }
  }, [draft, game, runCPUPicks]);

  if (!game) return <div className="p-8 text-gray-400">読み込み中...</div>;

  if (game.currentSeason.phase !== "offseason" && !draft) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href={`/game/${params.id}`} className="text-gray-400 hover:text-white">
            &larr; 戻る
          </Link>
          <h1 className="text-2xl font-bold">ドラフト</h1>
        </div>
        <div className="p-8 bg-gray-800/50 rounded-lg border border-dashed border-gray-600 text-center">
          <p className="text-gray-400 text-lg">オフシーズンになるとドラフトが開始されます</p>
        </div>
      </div>
    );
  }

  if (!draft) return <div className="p-8 text-gray-400">読み込み中...</div>;

  const currentPickTeamId = getCurrentPickTeam(draft);
  const isMyPick = currentPickTeamId === game.myTeamId;
  const isDraftOver = !currentPickTeamId;
  const currentRound = Math.floor(draft.currentPickIndex / draft.pickOrder.length) + 1;
  const currentPickInRound = (draft.currentPickIndex % draft.pickOrder.length) + 1;

  // 候補一覧のソート
  const sortedProspects = [...draft.prospects]
    .filter((p) => {
      if (filterPitcher === "pitcher") return p.isPitcher;
      if (filterPitcher === "batter") return !p.isPitcher;
      return true;
    })
    .sort((a, b) => {
      switch (sortKey) {
        case "overall":
          return getOverall(b) - getOverall(a);
        case "age":
          return a.age - b.age;
        case "contact":
          return b.batting.contact - a.batting.contact;
        case "power":
          return b.batting.power - a.batting.power;
        case "speed":
          return b.batting.speed - a.batting.speed;
        case "velocity":
          return (b.pitching?.velocity ?? 0) - (a.pitching?.velocity ?? 0);
        default:
          return 0;
      }
    });

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/game/${params.id}`} className="text-gray-400 hover:text-white">
          &larr; 戻る
        </Link>
        <h1 className="text-2xl font-bold">ドラフト</h1>
        <span className="text-gray-400 text-sm">
          {game.currentSeason.year}年
        </span>
      </div>

      {/* ステータスバー */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6 border border-gray-700 flex items-center justify-between">
        <div>
          <span className="text-sm text-gray-400">
            第{currentRound}巡 / {currentPickInRound}番目
          </span>
          {currentPickTeamId && (
            <span className="ml-3 font-semibold">
              <span
                className="w-3 h-3 rounded-full inline-block mr-1"
                style={{ backgroundColor: game.teams[currentPickTeamId]?.color }}
              />
              {game.teams[currentPickTeamId]?.shortName}の番
            </span>
          )}
        </div>
        {isMyPick && (
          <span className="text-green-400 font-bold animate-pulse">
            あなたの指名番です！
          </span>
        )}
        {isDraftOver && (
          <span className="text-yellow-400 font-bold">ドラフト終了</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 候補一覧 (2/3) */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold">
              候補選手 ({draft.prospects.length})
            </h2>
            <div className="flex gap-1 ml-auto">
              {(
                [
                  ["all", "全員"],
                  ["pitcher", "投手"],
                  ["batter", "野手"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilterPitcher(key)}
                  className={`px-3 py-1 rounded text-sm ${
                    filterPitcher === key
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-auto max-h-[500px] bg-gray-800 rounded-lg border border-gray-700">
            <table
              className="w-full whitespace-nowrap text-sm"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-900 text-xs text-gray-400 border-b-2 border-gray-600">
                  <th className="py-2 px-3 text-left">名前</th>
                  <th
                    className="py-2 px-3 text-right cursor-pointer hover:text-blue-300"
                    onClick={() => setSortKey("age")}
                  >
                    年齢
                  </th>
                  <th className="py-2 px-3 text-center">位置</th>
                  <th
                    className="py-2 px-3 text-right cursor-pointer hover:text-blue-300"
                    onClick={() => setSortKey("overall")}
                  >
                    総合
                  </th>
                  <th
                    className="py-2 px-3 text-right cursor-pointer hover:text-blue-300"
                    onClick={() => setSortKey("contact")}
                  >
                    ミート
                  </th>
                  <th
                    className="py-2 px-3 text-right cursor-pointer hover:text-blue-300"
                    onClick={() => setSortKey("power")}
                  >
                    パワー
                  </th>
                  <th
                    className="py-2 px-3 text-right cursor-pointer hover:text-blue-300"
                    onClick={() => setSortKey("speed")}
                  >
                    走力
                  </th>
                  <th
                    className="py-2 px-3 text-right cursor-pointer hover:text-blue-300"
                    onClick={() => setSortKey("velocity")}
                  >
                    球速
                  </th>
                  <th className="py-2 px-3 text-center">潜在</th>
                  {isMyPick && <th className="py-2 px-3 text-center">指名</th>}
                </tr>
              </thead>
              <tbody>
                {sortedProspects.map((p, i) => (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-700/30 hover:bg-gray-700/40 ${
                      i % 2 === 1 ? "bg-gray-800/60" : ""
                    }`}
                  >
                    <td className="py-2 px-3 text-white font-medium">{p.name}</td>
                    <td className="py-2 px-3 text-right text-gray-300">{p.age}</td>
                    <td className="py-2 px-3 text-center text-gray-300">
                      {POSITION_NAMES[p.position]}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-100 font-bold">
                      {getOverall(p)}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-300">
                      {p.isPitcher ? "-" : p.batting.contact}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-300">
                      {p.isPitcher ? "-" : p.batting.power}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-300">
                      {p.isPitcher ? "-" : p.batting.speed}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-300">
                      {p.isPitcher ? `${p.pitching?.velocity}km` : "-"}
                    </td>
                    <td className={`py-2 px-3 text-center font-bold ${
                      p.potential.overall === "S" ? "text-red-500" :
                      p.potential.overall === "A" ? "text-red-400" :
                      p.potential.overall === "B" ? "text-orange-400" :
                      p.potential.overall === "C" ? "text-yellow-400" :
                      "text-lime-400"
                    }`}>
                      {p.potential.overall}
                    </td>
                    {isMyPick && (
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => handlePick(p.id)}
                          className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-xs font-bold"
                        >
                          指名
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 指名履歴 (1/3) */}
        <div>
          <h2 className="text-lg font-semibold mb-3">指名履歴</h2>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-auto max-h-[500px]">
            {draft.picks.length === 0 ? (
              <div className="p-4 text-gray-500 text-sm text-center">
                まだ指名がありません
              </div>
            ) : (
              <div className="divide-y divide-gray-700/30">
                {[...draft.picks].reverse().map((pick) => {
                  const team = game.teams[pick.teamId];
                  // Find the player from the teams roster (already added)
                  let pickedPlayer: Player | undefined;
                  for (const t of Object.values(game.teams)) {
                    pickedPlayer = t.roster.find((p) => p.id === pick.playerId);
                    if (pickedPlayer) break;
                  }
                  return (
                    <div key={pick.pickNumber} className="px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 w-6">
                          {pick.round}-{((pick.pickNumber - 1) % draft.pickOrder.length) + 1}
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: team?.color }}
                        />
                        <span className={`${pick.teamId === game.myTeamId ? "text-blue-400 font-bold" : "text-gray-300"}`}>
                          {team?.shortName}
                        </span>
                      </div>
                      <div className="ml-8 text-white">
                        {pickedPlayer?.name ?? "?"}{" "}
                        <span className="text-gray-500">
                          ({pickedPlayer ? POSITION_NAMES[pickedPlayer.position] : "?"})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getOverall(p: Player): number {
  if (p.isPitcher) {
    return Math.round(
      (((p.pitching?.velocity ?? 120) - 120) / 45) * 40 +
        (p.pitching?.control ?? 0) * 0.3 +
        (p.pitching?.stamina ?? 0) * 0.15
    );
  }
  return Math.round(
    p.batting.contact * 0.3 +
      p.batting.power * 0.3 +
      p.batting.speed * 0.15 +
      p.batting.eye * 0.15 +
      p.batting.fielding * 0.1
  );
}
