"use client";

import { useParams } from "next/navigation";
import Link from "next/link";

/** TODO: ドラフト機能を実装する */
export default function DraftPage() {
  const params = useParams();

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/game/${params.id}`} className="text-gray-400 hover:text-white">&larr; 戻る</Link>
        <h1 className="text-2xl font-bold">ドラフト</h1>
      </div>

      <div className="p-8 bg-gray-800/50 rounded-lg border border-dashed border-gray-600 text-center">
        <p className="text-gray-400 text-lg mb-2">ドラフト画面</p>
        <p className="text-gray-500 text-sm">
          ウェーバー方式のドラフトを実装予定。
          成績の悪いチームから順に新人選手を指名できる。
        </p>
        <div className="mt-4 text-xs text-gray-600">
          エンジン: src/engine/draft.ts (実装済み)
        </div>
      </div>
    </div>
  );
}
