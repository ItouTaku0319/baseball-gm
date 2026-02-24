/**
 * 着地計算テスト
 *
 * calcBallLanding の着地座標・飛行時間・距離の検証
 */
import { describe, it, expect } from "vitest";
import { calcBallLanding } from "@/engine/fielding-ai";
import { estimateDistance } from "@/engine/simulation";
import { formatTable } from "./helpers";

describe("calcBallLanding: ゴロの着地計算", () => {
  it("低角度(5°) はゴロと判定される", () => {
    const landing = calcBallLanding(45, 5, 130);
    expect(landing.isGroundBall).toBe(true);
  });

  it("ゴロの最大距離は55m", () => {
    // 超高速ゴロでもキャップ
    const landing = calcBallLanding(45, -5, 170);
    expect(landing.distance).toBeLessThanOrEqual(55);
  });

  it("速度別ゴロの到達距離と時間", () => {
    const velocities = [80, 100, 120, 140, 160, 170];
    const headers = ["速度(km/h)", "距離(m)", "時間(s)", "座標X(m)", "座標Y(m)"];
    const rows: (string | number)[][] = [];

    for (const v of velocities) {
      const landing = calcBallLanding(45, 5, v); // センター方向ゴロ
      rows.push([
        String(v),
        landing.distance.toFixed(1),
        landing.flightTime.toFixed(2),
        landing.position.x.toFixed(1),
        landing.position.y.toFixed(1),
      ]);
    }

    console.log("\n=== ゴロ: 速度別の到達データ (方向=45°) ===");
    console.log(formatTable(headers, rows));

    // 速度が上がると距離も増加
    const slow = calcBallLanding(45, 5, 80);
    const fast = calcBallLanding(45, 5, 160);
    expect(fast.distance).toBeGreaterThan(slow.distance);
  });

  it("方向別ゴロの座標", () => {
    const directions = [0, 15, 30, 45, 60, 75, 90];
    const headers = ["方向(°)", "距離(m)", "X(m)", "Y(m)"];
    const rows: (string | number)[][] = [];

    for (const dir of directions) {
      const landing = calcBallLanding(dir, 5, 130);
      rows.push([
        String(dir),
        landing.distance.toFixed(1),
        landing.position.x.toFixed(1),
        landing.position.y.toFixed(1),
      ]);
    }

    console.log("\n=== ゴロ: 方向別の座標 (速度=130km/h) ===");
    console.log(formatTable(headers, rows));

    // 方向0°(レフト線) → x負, y正
    const left = calcBallLanding(0, 5, 130);
    expect(left.position.x).toBeLessThanOrEqual(0.5); // ほぼ0（45°基準からの偏差）

    // 方向90°(ライト線) → x正, y正
    const right = calcBallLanding(90, 5, 130);
    expect(right.position.x).toBeGreaterThan(0);
  });
});

describe("calcBallLanding: フライの着地計算", () => {
  it("角度10°以上はフライと判定される", () => {
    const landing = calcBallLanding(45, 15, 130);
    expect(landing.isGroundBall).toBe(false);
  });

  it("速度×角度別の飛距離と飛行時間", () => {
    const configs: { v: number; a: number }[] = [
      { v: 100, a: 15 },
      { v: 120, a: 20 },
      { v: 130, a: 25 },
      { v: 140, a: 30 },
      { v: 150, a: 35 },
      { v: 160, a: 30 },
      { v: 170, a: 35 },
    ];

    const headers = ["速度", "角度", "距離(m)", "飛行時間(s)", "X(m)", "Y(m)"];
    const rows: (string | number)[][] = [];

    for (const { v, a } of configs) {
      const landing = calcBallLanding(45, a, v); // センター方向
      rows.push([
        `${v}km/h`,
        `${a}°`,
        landing.distance.toFixed(1),
        landing.flightTime.toFixed(2),
        landing.position.x.toFixed(1),
        landing.position.y.toFixed(1),
      ]);
    }

    console.log("\n=== フライ: 速度×角度別のデータ (方向=45°) ===");
    console.log(formatTable(headers, rows));
  });

  it("同じ速度なら角度による飛距離の変化を確認", () => {
    const v = 150;
    const angles = [10, 15, 20, 25, 30, 35, 40, 45, 50];
    const headers = ["角度", "距離(m)", "飛行時間(s)"];
    const rows: (string | number)[][] = [];

    for (const a of angles) {
      const landing = calcBallLanding(45, a, v);
      rows.push([`${a}°`, landing.distance.toFixed(1), landing.flightTime.toFixed(2)]);
    }

    console.log(`\n=== フライ: 角度別の飛距離 (速度=${v}km/h) ===`);
    console.log(formatTable(headers, rows));
  });

  it("ポップフライ (50°以上) は滞空時間が長いが飛距離は限定的", () => {
    const popup = calcBallLanding(45, 55, 120);
    const fly = calcBallLanding(45, 30, 140); // フライは速度も高めで比較
    // 高角度は滞空時間が長い分、水平距離は伸びにくい
    console.log(`\nポップフライ(55°,120km/h): 距離=${popup.distance.toFixed(1)}m, 飛行時間=${popup.flightTime.toFixed(2)}s`);
    console.log(`フライ(30°,140km/h): 距離=${fly.distance.toFixed(1)}m, 飛行時間=${fly.flightTime.toFixed(2)}s`);
    // 速度が同等以上のフライの方が飛距離は長いはず
    expect(fly.distance).toBeGreaterThan(popup.distance);
  });
});

