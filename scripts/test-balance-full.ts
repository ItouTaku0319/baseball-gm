#!/usr/bin/env tsx
// scripts/test-balance-full.ts - 1000試合バランステスト

import { simulateGame } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import type { Team, RosterLevel } from "../src/models/team";
import type { GameResult, AtBatLog } from "../src/models/league";

// CLI引数パース
const args = process.argv.slice(2);
const gamesArg = args.find((a) => a.startsWith("--games="));
const NUM_GAMES = gamesArg ? parseInt(gamesArg.split("=")[1]) : 1000;

// テストチーム生成
function createTestTeam(id: string, name: string): Team {
  const roster = generateRoster(65);
  const rosterLevels: Record<string, RosterLevel> = {};
  roster.forEach((p) => {
    rosterLevels[p.id] = "ichi_gun";
  });
  return {
    id,
    name,
    shortName: name,
    color: "#0066cc",
    roster,
    budget: 500000,
    fanBase: 60,
    homeBallpark: "テスト球場",
    rosterLevels,
  };
}

// 集計データ
interface AggregatedStats {
  totalGames: number;
  totalAB: number;
  totalHits: number;
  totalHR: number;
  totalK: number;
  totalBB: number;
  totalSF: number;
  totalPA: number;
  totalGroundBallOuts: number;
  totalFlyBallOuts: number;
}

function aggregate(results: GameResult[]): AggregatedStats {
  const stats: AggregatedStats = {
    totalGames: results.length,
    totalAB: 0,
    totalHits: 0,
    totalHR: 0,
    totalK: 0,
    totalBB: 0,
    totalSF: 0,
    totalPA: 0,
    totalGroundBallOuts: 0,
    totalFlyBallOuts: 0,
  };

  for (const result of results) {
    for (const ps of result.playerStats) {
      stats.totalAB += ps.atBats;
      stats.totalHits += ps.hits;
      stats.totalHR += ps.homeRuns;
      stats.totalK += ps.strikeouts;
      stats.totalBB += ps.walks;
      const sf = ps.sacrificeFlies ?? 0;
      stats.totalSF += sf;
      // PA = AB + BB + SF + HBP
      const hbp = ps.hitByPitch ?? 0;
      stats.totalPA += ps.atBats + ps.walks + sf + hbp;
    }
    for (const pg of result.pitcherStats) {
      stats.totalGroundBallOuts += pg.groundBallOuts ?? 0;
      stats.totalFlyBallOuts += pg.flyBallOuts ?? 0;
    }
  }

  return stats;
}

// 異常パターン
interface Anomaly {
  type: string;
  count: number;
  samples: string[];
}

interface AnomalyCount {
  infieldGroundDouble: number;
  infieldGroundTriple: number;
  shortDistanceLongHit: number;
  lowSpeedHR: number;
  groundTriple: number;
  infieldGroundDoubleSamples: string[];
  infieldGroundTripleSamples: string[];
  shortDistanceLongHitSamples: string[];
  lowSpeedHRSamples: string[];
  groundTripleSamples: string[];
}

const MAX_SAMPLES = 3;

function addSample(samples: string[], msg: string) {
  if (samples.length < MAX_SAMPLES) samples.push(msg);
}

