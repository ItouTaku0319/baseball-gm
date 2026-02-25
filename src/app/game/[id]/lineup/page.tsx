"use client";

import { useEffect, useState, useCallback, startTransition } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { POSITION_NAMES } from "@/models/player";
import type { Player } from "@/models/player";
import { VelocityCell, AbilityCell, PitchList, calcPitcherOverall, OverallBadge } from "@/components/player-ability-card";
import type { TeamLineupConfig, StarterUsagePolicy, RelieverUsagePolicy, PitcherUsageConfig } from "@/models/team";
import { autoConfigureLineup, getIchiGunPlayers } from "@/engine/lineup";
import { LineupField } from "@/components/lineup-field";
import type { FieldPlayer } from "@/components/lineup-field";
import { LineupCard } from "@/components/lineup-card";

type Tab = "batting" | "rotation" | "bullpen";

const STARTER_POLICIES: { value: StarterUsagePolicy; label: string; desc: string }[] = [
  { value: "performance", label: "調子次第", desc: "スタミナ30%以下 or 自責4以上で交代" },
  { value: "win_eligible", label: "勝利投手", desc: "5回+リード+スタミナ40%以下で交代" },
  { value: "complete_game", label: "完投", desc: "スタミナ10%以下 or 自責8以上まで続投" },
  { value: "stamina_save", label: "スタミナ温存", desc: "スタミナ50%以下 or 6回以降で交代" },
  { value: "opener", label: "オープナー", desc: "1回だけ投げて交代" },
  { value: "short_starter", label: "ショートスターター", desc: "打者一巡 or 4回以降で交代" },
];

