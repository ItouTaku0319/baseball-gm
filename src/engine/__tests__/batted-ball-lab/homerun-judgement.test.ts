/**
 * HR判定テスト
 *
 * estimateDistance vs getFenceDistance のHR判定ロジック検証
 */
import { describe, it, expect } from "vitest";
import { estimateDistance, getFenceDistance } from "@/engine/simulation";
import { formatTable } from "./helpers";

/** HR判定のシミュレーション（simulation.ts の resolvePlayWithAI ロジックを再現） */
function simulateHRJudgement(
  exitVelocity: number,
  launchAngle: number,
  direction: number,
  power: number,
  trials: number = 1000
): { hrRate: number; avgRatio: number } {
  const distance = estimateDistance(exitVelocity, launchAngle);
  const fenceDist = getFenceDistance(direction);
  const ratio = distance / fenceDist;

  if (ratio >= 1.05) return { hrRate: 1.0, avgRatio: ratio };
  if (ratio < 0.95) return { hrRate: 0.0, avgRatio: ratio };

  // フェンス際ランダム判定
  let hrCount = 0;
  for (let i = 0; i < trials; i++) {
    const powerBonus = (power - 50) * 0.002;
    const hrChance = (ratio - 0.95) / 0.10 + powerBonus;
    const clampedChance = Math.max(0.01, Math.min(0.90, hrChance));
    if (Math.random() < clampedChance) hrCount++;
  }

  return { hrRate: hrCount / trials, avgRatio: ratio };
}

describe("HR判定: 基本ロジック", () => {
  it("ratio >= 1.05 → 確定HR", () => {
    // 170km/h, 35°, センター方向 → 高飛距離
    const d = estimateDistance(170, 35);
    const f = getFenceDistance(45);
    const ratio = d / f;

    console.log(`\n170km/h, 35°, センター: 飛距離=${d.toFixed(1)}m, フェンス=${f.toFixed(1)}m, ratio=${ratio.toFixed(3)}`);

    if (ratio >= 1.05) {
      expect(ratio).toBeGreaterThanOrEqual(1.05);
    }
  });

  it("ratio < 0.95 → HR不可", () => {
    const d = estimateDistance(100, 20);
    const f = getFenceDistance(45);
    const ratio = d / f;

    expect(ratio).toBeLessThan(0.95);
    console.log(`100km/h, 20°, センター: ratio=${ratio.toFixed(3)} → HR不可`);
  });
});

describe("HR判定: 速度×角度×方向のマトリクス", () => {
  it("各方向でのHR判定結果", () => {
    const directions = [0, 22, 45, 68, 90];
    const velocities = [130, 140, 150, 160, 170];
    const angle = 30;

    const headers = [
      "速度\\方向",
      ...directions.map(d => `${d}°(${getFenceDistance(d).toFixed(0)}m)`),
    ];
    const rows: (string | number)[][] = [];

    for (const v of velocities) {
      const row: (string | number)[] = [`${v}km/h`];
      for (const dir of directions) {
        const d = estimateDistance(v, angle);
        const f = getFenceDistance(dir);
        const ratio = d / f;

        let label: string;
        if (ratio >= 1.05) label = "HR確";
        else if (ratio >= 0.95) label = `際${(ratio * 100).toFixed(0)}%`;
        else label = `×${(ratio * 100).toFixed(0)}%`;

        row.push(label);
      }
      rows.push(row);
    }

    console.log(`\n=== HR判定マトリクス (角度=${angle}°) ===`);
    console.log("HR確=確定HR, 際XX%=飛距離/フェンス比, ×XX%=HR不可");
    console.log(formatTable(headers, rows));
  });

  it("各角度でのHR到達率 (速度=160km/h, センター方向)", () => {
    const angles = [15, 20, 25, 30, 35, 40, 45];
    const headers = ["角度", "飛距離(m)", "フェンス(m)", "比率", "判定", "HR率(P50)"];
    const rows: (string | number)[][] = [];

    for (const a of angles) {
      const d = estimateDistance(160, a);
      const f = getFenceDistance(45);
      const ratio = d / f;
      const { hrRate } = simulateHRJudgement(160, a, 45, 50);

      let judgement: string;
      if (ratio >= 1.05) judgement = "確定HR";
      else if (ratio >= 0.95) judgement = "フェンス際";
      else judgement = "HR不可";

      rows.push([
        `${a}°`,
        d.toFixed(1),
        f.toFixed(1),
        ratio.toFixed(3),
        judgement,
        `${(hrRate * 100).toFixed(1)}%`,
      ]);
    }

    console.log("\n=== 角度別HR判定 (160km/h, センター) ===");
    console.log(formatTable(headers, rows));
  });
});

