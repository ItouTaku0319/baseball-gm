/**
 * 能力値グリッド総合検証テスト
 *
 * 弾道(1-4) × ミート(10-100) × パワー(10-100) の全組み合わせで
 * 打球パラメータをシミュレーションし、NPB参考値との乖離を診断する。
 *
 * `npx vitest run --reporter=verbose batted-ball-lab/comprehensive-grid` で実行
 */
import { describe, it, expect } from "vitest";
import { generateBattedBall, classifyBattedBallType, estimateDistance, getFenceDistance } from "@/engine/simulation";
import { createBatter, createPitcher, formatTable } from "./helpers";
import type { Player } from "@/models/player";

const N = 1000; // 1組み合わせあたりの試行数
const VALUES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const NPB = {
  gbPct: { min: 43, max: 50 },
  ldPct: { min: 20, max: 25 },
  fbPct: { min: 25, max: 32 },
  pfPct: { min: 5, max: 10 },
  velMean: { min: 130, max: 140 },
  angleMean: { min: 8, max: 15 },
  hrPct: { min: 2.0, max: 4.0 },
};

interface GridCell {
  contact: number;
  power: number;
  trajectory: number;
  velMean: number;
  angleMean: number;
  gbPct: number;
  ldPct: number;
  fbPct: number;
  pfPct: number;
  hrPct: number;
}

function simulate(contact: number, power: number, trajectory: number): GridCell {
  const batter = createBatter({ contact, power, trajectory }, { batSide: "R" });
  const pitcher = createPitcher();

  const types = { ground_ball: 0, line_drive: 0, fly_ball: 0, popup: 0 };
  let velSum = 0;
  let angleSum = 0;
  let hrCount = 0;

  for (let i = 0; i < N; i++) {
    const ball = generateBattedBall(batter, pitcher);
    types[ball.type]++;
    velSum += ball.exitVelocity;
    angleSum += ball.launchAngle;

    if (ball.type === "fly_ball" && ball.launchAngle > 0) {
      const dist = estimateDistance(ball.exitVelocity, ball.launchAngle);
      const fence = getFenceDistance(ball.direction);

      // 弾道によるHR飛距離補正（simulation.tsと同期）
      const trajectoryCarryFactors = [0.90, 1.00, 1.05, 1.10]; // 弾道1-4
      const trajectoryCarryFactor = trajectoryCarryFactors[Math.min(3, Math.max(0, trajectory - 1))];
      const effectiveDistance = dist * trajectoryCarryFactor;
      const ratio = effectiveDistance / fence;
      if (ratio >= 1.05) {
        hrCount++;
      } else if (ratio >= 0.95) {
        const powerBonus = (power - 50) * 0.002;
        const hrChance = Math.max(0.01, Math.min(0.90, (ratio - 0.95) / 0.10 + powerBonus));
        if (Math.random() < hrChance) hrCount++;
      }
    }
  }

  return {
    contact,
    power,
    trajectory,
    velMean: velSum / N,
    angleMean: angleSum / N,
    gbPct: (types.ground_ball / N) * 100,
    ldPct: (types.line_drive / N) * 100,
    fbPct: (types.fly_ball / N) * 100,
    pfPct: (types.popup / N) * 100,
    hrPct: (hrCount / N) * 100,
  };
}

/** マトリクス表示 (行=ミート, 列=パワー) */
function printMatrix(
  label: string,
  data: GridCell[][],
  getValue: (cell: GridCell) => string
) {
  const header = ["M\\P", ...VALUES.map(v => String(v).padStart(6))].join(" | ");
  const sep = "-".repeat(header.length);
  console.log(`\n${label}`);
  console.log(header);
  console.log(sep);

  for (let ci = 0; ci < VALUES.length; ci++) {
    const row = [String(VALUES[ci]).padStart(3)];
    for (let pi = 0; pi < VALUES.length; pi++) {
      row.push(getValue(data[ci][pi]).padStart(6));
    }
    console.log(row.join(" | "));
  }
}