function detectAnomalies(logs: AtBatLog[]): Anomaly[] {
  const counts: AnomalyCount = {
    infieldGroundDouble: 0,
    infieldGroundTriple: 0,
    shortDistanceLongHit: 0,
    lowSpeedHR: 0,
    groundTriple: 0,
    infieldGroundDoubleSamples: [],
    infieldGroundTripleSamples: [],
    shortDistanceLongHitSamples: [],
    lowSpeedHRSamples: [],
    groundTripleSamples: [],
  };

  for (const log of logs) {
    const fp = log.fielderPosition;
    const bbt = log.battedBallType;
    const result = log.result;
    const dist = log.estimatedDistance;
    const ev = log.exitVelocity;
    const dir = log.direction;

    // 内野ゴロ二塁打: fielderPos 1-6 + ground_ball + result="double"
    if (fp !== null && fp >= 1 && fp <= 6 && bbt === "ground_ball" && result === "double") {
      counts.infieldGroundDouble++;
      addSample(
        counts.infieldGroundDoubleSamples,
        `ポジション${fp} ゴロ EV=${ev?.toFixed(0) ?? "?"}km/h → double`
      );
    }

    // 内野ゴロ三塁打: fielderPos 1-6 + ground_ball + result="triple"
    if (fp !== null && fp >= 1 && fp <= 6 && bbt === "ground_ball" && result === "triple") {
      counts.infieldGroundTriple++;
      addSample(
        counts.infieldGroundTripleSamples,
        `ポジション${fp} ゴロ EV=${ev?.toFixed(0) ?? "?"}km/h → triple`
      );
    }

    // 短距離長打: estimatedDistance < 25m + result in ["double","triple"]
    // (25-50mの二塁打はギャップへのライナー(Texas Leaguer)で正常な結果)
    if (
      dist !== null &&
      dist < 25 &&
      (result === "double" || result === "triple")
    ) {
      counts.shortDistanceLongHit++;
      addSample(
        counts.shortDistanceLongHitSamples,
        `飛距離${dist.toFixed(1)}m 角度${log.launchAngle?.toFixed(1) ?? "?"}° EV=${ev?.toFixed(0) ?? "?"}km/h → ${result}`
      );
    }

    // 低速HR: exitVelocity < 100km/h + result="homerun"
    if (ev !== null && ev < 100 && result === "homerun") {
      counts.lowSpeedHR++;
      addSample(
        counts.lowSpeedHRSamples,
        `EV=${ev.toFixed(0)}km/h 角度${log.launchAngle?.toFixed(1) ?? "?"}° 飛距離${dist?.toFixed(1) ?? "?"}m → homerun`
      );
    }

    // ゴロ三塁打: ground_ball + result="triple"
    if (bbt === "ground_ball" && result === "triple") {
      counts.groundTriple++;
      addSample(
        counts.groundTripleSamples,
        `ポジション${fp ?? "?"} EV=${ev?.toFixed(0) ?? "?"}km/h 方向${dir?.toFixed(0) ?? "?"}° → triple`
      );
    }
  }

  return [
    {
      type: "内野ゴロ二塁打",
      count: counts.infieldGroundDouble,
      samples: counts.infieldGroundDoubleSamples,
    },
    {
      type: "内野ゴロ三塁打",
      count: counts.infieldGroundTriple,
      samples: counts.infieldGroundTripleSamples,
    },
    {
      type: "短距離長打",
      count: counts.shortDistanceLongHit,
      samples: counts.shortDistanceLongHitSamples,
    },
    {
      type: "低速HR",
      count: counts.lowSpeedHR,
      samples: counts.lowSpeedHRSamples,
    },
    {
      type: "ゴロ三塁打",
      count: counts.groundTriple,
      samples: counts.groundTripleSamples,
    },
  ];
}

