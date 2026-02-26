// @ts-nocheck
/**
 * 守備AI網羅テスト → Excel出力
 *
 * 打球パラメータの全組み合わせで守備判定を行い、
 * 問題パターンをセル色で可視化したExcelファイルを出力する。
 *
 * Usage: npx tsx scripts/test-fielding-grid-excel.ts
 * Output: reports/fielding-grid.xlsx
 */

import ExcelJS from "exceljs";
import path from "path";
import { createCanvas } from "canvas";
import { calcBallLanding, evaluateFielders, DEFAULT_FIELDER_POSITIONS } from "../src/engine/fielding-ai";
import type { BallLanding, FielderDecision } from "../src/engine/fielding-ai";
import { classifyBattedBallType, estimateDistance, getFenceDistance } from "../src/engine/simulation";
import {
  GRAVITY, BAT_HEIGHT, FENCE_HEIGHT, TRAJECTORY_CARRY_FACTORS,
  BOUNCE_CLOSE_THRESHOLD, BOUNCE_NEAR_THRESHOLD, BOUNCE_MID_THRESHOLD,
} from "../src/engine/physics-constants";
import type { Player } from "../src/models/player";

// ========== パラメータ ==========
const DIRECTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const EXIT_VELOCITIES = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const LAUNCH_ANGLES = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type ResultType = "out" | "popupOut" | "error" | "infieldHit" | "single" | "double" | "triple" | "homerun";

const POS_NAMES: Record<number, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

// ========== テスト用選手(全能力50固定・再現性担保) ==========
const POSITION_MAP: Record<FielderPosition, Player["position"]> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function createTestPlayer(pos: FielderPosition): Player {
  const position = POSITION_MAP[pos];
  const isPitcher = pos === 1;
  return {
    id: `test-${position}`,
    name: `テスト${position}`,
    age: 25,
    position,
    isPitcher,
    throwHand: "R",
    batSide: "R",
    batting: {
      contact: 50, power: 50, trajectory: 2, speed: 50,
      arm: 50, fielding: 50, catching: 50, eye: 50,
    },
    pitching: isPitcher ? {
      velocity: 145, control: 50, pitches: [{ type: "slider", level: 4 }],
      stamina: 50, mentalToughness: 50, arm: 50, fielding: 50, catching: 50,
    } : null,
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
  };
}

function createFielderMap(): Map<FielderPosition, Player> {
  const map = new Map<FielderPosition, Player>();
  for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
    map.set(pos, createTestPlayer(pos));
  }
  return map;
}

// ========== 判定ロジック ==========
const BASE_LENGTH = 27.4;
const BASE_POSITIONS = {
  first:  { x: 19.4, y: 19.4 },
  second: { x: 0,    y: 38.8 },
  third:  { x: -19.4, y: 19.4 },
};
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function distToLanding(d: FielderDecision, landing: BallLanding): number {
  if (!d.posAtLanding) return d.distanceAtLanding ?? d.distanceToBall;
  return Math.sqrt(
    (d.posAtLanding.x - landing.position.x) ** 2 +
    (d.posAtLanding.y - landing.position.y) ** 2
  );
}

// simulation.tsと同様のロジックで回収者を選出
// - 外野converger(fly_converge, pos>=7)を distAtLanding 昇順で選択
// - 浅い打球(<30m)は内野手(pos 3-6)の方が近ければそちらを使用
// - フォールバック: 任意の外野手
function selectRetriever(
  fieldingResult: Map<FielderPosition, FielderDecision>,
  landing: BallLanding,
): FielderDecision | null {
  // 1. 外野converger(ボールに向かって走っていた最寄り)
  const ofConvergers = Array.from(fieldingResult.values())
    .filter(d => d.interceptType === "fly_converge" && d.position >= 7)
    .sort((a, b) => (a.distanceAtLanding ?? a.distanceToBall) - (b.distanceAtLanding ?? b.distanceToBall));
  let retriever: FielderDecision | null = ofConvergers[0] ?? null;

  // 2. 浅い打球(<30m)では内野手の方が近い場合がある
  if (landing.distance < 30) {
    const retDist = retriever
      ? distToLanding(retriever, landing)
      : Infinity;
    for (const d of fieldingResult.values()) {
      if (d.position <= 2 || d.position >= 7) continue; // 内野手のみ(3-6)
      const dist = distToLanding(d, landing);
      if (dist < retDist) { retriever = d; }
    }
  }

  // 3. フォールバック: 任意の外野手
  if (!retriever) {
    for (const d of fieldingResult.values()) {
      if (d.position >= 7) { retriever = d; break; }
    }
  }
  return retriever;
}

