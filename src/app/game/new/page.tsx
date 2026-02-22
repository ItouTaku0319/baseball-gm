"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEAM_TEMPLATES } from "@/data/teams";
import { useGameStore } from "@/store/game-store";
import { generateRoster } from "@/engine/player-generator";
import { createSeason } from "@/engine/season";
import type { Team } from "@/models/team";
import type { League } from "@/models/league";
import type { GameState } from "@/models/game-state";

export default function NewGamePage() {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const { setGame } = useGameStore();
  const router = useRouter();

  const centralTeams = TEAM_TEMPLATES.filter((t) => t.league === "central");
  const pacificTeams = TEAM_TEMPLATES.filter((t) => t.league === "pacific");

  const handleStart = () => {
    if (!selectedTeamId) return;

    const teams: Record<string, Team> = {};
    for (const template of TEAM_TEMPLATES) {
      teams[template.id] = {
        id: template.id,
        name: template.name,
        shortName: template.shortName,
        color: template.color,
        roster: generateRoster(25),
        budget: 500000,
        fanBase: 50 + Math.floor(Math.random() * 30),
        homeBallpark: template.homeBallpark,
      };
    }

    const leagues: League[] = [
      {
        id: "central",
        name: "セントラル・リーグ",
        teams: centralTeams.map((t) => t.id),
      },
      {
        id: "pacific",
        name: "パシフィック・リーグ",
        teams: pacificTeams.map((t) => t.id),
      },
    ];

    const season = createSeason(2026, leagues);

    const gameState: GameState = {
      id: crypto.randomUUID(),
      myTeamId: selectedTeamId,
      teams,
      currentSeason: season,
      seasonHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setGame(gameState);
    setTimeout(() => {
      useGameStore.getState().saveGame();
      router.push(`/game/${gameState.id}`);
    }, 100);
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-2">新しいゲーム</h1>
      <p className="text-gray-400 mb-8">あなたが監督・GMを務めるチームを選んでください</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-lg font-semibold mb-3 text-blue-400">
            セントラル・リーグ
          </h2>
          <div className="space-y-2">
            {centralTeams.map((team) => (
              <button
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                className={`w-full text-left p-4 rounded-lg border transition-all ${
                  selectedTeamId === team.id
                    ? "border-blue-500 bg-blue-950/50 shadow-lg shadow-blue-900/20"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-500 hover:bg-gray-800"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="font-medium text-white">{team.name}</span>
                </div>
                <div className="text-sm text-gray-500 mt-1 ml-8">
                  {team.homeBallpark}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3 text-emerald-400">
            パシフィック・リーグ
          </h2>
          <div className="space-y-2">
            {pacificTeams.map((team) => (
              <button
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                className={`w-full text-left p-4 rounded-lg border transition-all ${
                  selectedTeamId === team.id
                    ? "border-emerald-500 bg-emerald-950/50 shadow-lg shadow-emerald-900/20"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-500 hover:bg-gray-800"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="font-medium text-white">{team.name}</span>
                </div>
                <div className="text-sm text-gray-500 mt-1 ml-8">
                  {team.homeBallpark}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 text-center">
        <button
          onClick={handleStart}
          disabled={!selectedTeamId}
          className="py-3 px-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-lg font-semibold transition-colors"
        >
          ゲーム開始
        </button>
      </div>
    </div>
  );
}