// 判定ヘルパー
function check(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function mark(ok: boolean): string {
  return ok ? "✅" : "❌";
}

function pad(s: string, len: number): string {
  return s.padEnd(len, " ");
}

function padLeft(s: string, len: number): string {
  return s.padStart(len, " ");
}

// 結果出力
function printResults(
  stats: AggregatedStats,
  anomalies: Anomaly[],
  elapsedMs: number
): boolean {
  const elapsed = (elapsedMs / 1000).toFixed(1);

  const avg = stats.totalAB > 0 ? stats.totalHits / stats.totalAB : 0;
  const hrPerGame = stats.totalGames > 0 ? stats.totalHR / stats.totalGames : 0;
  const kPct = stats.totalPA > 0 ? (stats.totalK / stats.totalPA) * 100 : 0;
  const bbPct = stats.totalPA > 0 ? (stats.totalBB / stats.totalPA) * 100 : 0;
  const babipDenom =
    stats.totalAB - stats.totalK - stats.totalHR + stats.totalSF;
  const babip =
    babipDenom > 0 ? (stats.totalHits - stats.totalHR) / babipDenom : 0;
  const goao =
    stats.totalFlyBallOuts > 0
      ? stats.totalGroundBallOuts / stats.totalFlyBallOuts
      : 0;

  const avgOk = check(avg, 0.24, 0.28);
  const hrOk = check(hrPerGame, 1.0, 1.5);
  const kOk = check(kPct, 15, 25);
  const bbOk = check(bbPct, 7, 12);
  const babipOk = check(babip, 0.28, 0.32);
  const goaoOk = check(goao, 0.8, 1.3);

  const allOk = avgOk && hrOk && kOk && bbOk && babipOk && goaoOk;
  const totalAnomalies = anomalies.reduce((s, a) => s + a.count, 0);
  const totalLogs =
    stats.totalPA > 0 ? stats.totalPA : 1;
  const anomalyPct = ((totalAnomalies / totalLogs) * 100).toFixed(2);

  console.log("");
  console.log(`⚾ ${NUM_GAMES}試合バランステスト`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`実行時間: ${elapsed}秒`);
  console.log("");
  console.log("📊 基本指標");

  const fmt3 = (n: number) => n.toFixed(3);
  const fmt2 = (n: number) => n.toFixed(2);
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  console.log(
    `  ${pad("チーム打率", 10)} ${padLeft(fmt3(avg), 6)}  (.240-.280)  ${mark(avgOk)}`
  );
  console.log(
    `  ${pad("HR/試合", 10)} ${padLeft(fmt2(hrPerGame), 6)}  (1.0-1.5)   ${mark(hrOk)}`
  );
  console.log(
    `  ${pad("K%", 10)} ${padLeft(fmtPct(kPct), 6)}  (15-25%)    ${mark(kOk)}`
  );
  console.log(
    `  ${pad("BB%", 10)} ${padLeft(fmtPct(bbPct), 6)}  (7-12%)     ${mark(bbOk)}`
  );
  console.log(
    `  ${pad("BABIP", 10)} ${padLeft(fmt3(babip), 6)}  (.280-.320)  ${mark(babipOk)}`
  );
  console.log(
    `  ${pad("GO/AO", 10)} ${padLeft(fmt2(goao), 6)}  (0.8-1.3)   ${mark(goaoOk)}`
  );

  console.log("");
  console.log("⚠️  異常パターン検出");
  for (const anomaly of anomalies) {
    console.log(`  ${anomaly.type}: ${anomaly.count}件`);
    for (const sample of anomaly.samples) {
      console.log(`    例: ${sample}`);
    }
  }
  console.log("");
  console.log(
    `  合計: ${totalAnomalies}件 (${anomalyPct}%)`
  );
  console.log("");

  if (allOk && totalAnomalies === 0) {
    console.log("判定: ✅ 全指標正常");
    return true;
  } else {
    const failedMetrics: string[] = [];
    if (!avgOk) failedMetrics.push(`チーム打率=${fmt3(avg)}`);
    if (!hrOk) failedMetrics.push(`HR/試合=${fmt2(hrPerGame)}`);
    if (!kOk) failedMetrics.push(`K%=${fmtPct(kPct)}`);
    if (!bbOk) failedMetrics.push(`BB%=${fmtPct(bbPct)}`);
    if (!babipOk) failedMetrics.push(`BABIP=${fmt3(babip)}`);
    if (!goaoOk) failedMetrics.push(`GO/AO=${fmt2(goao)}`);
    if (totalAnomalies > 0) failedMetrics.push(`異常パターン${totalAnomalies}件`);
    console.log(`判定: ❌ 問題あり: ${failedMetrics.join(", ")}`);
    return false;
  }
}

// メイン
function main() {
  console.log(`⚾ ${NUM_GAMES}試合バランステスト開始...`);
  const start = Date.now();

  const results: GameResult[] = [];
  const step = Math.max(1, Math.floor(NUM_GAMES / 10));
  const ROTATE_EVERY = 100; // チームを100試合ごとにローテーション

  let teamA = createTestTeam("team-a", "テストA");
  let teamB = createTestTeam("team-b", "テストB");

  for (let i = 0; i < NUM_GAMES; i++) {
    // チームローテーション: 100試合ごとに新チーム生成
    if (i > 0 && i % ROTATE_EVERY === 0) {
      teamA = createTestTeam("team-a", "テストA");
      teamB = createTestTeam("team-b", "テストB");
    }
    results.push(simulateGame(teamA, teamB, { collectAtBatLogs: true }));
    if ((i + 1) % step === 0) {
      const pct = Math.round(((i + 1) / NUM_GAMES) * 100);
      process.stdout.write(`  進捗: ${pct}% (${i + 1}/${NUM_GAMES}試合)\n`);
    }
  }

  const elapsed = Date.now() - start;

  const stats = aggregate(results);
  const allLogs = results.flatMap((r) => r.atBatLogs ?? []);
  const anomalies = detectAnomalies(allLogs);

  const passed = printResults(stats, anomalies, elapsed);

  // 打球タイプ別ヒット率
  printBattedBallBreakdown(allLogs);

  // 守備分布チェック
  const fieldingPassed = printFieldingDistribution(allLogs, stats.totalGames);

  // 品質ゲート: exit codeで合否を返す
  if (!passed || !fieldingPassed) {
    process.exit(1);
  }
}

function printBattedBallBreakdown(logs: AtBatLog[]) {
  const HIT_RESULTS = new Set(["single", "double", "triple", "homerun", "infieldHit"]);
  const OUT_RESULTS = new Set(["groundout", "flyout", "lineout", "popout", "double_play"]);

  const types = ["ground_ball", "line_drive", "fly_ball", "popup"] as const;
  console.log("📊 打球タイプ別内訳");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let totalBIP = 0;
  for (const type of types) {
    const typeLogs = logs.filter((l) => l.battedBallType === type);
    const hits = typeLogs.filter((l) => HIT_RESULTS.has(l.result)).length;
    const outs = typeLogs.filter((l) => OUT_RESULTS.has(l.result) || l.result === "error" || l.result === "fielders_choice" || l.result === "sac_fly").length;
    const total = typeLogs.length;
    totalBIP += total;
    const hitRate = total > 0 ? (hits / total * 100).toFixed(1) : "0.0";
    console.log(`  ${type.padEnd(12)} ${String(total).padStart(5)}件  ヒット${String(hits).padStart(5)}  アウト${String(outs).padStart(5)}  ヒット率=${hitRate}%`);

    // result別の内訳
    const resultMap: Record<string, number> = {};
    for (const l of typeLogs) {
      resultMap[l.result] = (resultMap[l.result] || 0) + 1;
    }
    const resultStr = Object.entries(resultMap)
      .sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `${r}:${c}`)
      .join(", ");
    console.log(`    結果: ${resultStr}`);
  }

  console.log(`\n  合計BIP: ${totalBIP}件`);
  const bipPct = types.map((t) => {
    const c = logs.filter((l) => l.battedBallType === t).length;
    return `${t}=${(c / totalBIP * 100).toFixed(1)}%`;
  }).join(", ");
  console.log(`  分布: ${bipPct}`);
  console.log("");
}

