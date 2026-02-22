"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { POSITION_NAMES } from "@/models/player";
import type { Player } from "@/models/player";
import type { Team } from "@/models/team";
import {
  evaluatePlayerValue,
  evaluateTradeForCPU,
  executeTrade,
  type TradeProposal,
} from "@/engine/trade";

export default function TradePage() {
  const params = useParams();
  const { game, loadGame, setGame, saveGame } = useGameStore();
  const [targetTeamId, setTargetTeamId] = useState<string>("");
  const [offeredIds, setOfferedIds] = useState<Set<string>>(new Set());
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [tradeResult, setTradeResult] = useState<
    null | "accepted" | "rejected"
  >(null);

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  const otherTeams = useMemo(() => {
    if (!game) return [];
    return Object.values(game.teams).filter((t) => t.id !== game.myTeamId);
  }, [game]);

  useEffect(() => {
    if (otherTeams.length > 0 && !targetTeamId) {
      setTargetTeamId(otherTeams[0].id);
    }
  }, [otherTeams, targetTeamId]);

  const targetTeam = game?.teams[targetTeamId];
  const myTeam = game?.teams[game?.myTeamId ?? ""];

  const toggleOffered = (id: string) => {
    setTradeResult(null);
    setOfferedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRequested = (id: string) => {
    setTradeResult(null);
    setRequestedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const offeredValue = useMemo(() => {
    if (!myTeam) return 0;
    return myTeam.roster
      .filter((p) => offeredIds.has(p.id))
      .reduce((sum, p) => sum + evaluatePlayerValue(p), 0);
  }, [myTeam, offeredIds]);

  const requestedValue = useMemo(() => {
    if (!targetTeam) return 0;
    return targetTeam.roster
      .filter((p) => requestedIds.has(p.id))
      .reduce((sum, p) => sum + evaluatePlayerValue(p), 0);
  }, [targetTeam, requestedIds]);

  const handlePropose = useCallback(() => {
    if (!game || !targetTeamId || offeredIds.size === 0 || requestedIds.size === 0) return;

    const proposal: TradeProposal = {
      fromTeamId: game.myTeamId,
      toTeamId: targetTeamId,
      playersOffered: [...offeredIds],
      playersRequested: [...requestedIds],
    };

    const accepted = evaluateTradeForCPU(proposal, game.teams);
    if (accepted) {
      const newTeams = executeTrade(proposal, game.teams);
      const newGame = {
        ...game,
        teams: newTeams,
        updatedAt: new Date().toISOString(),
      };
      setGame(newGame);
      setTimeout(() => saveGame(), 50);
      setTradeResult("accepted");
      setOfferedIds(new Set());
      setRequestedIds(new Set());
    } else {
      setTradeResult("rejected");
    }
  }, [game, targetTeamId, offeredIds, requestedIds, setGame, saveGame]);

  if (!game) return <div className="p-8 text-gray-400">読み込み中...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/game/${params.id}`}
          className="text-gray-400 hover:text-white"
        >
          &larr; 戻る
        </Link>
        <h1 className="text-2xl font-bold">トレード</h1>
      </div>

      {/* 相手チーム選択 */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">
          トレード相手チーム
        </label>
        <div className="flex gap-2 flex-wrap">
          {otherTeams.map((team) => (
            <button
              key={team.id}
              onClick={() => {
                setTargetTeamId(team.id);
                setRequestedIds(new Set());
                setTradeResult(null);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                targetTeamId === team.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: team.color }}
              />
              {team.shortName}
            </button>
          ))}
        </div>
      </div>

      {/* トレード結果表示 */}
      {tradeResult && (
        <div
          className={`mb-4 p-3 rounded-lg text-center font-bold ${
            tradeResult === "accepted"
              ? "bg-green-900/50 text-green-400 border border-green-700"
              : "bg-red-900/50 text-red-400 border border-red-700"
          }`}
        >
          {tradeResult === "accepted"
            ? "トレード成立！"
            : "トレードは拒否されました"}
        </div>
      )}

      {/* 価値バー */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6 border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">提示価値</span>
          <span className="text-sm text-gray-400">要求価値</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1 text-right">
            <span className="text-xl font-bold text-blue-400">{offeredValue}</span>
          </div>
          <div className="text-gray-500">vs</div>
          <div className="flex-1 text-left">
            <span className="text-xl font-bold text-red-400">{requestedValue}</span>
          </div>
        </div>
        <div className="text-center mt-2 text-xs text-gray-500">
          {offeredValue >= requestedValue * 0.9
            ? "CPU受諾の可能性: 高"
            : offeredValue >= requestedValue * 0.7
            ? "CPU受諾の可能性: 中"
            : "CPU受諾の可能性: 低"}
        </div>
        <div className="text-center mt-3">
          <button
            onClick={handlePropose}
            disabled={offeredIds.size === 0 || requestedIds.size === 0}
            className="px-8 py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-bold transition-colors"
          >
            トレードを提案
          </button>
        </div>
      </div>

      {/* 両チームの選手一覧 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 自チーム */}
        <div>
          <h2 className="text-lg font-semibold mb-3 text-blue-400">
            {myTeam?.name} (提示選手を選択)
          </h2>
          <PlayerList
            players={myTeam?.roster ?? []}
            selectedIds={offeredIds}
            onToggle={toggleOffered}
          />
        </div>

        {/* 相手チーム */}
        <div>
          <h2 className="text-lg font-semibold mb-3 text-red-400">
            {targetTeam?.name} (要求選手を選択)
          </h2>
          <PlayerList
            players={targetTeam?.roster ?? []}
            selectedIds={requestedIds}
            onToggle={toggleRequested}
          />
        </div>
      </div>
    </div>
  );
}

function PlayerList({
  players,
  selectedIds,
  onToggle,
}: {
  players: Player[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const sorted = useMemo(
    () =>
      [...players].sort(
        (a, b) => evaluatePlayerValue(b) - evaluatePlayerValue(a)
      ),
    [players]
  );

  return (
    <div className="overflow-auto max-h-[400px] bg-gray-800 rounded-lg border border-gray-700">
      <table
        className="w-full whitespace-nowrap text-sm"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-900 text-xs text-gray-400 border-b-2 border-gray-600">
            <th className="py-2 px-2 w-8"></th>
            <th className="py-2 px-2 text-left">名前</th>
            <th className="py-2 px-2 text-center">位置</th>
            <th className="py-2 px-2 text-right">年齢</th>
            <th className="py-2 px-2 text-right">価値</th>
            <th className="py-2 px-2 text-center">潜在</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const selected = selectedIds.has(p.id);
            return (
              <tr
                key={p.id}
                onClick={() => onToggle(p.id)}
                className={`border-b border-gray-700/30 cursor-pointer transition-colors ${
                  selected
                    ? "bg-blue-900/40 border-l-2 border-l-blue-400"
                    : i % 2 === 1
                    ? "bg-gray-800/60 hover:bg-gray-700/40"
                    : "hover:bg-gray-700/40"
                }`}
              >
                <td className="py-2 px-2 text-center">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(p.id)}
                    className="rounded bg-gray-700 border-gray-600"
                  />
                </td>
                <td className="py-2 px-2 text-white font-medium">{p.name}</td>
                <td className="py-2 px-2 text-center text-gray-300">
                  {POSITION_NAMES[p.position]}
                </td>
                <td className="py-2 px-2 text-right text-gray-300">{p.age}</td>
                <td className="py-2 px-2 text-right font-bold text-gray-100">
                  {evaluatePlayerValue(p)}
                </td>
                <td
                  className={`py-2 px-2 text-center font-bold ${
                    p.potential.overall === "S"
                      ? "text-red-500"
                      : p.potential.overall === "A"
                      ? "text-red-400"
                      : p.potential.overall === "B"
                      ? "text-orange-400"
                      : p.potential.overall === "C"
                      ? "text-yellow-400"
                      : "text-lime-400"
                  }`}
                >
                  {p.potential.overall}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