const RELIEVER_POLICIES: { value: RelieverUsagePolicy; label: string; desc: string; color: string }[] = [
  { value: "closer", label: "守護神", desc: "最終回リード1-3点で登板", color: "bg-red-900/60 text-red-300" },
  { value: "lead_only", label: "リード時", desc: "リード時のみ登板", color: "bg-blue-900/60 text-blue-300" },
  { value: "close_game", label: "接戦時", desc: "1-2点差リード時に登板", color: "bg-orange-900/60 text-orange-300" },
  { value: "behind_ok", label: "ビハインドOK", desc: "接戦+1-2点ビハインドでも登板", color: "bg-gray-700 text-gray-300" },
  { value: "mop_up", label: "敗戦処理", desc: "大量ビハインド時に登板", color: "bg-gray-800 text-gray-500" },
];

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
      startTransition(() => setConfig(myTeam.lineupConfig ?? autoConfigureLineup(myTeam)));
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const game = useGameStore((s) => s.game);
  const seasonYear = game?.currentSeason.year;

  const usedIds = new Set(config.battingOrder);
  const benchBatters = batters.filter((b) => !usedIds.has(b.id));

  const fieldPlayers: FieldPlayer[] = config.battingOrder
    .slice(0, 9)
    .map((id) => {
      const p = playerMap.get(id);
      if (!p) return null;
      return { id: p.id, name: p.name, position: p.position };
    })
    .filter((x): x is FieldPlayer => x !== null);

  const handleCardClick = (playerId: string) => {
    if (!selectedId) {
      setSelectedId(playerId);
      return;
    }
    if (selectedId === playerId) {
      setSelectedId(null);
      return;
    }

    const selectedIndex = config.battingOrder.indexOf(selectedId);
    const clickedIndex = config.battingOrder.indexOf(playerId);

    if (selectedIndex >= 0 && clickedIndex >= 0) {
      const newOrder = [...config.battingOrder];
      [newOrder[selectedIndex], newOrder[clickedIndex]] = [newOrder[clickedIndex], newOrder[selectedIndex]];
      onChange({ ...config, battingOrder: newOrder });
    }
    setSelectedId(null);
  };

  const handleBenchClick = (playerId: string) => {
    if (!selectedId) return;
    const selectedIndex = config.battingOrder.indexOf(selectedId);
    if (selectedIndex < 0) return;

    const newOrder = [...config.battingOrder];
    newOrder[selectedIndex] = playerId;
    onChange({ ...config, battingOrder: newOrder });
    setSelectedId(null);
  };

  const handleSwap = (i: number, j: number) => {
    if (j < 0 || j >= 9) return;
    const newOrder = [...config.battingOrder];
    [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
    onChange({ ...config, battingOrder: newOrder });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-blue-400">スタメン打順</h2>

      <div className="flex flex-col lg:flex-row gap-4 mb-6">
        {/* フィールド図 */}
        <div className="lg:w-[320px] shrink-0">
          <LineupField
            players={fieldPlayers}
            selectedId={selectedId}
            onPlayerClick={handleCardClick}
          />
        </div>

        {/* 打順カードリスト */}
        <div className="flex-1 space-y-1.5">
          {config.battingOrder.slice(0, 9).map((playerId, i) => {
            const player = playerMap.get(playerId);
            if (!player) return null;
            const stats = seasonYear != null
              ? player.careerBattingStats[seasonYear]
              : undefined;
            return (
              <LineupCard
                key={playerId}
                order={i + 1}
                player={player}
                seasonStats={stats}
                selected={selectedId === playerId}
                onClick={() => handleCardClick(playerId)}
                onMoveUp={() => handleSwap(i, i - 1)}
                onMoveDown={() => handleSwap(i, i + 1)}
                disableUp={i === 0}
                disableDown={i >= 8}
              />
            );
          })}
        </div>
      </div>

      {/* ベンチ */}
      {benchBatters.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-400">
            ベンチ ({benchBatters.length})
            {selectedId && (
              <span className="ml-2 text-yellow-400 text-xs">
                クリックで差し替え
              </span>
            )}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {benchBatters.map((b) => (
              <div
                key={b.id}
                onClick={() => handleBenchClick(b.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedId
                    ? "bg-gray-700 hover:bg-gray-600 cursor-pointer border border-yellow-500/30"
                    : "bg-gray-800/50 border border-gray-700/50"
                }`}
              >
                <span className="text-gray-400 text-xs">
                  {POSITION_NAMES[b.position]}
                  {b.subPositions && b.subPositions.length > 0 && (
                    <span className="text-gray-600 ml-0.5">
                      ({b.subPositions.map((sp) => POSITION_NAMES[sp]).join("/")})
                    </span>
                  )}
                </span>
                <span className="text-white">{b.name}</span>
                <span className="text-gray-500 text-xs ml-auto">
                  ミ{b.batting.contact} パ{b.batting.power}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 投手カード ──

/** 投手情報カード */
function PitcherCard({
  player,
  role,
  isNext,
  onRemove,
  removeLabel,
}: {
  player: Player;
  role?: string;
  isNext?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const pitching = player.pitching;
  if (!pitching) return null;

  const roleColors: Record<string, string> = {
    "守護神": "bg-red-900/60 text-red-300",
    "リード時": "bg-blue-900/60 text-blue-300",
    "接戦時": "bg-orange-900/60 text-orange-300",
    "ビハインドOK": "bg-gray-700 text-gray-300",
    "敗戦処理": "bg-gray-800 text-gray-500",
    "セットアッパー": "bg-orange-900/60 text-orange-300",
    "中継ぎ": "bg-gray-700 text-gray-400",
  };

  return (
    <div
      className={`bg-gray-800 rounded-lg p-3 border transition-colors ${
        isNext ? "border-green-500" : "border-gray-700"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <OverallBadge value={calcPitcherOverall(pitching)} />
        <span className="text-white font-bold">{player.name}</span>
        <span className="text-gray-400 text-xs">{player.age}歳</span>
        {role && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${roleColors[role] ?? "bg-gray-700 text-gray-400"}`}>
            {role}
          </span>
        )}
        {isNext && (
          <span className="text-green-400 text-xs">●次回先発</span>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="ml-auto px-2 py-1 bg-red-900/50 hover:bg-red-800 rounded text-xs text-red-300"
          >
            {removeLabel ?? "除外"}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm mb-1.5 flex-wrap">
        <span>
          <span className="text-gray-400">球速 </span>
          <VelocityCell val={pitching.velocity} />
        </span>
        <span>
          <span className="text-gray-400">制球 </span>
          <AbilityCell val={pitching.control} />
        </span>
        <span>
          <span className="text-gray-400">スタ </span>
          <AbilityCell val={pitching.stamina} />
        </span>
        <span>
          <span className="text-gray-400">精神 </span>
          <AbilityCell val={pitching.mentalToughness} />
        </span>
      </div>
      <div className="text-sm">
        <PitchList pitches={pitching.pitches} />
      </div>
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
  const bullpenIds = new Set(config.relieverIds ?? []);

  const handleAdd = (playerId: string) => {
    if (config.startingRotation.length >= 6) return;
    const usages = { ...(config.pitcherUsages ?? {}) };
    usages[playerId] = { ...usages[playerId], starterPolicy: "performance" };
    onChange({
      ...config,
      startingRotation: [...config.startingRotation, playerId],
      pitcherUsages: usages,
    });
  };

  const handleRemove = (index: number) => {
    if (config.startingRotation.length <= 1) return;
    const removedId = config.startingRotation[index];
    const newRotation = config.startingRotation.filter((_, i) => i !== index);
    const usages = { ...(config.pitcherUsages ?? {}) };
    delete usages[removedId];
    onChange({
      ...config,
      startingRotation: newRotation,
      rotationIndex: config.rotationIndex % Math.max(1, newRotation.length),
      pitcherUsages: usages,
    });
  };

  const handleStarterPolicyChange = (playerId: string, policy: StarterUsagePolicy) => {
    const usages = { ...(config.pitcherUsages ?? {}) };
    usages[playerId] = { ...usages[playerId], starterPolicy: policy };
    onChange({ ...config, pitcherUsages: usages });
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

      <div className="space-y-2 mb-4">
        {config.startingRotation.map((playerId, i) => {
          const player = playerMap.get(playerId);
          if (!player) return null;
          const isNext = i === config.rotationIndex % config.startingRotation.length;
          return (
            <div key={playerId} className="flex items-start gap-2">
              <div className="w-10 pt-3 text-sm text-gray-400 text-center shrink-0">
                {i + 1}番手
              </div>
              <div className="flex-1">
                <PitcherCard
                  player={player}
                  isNext={isNext}
                  onRemove={config.startingRotation.length > 1 ? () => handleRemove(i) : undefined}
                />
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-gray-400 text-xs">起用法:</span>
                  <select
                    value={config.pitcherUsages?.[playerId]?.starterPolicy ?? "performance"}
                    onChange={(e) => handleStarterPolicyChange(playerId, e.target.value as StarterUsagePolicy)}
                    className="bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600"
                  >
                    {STARTER_POLICIES.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <span className="text-gray-500 text-xs">
                    {STARTER_POLICIES.find(p => p.value === (config.pitcherUsages?.[playerId]?.starterPolicy ?? "performance"))?.desc}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {config.startingRotation.length < 6 && available.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-400">追加可能な投手</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {available.map((p) => (
              <div
                key={p.id}
                onClick={() => handleAdd(p.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-gray-800/50 border border-gray-700/50 hover:bg-gray-700 cursor-pointer transition-colors"
              >
                <span className="text-white">{p.name}</span>
                <span className="text-gray-500 text-xs ml-auto">
                  {p.pitching?.velocity}km 制球{p.pitching?.control}
                </span>
              </div>
            ))}
          </div>
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
  const relieverIds = config.relieverIds ?? [];
  const relieverSet = new Set(relieverIds);

  const availablePitchers = pitchers.filter(
    (p) => !rotationSet.has(p.id) && !relieverSet.has(p.id)
  );

  const handleAdd = (playerId: string) => {
    if (relieverIds.length >= 8) return;
    const newRelievers = [...relieverIds, playerId];
    const usages = { ...(config.pitcherUsages ?? {}) };
    usages[playerId] = { relieverPolicy: "behind_ok", maxInnings: 3 };
    onChange({ ...config, relieverIds: newRelievers, pitcherUsages: usages });
  };

  const handleRemove = (playerId: string) => {
    const newRelievers = relieverIds.filter((id) => id !== playerId);
    const usages = { ...(config.pitcherUsages ?? {}) };
    delete usages[playerId];
    onChange({ ...config, relieverIds: newRelievers, pitcherUsages: usages });
  };

  const handlePolicyChange = (playerId: string, policy: RelieverUsagePolicy) => {
    if (policy === "closer") {
      const currentCloser = relieverIds.find(
        (id) => config.pitcherUsages?.[id]?.relieverPolicy === "closer" && id !== playerId
      );
      if (currentCloser) {
        const usages = { ...(config.pitcherUsages ?? {}) };
        usages[currentCloser] = { ...usages[currentCloser], relieverPolicy: "close_game" };
        usages[playerId] = { ...usages[playerId], relieverPolicy: policy, maxInnings: 1 };
        onChange({ ...config, pitcherUsages: usages });
        return;
      }
    }
    const usages = { ...(config.pitcherUsages ?? {}) };
    const defaultMax = policy === "closer" ? 1 : policy === "close_game" || policy === "lead_only" ? 2 : 3;
    usages[playerId] = { ...usages[playerId], relieverPolicy: policy, maxInnings: usages[playerId]?.maxInnings ?? defaultMax };
    onChange({ ...config, pitcherUsages: usages });
  };

  const handleMaxInningsChange = (playerId: string, maxInnings: number) => {
    const usages = { ...(config.pitcherUsages ?? {}) };
    usages[playerId] = { ...usages[playerId], maxInnings };
    onChange({ ...config, pitcherUsages: usages });
  };

  const getPolicy = (playerId: string): RelieverUsagePolicy =>
    config.pitcherUsages?.[playerId]?.relieverPolicy ?? "behind_ok";

  const getMaxInnings = (playerId: string): number =>
    config.pitcherUsages?.[playerId]?.maxInnings ?? 3;

  const getPolicyInfo = (policy: RelieverUsagePolicy) =>
    RELIEVER_POLICIES.find((p) => p.value === policy) ?? RELIEVER_POLICIES[3];

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-blue-400">
        リリーフ ({relieverIds.length}/8人)
      </h2>

      <div className="space-y-2 mb-4">
        {relieverIds.map((playerId) => {
          const player = playerMap.get(playerId);
          if (!player) return null;
          const policy = getPolicy(playerId);
          const policyInfo = getPolicyInfo(policy);
          const maxInn = getMaxInnings(playerId);

          return (
            <div key={playerId}>
              <PitcherCard
                player={player}
                role={policyInfo.label}
                onRemove={() => handleRemove(playerId)}
                removeLabel="除外"
              />
              <div className="flex items-center gap-3 mt-1 ml-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-xs">起用法:</span>
                  <select
                    value={policy}
                    onChange={(e) => handlePolicyChange(playerId, e.target.value as RelieverUsagePolicy)}
                    className="bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600"
                  >
                    {RELIEVER_POLICIES.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-xs">最大:</span>
                  <select
                    value={maxInn}
                    onChange={(e) => handleMaxInningsChange(playerId, Number(e.target.value))}
                    className="bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}イニング</option>
                    ))}
                  </select>
                </div>
                <span className="text-gray-500 text-xs">{policyInfo.desc}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 追加可能な投手 */}
      {relieverIds.length < 8 && availablePitchers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-gray-400">
            追加可能な投手 ({availablePitchers.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {availablePitchers.map((p) => (
              <div
                key={p.id}
                onClick={() => handleAdd(p.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-gray-800/50 border border-gray-700/50 hover:bg-gray-700 cursor-pointer transition-colors"
              >
                <span className="text-white">{p.name}</span>
                <span className="text-gray-500 text-xs ml-auto">
                  {p.pitching?.velocity}km 制球{p.pitching?.control}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
