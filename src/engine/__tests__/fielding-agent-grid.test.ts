import { describe, it, expect, beforeAll } from "vitest";
import { resolvePlayWithAgents } from "../fielding-agent";
import { calcBallLanding } from "../fielding-ai";
import type { Player, Position } from "../../models/player";
import type { AgentFieldingResult } from "../fielding-agent-types";

// グリッドパラメータ（fielding-grid.test.ts と同じ空間）
const DIRECTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const EXIT_VELOCITIES = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const LAUNCH_ANGLES = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45];

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// ポジション番号 → Position文字列
const POSITION_MAP: Record<FielderPosition, Position> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

// アウト結果の判定セット
const OUT_RESULTS = new Set([
  "groundout", "flyout", "lineout", "popout",
  "doublePlay", "sacrificeFly", "fieldersChoice",
]);

// 有効な AtBatResult セット（守備から返り得る値のみ）
const VALID_RESULTS = new Set([
  "single", "double", "triple", "homerun",
  "groundout", "flyout", "lineout", "popout",
  "doublePlay", "sacrificeFly", "fieldersChoice",
  "infieldHit", "error",
]);

// ゴロ判定角度閾値（physics-constants.ts GROUND_BALL_ANGLE_THRESHOLD と一致）
const GROUND_BALL_ANGLE_THRESHOLD = 10;

// D50標準選手を生成（全能力値50の平均的な選手）
function createD50Player(pos: FielderPosition): Player {
  const position = POSITION_MAP[pos];
  const isPitcher = pos === 1;
  return {
    id: `d50-${position}`,
    name: `D50${position}`,
    age: 25,
    position,
    isPitcher,
    throwHand: "R",
    batSide: "R",
    batting: {
      contact: 50,
      power: 50,
      trajectory: 2,
      speed: 50,
      arm: 50,
      fielding: 50,
      catching: 50,
      eye: 50,
    },
    pitching: isPitcher
      ? {
          velocity: 145,
          control: 50,
          pitches: [{ type: "slider", level: 4 }],
          stamina: 50,
          mentalToughness: 50,
          arm: 50,
          fielding: 50,
          catching: 50,
        }
      : null,
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
  } as Player;
}

// 9人のD50選手マップ（batter 兼用）
const fielderMap = new Map<FielderPosition, Player>();
for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
  fielderMap.set(pos, createD50Player(pos));
}

const d50Batter = createD50Player(3); // D50打者（1Bポジションを流用）

// 塁なし・0アウト（最もシンプルな状況）
const emptyBases = { first: null, second: null, third: null };

// 決定的実行オプション（ノイズなし、乱数固定）
const deterministicOptions = {
  perceptionNoise: 0,
  random: () => 0.5,
};

// 打球分類（ball-trajectory.ts と同じロジック）
function classifyBallType(launchAngle: number, exitVelocity: number): string {
  if (launchAngle >= 50) return "popup";
  if (launchAngle < GROUND_BALL_ANGLE_THRESHOLD) return "ground_ball";
  if (launchAngle < 20) {
    if (launchAngle < 12 && exitVelocity < 85) return "ground_ball";
    return "line_drive";
  }
  return "fly_ball";
}

interface AgentGridRow {
  direction: number;
  exitVelocity: number;
  launchAngle: number;
  ballType: string;
  distance: number;
  flightTime: number;
  result: string;
  fielderPos: number;
  isOut: boolean;
  isHit: boolean;
}

let allRows: AgentGridRow[] = [];

