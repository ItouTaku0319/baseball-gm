#!/usr/bin/env tsx
// 短距離長打を「間を抜いた打球」vs「野手正面なのに二塁打」に分類

import { simulateGame } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import type { Team, RosterLevel } from "../src/models/team";
import type { AtBatLog } from "../src/models/league";

const NUM_GAMES = 500;

function createTeam(id: string): Team {
  const roster = generateRoster(65);
  const rl: Record<string, RosterLevel> = {};
  roster.forEach(p => { rl[p.id] = "ichi_gun"; });
  return { id, name: id, shortName: id, color: "#000", roster, budget: 500000, fanBase: 60, homeBallpark: "球場", rosterLevels: rl };
}

// 外野手のデフォルト位置から方角を計算
// LF(-26,62) → atan2(-26,62) → direction = 45 + degrees(atan2(x,y))
// ただし座標系は x = distance * sin((dir-45)*π/180), y = distance * cos((dir-45)*π/180)
// なので逆算: dir = 45 + atan2(x, y) * 180/π
const LF_DIR = 45 + Math.atan2(-26, 62) * 180 / Math.PI; // ≈ 22.2°
const CF_DIR = 45 + Math.atan2(0, 70) * 180 / Math.PI;   // = 45.0°
const RF_DIR = 45 + Math.atan2(26, 62) * 180 / Math.PI;  // ≈ 67.8°

// ゾーン分類: ±8°を「正面」とする
const FRONT_HALF = 8;
type Zone = "LF正面" | "左中間" | "CF正面" | "右中間" | "RF正面" | "左線" | "右線";

function classifyDirection(dir: number): Zone {
  if (dir < LF_DIR - FRONT_HALF) return "左線";           // 0 ~ 14.2°
  if (dir < LF_DIR + FRONT_HALF) return "LF正面";         // 14.2 ~ 30.2°
  if (dir < CF_DIR - FRONT_HALF) return "左中間";          // 30.2 ~ 37°
  if (dir < CF_DIR + FRONT_HALF) return "CF正面";          // 37 ~ 53°
  if (dir < RF_DIR - FRONT_HALF) return "右中間";          // 53 ~ 59.8°
  if (dir < RF_DIR + FRONT_HALF) return "RF正面";          // 59.8 ~ 75.8°
  return "右線";                                           // 75.8 ~ 90°
}

