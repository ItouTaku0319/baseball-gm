/**
 * 打球生成キャリブレーションテスト
 *
 * 能力値別の打球パラメータをNPB参考値と比較し、調整の指針を得る。
 * `npx vitest run --reporter=verbose batted-ball-lab/calibration` で実行
 */
import { describe, it, expect } from "vitest";
import { generateBattedBall, classifyBattedBallType, estimateDistance, getFenceDistance } from "@/engine/simulation";
import { createBatter, createPitcher, mean, stdDev, percentile, formatTable, statSummary, histogram } from "./helpers";
import type { Player } from "@/models/player";

const N = 10000;

// ---- NPB参考値 ----
// 出典: NPB/MLB公開データを参考に設定
const NPB_REF = {
  // 打球タイプ分布 (% of BIP)
  groundBallPct: { min: 43, max: 50, label: "ゴロ%" },
  lineDrivePct: { min: 20, max: 25, label: "ライナー%" },
  flyBallPct: { min: 25, max: 32, label: "フライ%" },
  popupPct: { min: 5, max: 10, label: "ポップフライ%" },

  // 打球速度 (km/h)
  exitVelocityMean: { min: 130, max: 140, label: "速度平均(km/h)" },
  exitVelocityStd: { min: 15, max: 22, label: "速度SD(km/h)" },

  // 打球角度 (°)
  launchAngleMean: { min: 8, max: 15, label: "角度平均(°)" },
  launchAngleStd: { min: 15, max: 22, label: "角度SD(°)" },

  // HR
  hrPerBIP: { min: 2.0, max: 4.0, label: "HR/BIP(%)" },
};

/** 打球Nサンプルのサマリーを計算 */
function collectBattedBallStats(batter: Player, pitcher: Player, n: number) {
  const types = { ground_ball: 0, line_drive: 0, fly_ball: 0, popup: 0 };
  const angles: number[] = [];
  const velocities: number[] = [];
  const directions: number[] = [];
  const flyDistances: number[] = [];
  let hrCount = 0;

  for (let i = 0; i < n; i++) {
    const ball = generateBattedBall(batter, pitcher);
    types[ball.type]++;
    angles.push(ball.launchAngle);
    velocities.push(ball.exitVelocity);
    directions.push(ball.direction);

    if (ball.type === "fly_ball" && ball.launchAngle > 0) {
      const dist = estimateDistance(ball.exitVelocity, ball.launchAngle);
      const fence = getFenceDistance(ball.direction);
      flyDistances.push(dist);

      // 弾道によるHR飛距離補正（simulation.tsと同期）
      const trajectory = batter.batting.trajectory ?? 2;
      const trajectoryCarryFactors = [0.90, 1.00, 1.05, 1.10]; // 弾道1-4
      const trajectoryCarryFactor = trajectoryCarryFactors[Math.min(3, Math.max(0, trajectory - 1))];
      const effectiveDistance = dist * trajectoryCarryFactor;
      const ratio = effectiveDistance / fence;
      if (ratio >= 1.05) {
        hrCount++;
      } else if (ratio >= 0.95) {
        const powerBonus = (batter.batting.power - 50) * 0.002;
        const hrChance = Math.max(0.01, Math.min(0.90, (ratio - 0.95) / 0.10 + powerBonus));
        if (Math.random() < hrChance) hrCount++;
      }
    }
  }

  return {
    types,
    gbPct: (types.ground_ball / n) * 100,
    ldPct: (types.line_drive / n) * 100,
    fbPct: (types.fly_ball / n) * 100,
    pfPct: (types.popup / n) * 100,
    angleMean: mean(angles),
    angleStd: stdDev(angles),
    velMean: mean(velocities),
    velStd: stdDev(velocities),
    dirMean: mean(directions),
    dirStd: stdDev(directions),
    flyDistMean: flyDistances.length > 0 ? mean(flyDistances) : 0,
    flyDistStd: flyDistances.length > 0 ? stdDev(flyDistances) : 0,
    hrPct: (hrCount / n) * 100,
    angles,
    velocities,
    directions,
    flyDistances,
  };
}