beforeAll(() => {
  allRows = [];

  for (const direction of DIRECTIONS) {
    for (const exitVelocity of EXIT_VELOCITIES) {
      for (const launchAngle of LAUNCH_ANGLES) {
        const ballType = classifyBallType(launchAngle, exitVelocity);
        const landing = calcBallLanding(direction, launchAngle, exitVelocity);

        const ball = {
          direction,
          launchAngle,
          exitVelocity,
          type: ballType,
        };

        const agentResult: AgentFieldingResult = resolvePlayWithAgents(
          ball,
          landing,
          fielderMap,
          d50Batter,
          emptyBases,
          0,
          deterministicOptions
        );

        const isOut = OUT_RESULTS.has(agentResult.result);
        const isHit = ["single", "double", "triple", "homerun", "infieldHit"].includes(agentResult.result);

        allRows.push({
          direction,
          exitVelocity,
          launchAngle,
          ballType,
          distance: Math.round(landing.distance * 10) / 10,
          flightTime: landing.flightTime,
          result: agentResult.result,
          fielderPos: agentResult.fielderPos,
          isOut,
          isHit,
        });
      }
    }
  }

  // 統計サマリ出力（デバッグ用）
  const total = allRows.length;

  // 打球種別ごとの件数と割合
  const byBallType: Record<string, { count: number; outs: number }> = {};
  for (const r of allRows) {
    if (!byBallType[r.ballType]) byBallType[r.ballType] = { count: 0, outs: 0 };
    byBallType[r.ballType].count++;
    if (r.isOut) byBallType[r.ballType].outs++;
  }

  console.log(`\n=== エージェント守備グリッドテスト 統計サマリ ===`);
  console.log(`総パターン数: ${total}`);
  console.log(`\n--- 打球種別ごとの件数・アウト率 ---`);
  for (const [bt, stat] of Object.entries(byBallType)) {
    const pct = ((stat.count / total) * 100).toFixed(1);
    const outRate = ((stat.outs / stat.count) * 100).toFixed(1);
    console.log(`  ${bt}: ${stat.count}件 (${pct}%) アウト率=${outRate}%`);
  }

  // ポジション別処理件数
  const byPos: Record<number, number> = {};
  for (const r of allRows) {
    byPos[r.fielderPos] = (byPos[r.fielderPos] ?? 0) + 1;
  }
  const posNames: Record<number, string> = {
    1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
  };
  console.log(`\n--- ポジション別処理件数 ---`);
  for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const cnt = byPos[pos] ?? 0;
    const pct = ((cnt / total) * 100).toFixed(1);
    console.log(`  ${posNames[pos]}(${pos}): ${cnt}件 (${pct}%)`);
  }

  // 結果種別ごとの件数
  const byResult: Record<string, number> = {};
  for (const r of allRows) {
    byResult[r.result] = (byResult[r.result] ?? 0) + 1;
  }
  console.log(`\n--- 結果種別ごとの件数 ---`);
  for (const [res, cnt] of Object.entries(byResult).sort((a, b) => b[1] - a[1])) {
    const pct = ((cnt / total) * 100).toFixed(1);
    console.log(`  ${res}: ${cnt}件 (${pct}%)`);
  }

  // 全体アウト率
  const totalOuts = allRows.filter(r => r.isOut).length;
  console.log(`\n全体アウト率: ${((totalOuts / total) * 100).toFixed(1)}%`);
  console.log(`================================================\n`);
}, 120000);