function getThrowDistToFirst(pos: number, fielder: FielderDecision): number {
  // targetPosがあればそこから1Bへの実際の距離を計算
  if (fielder.targetPos) {
    return Math.sqrt(
      (fielder.targetPos.x - BASE_POSITIONS.first.x) ** 2 +
      (fielder.targetPos.y - BASE_POSITIONS.first.y) ** 2
    );
  }
  const d: Record<number, number> = { 1: 19.4, 2: 26.7, 3: 9.0, 4: 19.3, 5: 40.3, 6: 33.8, 7: 55, 8: 65, 9: 55 };
  return d[pos] ?? 30;
}

function checkHR(dir: number, ev: number, la: number, trajectory: number): boolean {
  if (la < 10) return false;
  const distance = estimateDistance(ev, la);
  const fenceDist = getFenceDistance(dir);
  const baseCarry = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, trajectory - 1))];
  let carryFactor = baseCarry;
  if (la > 35) {
    const taper = Math.max(0, 1 - (la - 35) / 15);
    carryFactor = 1 + (baseCarry - 1) * taper;
  }
  const effDist = distance * carryFactor;
  if (effDist / fenceDist < 1.0) return false;
  const v0 = ev / 3.6;
  const theta = la * Math.PI / 180;
  const vy0 = v0 * Math.sin(theta);
  const gEff = GRAVITY / carryFactor;
  const tUp = vy0 / gEff;
  const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * gEff);
  const tDown = Math.sqrt(2 * maxH / gEff);
  const tRaw = tUp + tDown;
  const tFence = (fenceDist / effDist) * tRaw;
  const height = BAT_HEIGHT + vy0 * tFence - 0.5 * gEff * tFence * tFence;
  return height >= FENCE_HEIGHT;
}

// simulation.ts resolveGroundBallSequential と同様の逐次インターセプトモデル
// テストでは確定的に判定（Math.randomは使わない、捕球成功率判定をスキップ）
function resolveGroundBallResult(
  fieldingResult: Map<FielderPosition, FielderDecision>,
  landing: BallLanding,
  batter: Player,
): ResultType {
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;
  // simulation.tsと同値: スイング完了→打球方向確認→加速フェーズ
  const runnerTo1B = 0.7 + timePerBase;

  // --- フェーズ1: path_intercept 野手を projectionDistance 昇順にソート ---
  const pathInterceptors = Array.from(fieldingResult.values())
    .filter(d => d.interceptType === "path_intercept")
    .sort((a, b) => (a.projectionDistance ?? 0) - (b.projectionDistance ?? 0));

  for (const fielder of pathInterceptors) {
    // timeToReach > ballArrival → ボール通過（次の野手へ）
    if (fielder.timeToReach > fielder.ballArrivalTime) continue;

    // 捕球成功とみなす（テストでは確定的判定）
    // Phase1 secureTime: simulation.tsと同値
    const skill = fielder.skill;
    const secureTime = 0.2 + (1 - skill.fielding / 100) * 0.2;
    const transferTime = 0.45 + (1 - skill.arm / 100) * 0.25;
    const throwSpeed = 25 + (skill.arm / 100) * 15;
    const fieldTime = Math.max(fielder.timeToReach, fielder.ballArrivalTime);
    const throwDist = getThrowDistToFirst(fielder.position, fielder);
    const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
    return runnerTo1B < defenseTime ? "infieldHit" : "out";
  }

  // --- フェーズ2: chase_to_stop 内野手（投手・外野手除く）で最寄り ---
  let chaseFielder: FielderDecision | null = null;
  let minChaseDist = Infinity;
  for (const decision of fieldingResult.values()) {
    if (decision.interceptType !== "chase_to_stop" || !decision.canReach) continue;
    if (decision.position > 6 || decision.position === 1) continue;
    const distAtLand = distToLanding(decision, landing);
    if (distAtLand < minChaseDist) {
      minChaseDist = distAtLand;
      chaseFielder = decision;
    }
  }

  if (chaseFielder) {
    const fielder = chaseFielder;
    const skill = fielder.skill;
    // Phase2 secureTime: simulation.tsと同値
    const secureTime = 0.15 + (1 - skill.fielding / 100) * 0.15;
    const transferTime = 0.45 + (1 - skill.arm / 100) * 0.25;
    const throwSpeed = 25 + (skill.arm / 100) * 15;
    const fieldTime = Math.max(fielder.timeToReach, fielder.ballArrivalTime);
    const throwDist = getThrowDistToFirst(fielder.position, fielder);
    const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
    return runnerTo1B < defenseTime ? "infieldHit" : "out";
  }

  // --- フェーズ3: 誰も届かない → single（外野抜け）---
  return "single";
}