/** 回収野手分布 + ポジション別TC/Gの表示とチェック */
function printFieldingDistribution(logs: AtBatLog[], totalGames: number): boolean {
  // 回収野手分布: ヒット(bouncePenalty付き)の回収者ポジションを集計
  const HIT_RESULTS = new Set(["single", "double", "triple", "infieldHit"]);
  const retrieverDist: Record<number, number> = {};
  let retrieverTotal = 0;

  for (const log of logs) {
    if (!HIT_RESULTS.has(log.result)) continue;
    const trace = log.fieldingTrace;
    if (!trace?.resolution?.bouncePenalty) continue;
    const pos = trace.resolution.bestFielderPos;
    retrieverDist[pos] = (retrieverDist[pos] ?? 0) + 1;
    retrieverTotal++;
  }

  console.log("🧤 回収野手分布");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const posNames: Record<number, string> = {
    1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
  };

  for (let p = 1; p <= 9; p++) {
    const count = retrieverDist[p] ?? 0;
    const pct = retrieverTotal > 0 ? (count / retrieverTotal * 100).toFixed(1) : "0.0";
    console.log(`  ${posNames[p].padEnd(3)} ${String(count).padStart(5)}件  (${pct.padStart(5)}%)`);
  }
  console.log(`  合計: ${retrieverTotal}件`);

  // 回収野手分布チェック (品質ゲート)
  const ofCount = (retrieverDist[7] ?? 0) + (retrieverDist[8] ?? 0) + (retrieverDist[9] ?? 0);
  const ofPct = retrieverTotal > 0 ? ofCount / retrieverTotal * 100 : 0;
  const cPct = retrieverTotal > 0 ? (retrieverDist[2] ?? 0) / retrieverTotal * 100 : 0;
  const pPct = retrieverTotal > 0 ? (retrieverDist[1] ?? 0) / retrieverTotal * 100 : 0;

  const ofOk = ofPct > 75;
  const cOk = cPct < 5;
  const pOk = pPct < 3;
  const allOk = ofOk && cOk && pOk;

  console.log("");
  console.log("  品質ゲート:");
  console.log(`  ${mark(ofOk)} OF回収率 (7+8+9): ${ofPct.toFixed(1)}%  (> 75%)`);
  console.log(`  ${mark(cOk)} C回収率 (2):      ${cPct.toFixed(1)}%  (< 5%)`);
  console.log(`  ${mark(pOk)} P回収率 (1):      ${pPct.toFixed(1)}%  (< 3%)`);
  console.log("");

  // ポジション別TC/G (参考指標 — 警告のみ)
  const tcByPos: Record<number, number> = {};
  for (const log of logs) {
    const trace = log.fieldingTrace;
    if (!trace?.resolution) continue;
    const pos = trace.resolution.bestFielderPos;
    if (pos >= 1 && pos <= 9) {
      tcByPos[pos] = (tcByPos[pos] ?? 0) + 1;
    }
  }

  const tcgBenchmarks: Record<number, { name: string; min: number; max: number; npb: number }> = {
    1: { name: "P",  min: 0.05, max: 3.5,  npb: 1.87 },
    2: { name: "C",  min: 5.0,  max: 10.5, npb: 8.15 },
    3: { name: "1B", min: 6.0,  max: 12.0, npb: 9.28 },
    4: { name: "2B", min: 2.5,  max: 7.5,  npb: 5.17 },
    5: { name: "3B", min: 1.0,  max: 4.5,  npb: 2.38 },
    6: { name: "SS", min: 2.5,  max: 7.0,  npb: 4.45 },
    7: { name: "LF", min: 0.8,  max: 4.0,  npb: 1.84 },
    8: { name: "CF", min: 1.0,  max: 4.5,  npb: 2.41 },
    9: { name: "RF", min: 0.8,  max: 4.0,  npb: 1.95 },
  };

  console.log("📊 ポジション別TC/G (参考)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (let p = 1; p <= 9; p++) {
    const tc = tcByPos[p] ?? 0;
    const tcg = totalGames > 0 ? tc / totalGames : 0;
    const bench = tcgBenchmarks[p];
    const inRange = tcg >= bench.min && tcg <= bench.max;
    const indicator = inRange ? "  " : "⚠️";
    console.log(`  ${indicator} ${bench.name.padEnd(3)} ${tcg.toFixed(2).padStart(5)} TC/G  (NPB: ${bench.npb}, 許容: ${bench.min}-${bench.max})`);
  }
  console.log("");

  if (!allOk) {
    const failedChecks: string[] = [];
    if (!ofOk) failedChecks.push(`OF回収率=${ofPct.toFixed(1)}%`);
    if (!cOk) failedChecks.push(`C回収率=${cPct.toFixed(1)}%`);
    if (!pOk) failedChecks.push(`P回収率=${pPct.toFixed(1)}%`);
    console.log(`判定: ❌ 守備分布に問題: ${failedChecks.join(", ")}`);
  } else {
    console.log("判定: ✅ 守備分布正常");
  }
  console.log("");

  return allOk;
}

main();
