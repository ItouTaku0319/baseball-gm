"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

/** TODO: 成績表示機能を実装する */
export default function StatsPage() {
  const params = useParams();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/game/${params.id}`} className="text-gray-400 hover:text-white">← 戻る</Link>
        <h1 className="text-2xl font-bold">成績</h1>
      </div>

      <div className="p-8 bg-gray-800/50 rounded-lg border border-dashed border-gray-600 text-center">
        <p className="text-gray-400 text-lg mb-2">統計・成績画面</p>
        <p className="text-gray-500 text-sm">
          打率ランキング、本塁打ランキング、防御率ランキングなど
          シーズン統計を表示する機能を実装予定。
        </p>
      </div>
    </div>
  );
}
