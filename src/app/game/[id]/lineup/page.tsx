"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { POSITION_NAMES } from "@/models/player";
import type { Player } from "@/models/player";
import type { TeamLineupConfig } from "@/models/team";
import { autoConfigureLineup, getIchiGunPlayers } from "@/engine/lineup";

type Tab = "batting" | "rotation" | "bullpen";

export default function LineupPage() {
  const params = useParams();
  const { game, loadGame, setGame, saveGame } = useGameStore();
  const [tab, setTab] = useState<Tab>("batting");
  const [config, setConfig] = useState<TeamLineupConfig | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  useEffect(() => {
    if (game) {
      const myTeam = game.teams[game.myTeamId];
      setConfig(myTeam.lineupConfig ?? autoConfigureLineup(myTeam));
    }
  }, [game]);

  const handleSave = useCallback(() => {
    if (!game || !config) return;
    const myTeam = game.teams[game.myTeamId];
    const newGame = {
      ...game,
      teams: {
        ...game.teams,
        [game.myTeamId]: { ...myTeam, lineupConfig: config },
      },
      updatedAt: new Date().toISOString(),
    };
    setGame(newGame);
    setTimeout(() => saveGame(), 50);
    setDirty(false);
  }, [game, config, setGame, saveGame]);

  const handleAutoConfig = useCallback(() => {
    if (!game) return;
    const myTeam = game.teams[game.myTeamId];
    const auto = autoConfigureLineup(myTeam);
    setConfig(auto);
    setDirty(true);
  }, [game]);

  if (!game || !config)
    return <div className="p-8 text-gray-400">読み込み中...</div>;

  const myTeam = game.teams[game.myTeamId];
  const activePlayers = getIchiGunPlayers(myTeam);
  const pitchers = activePlayers.filter((p) => p.isPitcher);
  const batters = activePlayers.filter((p) => !p.isPitcher);

  const playerMap = new Map(myTeam.roster.map((p) => [p.id, p]));

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/game/${game.id}`}
          className="text-gray-400 hover:text-white"
        >
          &larr; 戻る
        </Link>
        <h1 className="text-2xl font-bold">打順・ローテーション</h1>
        <div className="flex items-center gap-2 text-gray-400">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: myTeam.color }}
          />
          <span>{myTeam.name}</span>
        </div>
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-4">
        {(
          [
            ["batting", "打順"],
            ["rotation", "先発ローテ"],
            ["bullpen", "リリーフ"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2.5 rounded-lg font-semibold transition-colors ${
              tab === key
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* アクションボタン */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={handleAutoConfig}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
        >
          自動設定
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            dirty
              ? "bg-green-600 hover:bg-green-500 text-white"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }`}
        >
          保存
        </button>
        {dirty && (
          <span className="text-yellow-400 text-sm self-center ml-2">
            未保存の変更があります
          </span>
        )}
      </div>

      {/* 打順設定 */}
      {tab === "batting" && (
        <BattingOrderEditor
          config={config}
          batters={batters}
          playerMap={playerMap}
          onChange={(newConfig) => {
            setConfig(newConfig);
            setDirty(true);
          }}
        />
      )}

      {/* ローテーション設定 */}
      {tab === "rotation" && (
        <RotationEditor
          config={config}
          pitchers={pitchers}
          playerMap={playerMap}
          onChange={(newConfig) => {
            setConfig(newConfig);
            setDirty(true);
          }}
        />
      )}

      {/* リリーフ設定 */}
      {tab === "bullpen" && (
        <BullpenEditor
          config={config}
          pitchers={pitchers}
          playerMap={playerMap}
          onChange={(newConfig) => {
            setConfig(newConfig);
            setDirty(true);
          }}
        />
      )}
    </div>
  );
}

// ── 打順エディタ ──