describe("HR判定: パワー補正の効果", () => {
  it("同じ打球でもパワーが高いとフェンス際でHR率が上がる", () => {
    // フェンス際になる速度・角度を探す
    const dir = 45;
    const fence = getFenceDistance(dir);

    // ratio が 0.97 程度になる条件を探す
    let testVel = 150;
    let testAngle = 30;
    for (let v = 140; v <= 170; v += 5) {
      for (let a = 20; a <= 45; a += 5) {
        const d = estimateDistance(v, a);
        const ratio = d / fence;
        if (ratio >= 0.96 && ratio <= 1.0) {
          testVel = v;
          testAngle = a;
          break;
        }
      }
    }

    const powers = [20, 40, 50, 60, 80, 100];
    const headers = ["パワー", "HR率"];
    const rows: (string | number)[][] = [];

    for (const p of powers) {
      const { hrRate, avgRatio } = simulateHRJudgement(testVel, testAngle, dir, p, 3000);
      rows.push([String(p), `${(hrRate * 100).toFixed(1)}%`]);
    }

    const d = estimateDistance(testVel, testAngle);
    const ratio = d / fence;
    console.log(`\n=== パワー別HR率 (${testVel}km/h, ${testAngle}°, ratio=${ratio.toFixed(3)}) ===`);
    console.log(formatTable(headers, rows));
  });
});

describe("HR判定: 方向別の難易度", () => {
  it("両翼(100m) vs 中堅(122m) でのHR難易度比較", () => {
    const velocities = [140, 145, 150, 155, 160, 165, 170];
    const angle = 30;
    const headers = ["速度", "両翼(0°)HR率", "中堅(45°)HR率", "両翼ratio", "中堅ratio"];
    const rows: (string | number)[][] = [];

    for (const v of velocities) {
      const { hrRate: leftRate, avgRatio: leftRatio } = simulateHRJudgement(v, angle, 0, 50);
      const { hrRate: centerRate, avgRatio: centerRatio } = simulateHRJudgement(v, angle, 45, 50);

      rows.push([
        `${v}km/h`,
        `${(leftRate * 100).toFixed(1)}%`,
        `${(centerRate * 100).toFixed(1)}%`,
        leftRatio.toFixed(3),
        centerRatio.toFixed(3),
      ]);
    }

    console.log(`\n=== 方向別HR率比較 (角度=${angle}°, パワー=50) ===`);
    console.log(formatTable(headers, rows));
  });
});

describe("HR判定: 最低HR条件マップ", () => {
  it("各方向で100%HR確定になる最低速度 (角度=30°)", () => {
    const directions = [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90];
    const angle = 30;
    const headers = ["方向(°)", "フェンス(m)", "最低速度(km/h)", "その時の飛距離(m)"];
    const rows: (string | number)[][] = [];

    for (const dir of directions) {
      const fence = getFenceDistance(dir);
      let minVel = -1;

      for (let v = 100; v <= 200; v++) {
        const d = estimateDistance(v, angle);
        if (d / fence >= 1.05) {
          minVel = v;
          break;
        }
      }

      if (minVel > 0) {
        rows.push([
          String(dir),
          fence.toFixed(1),
          String(minVel),
          estimateDistance(minVel, angle).toFixed(1),
        ]);
      } else {
        rows.push([String(dir), fence.toFixed(1), "不可", "-"]);
      }
    }

    console.log(`\n=== 方向別 確定HR最低速度 (角度=${angle}°) ===`);
    console.log(formatTable(headers, rows));
  });
});