function main() {
  process.stderr.write(`500試合シミュレーション中...\n`);
  const allLogs: AtBatLog[] = [];
  let tA = createTeam("A"), tB = createTeam("B");
  for (let i = 0; i < NUM_GAMES; i++) {
    if (i > 0 && i % 100 === 0) { tA = createTeam("A"); tB = createTeam("B"); }
    const r = simulateGame(tA, tB, { collectAtBatLogs: true });
    allLogs.push(...(r.atBatLogs ?? []));
  }

  // 短距離長打 (飛距離<55m, double/triple)
  const shortDoubles = allLogs.filter(l =>
    l.estimatedDistance !== null && l.estimatedDistance < 55 &&
    (l.result === "double" || l.result === "triple") &&
    l.fieldingTrace
  );

  // 比較用: 短距離シングル (飛距離<55m, single)
  const shortSingles = allLogs.filter(l =>
    l.estimatedDistance !== null && l.estimatedDistance < 55 &&
    l.result === "single" &&
    l.fieldingTrace?.resolution.bouncePenalty !== undefined
  );

  console.log("# 短距離長打の方向別分析");
  console.log("");
  console.log(`外野手のデフォルト方角: LF=${LF_DIR.toFixed(1)}°  CF=${CF_DIR.toFixed(1)}°  RF=${RF_DIR.toFixed(1)}°`);
  console.log(`正面判定: 外野手方角 ±${FRONT_HALF}°`);
  console.log("");

  // ゾーン別集計
  const zones: Zone[] = ["左線", "LF正面", "左中間", "CF正面", "右中間", "RF正面", "右線"];
  const dblByZone: Record<Zone, AtBatLog[]> = {} as never;
  const sglByZone: Record<Zone, AtBatLog[]> = {} as never;
  for (const z of zones) { dblByZone[z] = []; sglByZone[z] = []; }

  for (const l of shortDoubles) dblByZone[classifyDirection(l.direction!)].push(l);
  for (const l of shortSingles) sglByZone[classifyDirection(l.direction!)].push(l);

  console.log("## 1. ゾーン別の二塁打 vs シングル");
  console.log("");
  console.log("| ゾーン | 方向帯 | 二塁打 | シングル | 二塁打率 | 判定 |");
  console.log("|---|---|---:|---:|---:|---|");
  for (const z of zones) {
    const d = dblByZone[z].length;
    const s = sglByZone[z].length;
    const total = d + s;
    const rate = total > 0 ? (d / total * 100).toFixed(1) + "%" : "-";
    const isGap = z === "左中間" || z === "右中間" || z === "左線" || z === "右線";
    const verdict = d === 0 ? "OK" : isGap ? "✅ 間を抜く打球" : `⚠️ 野手正面で二塁打`;
    const range = z === "左線" ? `0°-${(LF_DIR - FRONT_HALF).toFixed(0)}°`
      : z === "LF正面" ? `${(LF_DIR - FRONT_HALF).toFixed(0)}°-${(LF_DIR + FRONT_HALF).toFixed(0)}°`
      : z === "左中間" ? `${(LF_DIR + FRONT_HALF).toFixed(0)}°-${(CF_DIR - FRONT_HALF).toFixed(0)}°`
      : z === "CF正面" ? `${(CF_DIR - FRONT_HALF).toFixed(0)}°-${(CF_DIR + FRONT_HALF).toFixed(0)}°`
      : z === "右中間" ? `${(CF_DIR + FRONT_HALF).toFixed(0)}°-${(RF_DIR - FRONT_HALF).toFixed(0)}°`
      : z === "RF正面" ? `${(RF_DIR - FRONT_HALF).toFixed(0)}°-${(RF_DIR + FRONT_HALF).toFixed(0)}°`
      : `${(RF_DIR + FRONT_HALF).toFixed(0)}°-90°`;
    console.log(`| ${z} | ${range} | ${d} | ${s} | ${rate} | ${verdict} |`);
  }
  const gapDoubles = [...dblByZone["左中間"], ...dblByZone["右中間"], ...dblByZone["左線"], ...dblByZone["右線"]];
  const frontDoubles = [...dblByZone["LF正面"], ...dblByZone["CF正面"], ...dblByZone["RF正面"]];
  console.log("");
  console.log(`合計: 短距離二塁打 ${shortDoubles.length}件`);
  console.log(`  間を抜いた打球(左線/左中間/右中間/右線): ${gapDoubles.length}件 (${(gapDoubles.length / shortDoubles.length * 100).toFixed(1)}%)`);
  console.log(`  野手正面(LF/CF/RF正面): ${frontDoubles.length}件 (${(frontDoubles.length / shortDoubles.length * 100).toFixed(1)}%)`);
  console.log("");

  // 野手正面の二塁打の詳細分析
  console.log("## 2. 野手正面の二塁打: なぜ到達できなかったか");
  console.log("");

  if (frontDoubles.length === 0) {
    console.log("該当なし");
    return;
  }

  // 最寄野手の到達時間 vs ボール到着時間の差分
  const diffs: { zone: Zone; dir: number; dist: number; fielderTime: number; ballTime: number; gap: number; fielder: string }[] = [];
  for (const l of frontDoubles) {
    const t = l.fieldingTrace!;
    const r = t.resolution;
    const zone = classifyDirection(l.direction!);
    // 最寄野手の情報
    const bestFielder = t.fielders.find(f => f.position === r.bestFielderPos);
    if (!bestFielder) continue;
    diffs.push({
      zone,
      dir: l.direction!,
      dist: l.estimatedDistance!,
      fielderTime: bestFielder.timeToReach,
      ballTime: bestFielder.ballArrivalTime,
      gap: bestFielder.timeToReach - bestFielder.ballArrivalTime,
      fielder: ["", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"][bestFielder.position] ?? "?",
    });
  }

  // 「正面方向の外野手」が最寄だったか？
  const correctFielderCount = diffs.filter(d => {
    if (d.zone === "LF正面" && d.fielder === "LF") return true;
    if (d.zone === "CF正面" && d.fielder === "CF") return true;
    if (d.zone === "RF正面" && d.fielder === "RF") return true;
    return false;
  }).length;

  console.log(`正面方向の外野手が最寄だったケース: ${correctFielderCount} / ${frontDoubles.length}`);
  console.log("");

  // 到達遅延の統計
  const gaps = diffs.map(d => d.gap);
  gaps.sort((a, b) => a - b);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  console.log(`野手到達遅延 (fielderTime - ballTime):`);
  console.log(`  平均=${mean.toFixed(2)}s  最小=${gaps[0].toFixed(2)}s  P50=${gaps[Math.floor(gaps.length * 0.5)].toFixed(2)}s  最大=${gaps[gaps.length - 1].toFixed(2)}s`);
  console.log("");

  // 正面なのに到達できない原因: 距離 vs ボールの飛行時間
  console.log("## 3. 野手正面二塁打の個別データ (最大20件)");
  console.log("");

  const show = Math.min(20, frontDoubles.length);
  for (let i = 0; i < show; i++) {
    const l = frontDoubles[i];
    const t = l.fieldingTrace!;
    const r = t.resolution;
    const zone = classifyDirection(l.direction!);

    // 正面外野手のデータ
    const targetPos = zone === "LF正面" ? 7 : zone === "CF正面" ? 8 : 9;
    const targetFielder = t.fielders.find(f => f.position === targetPos);
    const bestFielder = t.fielders.find(f => f.position === r.bestFielderPos);

    console.log(`[${i + 1}] ${zone} dir=${l.direction!.toFixed(1)}° dist=${l.estimatedDistance!.toFixed(1)}m type=${l.battedBallType} EV=${l.exitVelocity!.toFixed(0)}km/h LA=${l.launchAngle!.toFixed(1)}°`);
    console.log(`  着地: (${t.landing.position.x.toFixed(1)}, ${t.landing.position.y.toFixed(1)})  距離=${t.landing.distance.toFixed(1)}m  飛行=${t.landing.flightTime.toFixed(2)}s`);

    if (targetFielder) {
      const posName = ["", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"][targetPos];
      console.log(`  正面外野手(${posName}): 移動距離=${targetFielder.distanceToBall.toFixed(1)}m  到達=${targetFielder.timeToReach.toFixed(2)}s  球=${targetFielder.ballArrivalTime.toFixed(2)}s  遅延=${(targetFielder.timeToReach - targetFielder.ballArrivalTime).toFixed(2)}s  reach=${targetFielder.canReach}`);
    }
    if (bestFielder && bestFielder.position !== targetPos) {
      const posName = ["", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"][bestFielder.position];
      console.log(`  最寄野手(${posName}): 移動距離=${bestFielder.distanceToBall.toFixed(1)}m  到達=${bestFielder.timeToReach.toFixed(2)}s  球=${bestFielder.ballArrivalTime.toFixed(2)}s  遅延=${(bestFielder.timeToReach - bestFielder.ballArrivalTime).toFixed(2)}s  reach=${bestFielder.canReach}`);
    }

    // 進塁判定
    if (r.bouncePenalty !== undefined) {
      console.log(`  回収: bounce=${r.bouncePenalty.toFixed(1)}s  total=${r.totalFielderTime!.toFixed(1)}s  throw2B=${r.throwTo2B!.toFixed(1)}m`);
      console.log(`  2B判定: 走者=${r.runnerTo2B!.toFixed(1)}s  守備+1.2=${(r.defenseTo2B! + 1.2).toFixed(1)}s  マージン=${r.margin2B!.toFixed(2)}s`);
    }
    console.log("");
  }

  // まとめ: 距離帯×ゾーンのクロス集計
  console.log("## 4. 距離帯×ゾーンのクロス集計 (二塁打のみ)");
  console.log("");
  const distBands = [[0, 35], [35, 45], [45, 55]] as const;
  console.log("| 距離帯 | 左線 | LF正面 | 左中間 | CF正面 | 右中間 | RF正面 | 右線 | 合計 |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [lo, hi] of distBands) {
    const row = zones.map(z => dblByZone[z].filter(l => l.estimatedDistance! >= lo && l.estimatedDistance! < hi).length);
    const total = row.reduce((a, b) => a + b, 0);
    console.log(`| ${lo}-${hi}m | ${row.join(" | ")} | ${total} |`);
  }
}

main();
