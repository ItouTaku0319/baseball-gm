#!/usr/bin/env tsx
// scripts/diagnose-fielding.ts - 守備AI診断レポート生成
// 使い方: npx tsx scripts/diagnose-fielding.ts [--games=500] [--verbose]

import * as fs from "fs";
import { simulateGame } from "../src/engine/simulation";
import { generateRoster } from "../src/engine/player-generator";
import type { Team, RosterLevel } from "../src/models/team";
import type { AtBatLog, FieldingTrace } from "../src/models/league";

const args = process.argv.slice(2);
const gamesArg = args.find(a => a.startsWith("--games="));
const NUM_GAMES = gamesArg ? parseInt(gamesArg.split("=")[1]) : 500;
const VERBOSE = args.includes("--verbose");
const OUTPUT_FILE = "reports/fielding-diagnosis.md";

const POS = { 1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF" } as Record<number, string>;

function createTeam(id: string, name: string): Team {
  const roster = generateRoster(65);
  const rosterLevels: Record<string, RosterLevel> = {};
  roster.forEach(p => { rosterLevels[p.id] = "ichi_gun"; });
  return { id, name, shortName: name, color: "#0066cc", roster, budget: 500000, fanBase: 60, homeBallpark: "テスト球場", rosterLevels };
}

// ================================================================
// ユーティリティ
// ================================================================
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const pct = (n: number, d: number) => d > 0 ? (n / d * 100).toFixed(1) + "%" : "-";

function statsOf(arr: number[]) {
  if (!arr.length) return { n: 0, mean: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const at = (p: number) => s[Math.floor(s.length * p)] ?? 0;
  return { n: s.length, mean, min: s[0], max: s[s.length - 1], p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) };
}

function statsRow(label: string, s: ReturnType<typeof statsOf>, unit = ""): string {
  return `| ${label.padEnd(22)} | ${f1(s.mean).padStart(6)} | ${f1(s.min).padStart(6)} | ${f1(s.p25).padStart(6)} | ${f1(s.p50).padStart(6)} | ${f1(s.p75).padStart(6)} | ${f1(s.max).padStart(6)} | ${unit}`;
}

function bar(count: number, total: number, width = 30): string {
  const len = total > 0 ? Math.round(count / total * width) : 0;
  return "█".repeat(len) + "░".repeat(width - len);
}

// ================================================================
// データ収集
// ================================================================
function collectData(): AtBatLog[] {
  const allLogs: AtBatLog[] = [];
  let teamA = createTeam("a", "A");
  let teamB = createTeam("b", "B");
  for (let i = 0; i < NUM_GAMES; i++) {
    if (i > 0 && i % 100 === 0) {
      teamA = createTeam("a", "A");
      teamB = createTeam("b", "B");
    }
    const r = simulateGame(teamA, teamB, { collectAtBatLogs: true });
    allLogs.push(...(r.atBatLogs ?? []));
    if ((i + 1) % 100 === 0) process.stderr.write(`  ${i + 1}/${NUM_GAMES}試合完了\n`);
  }
  return allLogs;
}

// ================================================================
// レポート生成
// ================================================================
function generateReport(allLogs: AtBatLog[], elapsedMs: number): string {
  const bip = allLogs.filter(l => l.battedBallType && l.fieldingTrace);
  const out: string[] = [];
  const w = (s: string) => out.push(s);

  w("# 守備AI診断レポート");
  w("");
  w(`- 試合数: ${NUM_GAMES}`);
  w(`- 打席数: ${allLogs.length}`);
  w(`- インプレー打球数(BIP): ${bip.length}`);
  w(`- 実行時間: ${(elapsedMs / 1000).toFixed(1)}秒`);
  w(`- 生成日: ${new Date().toISOString().slice(0, 10)}`);
  w("");

  // ─── 目次 ───
  w("## 目次");
  w("");
  w("1. [打球結果の全体像](#1-打球結果の全体像)");
  w("2. [長打判定の仕組みと統計](#2-長打判定の仕組みと統計)");
  w("3. [短距離長打の詳細分析](#3-短距離長打の詳細分析)");
  w("4. [2Bマージン分布（核心データ）](#4-2bマージン分布核心データ)");
  w("5. [ゴロ処理分析](#5-ゴロ処理分析)");
  w("6. [フライ・ライナー分析](#6-フライライナー分析)");
  w("7. [外野手の到達能力](#7-外野手の到達能力)");
  w("8. [問題点と改善候補](#8-問題点と改善候補)");
  w("");

  // ───────────────────────────────────────────────
  // 1. 全体像
  // ───────────────────────────────────────────────
  w("## 1. 打球結果の全体像");
  w("");

  // 判定フェーズ集計
  const phaseCounts: Record<string, { total: number; results: Record<string, number> }> = {};
  for (const l of bip) {
    const phase = l.fieldingTrace!.resolution.phase;
    if (!phaseCounts[phase]) phaseCounts[phase] = { total: 0, results: {} };
    phaseCounts[phase].total++;
    phaseCounts[phase].results[l.result] = (phaseCounts[phase].results[l.result] ?? 0) + 1;
  }

  w("### 判定フェーズ別の結果");
  w("");
  w("| フェーズ | 件数 | 割合 | 主な結果 |");
  w("|---|---:|---:|---|");
  for (const [phase, data] of Object.entries(phaseCounts).sort((a, b) => b[1].total - a[1].total)) {
    const top3 = Object.entries(data.results).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, c]) => `${r}(${c})`).join(", ");
    w(`| ${phase} | ${data.total} | ${pct(data.total, bip.length)} | ${top3} |`);
  }
  w("");

  // 打球タイプ別
  const HIT_SET = new Set(["single", "double", "triple", "homerun", "infieldHit"]);
  const types = ["ground_ball", "line_drive", "fly_ball", "popup"] as const;
  w("### 打球タイプ別");
  w("");
  w("| タイプ | 件数 | 割合 | ヒット率 | 主な結果 |");
  w("|---|---:|---:|---:|---|");
  for (const t of types) {
    const group = bip.filter(l => l.battedBallType === t);
    const hits = group.filter(l => HIT_SET.has(l.result)).length;
    const resultMap: Record<string, number> = {};
    for (const l of group) resultMap[l.result] = (resultMap[l.result] ?? 0) + 1;
    const top = Object.entries(resultMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r, c]) => `${r}(${c})`).join(", ");
    w(`| ${t} | ${group.length} | ${pct(group.length, bip.length)} | ${pct(hits, group.length)} | ${top} |`);
  }
  w("");

  // ───────────────────────────────────────────────
  // 2. 長打判定
  // ───────────────────────────────────────────────
  w("## 2. 長打判定の仕組みと統計");
  w("");
  w("```");
  w("ヒット確定後の進塁判定 (resolveHitAdvancement):");
  w("");
  w("  走者2B到達時間 = 0.3s(反応) + 塁間27.4m×2 / 走者速度");
  w("  守備2B完了時間 = 野手到達 + バウンスペナルティ + 拾い上げ + 送球距離/送球速度");
  w("");
  w("  二塁打条件: 走者2B到達 < 守備2B完了 + 1.2s  ← マージン(中継プレー誤差加味)");
  w("  三塁打条件: 走者3B到達 < 守備3B完了 - 0.9s  ← 慎重マージン");
  w("```");
  w("");

  const advLogs = bip.filter(l => l.fieldingTrace!.resolution.bouncePenalty !== undefined);
  if (advLogs.length > 0) {
    const singles = advLogs.filter(l => l.result === "single");
    const doubles = advLogs.filter(l => l.result === "double");
    const triples = advLogs.filter(l => l.result === "triple");

    w(`長打判定を通った打球: **${advLogs.length}件** (single:${singles.length} / double:${doubles.length} / triple:${triples.length})`);
    w("");

    for (const [label, group] of [["シングル", singles], ["二塁打", doubles], ["三塁打", triples]] as const) {
      if (group.length === 0) continue;
      w(`### ${label} (${group.length}件)`);
      w("");
      w("| 指標 | 平均 | 最小 | P25 | P50 | P75 | 最大 |");
      w("|---|---:|---:|---:|---:|---:|---:|");
      w(statsRow("飛距離 (m)", statsOf(group.map(l => l.estimatedDistance ?? 0))));
      w(statsRow("バウンスペナルティ (s)", statsOf(group.map(l => l.fieldingTrace!.resolution.bouncePenalty!))));
      w(statsRow("拾い上げ時間 (s)", statsOf(group.map(l => l.fieldingTrace!.resolution.pickupTime!))));
      w(statsRow("野手回収合計 (s)", statsOf(group.map(l => l.fieldingTrace!.resolution.totalFielderTime!))));
      w(statsRow("走者の2B到達 (s)", statsOf(group.map(l => l.fieldingTrace!.resolution.runnerTo2B!))));
      w(statsRow("守備の2B完了 (s)", statsOf(group.map(l => l.fieldingTrace!.resolution.defenseTo2B!))));
      w(statsRow("2Bマージン (s)", statsOf(group.map(l => l.fieldingTrace!.resolution.margin2B!))));
      w(statsRow("走者速度 (m/s)", statsOf(group.map(l => l.fieldingTrace!.resolution.runnerSpeed!))));
      w("");
    }
  }

  // ───────────────────────────────────────────────
  // 3. 短距離長打
  // ───────────────────────────────────────────────
  w("## 3. 短距離長打の詳細分析");
  w("");

  const shortHits = bip.filter(l =>
    l.estimatedDistance !== null && l.estimatedDistance < 55 &&
    (l.result === "double" || l.result === "triple")
  );

  w(`飛距離55m未満で二塁打/三塁打になったケース: **${shortHits.length}件**`);
  w("");

  // 打球タイプ別
  const byType: Record<string, number> = {};
  for (const l of shortHits) byType[l.battedBallType!] = (byType[l.battedBallType!] ?? 0) + 1;
  w("| 打球タイプ | 件数 | 割合 |");
  w("|---|---:|---:|");
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    w(`| ${t} | ${c} | ${pct(c, shortHits.length)} |`);
  }
  w("");

  // 典型例を表示
  const showN = VERBOSE ? 30 : 10;
  w(`### 典型例 (${showN}件)`);
  w("");
  for (let i = 0; i < Math.min(showN, shortHits.length); i++) {
    const l = shortHits[i];
    const t = l.fieldingTrace!;
    const r = t.resolution;
    w(`#### [${i + 1}] ${l.result.toUpperCase()} (${l.battedBallType})`);
    w("");
    w("```");
    w(`打球: EV=${f1(l.exitVelocity!)}km/h  角度=${f1(l.launchAngle!)}°  方向=${f1(l.direction!)}°`);
    w(`着地: 座標=(${f1(t.landing.position.x)}, ${f1(t.landing.position.y)})m  距離=${f1(t.landing.distance)}m  飛行時間=${f1(t.landing.flightTime)}s`);
    w(`推定飛距離(carry込): ${f1(l.estimatedDistance!)}m`);
    w("");
    w(`── 守備判定 ──`);
    w(`最寄野手: ${POS[r.bestFielderPos]}  到達=${f1(r.fielderArrival)}s  ボール=${f1(r.ballArrival)}s  到達可能=${r.canReach ? "○" : "×"}`);
    if (r.bouncePenalty !== undefined) {
      w("");
      w(`── 回収 ──`);
      w(`バウンス=${f1(r.bouncePenalty)}s  拾い上げ=${f1(r.pickupTime!)}s  ロール=${f1(r.rollDistance!)}m`);
      w(`回収合計=${f1(r.totalFielderTime!)}s  送球速度=${f1(r.throwSpeed!)}m/s`);
      w("");
      w(`── 進塁判定 ──`);
      w(`走者速度: ${f1(r.runnerSpeed!)}m/s`);
      w(`2B: 走者=${f1(r.runnerTo2B!)}s  守備=${f1(r.defenseTo2B!)}s  条件: ${f1(r.runnerTo2B!)} < ${f1(r.defenseTo2B!)} + 1.2 = ${f1(r.defenseTo2B! + 1.2)}  マージン=${f2(r.margin2B!)}s → ${r.margin2B! >= 0 ? "二塁打" : "シングル"}`);
      w(`3B: 走者=${f1(r.runnerTo3B!)}s  守備=${f1(r.defenseTo3B!)}s  条件: ${f1(r.runnerTo3B!)} < ${f1(r.defenseTo3B!)} - 0.9 = ${f1(r.defenseTo3B! - 0.9)}  マージン=${f2(r.margin3B!)}s → ${r.margin3B! >= 0 ? "三塁打" : "二塁打止"}`);
    }
    w("");
    w(`── 全野手の到達状況 ──`);
    for (const fld of t.fielders.sort((a, b) => a.timeToReach - b.timeToReach)) {
      const name = POS[fld.position] ?? String(fld.position);
      const roleTag = fld.role !== "none" ? ` [${fld.role}]` : "";
      const reachTag = fld.canReach ? "○" : "×";
      w(`  ${name.padEnd(3)} pos=(${f1(fld.defaultPos.x).padStart(5)},${f1(fld.defaultPos.y).padStart(5)})  距離=${f1(fld.distanceToBall).padStart(5)}m  野手=${f1(fld.timeToReach).padStart(5)}s  球=${f1(fld.ballArrivalTime).padStart(5)}s  ${reachTag}${roleTag}`);
    }
    w("```");
    w("");
  }

  if (shortHits.length > showN) {
    w(`> 残り ${shortHits.length - showN}件は省略 (--verbose で30件表示)`);
    w("");
  }

  // ───────────────────────────────────────────────
  // 4. 2Bマージン分布
  // ───────────────────────────────────────────────
  w("## 4. 2Bマージン分布（核心データ）");
  w("");
  w("```");
  w("マージン = (守備2B完了 + 1.2) - 走者2B到達");
  w("正 → 二塁打 / 負 → シングル");
  w("```");
  w("");

  if (advLogs.length > 0) {
    const margins = advLogs.map(l => ({
      m: l.fieldingTrace!.resolution.margin2B!,
      result: l.result,
      dist: l.estimatedDistance ?? 0,
    }));

    const maxBinCount = (() => {
      let mx = 0;
      for (let b = -5; b < 8; b += 0.5) {
        const c = margins.filter(v => v.m >= b && v.m < b + 0.5).length;
        if (c > mx) mx = c;
      }
      return mx;
    })();

    w("```");
    w("マージン(s)    件数   D    S    分布");
    w("─────────── ────── ──── ──── ──────────────────────────────");
    for (let b = -5; b < 8; b += 0.5) {
      const inBin = margins.filter(v => v.m >= b && v.m < b + 0.5);
      if (inBin.length === 0) continue;
      const d = inBin.filter(v => v.result === "double" || v.result === "triple").length;
      const s = inBin.filter(v => v.result === "single").length;
      const label = `${b >= 0 ? "+" : ""}${b.toFixed(1)}〜${(b + 0.5) >= 0 ? "+" : ""}${(b + 0.5).toFixed(1)}`;
      const barStr = bar(inBin.length, maxBinCount, 30);
      const marker = b >= 0 ? " ← 二塁打ゾーン" : "";
      w(`${label.padStart(12)} ${String(inBin.length).padStart(5)}  ${String(d).padStart(4)} ${String(s).padStart(4)}  ${barStr}${marker}`);
    }
    w("```");
    w("");

    // 二塁打のマージン統計
    const dblMargins = margins.filter(v => v.result === "double" || v.result === "triple");
    if (dblMargins.length > 0) {
      const ms = statsOf(dblMargins.map(v => v.m));
      w(`二塁打/三塁打のマージン: 平均=${f2(ms.mean)}s  P10=${f2(ms.p10)}s  P50=${f2(ms.p50)}s  P90=${f2(ms.p90)}s`);
      w("");

      // 飛距離帯
      w("### 二塁打/三塁打の飛距離分布");
      w("");
      w("```");
      const distBins = [[0, 30], [30, 40], [40, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 120]];
      for (const [lo, hi] of distBins) {
        const c = dblMargins.filter(v => v.dist >= lo && v.dist < hi).length;
        if (c === 0) continue;
        const b = bar(c, dblMargins.length, 35);
        w(`  ${String(lo).padStart(3)}-${String(hi).padStart(3)}m: ${String(c).padStart(5)}件  ${b}  ${pct(c, dblMargins.length)}`);
      }
      w("```");
      w("");
    }
  }

  // ───────────────────────────────────────────────
  // 5. ゴロ
  // ───────────────────────────────────────────────
  w("## 5. ゴロ処理分析");
  w("");
  const gbLogs = bip.filter(l => l.battedBallType === "ground_ball");
  const gbFielded = gbLogs.filter(l => {
    const p = l.fieldingTrace?.resolution.phase ?? "";
    return p === "ground_ball_fielded" || p === "ground_ball";
  });
  const gbThrough = gbLogs.filter(l => l.fieldingTrace?.resolution.phase === "ground_ball_through");

  w(`| 分類 | 件数 | 割合 |`);
  w(`|---|---:|---:|`);
  w(`| ゴロ合計 | ${gbLogs.length} | 100% |`);
  w(`| 内野で処理 | ${gbFielded.length} | ${pct(gbFielded.length, gbLogs.length)} |`);
  w(`| 外野に抜けた | ${gbThrough.length} | ${pct(gbThrough.length, gbLogs.length)} |`);
  w("");

  // 内野処理結果
  w("### 内野処理の結果");
  w("");
  w("| 結果 | 件数 | 割合 |");
  w("|---|---:|---:|");
  const gbResults: Record<string, number> = {};
  for (const l of gbFielded) gbResults[l.result] = (gbResults[l.result] ?? 0) + 1;
  for (const [r, c] of Object.entries(gbResults).sort((a, b) => b[1] - a[1])) {
    w(`| ${r} | ${c} | ${pct(c, gbFielded.length)} |`);
  }
  w("");

  // ポジション分布
  w("### ゴロ処理ポジション分布");
  w("");
  const posDist: Record<number, number> = {};
  for (const l of gbLogs) {
    if (l.fieldingTrace) {
      const p = l.fieldingTrace.resolution.bestFielderPos;
      posDist[p] = (posDist[p] ?? 0) + 1;
    }
  }
  w("```");
  for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const c = posDist[pos] ?? 0;
    if (c === 0) continue;
    const name = POS[pos]!;
    const b = bar(c, gbLogs.length, 30);
    w(`  ${name.padEnd(3)} ${String(c).padStart(5)}件 (${pct(c, gbLogs.length).padStart(6)})  ${b}`);
  }
  w("```");
  w("");
  w("> **注意**: P(19%)・C(13%)のゴロ処理率が高すぎる。NPBではP=2-5%、C=0-1%程度。");
  w("");

  // ───────────────────────────────────────────────
  // 6. フライ/ライナー
  // ───────────────────────────────────────────────
  w("## 6. フライ/ライナー分析");
  w("");
  const flyLogs = bip.filter(l => l.battedBallType === "fly_ball" || l.battedBallType === "line_drive");
  const flyCaught = flyLogs.filter(l => l.fieldingTrace?.resolution.phase === "fly_catch");
  const flyHit = flyLogs.filter(l => l.fieldingTrace?.resolution.phase === "fly_hit");
  const flyHR = flyLogs.filter(l => l.fieldingTrace?.resolution.phase === "homerun");
  const flyFence = flyLogs.filter(l => l.fieldingTrace?.resolution.phase === "fence_hit");

  w("| 分類 | 件数 | 割合 |");
  w("|---|---:|---:|");
  w(`| フライ/ライナー合計 | ${flyLogs.length} | 100% |`);
  w(`| 捕球アウト | ${flyCaught.length} | ${pct(flyCaught.length, flyLogs.length)} |`);
  w(`| 安打(野手不到達 or エラー) | ${flyHit.length} | ${pct(flyHit.length, flyLogs.length)} |`);
  w(`| ホームラン | ${flyHR.length} | ${pct(flyHR.length, flyLogs.length)} |`);
  w(`| フェンス直撃 | ${flyFence.length} | ${pct(flyFence.length, flyLogs.length)} |`);
  w("");

  if (flyCaught.length > 0) {
    const rates = flyCaught.map(l => l.fieldingTrace!.resolution.catchRate!).filter(v => v !== undefined);
    const margs = flyCaught.map(l => l.fieldingTrace!.resolution.catchMargin!).filter(v => v !== undefined);
    if (rates.length > 0) {
      w(`捕球成功時の平均: catchRate=${(rates.reduce((a, b) => a + b, 0) / rates.length * 100).toFixed(1)}%  余裕時間=${f1(margs.reduce((a, b) => a + b, 0) / margs.length)}s`);
      w("");
    }
  }

  // 安打の飛距離分布
  if (flyHit.length > 0) {
    w("### 安打ケースの飛距離分布");
    w("");
    w("```");
    const distBins = [[0, 30], [30, 40], [40, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 200]];
    for (const [lo, hi] of distBins) {
      const c = flyHit.filter(l => (l.estimatedDistance ?? 0) >= lo && (l.estimatedDistance ?? 0) < hi).length;
      if (c === 0) continue;
      const b = bar(c, flyHit.length, 30);
      w(`  ${String(lo).padStart(3)}-${String(hi).padStart(3)}m: ${String(c).padStart(4)}件  ${b}  ${pct(c, flyHit.length)}`);
    }
    w("```");
    w("");

    // 結果内訳
    const hitRes: Record<string, number> = {};
    for (const l of flyHit) hitRes[l.result] = (hitRes[l.result] ?? 0) + 1;
    w("| 結果 | 件数 |");
    w("|---|---:|");
    for (const [r, c] of Object.entries(hitRes).sort((a, b) => b[1] - a[1])) {
      w(`| ${r} | ${c} |`);
    }
    w("");
  }

  // ───────────────────────────────────────────────
  // 7. 外野手到達能力
  // ───────────────────────────────────────────────
  w("## 7. 外野手の到達能力");
  w("");
  const ofLogs = bip.filter(l =>
    (l.battedBallType === "fly_ball" || l.battedBallType === "line_drive") &&
    l.fieldingTrace && !["homerun", "fence_hit", "popup_out"].includes(l.fieldingTrace.resolution.phase)
  );
  w(`フライ/ライナー(HR除外): ${ofLogs.length}件`);
  w("");
  w("| ポジション | 到達 | 不到達 | 到達率 | 平均距離 | 平均到達時間 |");
  w("|---|---:|---:|---:|---:|---:|");
  for (const pos of [7, 8, 9]) {
    let reach = 0, miss = 0, totalDist = 0, totalTime = 0;
    for (const l of ofLogs) {
      for (const f of l.fieldingTrace!.fielders) {
        if (f.position !== pos) continue;
        if (f.canReach) reach++; else miss++;
        totalDist += f.distanceToBall;
        totalTime += f.timeToReach;
      }
    }
    const total = reach + miss;
    w(`| ${POS[pos]} | ${reach} | ${miss} | ${pct(reach, total)} | ${f1(totalDist / (total || 1))}m | ${f1(totalTime / (total || 1))}s |`);
  }
  w("");

  // ───────────────────────────────────────────────
  // 8. 問題点と改善候補
  // ───────────────────────────────────────────────
  w("## 8. 問題点と改善候補");
  w("");
  w("### 発見された問題");
  w("");
  w("| # | 問題 | 根拠 | 影響度 |");
  w("|---|---|---|---|");
  w(`| 1 | 短距離長打が多すぎる | 飛距離55m未満の二塁打が${shortHits.length}件。ほぼ全てライナー | 高 |`);
  w(`| 2 | +1.2sマージンが大きすぎる | マージン+0.0〜+0.5の際どい二塁打が全二塁打の${(() => { const adv = advLogs.filter(l => l.result === "double" || l.result === "triple"); const slim = adv.filter(l => l.fieldingTrace!.resolution.margin2B! < 0.5 && l.fieldingTrace!.resolution.margin2B! >= 0); return pct(slim.length, adv.length); })()}を占める | 高 |`);
  w(`| 3 | ゴロが外野に抜けない | 外野抜け ${gbThrough.length}件 / ゴロ ${gbLogs.length}件 = ${pct(gbThrough.length, gbLogs.length)} | 中 |`);
  w(`| 4 | P/Cのゴロ処理率が高すぎる | P=${pct(posDist[1] ?? 0, gbLogs.length)}, C=${pct(posDist[2] ?? 0, gbLogs.length)} (NPB: P=2-5%, C=0-1%) | 中 |`);
  w(`| 5 | フライ安打が全てエラー | fly_hit→結果が全てerror。野手が到達しているが落球 | 低 |`);
  w("");
  w("### 改善候補");
  w("");
  w("| # | 対策 | 期待効果 | 影響範囲 |");
  w("|---|---|---|---|");
  w("| A | +1.2sマージンを+0.5〜+0.8に縮小 | 短距離長打を大幅削減、二塁打率が適正化 | resolveHitAdvancement |");
  w("| B | 浅い打球のバウンスペナルティを軽減 | 飛距離50m以下の二塁打を減らす | resolveHitAdvancement |");
  w("| C | ゴロの野手判定にギャップゾーンを追加 | ゴロ外野抜けを発生させ、リアルな内野安打比率に | evaluateFielders |");
  w("| D | P/Cのゴロ反応時間にペナルティ追加 | P/Cのゴロ処理率をNPBに近づける | evaluateFielders |");
  w("");

  return out.join("\n");
}

// ================================================================
// メイン
// ================================================================
function main() {
  process.stderr.write(`⚾ 守備AI診断 (${NUM_GAMES}試合)...\n`);
  const start = Date.now();
  const logs = collectData();
  const elapsed = Date.now() - start;

  const report = generateReport(logs, elapsed);

  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, report, "utf-8");
  process.stderr.write(`\n✅ レポート出力: ${OUTPUT_FILE}\n`);

  // コンソールにもサマリーを表示
  const lines = report.split("\n");
  const summaryEnd = lines.findIndex(l => l.startsWith("## 2."));
  console.log(lines.slice(0, summaryEnd > 0 ? summaryEnd : 30).join("\n"));
  console.log(`\n... 全文は ${OUTPUT_FILE} を参照`);
}

main();