// simulation.ts resolveHitAdvancement と同様のロジック
// テストでは確定的判定（Math.randomの代わりに中央値を使用）
function resolveHitAdvancement(
  ball: { direction: number; exitVelocity: number },
  landing: BallLanding,
  retriever: FielderDecision,
  batter: Player,
): ResultType {
  const skill = retriever.skill;
  const distAtLanding = retriever.distanceAtLanding ?? retriever.distanceToBall;
  const fenceDist = getFenceDistance(ball.direction);

  let bouncePenalty: number;
  let rollDistance: number;

  if (landing.isGroundBall) {
    // ゴロが外野に抜けた場合: Math.random() * 0.5 → 中央値 0.25
    bouncePenalty = 0.5 + 0.25;
    rollDistance = 3;
  } else {
    // フライ/ライナー: depthFactorベースのバウンドペナルティ (simulation.tsと同値)
    // Math.random() * 0.4 → 中央値 0.2
    const depthFactor = clamp((landing.distance - 50) / 50, 0, 1);
    bouncePenalty = 0.3 + depthFactor * 0.5 + 0.2;
    rollDistance = clamp((landing.distance - 50) * 0.08, 0, 6);

    // フェンス際: Math.random() * 0.6 → 中央値 0.3
    if (landing.distance >= fenceDist * 0.90) {
      bouncePenalty += 0.6 + 0.3;
      rollDistance = Math.min(rollDistance + 3, 10);
    }
  }

  const pickupTime = 0.3 + (1 - skill.catching / 100) * 0.4;
  const runSpeedFielder = retriever.speed ?? 6.5;
  const additionalRunTime = distAtLanding / runSpeedFielder;
  const totalFielderTime = landing.isGroundBall
    ? retriever.timeToReach + bouncePenalty + pickupTime
    : retriever.ballArrivalTime + additionalRunTime + bouncePenalty + pickupTime;

  const throwSpeed = 25 + (skill.arm / 100) * 15;
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;

  const angleRad = (ball.direction - 45) * Math.PI / 180;
  const retrievalPos = {
    x: landing.position.x + rollDistance * Math.sin(angleRad),
    y: landing.position.y + rollDistance * Math.cos(angleRad),
  };

  // simulation.tsと同じ塁座標を使用
  const throwTo2B = Math.sqrt(
    (retrievalPos.x - BASE_POSITIONS.second.x) ** 2 +
    (retrievalPos.y - BASE_POSITIONS.second.y) ** 2
  );
  const throwTo3B = Math.sqrt(
    (retrievalPos.x - BASE_POSITIONS.third.x) ** 2 +
    (retrievalPos.y - BASE_POSITIONS.third.y) ** 2
  );

  const runnerTo2B = 0.3 + timePerBase * 2;
  const runnerTo3B = 0.3 + timePerBase * 3;
  const defenseTo2B = totalFielderTime + throwTo2B / throwSpeed;
  const defenseTo3B = totalFielderTime + throwTo3B / throwSpeed;

  let basesReached = 1;
  // simulation.tsと同じマージン: -0.3 (旧: +1.2)
  if (runnerTo2B < defenseTo2B - 0.3) basesReached = 2;
  if (basesReached >= 2 && runnerTo3B < defenseTo3B - 0.9) basesReached = 3;

  // ゴロで3塁打は現実的でない
  if (landing.isGroundBall) basesReached = Math.min(basesReached, 2);
  // 短距離(<25m)に落ちた打球は長打にならない
  if (landing.distance < 25) basesReached = Math.min(basesReached, 1);

  if (basesReached >= 3) return "triple";
  if (basesReached >= 2) return "double";
  return "single";
}

// ========== テスト実行 ==========
interface TestRow {
  direction: number;
  exitVelocity: number;
  launchAngle: number;
  ballType: string;
  landingX: number;
  landingY: number;
  distance: number;
  result: ResultType;
  primaryPos: string;
  primaryCanReach: boolean;
  retrieverPos: string;
  retrieverDist: number;
  // 問題フラグ
  issues: string[];
}

const fielderMap = createFielderMap();
const runners = { first: false, second: false, third: false };
const batter = [...fielderMap.values()].find(p => p.position !== "P")!;
const rows: TestRow[] = [];

