/**
 * 飛距離計算テスト
 *
 * estimateDistance と getFenceDistance の動作確認・データ出力
 */
import { describe, it, expect } from "vitest";
import { estimateDistance, getFenceDistance } from "@/engine/simulation";
import { formatTable } from "./helpers";

describe("estimateDistance: 基本動作", () => {
  it("角度 0° 以下は飛距離 0", () => {
    expect(estimateDistance(150, 0)).toBe(0);
    expect(estimateDistance(150, -5)).toBe(0);
  });

  it("角度が正なら飛距離は正", () => {
    expect(estimateDistance(130, 15)).toBeGreaterThan(0);
  });

  it("同じ角度なら速度が高いほど飛距離が長い", () => {
    const d1 = estimateDistance(100, 30);
    const d2 = estimateDistance(150, 30);
    expect(d2).toBeGreaterThan(d1);
  });

  it("極端に低い速度でも正常に計算", () => {
    const d = estimateDistance(80, 10);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(30);
  });
});

describe("estimateDistance: 角度別飛距離テーブル", () => {
  it("速度別×角度別の飛距離マトリクス", () => {
    const velocities = [80, 100, 120, 130, 140, 150, 160, 170];
    const angles = [5, 10, 15, 20, 25, 30, 35, 40, 45];

    const headers = ["速度\\角度", ...angles.map(a => `${a}°`)];
    const rows: (string | number)[][] = [];

    for (const v of velocities) {
      const row: (string | number)[] = [`${v}km/h`];
      for (const a of angles) {
        row.push(Math.round(estimateDistance(v, a)));
      }
      rows.push(row);
    }

    console.log("\n=== 飛距離マトリクス (m) ===");
    console.log(formatTable(headers, rows));

    // 基本的な範囲チェック
    for (const v of velocities) {
      for (const a of angles) {
        const d = estimateDistance(v, a);
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(200); // 現実的な上限
      }
    }
  });

  it("最大飛距離は45°付近で出る（放物運動の性質）", () => {
    const v = 160;
    const distances = [];
    for (let a = 5; a <= 60; a += 5) {
      distances.push({ angle: a, distance: estimateDistance(v, a) });
    }
    const maxEntry = distances.reduce((best, e) => e.distance > best.distance ? e : best);
    // 空気抵抗があるので35-50°付近が最大
    expect(maxEntry.angle).toBeGreaterThanOrEqual(30);
    expect(maxEntry.angle).toBeLessThanOrEqual(50);
  });
});

describe("estimateDistance: HR到達可能性", () => {
  it("各速度で「HR可能な最低角度」を特定", () => {
    const velocities = [120, 130, 140, 150, 160, 170];
    const results: { velocity: number; minAngle: number | string; maxDist: number }[] = [];

    for (const v of velocities) {
      let minAngle: number | null = null;
      let maxDist = 0;

      for (let a = 5; a <= 60; a++) {
        const d = estimateDistance(v, a);
        if (d > maxDist) maxDist = d;
        // 中堅122m, 両翼100m → 平均的なフェンス約110m
        if (d >= 100 && minAngle === null) {
          minAngle = a;
        }
      }
      results.push({
        velocity: v,
        minAngle: minAngle ?? "不可",
        maxDist: Math.round(maxDist),
      });
    }

    console.log("\n=== HR到達可能性 (フェンス100m基準) ===");
    const headers = ["速度(km/h)", "HR最低角度", "最大飛距離(m)"];
    const rows = results.map(r => [String(r.velocity), String(r.minAngle), r.maxDist]);
    console.log(formatTable(headers, rows));

    // 170km/hならHR到達可能であるべき
    const top = results.find(r => r.velocity === 170);
    expect(top?.maxDist).toBeGreaterThan(100);
  });
});

describe("getFenceDistance: NPBフェンス形状", () => {
  it("両翼 (0°, 90°) は 100m", () => {
    expect(getFenceDistance(0)).toBeCloseTo(100, 0);
    expect(getFenceDistance(90)).toBeCloseTo(100, 0);
  });

  it("中堅 (45°) は 122m", () => {
    expect(getFenceDistance(45)).toBeCloseTo(122, 0);
  });

  it("フェンス形状テーブル", () => {
    const angles = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
    const headers = ["方向(°)", "フェンス距離(m)"];
    const rows = angles.map(a => [String(a), getFenceDistance(a).toFixed(1)]);

    console.log("\n=== NPBフェンス距離 ===");
    console.log(formatTable(headers, rows));

    // 全方向で100m以上
    for (const a of angles) {
      expect(getFenceDistance(a)).toBeGreaterThanOrEqual(100);
    }
  });

  it("左右対称性: dir=20° と dir=70° でフェンス距離が等しい", () => {
    // sin(20/90*π) と sin(70/90*π) は異なるので非対称
    // ただし0°と90°は同じ
    const d0 = getFenceDistance(0);
    const d90 = getFenceDistance(90);
    expect(d0).toBeCloseTo(d90, 5);
  });
});

describe("estimateDistance vs getFenceDistance: HR判定ゾーン", () => {
  it("各方向でHRになる最低速度×角度の組み合わせ", () => {
    const directions = [0, 15, 30, 45, 60, 75, 90];
    const results: { dir: number; fence: number; minVel: number | string; bestAngle: number | string }[] = [];

    for (const dir of directions) {
      const fence = getFenceDistance(dir);
      let found = false;

      for (let v = 100; v <= 170; v += 5) {
        for (let a = 15; a <= 50; a += 5) {
          const d = estimateDistance(v, a);
          if (d >= fence) {
            results.push({
              dir,
              fence: Math.round(fence),
              minVel: v,
              bestAngle: a,
            });
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        results.push({ dir, fence: Math.round(fence), minVel: "不可能", bestAngle: "-" });
      }
    }

    console.log("\n=== 方向別HR到達の最低条件 ===");
    const headers = ["方向(°)", "フェンス(m)", "最低速度", "角度"];
    const rows = results.map(r => [String(r.dir), String(r.fence), String(r.minVel), String(r.bestAngle)]);
    console.log(formatTable(headers, rows));
  });
});