describe("エージェント守備グリッドテスト", () => {
  // --- 基本テスト ---
  describe("基本テスト", () => {
    it("5,586パターン全件が処理完了している（データ件数確認）", () => {
      expect(allRows.length).toBe(DIRECTIONS.length * EXIT_VELOCITIES.length * LAUNCH_ANGLES.length);
    });

    it("各パターンの result が有効な値であること", () => {
      const invalid = allRows.filter(r => !VALID_RESULTS.has(r.result));
      if (invalid.length > 0) {
        console.log("無効なresult例:", invalid.slice(0, 5));
      }
      expect(invalid.length).toBe(0);
    });
  });

  // --- 統計ゲート ---
  describe("統計ゲート", () => {
    it("全体アウト率が 40-80% の範囲内", () => {
      const outs = allRows.filter(r => r.isOut).length;
      const rate = outs / allRows.length;
      expect(rate).toBeGreaterThanOrEqual(0.40);
      expect(rate).toBeLessThanOrEqual(0.80);
    });

    it("ゴロアウト率が 50-90% の範囲内", () => {
      const groundBalls = allRows.filter(r => r.ballType === "ground_ball");
      if (groundBalls.length === 0) return;
      const outs = groundBalls.filter(r => r.isOut).length;
      const rate = outs / groundBalls.length;
      if (rate < 0.50 || rate > 0.90) {
        console.log(`ゴロアウト率: ${(rate * 100).toFixed(1)}% (期待: 50-90%)`);
      }
      expect(rate).toBeGreaterThanOrEqual(0.50);
      expect(rate).toBeLessThanOrEqual(0.90);
    });

    it("フライアウト率が 30-80% の範囲内", () => {
      const flyBalls = allRows.filter(r => r.ballType === "fly_ball");
      if (flyBalls.length === 0) return;
      const outs = flyBalls.filter(r => r.isOut).length;
      const rate = outs / flyBalls.length;
      if (rate < 0.30 || rate > 0.80) {
        console.log(`フライアウト率: ${(rate * 100).toFixed(1)}% (期待: 30-80%)`);
      }
      expect(rate).toBeGreaterThanOrEqual(0.30);
      expect(rate).toBeLessThanOrEqual(0.80);
    });

    it("0-15m フライアウト率 >= 80%", () => {
      const subset = allRows.filter(r =>
        (r.ballType === "fly_ball" || r.ballType === "line_drive") &&
        r.distance >= 0 && r.distance < 15
      );
      if (subset.length === 0) return;
      const outs = subset.filter(r => r.isOut).length;
      const rate = outs / subset.length;
      if (rate < 0.80) {
        console.log(`0-15m フライアウト率: ${(rate * 100).toFixed(1)}% (期待: >=80%)`);
        const failures = subset.filter(r => !r.isOut).slice(0, 5);
        console.log("失敗例:", failures);
      }
      expect(rate).toBeGreaterThanOrEqual(0.80);
    });

    it("ゴロ方向別アウト率 >= 40%", () => {
      for (const dir of DIRECTIONS) {
        const subset = allRows.filter(r => r.direction === dir && r.ballType === "ground_ball");
        if (subset.length === 0) continue;
        const outs = subset.filter(r => r.isOut).length;
        const rate = outs / subset.length;
        if (rate < 0.40) {
          console.log(`方向${dir}° ゴロアウト率: ${(rate * 100).toFixed(1)}% (期待: >=40%)`);
          const failures = subset.filter(r => !r.isOut).slice(0, 3);
          console.log(`  失敗例:`, failures);
        }
        expect(rate).toBeGreaterThanOrEqual(0.40);
      }
    });
  });

  // --- サニティチェック（R6, R7, R8, R10 相当）---
  describe("サニティチェック", () => {
    it("R6: 遠距離(>40m) でP/Cが処理野手にならない = 0件", () => {
      const violations = allRows.filter(r =>
        r.distance > 40 &&
        r.isHit &&
        (r.fielderPos === 1 || r.fielderPos === 2)
      );
      if (violations.length > 0) {
        console.log("R6違反（遠距離P/C処理）:", violations.slice(0, 5));
      }
      expect(violations.length).toBe(0);
    });

    it("R7: 浅打球(<20m) ゴロでヒットの場合、処理野手はOFでない = 0件", () => {
      const violations = allRows.filter(r =>
        r.distance < 20 &&
        r.ballType === "ground_ball" &&
        r.isHit &&
        r.fielderPos >= 7
      );
      if (violations.length > 0) {
        console.log("R7違反（浅ゴロOF処理）:", violations.slice(0, 5));
      }
      expect(violations.length).toBe(0);
    });

    it("R8: 深打球(>55m) フライ/ライナーでヒットの場合、処理野手はIFでない = 0件", () => {
      const violations = allRows.filter(r =>
        r.distance > 55 &&
        (r.ballType === "fly_ball" || r.ballType === "line_drive") &&
        r.isHit &&
        r.fielderPos >= 3 &&
        r.fielderPos <= 6
      );
      if (violations.length > 0) {
        console.log("R8違反（深打球IF処理）:", violations.slice(0, 5));
      }
      expect(violations.length).toBe(0);
    });

    it("R10: ゴロで三塁打は発生しない = 0件", () => {
      const violations = allRows.filter(r =>
        r.ballType === "ground_ball" &&
        r.result === "triple"
      );
      if (violations.length > 0) {
        console.log("R10違反（ゴロ三塁打）:", violations.slice(0, 5));
      }
      expect(violations.length).toBe(0);
    });
  });
});
