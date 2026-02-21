"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

/** TODO: トレード機能を実装する */
export default function TradePage() {
  const params = useParams();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/game/${params.id}`} className="text-gray-400 hover:text-white">← 戻る</Link>
        <h1 className="text-2xl font-bold">トレード</h1>
      </div>

      <div className="p-8 bg-gray-800/50 rounded-lg border border-dashed border-gray-600 text-center">
        <p className="text-gray-400 text-lg mb-2">トレード画面</p>
        <p className="text-gray-500 text-sm">
          他チームと選手を交換するトレード機能を実装予定。
          選手価値の自動算出とCPUの交渉ロジック搭載。
        </p>
        <div className="mt-4 text-xs text-gray-600">
          エンジン: src/engine/trade.ts (実装済み)
        </div>
      </div>
    </div>
  );
}