for (const dir of DIRECTIONS) {
  for (const ev of EXIT_VELOCITIES) {
    for (const la of LAUNCH_ANGLES) {
      const ballType = classifyBattedBallType(la, ev);
      const landing = calcBallLanding(dir, la, ev);
      const fieldingResult = evaluateFielders(landing, ballType, fielderMap, runners, 0);

      let best: FielderDecision | null = null;
      for (const d of fieldingResult.values()) {
        if (!d.canReach) continue;
        if (!best || d.timeToReach < best.timeToReach) best = d;
      }
      if (!best) {
        for (const d of fieldingResult.values()) {
          if (!best || d.distanceToBall < best.distanceToBall) best = d;
        }
      }
      if (!best) continue;

      let result: ResultType;
      let retrieverPos = best.position;
      let retrieverDist = 0;

      if ((ballType === "fly_ball" || ballType === "popup") && checkHR(dir, ev, la, 2)) {
        result = "homerun";
      } else if (ballType === "popup") {
        result = "popupOut";
      } else if (ballType === "ground_ball") {
        // ゴロ: 逐次インターセプトモデルで判定（fieldingResult全体を渡す）
        result = resolveGroundBallResult(fieldingResult, landing, batter);
      } else if (best.canReach) {
        result = "out";
      } else {
        const retriever = selectRetriever(fieldingResult, landing) ?? best;
        retrieverPos = retriever.position;
        retrieverDist = Math.round(distToLanding(retriever, landing) * 10) / 10;
        result = resolveHitAdvancement({ direction: dir, exitVelocity: ev }, landing, retriever, batter);
      }

      // 問題判定
      const issues: string[] = [];
      const isHit = !["out", "popupOut", "error"].includes(result);
      if (isHit && landing.distance > 50 && (retrieverPos === 1 || retrieverPos === 2)) {
        issues.push("遠距離P/C回収");
      }
      if (isHit && ballType === "ground_ball" && landing.distance < 25 && retrieverPos >= 7) {
        issues.push("浅ゴロOF回収");
      }
      if (isHit && landing.distance > 60 && retrieverPos >= 3 && retrieverPos <= 6) {
        issues.push("深打球IF回収");
      }
      if (landing.distance < 50 && (result === "double" || result === "triple")) {
        issues.push("短距離長打");
      }
      if (landing.distance > 60 && result === "single") {
        issues.push("長距離単打");
      }
      if (isHit && ballType === "fly_ball" && retrieverPos === 2 && landing.distance > 10) {
        issues.push("フライC回収");
      }

      rows.push({
        direction: dir, exitVelocity: ev, launchAngle: la, ballType,
        landingX: Math.round(landing.position.x * 10) / 10,
        landingY: Math.round(landing.position.y * 10) / 10,
        distance: Math.round(landing.distance * 10) / 10,
        result,
        primaryPos: POS_NAMES[best.position],
        primaryCanReach: best.canReach,
        retrieverPos: POS_NAMES[retrieverPos],
        retrieverDist,
        issues,
      });
    }
  }
}

