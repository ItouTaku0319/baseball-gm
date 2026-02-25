#!/usr/bin/env tsx
// 守備判断の詳細をCSV出力するスクリプト
// 使い方: npx tsx scripts/fielding-decisions-csv.ts > reports/fielding-decisions.csv

import { simulateGame } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import type { Team, RosterLevel } from "../src/models/team";
import type { AtBatLog, FieldingTrace } from "../src/models/league";

const NUM_GAMES = 300;

function createTeam(id: string): Team {
  const roster = generateRoster(65);
  const rl: Record<string, RosterLevel> = {};
  roster.forEach(p => { rl[p.id] = "ichi_gun"; });
  return { id, name: id, shortName: id, color: "#000", roster, budget: 500000, fanBase: 60, homeBallpark: "球場", rosterLevels: rl };
}

const POS_NAMES: Record<number, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function main() {
  process.stderr.write(`${NUM_GAMES}試合シミュレーション中...\n`);
  const logs: AtBatLog[] = [];
  let tA = createTeam("A"), tB = createTeam("B");
  for (let i = 0; i < NUM_GAMES; i++) {
    if (i > 0 && i % 100 === 0) { tA = createTeam("A"); tB = createTeam("B"); }
    const r = simulateGame(tA, tB, { collectAtBatLogs: true });
    logs.push(...(r.atBatLogs ?? []));
  }

  // フィールディングトレース付きのヒット打球のみ抽出
  const hits = logs.filter(l =>
    l.fieldingTrace &&
    l.fieldingTrace.resolution.bouncePenalty !== undefined &&
    (l.result === "single" || l.result === "double" || l.result === "triple")
  );

  process.stderr.write(`対象打球: ${hits.length}件\n`);

  // CSVヘッダー
  const header = [
    "結果", "打球種", "方向(°)", "角度(°)", "初速(km/h)", "飛距離(m)", "飛行時間(s)",
    // 9野手の情報
    ...([7, 8, 9, 3, 4, 5, 6, 1, 2] as number[]).flatMap(pos => [
      `${POS_NAMES[pos]}_役割`,
      `${POS_NAMES[pos]}_アクション`,
      `${POS_NAMES[pos]}_初期距離(m)`,
      `${POS_NAMES[pos]}_着地時距離(m)`,
      `${POS_NAMES[pos]}_到達可`,
      `${POS_NAMES[pos]}_速度(m/s)`,
    ]),
    // 回収・進塁判定
    "回収野手", "バウンス(s)", "拾う(s)", "回収合計(s)",
    "送球2B(m)", "送球3B(m)", "守備→2B(s)", "守備→3B(s)",
    "走者→2B(s)", "走者→3B(s)", "2Bマージン(s)", "3Bマージン(s)", "到達塁数",
  ];

  // UTF-8 BOM付きでExcelの文字化けを防止
  process.stdout.write("\uFEFF");
  console.log(header.join(","));

  for (const log of hits) {
    const t = log.fieldingTrace!;
    const res = t.resolution;

    // 基本情報
    const row: (string | number)[] = [
      log.result,
      log.battedBallType ?? "",
      (log.direction ?? 0).toFixed(1),
      (log.launchAngle ?? 0).toFixed(1),
      (log.exitVelocity ?? 0).toFixed(0),
      (log.estimatedDistance ?? 0).toFixed(1),
      t.landing.flightTime.toFixed(2),
    ];

    // 9野手の詳細
    for (const pos of [7, 8, 9, 3, 4, 5, 6, 1, 2]) {
      const f = t.fielders.find(f => f.position === pos);
      const mv = t.movements?.find(m => m.position === pos);
      if (f) {
        row.push(
          f.role,
          mv?.action ?? "",
          f.distanceToBall.toFixed(1),
          (f.distanceAtLanding ?? f.distanceToBall).toFixed(1),
          f.canReach ? "○" : "×",
          (f.skill.speed / 100 * 3 + 5).toFixed(1),
        );
      } else {
        row.push("", "", "", "", "", "");
      }
    }

    // 回収・進塁判定
    row.push(
      POS_NAMES[res.bestFielderPos] ?? res.bestFielderPos,
      (res.bouncePenalty ?? 0).toFixed(2),
      (res.pickupTime ?? 0).toFixed(2),
      (res.totalFielderTime ?? 0).toFixed(2),
      (res.throwTo2B ?? 0).toFixed(1),
      (res.throwTo3B ?? 0).toFixed(1),
      (res.defenseTo2B ?? 0).toFixed(2),
      (res.defenseTo3B ?? 0).toFixed(2),
      (res.runnerTo2B ?? 0).toFixed(2),
      (res.runnerTo3B ?? 0).toFixed(2),
      (res.margin2B ?? 0).toFixed(2),
      (res.margin3B ?? 0).toFixed(2),
      res.basesReached ?? "",
    );

    console.log(row.join(","));
  }

  process.stderr.write(`CSV出力完了\n`);
}

main();
