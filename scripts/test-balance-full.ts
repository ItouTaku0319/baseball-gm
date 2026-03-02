#!/usr/bin/env tsx
// scripts/test-balance-full.ts - 1000試合バランステスト

import { simulateGame } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import type { Team, RosterLevel } from "../src/models/team";
import type { GameResult, AtBatLog } from "../src/models/league";

// CLI引数パース
const args = process.argv.slice(2);
const gamesArg = args.find((a) => a.startsWith("--games="));
const NUM_GAMES = gamesArg ? parseInt(gamesArg.split("=")[1]) : 2000;

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
  const bbOk = check(bbPct, 6.5, 12);
  const babipOk = check(babip, 0.28, 0.32);
  const goaoOk = check(goao, 0.75, 1.3);

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
    `  ${pad("BB%", 10)} ${padLeft(fmtPct(bbPct), 6)}  (6.5-12%)   ${mark(bbOk)}`
  );
  console.log(
    `  ${pad("BABIP", 10)} ${padLeft(fmt3(babip), 6)}  (.280-.320)  ${mark(babipOk)}`
  );
  console.log(
    `  ${pad("GO/AO", 10)} ${padLeft(fmt2(goao), 6)}  (0.75-1.3)  ${mark(goaoOk)}`
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

/** ファウル関連指標の表示 */
function printFoulMetrics(logs: AtBatLog[], totalGames: number) {
  const OUT_RESULTS = new Set(["flyout", "popout"]);

  // ファウルアウト: direction < 0 or > 90 の flyout/popout
  let foulOuts = 0;
  // ファウルチップK: direction < -5 or > 95 の strikeout (fielderPosition === 2)
  let foulTipK = 0;
  // 全三振
  let totalK = 0;
  // コンタクト(打球あり)の打席
  let contactAB = 0;
  let fairBalls = 0;

  for (const log of logs) {
    const dir = log.direction;
    const result = log.result;

    if (result === "strikeout") totalK++;

    // 打球データがあるもの = コンタクト成功
    if (dir !== null) {
      contactAB++;
      if (dir >= 0 && dir <= 90) {
        fairBalls++;
      }

      // ファウルゾーンのアウト
      if ((dir < 0 || dir > 90) && OUT_RESULTS.has(result)) {
        foulOuts++;
      }

      // ファウルチップ三振
      if ((dir < -5 || dir > 95) && result === "strikeout" && log.fielderPosition === 2) {
        foulTipK++;
      }
    }
  }

  const foulOutsPerGame = totalGames > 0 ? foulOuts / totalGames : 0;
  const foulTipKPerGame = totalGames > 0 ? foulTipK / totalGames : 0;
  const foulTipKPct = totalK > 0 ? (foulTipK / totalK * 100) : 0;
  const fairRate = contactAB > 0 ? (fairBalls / contactAB * 100) : 0;

  console.log("⚾ ファウル関連指標");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  ファウルアウト/試合:  ${foulOutsPerGame.toFixed(2)}  (目標: ~1-2)`);
  console.log(`  ファウルチップK/試合: ${foulTipKPerGame.toFixed(2)}  (目標: ~0.7-1.4)`);
  console.log(`  ファウルチップK/全K:  ${foulTipKPct.toFixed(1)}%  (目標: 5-10%)`);
  console.log(`  フェア打球率:         ${fairRate.toFixed(1)}%  (目標: 60-70%)`);
  console.log(`  (コンタクト打席: ${contactAB}, フェア: ${fairBalls}, ファウルアウト: ${foulOuts}, ファウルチップK: ${foulTipK})`);
  console.log("");
}

// メイン
function main() {
  console.log(`⚾ ${NUM_GAMES}試合バランステスト開始...`);
  const start = Date.now();

  // ストリーミング集計: GameResultを蓄積せず即座に処理してメモリ解放
  const stats: AggregatedStats = {
    totalGames: 0, totalAB: 0, totalHits: 0, totalHR: 0,
    totalK: 0, totalBB: 0, totalSF: 0, totalPA: 0,
    totalGroundBallOuts: 0, totalFlyBallOuts: 0,
  };
  const allLogs: AtBatLog[] = [];
  const poByPos: Record<number, number> = {};
  const aByPos: Record<number, number> = {};
  const eByPos: Record<number, number> = {};

  const step = Math.max(1, Math.floor(NUM_GAMES / 10));
  const ROTATE_EVERY = 100;

  let teamA = createTestTeam("team-a", "テストA");
  let teamB = createTestTeam("team-b", "テストB");

  for (let i = 0; i < NUM_GAMES; i++) {
    if (i > 0 && i % ROTATE_EVERY === 0) {
      teamA = createTestTeam("team-a", "テストA");
      teamB = createTestTeam("team-b", "テストB");
    }
    const result = simulateGame(teamA, teamB, { collectAtBatLogs: true });

    // 即座に集計してresultの参照を手放す
    stats.totalGames++;
    for (const ps of result.playerStats) {
      stats.totalAB += ps.atBats;
      stats.totalHits += ps.hits;
      stats.totalHR += ps.homeRuns;
      stats.totalK += ps.strikeouts;
      stats.totalBB += ps.walks;
      const sf = ps.sacrificeFlies ?? 0;
      stats.totalSF += sf;
      const hbp = ps.hitByPitch ?? 0;
      stats.totalPA += ps.atBats + ps.walks + sf + hbp;

      // 守備指標集計
      const pos = ps.fieldingPosition;
      if (pos && pos >= 1 && pos <= 9) {
        poByPos[pos] = (poByPos[pos] ?? 0) + (ps.putOuts ?? 0);
        aByPos[pos] = (aByPos[pos] ?? 0) + (ps.assists ?? 0);
        eByPos[pos] = (eByPos[pos] ?? 0) + (ps.errors ?? 0);
      }
    }
    for (const pg of result.pitcherStats) {
      stats.totalGroundBallOuts += pg.groundBallOuts ?? 0;
      stats.totalFlyBallOuts += pg.flyBallOuts ?? 0;
    }
    if (result.atBatLogs) {
      for (const log of result.atBatLogs) {
        allLogs.push(log);
      }
    }

    if ((i + 1) % step === 0) {
      const pct = Math.round(((i + 1) / NUM_GAMES) * 100);
      process.stdout.write(`  進捗: ${pct}% (${i + 1}/${NUM_GAMES}試合)\n`);
    }
  }

  const elapsed = Date.now() - start;

  const anomalies = detectAnomalies(allLogs);
  const passed = printResults(stats, anomalies, elapsed);

  // 打球タイプ別ヒット率
  printBattedBallBreakdown(allLogs);

  // ファウル指標
  printFoulMetrics(allLogs, stats.totalGames);

  // 守備分布チェック（事前集計済みの poByPos/aByPos/eByPos を渡す）
  const fieldingPassed = printFieldingDistributionFromAgg(
    allLogs, stats.totalGames, poByPos, aByPos, eByPos
  );

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

/** 回収野手分布 + ポジション別TC/Gの表示とチェック（事前集計版） */
function printFieldingDistributionFromAgg(
  logs: AtBatLog[], totalGames: number,
  poByPos: Record<number, number>,
  aByPos: Record<number, number>,
  eByPos: Record<number, number>
): boolean {
  // 回収野手分布: ヒット打球の fielderPosition を集計
  const HIT_RESULTS = new Set(["single", "double", "triple", "infieldHit"]);
  const retrieverDist: Record<number, number> = {};
  let retrieverTotal = 0;

  for (const log of logs) {
    if (!HIT_RESULTS.has(log.result)) continue;
    const pos = log.fielderPosition;
    if (!pos || pos < 1 || pos > 9) continue;
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

  // NPB参考値（per team per game = 1人分）
  const fieldingBenchmarks: Record<number, { name: string; npbPO: number; npbA: number; npbTC: number; min: number; max: number }> = {
    1: { name: "P",  npbPO: 0.3,  npbA: 1.5,  npbTC: 1.87, min: 0.5, max: 3.5 },
    2: { name: "C",  npbPO: 7.7,  npbA: 0.4,  npbTC: 8.15, min: 5.0, max: 10.5 },
    3: { name: "1B", npbPO: 8.5,  npbA: 0.7,  npbTC: 9.28, min: 6.0, max: 12.0 },
    4: { name: "2B", npbPO: 2.0,  npbA: 3.1,  npbTC: 5.17, min: 2.5, max: 7.5 },
    5: { name: "3B", npbPO: 0.8,  npbA: 1.5,  npbTC: 2.38, min: 1.0, max: 4.5 },
    6: { name: "SS", npbPO: 1.5,  npbA: 2.9,  npbTC: 4.45, min: 2.5, max: 7.0 },
    7: { name: "LF", npbPO: 1.7,  npbA: 0.05, npbTC: 1.84, min: 0.8, max: 4.0 },
    8: { name: "CF", npbPO: 2.3,  npbA: 0.05, npbTC: 2.41, min: 1.0, max: 4.5 },
    9: { name: "RF", npbPO: 1.8,  npbA: 0.08, npbTC: 1.95, min: 0.8, max: 4.0 },
  };

  // teamGames = 1チーム1試合換算（各試合に2チームいるのでtotalGames×2）
  const teamGames = totalGames * 2;

  console.log("📊 ポジション別守備指標 (per team per game)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("     PO/G    A/G    E/G   TC/G │ NPB  PO    A   TC   許容範囲");
  console.log("  ─────────────────────────────┼────────────────────────────────");
  for (let p = 1; p <= 9; p++) {
    const bench = fieldingBenchmarks[p];
    const po = (poByPos[p] ?? 0) / teamGames;
    const a = (aByPos[p] ?? 0) / teamGames;
    const e = (eByPos[p] ?? 0) / teamGames;
    const tc = po + a + e;
    const inRange = tc >= bench.min && tc <= bench.max;
    const indicator = inRange ? "  " : "⚠️";
    console.log(
      `  ${indicator} ${bench.name.padEnd(3)}` +
      ` ${po.toFixed(2).padStart(5)}  ${a.toFixed(2).padStart(5)}  ${e.toFixed(2).padStart(5)}  ${tc.toFixed(2).padStart(5)}` +
      ` │ ${bench.npbPO.toFixed(1).padStart(4)} ${bench.npbA.toFixed(1).padStart(5)} ${bench.npbTC.toFixed(1).padStart(5)}` +
      `  (${bench.min}-${bench.max})`
    );
  }

  // 合計PO検証: 全PO/試合 ≈ 27アウト×2チーム = 54
  const totalPO = Object.values(poByPos).reduce((s, v) => s + v, 0);
  const totalA = Object.values(aByPos).reduce((s, v) => s + v, 0);
  const totalE = Object.values(eByPos).reduce((s, v) => s + v, 0);
  console.log("  ─────────────────────────────┼────────────────────────────────");
  console.log(
    `  合計` +
    ` ${(totalPO / teamGames).toFixed(2).padStart(5)}  ${(totalA / teamGames).toFixed(2).padStart(5)}  ${(totalE / teamGames).toFixed(2).padStart(5)}  ${((totalPO + totalA + totalE) / teamGames).toFixed(2).padStart(5)}` +
    ` │ 期待PO/team≈27.0`
  );
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