function BattingOrderEditor({
  config,
  batters,
  playerMap,
  onChange,
}: {
  config: TeamLineupConfig;
  batters: Player[];
  playerMap: Map<string, Player>;
  onChange: (c: TeamLineupConfig) => void;
}) {
  const orderLabels = [
    "1番 (リードオフ)",
    "2番 (つなぎ)",
    "3番 (チャンスメーカー)",
    "4番 (クリーンナップ)",
    "5番 (ポイントゲッター)",
    "6番",
    "7番",
    "8番",
    "9番",
  ];

  const handleSwap = (i: number, j: number) => {
    const newOrder = [...config.battingOrder];
    [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
    onChange({ ...config, battingOrder: newOrder });
  };

  const handleReplace = (slotIndex: number, playerId: string) => {
    const newOrder = [...config.battingOrder];
    newOrder[slotIndex] = playerId;
    onChange({ ...config, battingOrder: newOrder });
  };

  const usedIds = new Set(config.battingOrder);
  const available = batters.filter((b) => !usedIds.has(b.id));

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold mb-3 text-blue-400">スタメン打順</h2>
      {config.battingOrder.slice(0, 9).map((playerId, i) => {
        const player = playerMap.get(playerId);
        return (
          <div
            key={i}
            className="flex items-center gap-3 bg-gray-800 rounded-lg p-3 border border-gray-700"
          >
            <div className="w-32 text-sm text-gray-400 flex-shrink-0">
              {orderLabels[i]}
            </div>
            <select
              value={playerId}
              onChange={(e) => handleReplace(i, e.target.value)}
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            >
              {player && (
                <option value={player.id}>
                  {player.name} ({POSITION_NAMES[player.position]}) ミ{player.batting.contact} パ{player.batting.power} 走{player.batting.speed}
                </option>
              )}
              {available.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({POSITION_NAMES[b.position]}) ミ{b.batting.contact} パ{b.batting.power} 走{b.batting.speed}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              <button
                onClick={() => i > 0 && handleSwap(i, i - 1)}
                disabled={i === 0}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => i < 8 && handleSwap(i, i + 1)}
                disabled={i >= 8}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── ローテーションエディタ ──

function RotationEditor({
  config,
  pitchers,
  playerMap,
  onChange,
}: {
  config: TeamLineupConfig;
  pitchers: Player[];
  playerMap: Map<string, Player>;
  onChange: (c: TeamLineupConfig) => void;
}) {
  const bullpenIds = new Set([
    config.closerId,
    ...config.setupIds,
  ].filter(Boolean));

  const handleReplace = (slotIndex: number, playerId: string) => {
    const newRotation = [...config.startingRotation];
    newRotation[slotIndex] = playerId;
    onChange({ ...config, startingRotation: newRotation });
  };

  const handleAdd = (playerId: string) => {
    if (config.startingRotation.length >= 6) return;
    onChange({
      ...config,
      startingRotation: [...config.startingRotation, playerId],
    });
  };

  const handleRemove = (index: number) => {
    if (config.startingRotation.length <= 1) return;
    const newRotation = config.startingRotation.filter((_, i) => i !== index);
    onChange({
      ...config,
      startingRotation: newRotation,
      rotationIndex: config.rotationIndex % Math.max(1, newRotation.length),
    });
  };

  const rotationSet = new Set(config.startingRotation);
  const available = pitchers.filter(
    (p) => !rotationSet.has(p.id) && !bullpenIds.has(p.id)
  );

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-blue-400">
        先発ローテーション ({config.startingRotation.length}人)
      </h2>
      <p className="text-sm text-gray-400 mb-4">
        次回先発: {config.rotationIndex + 1}番手
      </p>
      <div className="space-y-2 mb-4">
        {config.startingRotation.map((playerId, i) => {
          const player = playerMap.get(playerId);
          return (
            <div
              key={i}
              className={`flex items-center gap-3 bg-gray-800 rounded-lg p-3 border ${
                i === config.rotationIndex % config.startingRotation.length
                  ? "border-green-500"
                  : "border-gray-700"
              }`}
            >
              <div className="w-16 text-sm text-gray-400">
                {i + 1}番手
                {i === config.rotationIndex % config.startingRotation.length && (
                  <span className="text-green-400 ml-1">●</span>
                )}
              </div>
              <select
                value={playerId}
                onChange={(e) => handleReplace(i, e.target.value)}
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              >
                {player && (
                  <option value={player.id}>
                    {player.name} {player.pitching?.velocity}km スタ{player.pitching?.stamina}
                  </option>
                )}
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.pitching?.velocity}km スタ{p.pitching?.stamina}
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleRemove(i)}
                disabled={config.startingRotation.length <= 1}
                className="px-3 py-1 bg-red-900/50 hover:bg-red-800 rounded text-sm text-red-300 disabled:opacity-30"
              >
                除外
              </button>
            </div>
          );
        })}
      </div>
      {config.startingRotation.length < 6 && available.length > 0 && (
        <div className="flex items-center gap-3">
          <select
            id="add-starter"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                handleAdd(e.target.value);
                e.target.value = "";
              }
            }}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
          >
            <option value="" disabled>
              先発投手を追加...
            </option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.pitching?.velocity}km スタ{p.pitching?.stamina}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ── リリーフエディタ ──

function BullpenEditor({
  config,
  pitchers,
  playerMap,
  onChange,
}: {
  config: TeamLineupConfig;
  pitchers: Player[];
  playerMap: Map<string, Player>;
  onChange: (c: TeamLineupConfig) => void;
}) {
  const rotationSet = new Set(config.startingRotation);
  const availablePitchers = pitchers.filter((p) => !rotationSet.has(p.id));
  const usedIds = new Set([config.closerId, ...config.setupIds].filter(Boolean));

  const handleCloserChange = (playerId: string) => {
    onChange({
      ...config,
      closerId: playerId || null,
      setupIds: config.setupIds.filter((id) => id !== playerId),
    });
  };

  const handleSetupAdd = (playerId: string) => {
    if (config.setupIds.length >= 3) return;
    onChange({
      ...config,
      setupIds: [...config.setupIds, playerId],
    });
  };

  const handleSetupRemove = (index: number) => {
    onChange({
      ...config,
      setupIds: config.setupIds.filter((_, i) => i !== index),
    });
  };

  const closerPlayer = config.closerId
    ? playerMap.get(config.closerId)
    : null;
  const availableForCloser = availablePitchers.filter(
    (p) => !config.setupIds.includes(p.id)
  );
  const availableForSetup = availablePitchers.filter(
    (p) => p.id !== config.closerId && !config.setupIds.includes(p.id)
  );

  return (
    <div className="space-y-6">
      {/* クローザー */}
      <div>
        <h2 className="text-lg font-semibold mb-3 text-red-400">守護神</h2>
        <select
          value={config.closerId ?? ""}
          onChange={(e) => handleCloserChange(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
        >
          <option value="">なし</option>
          {closerPlayer && (
            <option value={closerPlayer.id}>
              {closerPlayer.name} {closerPlayer.pitching?.velocity}km 制球{closerPlayer.pitching?.control}
            </option>
          )}
          {availableForCloser
            .filter((p) => p.id !== config.closerId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.pitching?.velocity}km 制球{p.pitching?.control}
              </option>
            ))}
        </select>
      </div>

      {/* セットアッパー */}
      <div>
        <h2 className="text-lg font-semibold mb-3 text-orange-400">
          セットアッパー ({config.setupIds.length}人)
        </h2>
        <div className="space-y-2 mb-3">
          {config.setupIds.map((playerId, i) => {
            const player = playerMap.get(playerId);
            return (
              <div
                key={i}
                className="flex items-center gap-3 bg-gray-800 rounded-lg p-3 border border-gray-700"
              >
                <span className="text-white flex-1">
                  {player?.name ?? "?"} {player?.pitching?.velocity}km
                </span>
                <button
                  onClick={() => handleSetupRemove(i)}
                  className="px-3 py-1 bg-red-900/50 hover:bg-red-800 rounded text-sm text-red-300"
                >
                  除外
                </button>
              </div>
            );
          })}
        </div>
        {config.setupIds.length < 3 && availableForSetup.length > 0 && (
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                handleSetupAdd(e.target.value);
                e.target.value = "";
              }
            }}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
          >
            <option value="" disabled>
              セットアッパーを追加...
            </option>
            {availableForSetup.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.pitching?.velocity}km 制球{p.pitching?.control}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 中継ぎ一覧 */}
      <div>
        <h2 className="text-lg font-semibold mb-3 text-gray-400">
          その他のリリーフ
        </h2>
        <div className="space-y-1">
          {availablePitchers
            .filter((p) => !usedIds.has(p.id))
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 bg-gray-800/50 rounded px-3 py-2 text-sm text-gray-300"
              >
                <span>{p.name}</span>
                <span className="text-gray-500">
                  {p.pitching?.velocity}km 制球{p.pitching?.control} スタ{p.pitching?.stamina}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