describe("能力値グリッド総合検証", () => {
  // 弾道ごとにデータを事前計算
  const allData: Map<number, GridCell[][]> = new Map();

  // 全弾道のデータを1つのitで計算（テスト実行時間を最適化）
  it("全グリッドデータ計算 (弾道1-4 × ミート10-100 × パワー10-100)", () => {
    for (let traj = 1; traj <= 4; traj++) {
      const grid: GridCell[][] = [];
      for (const contact of VALUES) {
        const row: GridCell[] = [];
        for (const power of VALUES) {
          row.push(simulate(contact, power, traj));
        }
        grid.push(row);
      }
      allData.set(traj, grid);
    }

    expect(allData.size).toBe(4);
  });

  it("弾道別マトリクス表示: HR%", () => {
    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      printMatrix(
        `=== 弾道${traj} HR% マトリクス (行=ミート, 列=パワー, NPB平均: ${NPB.hrPct.min}-${NPB.hrPct.max}%) ===`,
        grid,
        (c) => c.hrPct.toFixed(1)
      );
    }
  });

  it("弾道別マトリクス表示: 打球速度", () => {
    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      printMatrix(
        `=== 弾道${traj} 打球速度(km/h) マトリクス (行=ミート, 列=パワー, NPB平均: ${NPB.velMean.min}-${NPB.velMean.max}) ===`,
        grid,
        (c) => c.velMean.toFixed(0)
      );
    }
  });

  it("弾道別マトリクス表示: ゴロ率", () => {
    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      printMatrix(
        `=== 弾道${traj} ゴロ% マトリクス (行=ミート, 列=パワー, NPB平均: ${NPB.gbPct.min}-${NPB.gbPct.max}%) ===`,
        grid,
        (c) => c.gbPct.toFixed(0)
      );
    }
  });

  it("弾道別マトリクス表示: フライ率", () => {
    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      printMatrix(
        `=== 弾道${traj} フライ% マトリクス (行=ミート, 列=パワー, NPB平均: ${NPB.fbPct.min}-${NPB.fbPct.max}%) ===`,
        grid,
        (c) => c.fbPct.toFixed(0)
      );
    }
  });

  it("弾道別マトリクス表示: 打球角度", () => {
    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      printMatrix(
        `=== 弾道${traj} 打球角度(°) マトリクス (行=ミート, 列=パワー, NPB平均: ${NPB.angleMean.min}-${NPB.angleMean.max}°) ===`,
        grid,
        (c) => c.angleMean.toFixed(1)
      );
    }
  });

  it("弾道別マトリクス表示: ポップフライ率", () => {
    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      printMatrix(
        `=== 弾道${traj} PF% マトリクス (行=ミート, 列=パワー, NPB平均: ${NPB.pfPct.min}-${NPB.pfPct.max}%) ===`,
        grid,
        (c) => c.pfPct.toFixed(0)
      );
    }
  });

  it("異常値・バランス診断", () => {
    console.log("\n" + "=".repeat(70));
    console.log("  異常値・バランス診断");
    console.log("=".repeat(70));

    const issues: string[] = [];
    const warnings: string[] = [];

    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      for (let ci = 0; ci < VALUES.length; ci++) {
        for (let pi = 0; pi < VALUES.length; pi++) {
          const cell = grid[ci][pi];
          const label = `弾道${traj} M${cell.contact} P${cell.power}`;

          // 致命的な異常
          if (cell.hrPct > 35) {
            issues.push(`[ERROR] ${label}: HR% = ${cell.hrPct.toFixed(1)}% (35%超)`);}
          if (cell.velMean < 100) {
            issues.push(`[ERROR] ${label}: 速度 = ${cell.velMean.toFixed(0)}km/h (100未満, クリッピング多発)`);
          }
          if (cell.gbPct > 75) {
            issues.push(`[ERROR] ${label}: ゴロ% = ${cell.gbPct.toFixed(0)}% (75%超, 極端)`);
          }
          if (cell.gbPct < 15) {
            issues.push(`[ERROR] ${label}: ゴロ% = ${cell.gbPct.toFixed(0)}% (15%未満, 極端)`);
          }

          // 警告
          if (cell.hrPct > 20) {
            warnings.push(`[WARN]  ${label}: HR% = ${cell.hrPct.toFixed(1)}% (20%超)`);
          } else if (cell.hrPct > 15) {
            warnings.push(`[WARN]  ${label}: HR% = ${cell.hrPct.toFixed(1)}% (15%超)`);
          }
          if (cell.velMean < 110) {
            warnings.push(`[WARN]  ${label}: 速度 = ${cell.velMean.toFixed(0)}km/h (110未満)`);
          }
          if (cell.velMean > 165) {
            warnings.push(`[WARN]  ${label}: 速度 = ${cell.velMean.toFixed(0)}km/h (165超, 上限近い)`);
          }
          if (cell.pfPct > 15) {
            warnings.push(`[WARN]  ${label}: PF% = ${cell.pfPct.toFixed(0)}% (15%超)`);
          }
          if (cell.ldPct < 15) {
            warnings.push(`[WARN]  ${label}: LD% = ${cell.ldPct.toFixed(0)}% (15%未満)`);
          }
          if (cell.ldPct > 30) {
            warnings.push(`[WARN]  ${label}: LD% = ${cell.ldPct.toFixed(0)}% (30%超)`);
          }
        }
      }
    }

    // NPB平均(能力45)との比較
    console.log("\n--- NPB平均比較 (能力45, 弾道2) ---");
    const avg45 = allData.get(2)!;
    // ミート45 = index 3 (VALUES[3]=40), index 4 (VALUES[4]=50)
    // 正確にはVALUESに45がないので、40と50の中間を報告
    const m40 = avg45[3]; // contact=40
    const m50 = avg45[4]; // contact=50
    // パワー45も同様
    const cell40_40 = m40[3]; // contact=40, power=40
    const cell40_50 = m40[4]; // contact=40, power=50
    const cell50_40 = m50[3]; // contact=50, power=40
    const cell50_50 = m50[4]; // contact=50, power=50

    console.log("  (能力45はグリッドにないため、40と50の結果を参考表示)");
    console.log(`  M40/P40: 速度=${cell40_40.velMean.toFixed(0)} 角度=${cell40_40.angleMean.toFixed(1)}° GB=${cell40_40.gbPct.toFixed(0)}% HR=${cell40_40.hrPct.toFixed(1)}%`);
    console.log(`  M40/P50: 速度=${cell40_50.velMean.toFixed(0)} 角度=${cell40_50.angleMean.toFixed(1)}° GB=${cell40_50.gbPct.toFixed(0)}% HR=${cell40_50.hrPct.toFixed(1)}%`);
    console.log(`  M50/P40: 速度=${cell50_40.velMean.toFixed(0)} 角度=${cell50_40.angleMean.toFixed(1)}° GB=${cell50_40.gbPct.toFixed(0)}% HR=${cell50_40.hrPct.toFixed(1)}%`);
    console.log(`  M50/P50: 速度=${cell50_50.velMean.toFixed(0)} 角度=${cell50_50.angleMean.toFixed(1)}° GB=${cell50_50.gbPct.toFixed(0)}% HR=${cell50_50.hrPct.toFixed(1)}%`);
    console.log(`  NPB参考: 速度=${NPB.velMean.min}-${NPB.velMean.max} 角度=${NPB.angleMean.min}-${NPB.angleMean.max}° GB=${NPB.gbPct.min}-${NPB.gbPct.max}% HR=${NPB.hrPct.min}-${NPB.hrPct.max}%`);

    // パワー別HR%推移 (弾道2, ミート50)
    console.log("\n--- パワー別HR%推移 (弾道2, ミート50) ---");
    const m50row = avg45[4]; // contact=50の行
    for (let pi = 0; pi < VALUES.length; pi++) {
      const cell = m50row[pi];
      const bar = "█".repeat(Math.round(cell.hrPct));
      console.log(`  P${String(cell.power).padStart(3)}: ${cell.hrPct.toFixed(1).padStart(5)}% ${bar}`);
    }

    // ミート別ゴロ%推移 (弾道2, パワー50)
    console.log("\n--- ミート別ゴロ%推移 (弾道2, パワー50) ---");
    for (let ci = 0; ci < VALUES.length; ci++) {
      const cell = avg45[ci][4]; // power=50
      const bar = "█".repeat(Math.round(cell.gbPct / 2));
      console.log(`  M${String(cell.contact).padStart(3)}: ${cell.gbPct.toFixed(0).padStart(3)}% ${bar}`);
    }

    // 弾道別の平均HR% (全ミート×パワーの平均)
    console.log("\n--- 弾道別平均HR% (全ミート×パワーの平均) ---");
    for (let traj = 1; traj <= 4; traj++) {
      const grid = allData.get(traj)!;
      let totalHr = 0;
      let count = 0;
      for (const row of grid) {
        for (const cell of row) {
          totalHr += cell.hrPct;
          count++;
        }
      }
      console.log(`  弾道${traj}: ${(totalHr / count).toFixed(2)}%`);
    }

    // 結果出力
    if (issues.length > 0) {
      console.log(`\n--- 致命的問題 (${issues.length}件) ---`);
      for (const issue of issues) console.log(`  ${issue}`);
    } else {
      console.log("\n  致命的問題: なし");
    }

    if (warnings.length > 0) {
      console.log(`\n--- 警告 (${warnings.length}件) ---`);
      for (const w of warnings) console.log(`  ${w}`);
    } else {
      console.log("\n  警告: なし");
    }

    // テストとしては致命的問題がないことを確認
    expect(issues.length).toBe(0);
  });
});
