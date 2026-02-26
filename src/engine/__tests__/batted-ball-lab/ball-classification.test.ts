/**
 * 打球分類テスト
 *
 * classifyBattedBallType の境界値・マッピング検証
 */
import { describe, it, expect } from "vitest";
import { classifyBattedBallType } from "@/engine/simulation";
import { formatTable } from "./helpers";

describe("classifyBattedBallType: 境界値テスト", () => {
  // 角度境界: -15, 10, 15, 20, 50
  // 速度境界: 100 (弱いライナー→ゴロの境界)

  it("角度 < 10° → ground_ball", () => {
    expect(classifyBattedBallType(-15, 150)).toBe("ground_ball");
    expect(classifyBattedBallType(-5, 150)).toBe("ground_ball");
    expect(classifyBattedBallType(0, 150)).toBe("ground_ball");
    expect(classifyBattedBallType(5, 150)).toBe("ground_ball");
    expect(classifyBattedBallType(9, 150)).toBe("ground_ball");
    expect(classifyBattedBallType(9.9, 150)).toBe("ground_ball");
  });

  it("10-19° + 速度>=100 → line_drive", () => {
    expect(classifyBattedBallType(10, 100)).toBe("line_drive");
    expect(classifyBattedBallType(15, 100)).toBe("line_drive");
    expect(classifyBattedBallType(15, 130)).toBe("line_drive");
    expect(classifyBattedBallType(19, 150)).toBe("line_drive");
  });

  it("10-11° + 速度<85 → ground_ball (弱いライナー→ゴロ)", () => {
    // 実装: launchAngle < 12 && exitVelocity < 85 の場合のみゴロ
    expect(classifyBattedBallType(10, 80)).toBe("ground_ball");
    expect(classifyBattedBallType(11, 84)).toBe("ground_ball");
    // 12°以上 or 速度85以上 → ライナー
    expect(classifyBattedBallType(12, 80)).toBe("line_drive");
    expect(classifyBattedBallType(10, 85)).toBe("line_drive");
  });

  it("15-19° → line_drive (15°以上は低速でもライナー)", () => {
    // 15°は「launchAngle < 15」の条件外なので、速度に関係なくライナー
    expect(classifyBattedBallType(15, 90)).toBe("line_drive");
    expect(classifyBattedBallType(16, 95)).toBe("line_drive");
    expect(classifyBattedBallType(19, 80)).toBe("line_drive");
  });

  it("20-37° → fly_ball", () => {
    expect(classifyBattedBallType(20, 150)).toBe("fly_ball");
    expect(classifyBattedBallType(30, 150)).toBe("fly_ball");
    expect(classifyBattedBallType(35, 150)).toBe("fly_ball");
    expect(classifyBattedBallType(37, 150)).toBe("fly_ball");
  });

  it("50°以上 → popup", () => {
    // 実装: launchAngle >= 50 の場合のみポップフライ
    expect(classifyBattedBallType(50, 100)).toBe("popup");
    expect(classifyBattedBallType(55, 100)).toBe("popup");
    expect(classifyBattedBallType(70, 80)).toBe("popup");
    // 49°以下 → フライボール
    expect(classifyBattedBallType(38, 150)).toBe("fly_ball");
    expect(classifyBattedBallType(40, 150)).toBe("fly_ball");
    expect(classifyBattedBallType(45, 120)).toBe("fly_ball");
    expect(classifyBattedBallType(49, 100)).toBe("fly_ball");
  });
});

describe("classifyBattedBallType: 全マッピングテーブル", () => {
  it("角度×速度の分類マトリクス", () => {
    const angles = [-15, -10, -5, 0, 5, 10, 12, 14, 15, 16, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70];
    const velocities = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170];

    const typeShort: Record<string, string> = {
      ground_ball: "G",
      line_drive: "L",
      fly_ball: "F",
      popup: "P",
    };

    const headers = ["角度\\速度", ...velocities.map(v => `${v}`)];
    const rows: (string | number)[][] = [];

    for (const a of angles) {
      const row: (string | number)[] = [`${a}°`];
      for (const v of velocities) {
        row.push(typeShort[classifyBattedBallType(a, v)]);
      }
      rows.push(row);
    }

    console.log("\n=== 打球分類マトリクス (G=ゴロ, L=ライナー, F=フライ, P=ポップ) ===");
    console.log(formatTable(headers, rows));
  });
});

describe("classifyBattedBallType: 境界の一貫性", () => {
  it("角度が連続的に増加する際、タイプが順序通り遷移する", () => {
    // ground_ball → line_drive → fly_ball → popup の順序
    const typeOrder = { ground_ball: 0, line_drive: 1, fly_ball: 2, popup: 3 };
    let prevOrder = 0;
    const velocity = 130;

    for (let a = -15; a <= 70; a++) {
      const type = classifyBattedBallType(a, velocity);
      const order = typeOrder[type];
      expect(order).toBeGreaterThanOrEqual(prevOrder);
      prevOrder = order;
    }
  });

  it("速度が変わっても基本的な角度境界は維持される", () => {
    // 高速球でも低角度はゴロ
    expect(classifyBattedBallType(5, 170)).toBe("ground_ball");
    // 低速でも高角度はポップフライ
    expect(classifyBattedBallType(55, 80)).toBe("popup");
    // 高角度フライは速度によらない
    expect(classifyBattedBallType(30, 80)).toBe("fly_ball");
    expect(classifyBattedBallType(30, 170)).toBe("fly_ball");
  });
});