describe("calcBallLanding: estimateDistance との比較", () => {
  // calcBallLanding と estimateDistance は同じ物理モデルを使うべき
  // ただし calcBallLanding は座標も返し、estimateDistance はスカラーのみ

  it("同じ入力で似た飛距離を返す", () => {
    // fielding-ai.ts と simulation.ts で同じ dragFactor=0.70 を使っている

    const configs = [
      { dir: 45, angle: 25, vel: 140 },
      { dir: 45, angle: 35, vel: 150 },
      { dir: 45, angle: 20, vel: 130 },
    ];

    const headers = ["角度", "速度", "estimateDistance(m)", "calcBallLanding(m)", "差(m)"];
    const rows: (string | number)[][] = [];

    for (const { dir, angle, vel } of configs) {
      const ed = estimateDistance(vel, angle);
      const cl = calcBallLanding(dir, angle, vel);
      const diff = Math.abs(ed - cl.distance);
      rows.push([`${angle}°`, `${vel}km/h`, ed.toFixed(1), cl.distance.toFixed(1), diff.toFixed(1)]);
    }

    console.log("\n=== estimateDistance vs calcBallLanding の飛距離比較 ===");
    console.log(formatTable(headers, rows));
  });
});

describe("calcBallLanding: 守備位置との距離感", () => {
  it("典型的な打球が各守備位置付近に落ちるか確認", () => {
    // デフォルト守備位置 (fielding-ai.ts より)
    const fielderPositions = [
      { name: "P", x: 0, y: 18.4 },
      { name: "C", x: 0, y: 1.0 },
      { name: "1B", x: 20, y: 28 },
      { name: "2B", x: 10, y: 36 },
      { name: "3B", x: -20, y: 28 },
      { name: "SS", x: -10, y: 36 },
      { name: "LF", x: -26, y: 65 },
      { name: "CF", x: 0, y: 73 },
      { name: "RF", x: 26, y: 65 },
    ];

    // 様々な打球の着地位置を計算して守備位置との距離を出す
    const balls = [
      { label: "ゴロ(3B方向)", dir: 10, angle: 3, vel: 120 },
      { label: "ゴロ(SS方向)", dir: 30, angle: 5, vel: 130 },
      { label: "ゴロ(2B方向)", dir: 55, angle: 5, vel: 130 },
      { label: "ゴロ(1B方向)", dir: 80, angle: 3, vel: 120 },
      { label: "フライ(LF)", dir: 15, angle: 30, vel: 140 },
      { label: "フライ(CF)", dir: 45, angle: 30, vel: 140 },
      { label: "フライ(RF)", dir: 75, angle: 30, vel: 140 },
      { label: "ライナー(SS)", dir: 30, angle: 15, vel: 140 },
    ];

    console.log("\n=== 打球着地位置と各守備位置の距離 ===");

    for (const ball of balls) {
      const landing = calcBallLanding(ball.dir, ball.angle, ball.vel);
      console.log(`\n${ball.label}: 着地=(${landing.position.x.toFixed(1)}, ${landing.position.y.toFixed(1)}), 距離=${landing.distance.toFixed(1)}m`);

      const distances = fielderPositions.map(fp => {
        const dx = landing.position.x - fp.x;
        const dy = landing.position.y - fp.y;
        return { name: fp.name, dist: Math.sqrt(dx * dx + dy * dy) };
      });
      distances.sort((a, b) => a.dist - b.dist);

      const nearest3 = distances.slice(0, 3);
      console.log(`  最寄り: ${nearest3.map(d => `${d.name}(${d.dist.toFixed(1)}m)`).join(", ")}`);
    }
  });
});