describe("キャリブレーション: 現在の計算式サマリー", () => {
  it("generateBattedBall の現在のパラメータ一覧", () => {
    console.log("\n" + "=".repeat(70));
    console.log("  generateBattedBall 現在の計算式");
    console.log("=".repeat(70));

    console.log(`
  ■ 打球方向 (direction)
    mean = 45° (switch) / 38° (R) / 52° (L)
    pullShift = (power - 50) * 0.08
    σ = 18, range = [0, 90]

  ■ 打球角度 (launchAngle)
    mean = 12 + (power-50)*0.08 - (contact-50)*0.04 + (trajectory-2)*3 - sinkerBonus
    σ = 16, range = [-15, 70]

  ■ 打球速度 (exitVelocity)
    mean = 132 + (power-50)*0.15 + (contact-50)*0.15 - breakingPenalty
    breakingPenalty = (breakingPower - 50) * 0.15
    σ = 18, range = [80, 170]

  ■ classifyBattedBallType
    popup:      angle >= 38°
    ground_ball: angle < 10°
    line_drive:  10-19° (ただし <15° && vel<100 → ground_ball)
    fly_ball:    20-39°
`);
  });
});

describe("キャリブレーション: 能力値別の打球分布", () => {
  it("能力値 40/45/50 での打球パラメータ比較", () => {
    const pitcher = createPitcher();
    const levels = [
      { label: "能力40", contact: 40, power: 40, trajectory: 2 },
      { label: "能力45", contact: 45, power: 45, trajectory: 2 },
      { label: "能力50", contact: 50, power: 50, trajectory: 2 },
      { label: "能力55", contact: 55, power: 55, trajectory: 2 },
      { label: "能力60", contact: 60, power: 60, trajectory: 3 },
    ];

    // 計算上の期待値を表示
    console.log("\n--- 計算式による期待値 (sinkerBonus=0, breakingPenalty≈0 の場合) ---");
    const calcHeaders = ["能力値", "角度mean", "速度mean", "方向mean(R打)"];
    const calcRows: (string | number)[][] = [];
    for (const lv of levels) {
      const angleMean = 12 + (lv.power - 50) * 0.08 - (lv.contact - 50) * 0.04 + (lv.trajectory - 2) * 3;
      const velMean = 132 + (lv.power - 50) * 0.15 + (lv.contact - 50) * 0.15;
      const dirMean = 38 - (lv.power - 50) * 0.08;
      calcRows.push([lv.label, angleMean.toFixed(1), velMean.toFixed(1), dirMean.toFixed(1)]);
    }
    console.log(formatTable(calcHeaders, calcRows));

    // 実測値
    console.log("\n--- 実測値 (N=" + N + ", 右打者 vs 平均投手) ---");
    const headers = [
      "能力値",
      "ゴロ%", "LD%", "FB%", "PF%",
      "速度mean", "速度SD",
      "角度mean", "角度SD",
      "飛距離mean",
      "HR%",
    ];
    const rows: (string | number)[][] = [];

    for (const lv of levels) {
      const batter = createBatter(
        { contact: lv.contact, power: lv.power, trajectory: lv.trajectory },
        { batSide: "R" }
      );
      const stats = collectBattedBallStats(batter, pitcher, N);
      rows.push([
        lv.label,
        stats.gbPct.toFixed(1), stats.ldPct.toFixed(1),
        stats.fbPct.toFixed(1), stats.pfPct.toFixed(1),
        stats.velMean.toFixed(1), stats.velStd.toFixed(1),
        stats.angleMean.toFixed(1), stats.angleStd.toFixed(1),
        stats.flyDistMean.toFixed(1),
        stats.hrPct.toFixed(2),
      ]);
    }

    // NPB参考値行を追加
    rows.push([
      "NPB参考",
      `${NPB_REF.groundBallPct.min}-${NPB_REF.groundBallPct.max}`,
      `${NPB_REF.lineDrivePct.min}-${NPB_REF.lineDrivePct.max}`,
      `${NPB_REF.flyBallPct.min}-${NPB_REF.flyBallPct.max}`,
      `${NPB_REF.popupPct.min}-${NPB_REF.popupPct.max}`,
      `${NPB_REF.exitVelocityMean.min}-${NPB_REF.exitVelocityMean.max}`,
      `${NPB_REF.exitVelocityStd.min}-${NPB_REF.exitVelocityStd.max}`,
      `${NPB_REF.launchAngleMean.min}-${NPB_REF.launchAngleMean.max}`,
      `${NPB_REF.launchAngleStd.min}-${NPB_REF.launchAngleStd.max}`,
      "-",
      `${NPB_REF.hrPerBIP.min}-${NPB_REF.hrPerBIP.max}`,
    ]);

    console.log(formatTable(headers, rows));
  });

  it("能力値45 の詳細分布", () => {
    const batter = createBatter({ contact: 45, power: 45, trajectory: 2 }, { batSide: "R" });
    const pitcher = createPitcher();
    const stats = collectBattedBallStats(batter, pitcher, N);

    console.log("\n" + "=".repeat(60));
    console.log("  能力値45 (提案平均) の打球分布詳細");
    console.log("=".repeat(60));

    console.log("\n" + statSummary("打球角度 (°)", stats.angles));
    console.log("\n" + statSummary("打球速度 (km/h)", stats.velocities));
    console.log("\n" + statSummary("打球方向 (°)", stats.directions));

    // 角度ヒストグラム
    console.log("\n--- 打球角度分布 ---");
    const angleBins = [-15, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70];
    for (let i = 0; i < angleBins.length - 1; i++) {
      const lo = angleBins[i];
      const hi = angleBins[i + 1];
      const count = stats.angles.filter(a => a >= lo && a < hi).length;
      const pct = ((count / N) * 100).toFixed(1);
      const bar = "#".repeat(Math.round(count / 100));
      const typeLabel =
        hi <= 10 ? "[G]" :
        lo >= 40 ? "[P]" :
        lo >= 20 ? "[F]" :
        "[L]";
      console.log(`  ${String(lo).padStart(3)}~${String(hi).padStart(3)}° ${typeLabel}: ${String(count).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
    }

    // 速度ヒストグラム
    console.log("\n--- 打球速度分布 ---");
    const velBins = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
    for (let i = 0; i < velBins.length - 1; i++) {
      const lo = velBins[i];
      const hi = velBins[i + 1];
      const count = stats.velocities.filter(v => v >= lo && v < hi).length;
      const pct = ((count / N) * 100).toFixed(1);
      const bar = "#".repeat(Math.round(count / 100));
      console.log(`  ${String(lo).padStart(3)}~${String(hi).padStart(3)}km/h: ${String(count).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
    }

    // NPBとの乖離診断
    console.log("\n--- NPBとの乖離診断 ---");
    const checks = [
      { label: "ゴロ%", actual: stats.gbPct, ...NPB_REF.groundBallPct },
      { label: "ライナー%", actual: stats.ldPct, ...NPB_REF.lineDrivePct },
      { label: "フライ%", actual: stats.fbPct, ...NPB_REF.flyBallPct },
      { label: "ポップフライ%", actual: stats.pfPct, ...NPB_REF.popupPct },
      { label: "速度平均", actual: stats.velMean, ...NPB_REF.exitVelocityMean },
      { label: "角度平均", actual: stats.angleMean, ...NPB_REF.launchAngleMean },
      { label: "HR/BIP%", actual: stats.hrPct, ...NPB_REF.hrPerBIP },
    ];

    for (const c of checks) {
      const status =
        c.actual >= c.min && c.actual <= c.max ? "OK" :
        c.actual < c.min ? `LOW (${(c.actual - c.min).toFixed(1)})` :
        `HIGH (+${(c.actual - c.max).toFixed(1)})`;
      console.log(`  ${c.label.padEnd(16)} ${c.actual.toFixed(1).padStart(6)} | 目標: ${c.min}-${c.max} → ${status}`);
    }
  });
});

describe("キャリブレーション: 個別能力の影響度", () => {
  it("パワー単独の効果 (contact=45固定)", () => {
    const pitcher = createPitcher();
    const powers = [10, 20, 30, 40, 50, 60, 70, 80, 90];

    const headers = ["Pow", "角度mean", "速度mean", "ゴロ%", "LD%", "FB%", "PF%", "HR%", "飛距離mean"];
    const rows: (string | number)[][] = [];

    for (const p of powers) {
      // 弾道はパワー連動: 1 + (power/100)*2.5 を四捨五入 (1-4)
      const traj = Math.min(4, Math.max(1, Math.round(1 + (p / 100) * 2.5)));
      const batter = createBatter({ contact: 45, power: p, trajectory: traj });
      const stats = collectBattedBallStats(batter, pitcher, 5000);
      rows.push([
        `${p}(弾${traj})`,
        stats.angleMean.toFixed(1), stats.velMean.toFixed(1),
        stats.gbPct.toFixed(1), stats.ldPct.toFixed(1),
        stats.fbPct.toFixed(1), stats.pfPct.toFixed(1),
        stats.hrPct.toFixed(2),
        stats.flyDistMean.toFixed(1),
      ]);
    }

    console.log("\n=== パワー感度 (contact=45固定) ===");
    console.log(formatTable(headers, rows));
  });

  it("ミート単独の効果 (power=45固定)", () => {
    const pitcher = createPitcher();
    const contacts = [10, 20, 30, 40, 50, 60, 70, 80, 90];

    const headers = ["Con", "角度mean", "速度mean", "ゴロ%", "LD%", "FB%", "PF%", "HR%"];
    const rows: (string | number)[][] = [];

    for (const c of contacts) {
      const batter = createBatter({ contact: c, power: 45, trajectory: 2 });
      const stats = collectBattedBallStats(batter, pitcher, 5000);
      rows.push([
        String(c),
        stats.angleMean.toFixed(1), stats.velMean.toFixed(1),
        stats.gbPct.toFixed(1), stats.ldPct.toFixed(1),
        stats.fbPct.toFixed(1), stats.pfPct.toFixed(1),
        stats.hrPct.toFixed(2),
      ]);
    }

    console.log("\n=== ミート感度 (power=45固定) ===");
    console.log(formatTable(headers, rows));
  });

  it("弾道単独の効果 (power=45, contact=45固定)", () => {
    const pitcher = createPitcher();

    const headers = ["弾道", "角度mean", "角度理論値", "ゴロ%", "LD%", "FB%", "PF%", "HR%"];
    const rows: (string | number)[][] = [];

    for (let t = 1; t <= 4; t++) {
      const batter = createBatter({ contact: 45, power: 45, trajectory: t });
      const stats = collectBattedBallStats(batter, pitcher, 5000);
      const theoreticalAngle = 12 + (45 - 50) * 0.08 - (45 - 50) * 0.04 + (t - 2) * 3;
      rows.push([
        String(t),
        stats.angleMean.toFixed(1), theoreticalAngle.toFixed(1),
        stats.gbPct.toFixed(1), stats.ldPct.toFixed(1),
        stats.fbPct.toFixed(1), stats.pfPct.toFixed(1),
        stats.hrPct.toFixed(2),
      ]);
    }

    console.log("\n=== 弾道感度 (power=45, contact=45固定) ===");
    console.log(formatTable(headers, rows));
  });
});

describe("キャリブレーション: 投手能力の影響", () => {
  it("投手の変化球レベルによるbreakingPenalty", () => {
    const batter = createBatter({ contact: 45, power: 45, trajectory: 2 });

    const pitcherConfigs = [
      { label: "変化球なし", pitches: [] as { type: string; level: number }[] },
      { label: "スラ3", pitches: [{ type: "slider" as const, level: 3 }] },
      { label: "スラ4(デフォ)", pitches: [{ type: "slider" as const, level: 4 }] },
      { label: "スラ5", pitches: [{ type: "slider" as const, level: 5 }] },
      { label: "スラ4+フォ5", pitches: [{ type: "slider" as const, level: 4 }, { type: "fork" as const, level: 5 }] },
      { label: "多彩(4球種)", pitches: [
        { type: "slider" as const, level: 4 },
        { type: "curve" as const, level: 3 },
        { type: "fork" as const, level: 5 },
        { type: "changeup" as const, level: 3 },
      ]},
    ];

    const headers = ["投手", "breakingPower", "penalty", "速度mean", "角度mean", "HR%"];
    const rows: (string | number)[][] = [];

    for (const cfg of pitcherConfigs) {
      const pitcher = createPitcher({ pitches: cfg.pitches });
      // calcBreakingPower を手計算
      const total = cfg.pitches.reduce((sum, p) => sum + p.level * p.level, 0);
      const bp = cfg.pitches.length === 0 ? 30 : Math.min(100, (total / 245) * 130);
      const penalty = (bp - 50) * 0.15;

      const stats = collectBattedBallStats(batter, pitcher, 5000);
      rows.push([
        cfg.label,
        bp.toFixed(1),
        penalty.toFixed(1),
        stats.velMean.toFixed(1), stats.angleMean.toFixed(1),
        stats.hrPct.toFixed(2),
      ]);
    }

    console.log("\n=== 投手変化球レベルの影響 (打者: 能力45) ===");
    console.log(formatTable(headers, rows));
  });

  it("シンカー/シュートによる角度低下効果", () => {
    const batter = createBatter({ contact: 45, power: 45, trajectory: 2 });

    const pitcherConfigs = [
      { label: "シンカーなし", pitches: [{ type: "slider" as const, level: 4 }] },
      { label: "シンカー3", pitches: [{ type: "sinker" as const, level: 3 }, { type: "slider" as const, level: 4 }] },
      { label: "シンカー5", pitches: [{ type: "sinker" as const, level: 5 }, { type: "slider" as const, level: 4 }] },
      { label: "シンカー7", pitches: [{ type: "sinker" as const, level: 7 }, { type: "slider" as const, level: 3 }] },
      { label: "シュート5", pitches: [{ type: "shoot" as const, level: 5 }, { type: "slider" as const, level: 4 }] },
    ];

    const headers = ["投手", "sinkerBonus", "角度mean", "ゴロ%", "LD%", "FB%", "PF%"];
    const rows: (string | number)[][] = [];

    for (const cfg of pitcherConfigs) {
      let sb = 0;
      for (const p of cfg.pitches) {
        if (p.type === "sinker") sb += p.level * 0.6;
        if (p.type === "shoot") sb += p.level * 0.4;
      }
      sb = Math.min(5, sb);

      const pitcher = createPitcher({ pitches: cfg.pitches });
      const stats = collectBattedBallStats(batter, pitcher, 5000);
      rows.push([
        cfg.label,
        sb.toFixed(1),
        stats.angleMean.toFixed(1),
        stats.gbPct.toFixed(1), stats.ldPct.toFixed(1),
        stats.fbPct.toFixed(1), stats.pfPct.toFixed(1),
      ]);
    }

    console.log("\n=== シンカー/シュートの角度低下効果 (打者: 能力45) ===");
    console.log(formatTable(headers, rows));
  });
});

describe("キャリブレーション: 乖離まとめと調整案", () => {
  it("能力45をNPB平均にするための調整案を出力", () => {
    const batter = createBatter({ contact: 45, power: 45, trajectory: 2 }, { batSide: "R" });
    const pitcher = createPitcher();
    const stats = collectBattedBallStats(batter, pitcher, N);

    console.log("\n" + "=".repeat(70));
    console.log("  能力値45 = NPB平均 とするための調整案");
    console.log("=".repeat(70));

    console.log("\n--- 現状 vs NPB目標 ---");
    const issues: string[] = [];

    // 速度チェック
    const velTarget = 135;
    const velDiff = velTarget - stats.velMean;
    console.log(`  速度: 現在 ${stats.velMean.toFixed(1)} km/h → 目標 ~${velTarget} km/h (差: ${velDiff > 0 ? "+" : ""}${velDiff.toFixed(1)})`);
    if (Math.abs(velDiff) > 3) {
      const currentBase = 120;
      const newBase = currentBase + velDiff;
      issues.push(`  → 速度ベース値を ${currentBase} → ${newBase.toFixed(0)} に変更`);
      issues.push(`    (式: velMean = ${newBase.toFixed(0)} + (power-50)*0.5 + (contact-50)*0.15)`);
    }

    // 角度チェック
    const angTarget = 12;
    const angDiff = angTarget - stats.angleMean;
    console.log(`  角度: 現在 ${stats.angleMean.toFixed(1)}° → 目標 ~${angTarget}° (差: ${angDiff > 0 ? "+" : ""}${angDiff.toFixed(1)})`);
    if (Math.abs(angDiff) > 1) {
      const currentBase = 12;
      const newBase = currentBase + angDiff;
      issues.push(`  → 角度ベース値を ${currentBase} → ${newBase.toFixed(0)} に変更`);
    }

    // タイプ分布チェック
    console.log(`  ゴロ%:    ${stats.gbPct.toFixed(1)}% (目標: 43-50%)`);
    console.log(`  ライナー%: ${stats.ldPct.toFixed(1)}% (目標: 20-25%)`);
    console.log(`  フライ%:   ${stats.fbPct.toFixed(1)}% (目標: 25-32%)`);
    console.log(`  PF%:       ${stats.pfPct.toFixed(1)}% (目標: 5-10%)`);
    console.log(`  HR/BIP%:   ${stats.hrPct.toFixed(2)}% (目標: 2-4%)`);

    if (stats.pfPct < 5) {
      issues.push(`  → ポップフライ率が低い: 角度σを16→18にする or ポップ閾値40→38に下げる`);
    }
    if (stats.hrPct < 2) {
      issues.push(`  → HR率が低い: 速度ベースを上げてフライの飛距離を伸ばす / dragFactor調整`);
    }

    if (issues.length > 0) {
      console.log("\n--- 推奨調整 ---");
      for (const issue of issues) {
        console.log(issue);
      }
    } else {
      console.log("\n  全指標がNPB参考範囲内。調整不要。");
    }

    // 最低限のアサーション
    expect(stats.gbPct + stats.ldPct + stats.fbPct + stats.pfPct).toBeCloseTo(100, 0);
  });
});
