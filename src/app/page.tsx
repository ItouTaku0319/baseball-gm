"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";

export default function Home() {
  const { savedGames, loadSavedGamesList, deleteSave } = useGameStore();

  useEffect(() => {
    loadSavedGamesList();
  }, [loadSavedGamesList]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Baseball GM
        </h1>
        <p className="text-gray-400 text-lg">
          プロ野球GMとしてチームを優勝に導け
        </p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        <Link
          href="/game/new"
          className="block text-center py-4 px-8 bg-blue-600 hover:bg-blue-500 rounded-lg text-lg font-semibold transition-colors"
        >
          新しいゲームを始める
        </Link>

        {savedGames.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-3 text-gray-300">
              セーブデータ
            </h2>
            <div className="space-y-2">
              {savedGames.map((save) => (
                <div
                  key={save.id}
                  className="flex items-center justify-between p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
                >
                  <Link
                    href={`/game/${save.id}`}
                    className="flex-1 hover:text-blue-400 transition-colors"
                  >
                    <div className="font-medium text-white">{save.name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(save.updatedAt).toLocaleString("ja-JP")}
                    </div>
                  </Link>
                  <button
                    onClick={() => deleteSave(save.id)}
                    className="text-sm text-red-400 hover:text-red-300 ml-4 px-2 py-1 rounded hover:bg-red-950/30 transition-colors"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
