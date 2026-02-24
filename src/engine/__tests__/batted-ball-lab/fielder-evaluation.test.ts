/**
 * 守備評価テスト
 *
 * evaluateFielders / resolveHitTypeFromLanding の検証
 */
import { describe, it, expect } from "vitest";
import { calcBallLanding, evaluateFielders, resolveHitTypeFromLanding } from "@/engine/fielding-ai";
import { getFenceDistance } from "@/engine/simulation";
import { createFielderMap, formatTable } from "./helpers";

describe("evaluateFielders: 基本動作", () => {
  const fielderMap = createFielderMap();

  it("9人全員の判断結果が返る", () => {
    const landing = calcBallLanding(45, 30, 140);
    const result = evaluateFielders(landing, "fly_ball", fielderMap);
    expect(result.size).toBe(9);
  });

  it("必ず1人は primary ロールを持つ", () => {
    const landing = calcBallLanding(45, 30, 140);
    const result = evaluateFielders(landing, "fly_ball", fielderMap);
    const primary = [...result.values()].find(d => d.role === "primary");
    expect(primary).toBeDefined();
  });

  it("ゴロの primary は内野手が優先", () => {
    const landing = calcBallLanding(30, 5, 120);
    const result = evaluateFielders(landing, "ground_ball", fielderMap);
    const primary = [...result.values()].find(d => d.role === "primary");
    expect(primary).toBeDefined();
    expect(primary!.position).toBeLessThanOrEqual(6); // 1-6 = 内野
  });

  it("フライの primary は外野手が優先", () => {
    const landing = calcBallLanding(45, 30, 140);
    const result = evaluateFielders(landing, "fly_ball", fielderMap);
    const primary = [...result.values()].find(d => d.role === "primary");
    expect(primary).toBeDefined();
    // 外野手(7,8,9)がcanReachなら彼らがprimary
    if (primary!.canReach) {
      expect(primary!.position).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("evaluateFielders: 各方向の最適守備者", () => {
  const fielderMap = createFielderMap();
  const posNames: Record<number, string> = {
    1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
  };

  it("ゴロ方向別の primary 野手", () => {
    const directions = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
    const headers = ["方向(°)", "Primary", "到達時間(s)", "ボール到達(s)", "間に合う?"];
    const rows: (string | number)[][] = [];

    for (const dir of directions) {
      const landing = calcBallLanding(dir, 5, 120);
      const result = evaluateFielders(landing, "ground_ball", fielderMap);
      const primary = [...result.values()].find(d => d.role === "primary");

      if (primary) {
        rows.push([
          `${dir}°`,
          posNames[primary.position],
          primary.timeToReach.toFixed(2),
          primary.ballArrivalTime.toFixed(2),
          primary.canReach ? "○" : "×",
        ]);
      }
    }

    console.log("\n=== ゴロ方向別 primary野手 (速度=120km/h) ===");
    console.log(formatTable(headers, rows));
  });

  it("フライ方向別の primary 野手", () => {
    const directions = [0, 15, 30, 45, 60, 75, 90];
    const headers = ["方向(°)", "Primary", "到達時間(s)", "飛行時間(s)", "間に合う?", "距離(m)"];
    const rows: (string | number)[][] = [];

    for (const dir of directions) {
      const landing = calcBallLanding(dir, 30, 140);
      const result = evaluateFielders(landing, "fly_ball", fielderMap);
      const primary = [...result.values()].find(d => d.role === "primary");

      if (primary) {
        rows.push([
          `${dir}°`,
          posNames[primary.position],
          primary.timeToReach.toFixed(2),
          primary.ballArrivalTime.toFixed(2),
          primary.canReach ? "○" : "×",
          primary.distanceToBall.toFixed(1),
        ]);
      }
    }

    console.log("\n=== フライ方向別 primary野手 (角度=30°, 速度=140km/h) ===");
    console.log(formatTable(headers, rows));
  });
});

describe("evaluateFielders: ライナーの反応遅延", () => {
  const fielderMap = createFielderMap();

  it("ライナーは到達時間がフライより長い（反応遅延の効果）", () => {
    const landing = calcBallLanding(45, 15, 140);

    const flyResult = evaluateFielders(landing, "fly_ball", fielderMap);
    const lineResult = evaluateFielders(landing, "line_drive", fielderMap);

    // 同じ着地位置で打球タイプだけ変える → ライナーの方が到達時間が長い
    const flyPrimary = [...flyResult.values()].find(d => d.role === "primary");
    const linePrimary = [...lineResult.values()].find(d => d.role === "primary");

    if (flyPrimary && linePrimary && flyPrimary.position === linePrimary.position) {
      expect(linePrimary.timeToReach).toBeGreaterThan(flyPrimary.timeToReach);
      console.log(`\n反応遅延の効果: フライ ${flyPrimary.timeToReach.toFixed(2)}s → ライナー ${linePrimary.timeToReach.toFixed(2)}s (+${(linePrimary.timeToReach - flyPrimary.timeToReach).toFixed(2)}s)`);
    }
  });
});

describe("evaluateFielders: 守備力による到達時間の変化", () => {
  it("守備力が高いほど反応時間が短い", () => {
    const fast = createFielderMap({ 6: { fielding: 90, speed: 80 } }); // 俊足好守の遊撃手
    const slow = createFielderMap({ 6: { fielding: 20, speed: 30 } }); // 鈍足拙守の遊撃手

    const landing = calcBallLanding(30, 5, 120); // SS方向ゴロ

    const fastResult = evaluateFielders(landing, "ground_ball", fast);
    const slowResult = evaluateFielders(landing, "ground_ball", slow);

    const fastSS = fastResult.get(6)!;
    const slowSS = slowResult.get(6)!;

    expect(fastSS.timeToReach).toBeLessThan(slowSS.timeToReach);
    console.log(`\n守備力90/走力80のSS到達: ${fastSS.timeToReach.toFixed(2)}s`);
    console.log(`守備力20/走力30のSS到達: ${slowSS.timeToReach.toFixed(2)}s`);
    console.log(`差: ${(slowSS.timeToReach - fastSS.timeToReach).toFixed(2)}s`);
  });
});

describe("resolveHitTypeFromLanding: 長打判定", () => {
  it("内野付近 (<60m) は常にシングル", () => {
    const landing = calcBallLanding(45, 15, 120);
    // 近距離を確実にするためdistanceを直接設定
    const mockLanding = { ...landing, distance: 40 };
    for (let i = 0; i < 100; i++) {
      expect(resolveHitTypeFromLanding(mockLanding, 50, 122)).toBe("single");
    }
  });

  it("外野中間 (60-80m) はシングル中心、たまにダブル", () => {
    const mockLanding = { ...calcBallLanding(45, 25, 140), distance: 70 };
    let singles = 0, doubles = 0, triples = 0;
    const N = 1000;

    for (let i = 0; i < N; i++) {
      const type = resolveHitTypeFromLanding(mockLanding, 50, 122);
      if (type === "single") singles++;
      else if (type === "double") doubles++;
      else triples++;
    }

    console.log(`\n=== 外野中間(70m) 長打判定 (N=${N}) ===`);
    console.log(`  シングル: ${(singles / N * 100).toFixed(1)}%`);
    console.log(`  ダブル: ${(doubles / N * 100).toFixed(1)}%`);
    console.log(`  トリプル: ${(triples / N * 100).toFixed(1)}%`);

    expect(singles).toBeGreaterThan(doubles);
  });

  it("フェンス際 (90%以上) はトリプル高確率", () => {
    const fence = 122;
    const mockLanding = { ...calcBallLanding(45, 35, 160), distance: fence * 0.92 };
    let singles = 0, doubles = 0, triples = 0;
    const N = 1000;

    for (let i = 0; i < N; i++) {
      const type = resolveHitTypeFromLanding(mockLanding, 50, fence);
      if (type === "single") singles++;
      else if (type === "double") doubles++;
      else triples++;
    }

    console.log(`\n=== フェンス際(${(fence * 0.92).toFixed(0)}m / フェンス${fence}m) 長打判定 (N=${N}) ===`);
    console.log(`  シングル: ${(singles / N * 100).toFixed(1)}%`);
    console.log(`  ダブル: ${(doubles / N * 100).toFixed(1)}%`);
    console.log(`  トリプル: ${(triples / N * 100).toFixed(1)}%`);

    expect(triples).toBeGreaterThan(singles);
  });

  it("走力による長打率の変化", () => {
    const fence = 122;
    const mockLanding = { ...calcBallLanding(45, 30, 145), distance: 75 };
    const speeds = [10, 30, 50, 70, 90];
    const headers = ["走力", "シングル%", "ダブル%", "トリプル%"];
    const rows: (string | number)[][] = [];

    for (const speed of speeds) {
      let singles = 0, doubles = 0, triples = 0;
      const N = 2000;

      for (let i = 0; i < N; i++) {
        const type = resolveHitTypeFromLanding(mockLanding, speed, fence);
        if (type === "single") singles++;
        else if (type === "double") doubles++;
        else triples++;
      }

      rows.push([
        String(speed),
        ((singles / N) * 100).toFixed(1),
        ((doubles / N) * 100).toFixed(1),
        ((triples / N) * 100).toFixed(1),
      ]);
    }

    console.log(`\n=== 走力別 長打率 (距離=75m, フェンス=${fence}m) ===`);
    console.log(formatTable(headers, rows));
  });
});