// ========== Excel出力 ==========
async function writeExcel() {
  const wb = new ExcelJS.Workbook();

  // --- Sheet 1: 全データ ---
  const ws = wb.addWorksheet("全データ", { views: [{ state: "frozen", ySplit: 1 }] });

  const headers = [
    "方向(°)", "速度(km/h)", "角度(°)", "打球タイプ",
    "着地X(m)", "着地Y(m)", "飛距離(m)", "結果",
    "primary", "到達可", "回収者", "回収距離(m)", "問題",
  ];
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
  headerRow.alignment = { horizontal: "center" };

  // 色定義
  const COLORS = {
    out: "FFE8E8E8",         // 薄いグレー
    popupOut: "FFB0BEC5",    // 青灰色（ポップフライアウト）
    infieldHit: "FF81D4FA",  // 水色（内野安打）
    single: "FFC8E6C9",     // 緑
    double: "FFFFECB3",     // 黄色
    triple: "FFFFCC80",     // オレンジ
    homerun: "FFEF9A9A",    // 赤
    error: "FFCE93D8",      // 紫
  };
  const ISSUE_BG = "FFFF8A80";    // 問題あり: 濃い赤
  const WARN_BG = "FFFFF176";     // 警告: 濃い黄色

  for (const row of rows) {
    const r = ws.addRow([
      row.direction, row.exitVelocity, row.launchAngle, row.ballType,
      row.landingX, row.landingY, row.distance, row.result,
      row.primaryPos, row.primaryCanReach ? "○" : "×",
      row.retrieverPos, row.retrieverDist,
      row.issues.join(", "),
    ]);

    // 結果列に色
    const resultCell = r.getCell(8);
    const color = COLORS[row.result as keyof typeof COLORS];
    if (color) {
      resultCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    }

    // 問題がある行は問題列に色
    if (row.issues.length > 0) {
      const issueCell = r.getCell(13);
      const hasError = row.issues.some(i =>
        ["遠距離P/C回収", "浅ゴロOF回収", "深打球IF回収"].includes(i)
      );
      issueCell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: hasError ? ISSUE_BG : WARN_BG },
      };
      issueCell.font = { bold: true };

      // 行全体を薄く色付け
      for (let c = 1; c <= 12; c++) {
        r.getCell(c).fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: hasError ? "FFFFCDD2" : "FFFFF9C4" },
        };
      }
      // 結果列は元の色を維持
      resultCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color ?? "FFFFFFFF" } };
    }

    // 到達可列の色
    const reachCell = r.getCell(10);
    reachCell.fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: row.primaryCanReach ? "FFC8E6C9" : "FFFFCDD2" },
    };

    r.alignment = { horizontal: "center" };
  }

  // 列幅
  ws.columns = [
    { width: 8 }, { width: 11 }, { width: 8 }, { width: 14 },
    { width: 9 }, { width: 9 }, { width: 9 }, { width: 11 },
    { width: 8 }, { width: 7 }, { width: 8 }, { width: 11 }, { width: 20 },
  ];

  // オートフィルター
  ws.autoFilter = { from: "A1", to: "M1" };

  // --- Sheet 2: ヒートマップ(速度×角度) ---
  const ws2 = wb.addWorksheet("ヒートマップ");
  ws2.addRow(["速度×角度 → 最頻結果 (全方向合算)"]).font = { bold: true, size: 14 };
  ws2.addRow([]);

  const hmHeaderRow = ws2.addRow(["速度(km/h)", ...LAUNCH_ANGLES.map(a => `${a}°`)]);
  hmHeaderRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hmHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
  hmHeaderRow.alignment = { horizontal: "center" };

  for (const ev of EXIT_VELOCITIES) {
    const cells: string[] = [];
    for (const la of LAUNCH_ANGLES) {
      const cases = rows.filter(r => r.exitVelocity === ev && r.launchAngle === la);
      if (cases.length === 0) { cells.push("-"); continue; }
      const counts: Record<string, number> = {};
      for (const c of cases) counts[c.result] = (counts[c.result] ?? 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const abbrev: Record<string, string> = {
        out: "OUT", popupOut: "POP", infieldHit: "IFH", single: "1B", double: "2B",
        triple: "3B", homerun: "HR", error: "ERR",
      };
      cells.push(abbrev[top] ?? "?");
    }
    const r = ws2.addRow([`${ev}`, ...cells]);
    r.alignment = { horizontal: "center" };

    // セルに色
    for (let i = 0; i < cells.length; i++) {
      const cell = r.getCell(i + 2);
      const resultMap: Record<string, string> = {
        "OUT": COLORS.out, "POP": COLORS.popupOut, "IFH": COLORS.infieldHit,
        "1B": COLORS.single, "2B": COLORS.double, "3B": COLORS.triple, "HR": COLORS.homerun,
      };
      const c = resultMap[cells[i]];
      if (c) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c } };
    }
  }
  ws2.columns = [{ width: 12 }, ...LAUNCH_ANGLES.map(() => ({ width: 7 }))];

  // --- Sheet 3: 回収野手分布 ---
  const ws3 = wb.addWorksheet("回収者分布");
  ws3.addRow(["打球タイプ別 回収野手分布 (ヒットのみ)"]).font = { bold: true, size: 14 };
  ws3.addRow([]);

  const hitRows = rows.filter(r => !["out", "popupOut", "error", "homerun"].includes(r.result));
  const types = ["ground_ball", "line_drive", "fly_ball"];
  const posNames = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

  const distHeader = ws3.addRow(["打球タイプ", ...posNames, "合計"]);
  distHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  distHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
  distHeader.alignment = { horizontal: "center" };

  for (const type of types) {
    const cases = hitRows.filter(r => r.ballType === type);
    const counts: Record<string, number> = {};
    for (const c of cases) counts[c.retrieverPos] = (counts[c.retrieverPos] ?? 0) + 1;
    const total = cases.length;
    const r = ws3.addRow([type, ...posNames.map(p => counts[p] ?? 0), total]);
    r.alignment = { horizontal: "center" };

    // P, Cが多い場合は赤
    for (let i = 0; i < posNames.length; i++) {
      const cell = r.getCell(i + 2);
      const cnt = counts[posNames[i]] ?? 0;
      const pct = total > 0 ? cnt / total : 0;
      if (posNames[i] === "P" || posNames[i] === "C") {
        if (pct > 0.20) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ISSUE_BG } };
          cell.font = { bold: true };
        } else if (pct > 0.10) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN_BG } };
        }
      }
      // OFが少ない場合は黄色
      if (["LF", "CF", "RF"].includes(posNames[i]) && type === "fly_ball" && pct < 0.05 && cnt > 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN_BG } };
      }
    }
  }

  // パーセンテージ行
  ws3.addRow([]);
  const pctHeader = ws3.addRow(["(割合%)", ...posNames, ""]);
  pctHeader.font = { bold: true, italic: true };
  pctHeader.alignment = { horizontal: "center" };
  for (const type of types) {
    const cases = hitRows.filter(r => r.ballType === type);
    const counts: Record<string, number> = {};
    for (const c of cases) counts[c.retrieverPos] = (counts[c.retrieverPos] ?? 0) + 1;
    const total = cases.length || 1;
    const r = ws3.addRow([
      type,
      ...posNames.map(p => `${((counts[p] ?? 0) / total * 100).toFixed(1)}%`),
      "100%",
    ]);
    r.alignment = { horizontal: "center" };

    for (let i = 0; i < posNames.length; i++) {
      const cell = r.getCell(i + 2);
      const pct = (counts[posNames[i]] ?? 0) / total;
      if ((posNames[i] === "P" || posNames[i] === "C") && pct > 0.20) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ISSUE_BG } };
        cell.font = { bold: true };
      } else if ((posNames[i] === "P" || posNames[i] === "C") && pct > 0.10) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN_BG } };
      }
    }
  }

  ws3.columns = [{ width: 14 }, ...posNames.map(() => ({ width: 8 })), { width: 8 }];

  // --- Sheet 4: 問題サマリー ---
  const ws4 = wb.addWorksheet("問題サマリー");
  ws4.addRow(["問題パターン検出結果"]).font = { bold: true, size: 14 };
  ws4.addRow([]);

  const issueTypes = [
    { label: "遠距離P/C回収 (dist>50m)", filter: "遠距離P/C回収", severity: "error" },
    { label: "浅ゴロOF回収 (dist<25m)", filter: "浅ゴロOF回収", severity: "error" },
    { label: "深打球IF回収 (dist>60m)", filter: "深打球IF回収", severity: "error" },
    { label: "短距離長打 (dist<50m, 2B/3B)", filter: "短距離長打", severity: "warn" },
    { label: "長距離単打 (dist>60m, 1B)", filter: "長距離単打", severity: "warn" },
    { label: "フライC回収 (dist>10m)", filter: "フライC回収", severity: "warn" },
  ];

  const sumHeader = ws4.addRow(["問題パターン", "件数", "判定"]);
  sumHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  sumHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };

  for (const issue of issueTypes) {
    const count = rows.filter(r => r.issues.includes(issue.filter)).length;
    const r = ws4.addRow([issue.label, count, count === 0 ? "✅ OK" : (issue.severity === "error" ? "❌ NG" : "⚠️ 注意")]);
    if (count > 0) {
      const color = issue.severity === "error" ? ISSUE_BG : WARN_BG;
      r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      r.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      r.getCell(3).font = { bold: true };
    } else {
      r.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8E6C9" } };
    }
  }

  ws4.addRow([]);
  ws4.addRow([`テスト総数: ${rows.length}ケース`]);
  ws4.addRow([`パラメータ: 方向=${DIRECTIONS.length}段階 × 速度=${EXIT_VELOCITIES.length}段階 × 角度=${LAUNCH_ANGLES.length}段階`]);

  ws4.columns = [{ width: 30 }, { width: 8 }, { width: 10 }];

  // --- Sheet 5: フィールドマップ ---
  await addFieldMapSheet(wb, rows);

  // 保存
  // タイムスタンプ付きで出力(ロック回避)
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "");
  const outPath = path.resolve(`reports/fielding-grid-${ts}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  console.log(`✅ Excel出力完了: ${outPath}`);
  console.log(`  シート1: 全データ (${rows.length}行, フィルター付き)`);
  console.log(`  シート2: ヒートマップ (速度×角度)`);
  console.log(`  シート3: 回収者分布`);
  console.log(`  シート4: 問題サマリー`);

  const issueCount = rows.filter(r => r.issues.length > 0).length;
  const errorCount = rows.filter(r => r.issues.some(i =>
    ["遠距離P/C回収", "浅ゴロOF回収", "深打球IF回収"].includes(i)
  )).length;
  console.log(`\n  問題行: ${issueCount}件 (うちエラー: ${errorCount}件, 警告: ${issueCount - errorCount}件)`);
}

// ========== フィールドマップ画像生成 ==========

const RESULT_COLORS: Record<string, string> = {
  out: "#AAAAAA",
  popupOut: "#78909C",
  infieldHit: "#29B6F6",
  single: "#43A047",
  double: "#FDD835",
  triple: "#FF9800",
  homerun: "#E53935",
  error: "#AB47BC",
};

const RESULT_LABELS: Record<string, string> = {
  out: "OUT", popupOut: "POP", infieldHit: "IFH", single: "1B",
  double: "2B", triple: "3B", homerun: "HR",
};

/** フィールド座標(m) → キャンバス座標(px) 変換 */
function createTransform(canvasSize: number, fieldRange: number) {
  const margin = 60;
  const scale = (canvasSize - margin * 2) / (fieldRange * 2);
  return {
    x: (fieldX: number) => canvasSize / 2 + fieldX * scale,
    y: (fieldY: number) => canvasSize - margin - fieldY * scale,
    scale,
  };
}

/** 球場の背景を描画 */
function drawField(
  ctx: CanvasRenderingContext2D,
  W: number, H: number, fieldRange: number
) {
  const t = createTransform(W, fieldRange);

  // 背景
  ctx.fillStyle = "#1a3a1a";
  ctx.fillRect(0, 0, W, H);

  // 外野芝(扇形)
  ctx.beginPath();
  ctx.moveTo(t.x(0), t.y(0));
  // フェンス弧: 方向0-90をなぞる
  for (let deg = 0; deg <= 90; deg += 1) {
    const rad = (deg - 45) * Math.PI / 180;
    const fenceDist = getFenceDistance(deg);
    ctx.lineTo(t.x(fenceDist * Math.sin(rad)), t.y(fenceDist * Math.cos(rad)));
  }
  ctx.closePath();
  ctx.fillStyle = "#2d5a2d";
  ctx.fill();

  // フェンスライン
  ctx.beginPath();
  for (let deg = 0; deg <= 90; deg += 1) {
    const rad = (deg - 45) * Math.PI / 180;
    const fenceDist = getFenceDistance(deg);
    const px = t.x(fenceDist * Math.sin(rad));
    const py = t.y(fenceDist * Math.cos(rad));
    if (deg === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = "#FFD54F";
  ctx.lineWidth = 3;
  ctx.stroke();

  // 内野ダイヤモンド(茶色)
  const bases = [
    { x: 0, y: 0 },       // Home
    { x: 19.4, y: 19.4 }, // 1B
    { x: 0, y: 38.8 },    // 2B
    { x: -19.4, y: 19.4 },// 3B
  ];
  // 内野土
  ctx.beginPath();
  ctx.arc(t.x(0), t.y(19.4), 28 * t.scale, 0, Math.PI * 2);
  ctx.fillStyle = "#8B6914";
  ctx.fill();
  // ダイヤモンドライン
  ctx.beginPath();
  ctx.moveTo(t.x(bases[0].x), t.y(bases[0].y));
  for (const b of [...bases.slice(1), bases[0]]) ctx.lineTo(t.x(b.x), t.y(b.y));
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.stroke();

  // ファウルライン
  ctx.beginPath();
  ctx.moveTo(t.x(0), t.y(0));
  const fenceL = getFenceDistance(0);
  ctx.lineTo(t.x(fenceL * Math.sin(-45 * Math.PI / 180)), t.y(fenceL * Math.cos(-45 * Math.PI / 180)));
  ctx.moveTo(t.x(0), t.y(0));
  const fenceR = getFenceDistance(90);
  ctx.lineTo(t.x(fenceR * Math.sin(45 * Math.PI / 180)), t.y(fenceR * Math.cos(45 * Math.PI / 180)));
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 塁マーカー
  ctx.fillStyle = "#FFFFFF";
  for (const b of bases) {
    ctx.fillRect(t.x(b.x) - 4, t.y(b.y) - 4, 8, 8);
  }

  // 守備位置マーカー
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [pos, fpos] of DEFAULT_FIELDER_POSITIONS) {
    const px = t.x(fpos.x);
    const py = t.y(fpos.y);
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(POS_NAMES[pos], px, py);
  }
}

/** 着地点ドットを描画 */
function drawLandingDots(
  ctx: CanvasRenderingContext2D,
  W: number, fieldRange: number,
  data: TestRow[],
  issueOnly: boolean
) {
  const t = createTransform(W, fieldRange);
  const filtered = issueOnly ? data.filter(r => r.issues.length > 0) : data;

  for (const r of filtered) {
    const px = t.x(r.landingX);
    const py = t.y(r.landingY);
    const color = RESULT_COLORS[r.result] ?? "#FFFFFF";

    // ドット
    ctx.beginPath();
    const radius = issueOnly ? 8 : (r.result === "out" ? 3 : 5);
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = r.result === "out" ? 0.4 : 0.85;
    ctx.fill();

    // 問題ありは赤枠
    if (r.issues.length > 0) {
      ctx.strokeStyle = "#FF0000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // 問題のみ表示時はラベル追加
    if (issueOnly) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(RESULT_LABELS[r.result] ?? "?", px, py - 12);
      ctx.font = "8px sans-serif";
      ctx.fillText(`${r.exitVelocity}km ${r.launchAngle}°`, px, py + 14);
    }
  }
}

/** 凡例を描画 */
function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, title: string) {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(x, y, 120, 190);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, x + 8, y + 18);

  const items: [string, string][] = [
    ["OUT", "out"], ["POP", "popupOut"], ["IFH", "infieldHit"], ["1B", "single"],
    ["2B", "double"], ["3B", "triple"], ["HR", "homerun"],
  ];
  items.forEach(([label, key], i) => {
    const iy = y + 35 + i * 20;
    ctx.beginPath();
    ctx.arc(x + 16, iy, 6, 0, Math.PI * 2);
    ctx.fillStyle = RESULT_COLORS[key];
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "11px sans-serif";
    ctx.fillText(label, x + 28, iy + 4);
  });
}

/** フィールドマップ画像を生成してExcelシートに追加 */
async function addFieldMapSheet(wb: ExcelJS.Workbook, data: TestRow[]) {
  const ws = wb.addWorksheet("フィールドマップ");
  const SIZE = 800;
  const RANGE = 85; // フィールド表示範囲(m)

  // 画像1: 全打球の着地点(結果別色分け)
  const allCanvas = createCanvas(SIZE, SIZE);
  const allCtx = allCanvas.getContext("2d");
  drawField(allCtx, SIZE, SIZE, RANGE);
  drawLandingDots(allCtx, SIZE, RANGE, data, false);
  drawLegend(allCtx, 10, SIZE - 180, "全打球");
  // タイトル
  allCtx.fillStyle = "#FFFFFF";
  allCtx.font = "bold 16px sans-serif";
  allCtx.textAlign = "center";
  allCtx.fillText("打球着地点マップ (全結果)", SIZE / 2, 22);

  const allBuf = allCanvas.toBuffer("image/png");
  const allImg = wb.addImage({ buffer: allBuf, extension: "png" });
  ws.addImage(allImg, { tl: { col: 0, row: 0 }, ext: { width: SIZE, height: SIZE } });

  // 画像2-5: 打球タイプ別
  const ballTypes = [
    { type: "ground_ball", label: "ゴロ" },
    { type: "line_drive", label: "ライナー" },
    { type: "fly_ball", label: "フライ" },
    { type: "popup", label: "ポップフライ" },
  ];

  for (let i = 0; i < ballTypes.length; i++) {
    const { type, label } = ballTypes[i];
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");
    drawField(ctx, SIZE, SIZE, RANGE);
    drawLandingDots(ctx, SIZE, RANGE, data.filter(r => r.ballType === type), false);
    drawLegend(ctx, 10, SIZE - 180, label);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${label}の着地点`, SIZE / 2, 22);

    const buf = canvas.toBuffer("image/png");
    const img = wb.addImage({ buffer: buf, extension: "png" });
    // 2列目以降に横に並べる
    const col = (i + 1) % 3 === 0 ? 0 : ((i + 1) % 3) * 12;
    const rowOffset = i >= 2 ? 42 : 0;
    ws.addImage(img, {
      tl: { col: col + (i < 2 ? 12 : 0), row: rowOffset },
      ext: { width: SIZE, height: SIZE },
    });
  }

  // 画像6: 速度帯別(低速 vs 高速)
  const ws6 = wb.addWorksheet("速度帯別マップ");

  const speedBands = [
    { label: "低速 (40-80 km/h)", filter: (r: TestRow) => r.exitVelocity <= 80 },
    { label: "中速 (100-120 km/h)", filter: (r: TestRow) => r.exitVelocity >= 100 && r.exitVelocity <= 120 },
    { label: "高速 (140-170 km/h)", filter: (r: TestRow) => r.exitVelocity >= 140 },
  ];

  for (let i = 0; i < speedBands.length; i++) {
    const { label, filter } = speedBands[i];
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");
    drawField(ctx, SIZE, SIZE, RANGE);
    drawLandingDots(ctx, SIZE, RANGE, data.filter(filter), false);
    drawLegend(ctx, 10, SIZE - 180, label);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, SIZE / 2, 22);

    const buf = canvas.toBuffer("image/png");
    const img = wb.addImage({ buffer: buf, extension: "png" });
    const col = i * 12;
    ws6.addImage(img, { tl: { col, row: 0 }, ext: { width: SIZE, height: SIZE } });
  }

  // 画像7: 問題パターンのみ
  const issueData = data.filter(r => r.issues.length > 0);
  if (issueData.length > 0) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");
    drawField(ctx, SIZE, SIZE, RANGE);
    drawLandingDots(ctx, SIZE, RANGE, issueData, true);
    drawLegend(ctx, 10, SIZE - 180, "問題のみ");
    ctx.fillStyle = "#FF5252";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`問題パターン (${issueData.length}件)`, SIZE / 2, 22);

    const buf = canvas.toBuffer("image/png");
    const img = wb.addImage({ buffer: buf, extension: "png" });
    ws6.addImage(img, { tl: { col: 0, row: 42 }, ext: { width: SIZE, height: SIZE } });
  }
}

writeExcel().catch(console.error);
