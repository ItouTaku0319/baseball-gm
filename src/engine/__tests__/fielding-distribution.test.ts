import { describe, it, expect } from "vitest";
import { simulateGame, generateBattedBall, classifyBattedBallType } from "@/engine/simulation";
import type { Player } from "@/models/player";
import type { Team } from "@/models/team";

function createTestPlayer(id: string, position: Player["position"], isPitcher: boolean): Player {
  const base: Player = {
    id,
    name: `テスト${position}`,
    age: 25,
    position,
    isPitcher,
    throwHand: "R",
    batSide: "R",
    batting: {
      contact: 50,
      power: 50,
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
          stamina: 60,
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
  };
  return base;
}

function createTestTeam(id: string): Team {
  const positions: Player["position"][] = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  const roster = positions.map((pos, i) =>
    createTestPlayer(`${id}-${pos}-${i}`, pos, pos === "P")
  );
  // 投手を複数追加（ローテーション用）
  for (let i = 1; i <= 5; i++) {
    roster.push(createTestPlayer(`${id}-SP${i}`, "P", true));
  }
  return {
    id,
    name: `テストチーム${id}`,
    shortName: `T${id}`,
    color: "#000000",
    roster,
    budget: 50000,
    fanBase: 50,
    homeBallpark: "テスト球場",
  };
}

describe("ポジション別守備機会分布", () => {
  const N = 500;
  const teamA = createTestTeam("A");
  const teamB = createTestTeam("B");

  const positionPlayerIds: Record<string, string> = {};
  const positions = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  positions.forEach((pos, i) => {
    positionPlayerIds[pos] = `A-${pos}-${i}`;
  });

  const totals: Record<string, { po: number; a: number; e: number }> = {};
  positions.forEach((pos) => {
    totals[pos] = { po: 0, a: 0, e: 0 };
  });

  for (let i = 0; i < N; i++) {
    const result = simulateGame(teamA, teamB);
    for (const pos of positions) {
      const playerId = positionPlayerIds[pos];
      const stats = result.playerStats.find((s) => s.playerId === playerId);
      if (stats) {
        totals[pos].po += stats.putOuts ?? 0;
        totals[pos].a += stats.assists ?? 0;
        totals[pos].e += stats.errors ?? 0;
      }
    }
  }

  const avg: Record<string, { po: number; a: number; total: number }> = {};
  positions.forEach((pos) => {
    avg[pos] = {
      po: totals[pos].po / N,
      a: totals[pos].a / N,
      total: (totals[pos].po + totals[pos].a) / N,
    };
  });

  it("デバッグ: ポジション別平均値を出力", () => {
    console.log("\n=== ポジション別守備機会 (平均/試合) ===");
    for (const pos of positions) {
      console.log(
        `${pos}: PO=${avg[pos].po.toFixed(2)}, A=${avg[pos].a.toFixed(2)}, Total=${avg[pos].total.toFixed(2)}`
      );
    }
    expect(true).toBe(true);
  });

  // teamAはホームチームとして9イニングの表のみ守備するため、
  // SS守備機会はフル18イニングの約半分になる
  it("SS: 1試合あたりPO+Aが3.0-6.5", () => {
    expect(avg["SS"].total).toBeGreaterThanOrEqual(3.0);
    expect(avg["SS"].total).toBeLessThanOrEqual(6.5);
  });

  it("SS: 1試合あたりPOが0.5-3.5", () => {
    expect(avg["SS"].po).toBeGreaterThanOrEqual(0.5);
    expect(avg["SS"].po).toBeLessThanOrEqual(3.5);
  });

  it("SS: 1試合あたりAが2.0-4.5", () => {
    expect(avg["SS"].a).toBeGreaterThanOrEqual(2.0);
    expect(avg["SS"].a).toBeLessThanOrEqual(4.5);
  });

  it("1B: 1試合あたりPOが6-12", () => {
    expect(avg["1B"].po).toBeGreaterThanOrEqual(6);
    expect(avg["1B"].po).toBeLessThanOrEqual(12);
  });

  it("2B: 1試合あたりPO+Aが3.5-8", () => {
    expect(avg["2B"].total).toBeGreaterThanOrEqual(3.5);
    expect(avg["2B"].total).toBeLessThanOrEqual(8);
  });

  it("CF: 1試合あたりPOが1.5-3.5", () => {
    expect(avg["CF"].po).toBeGreaterThanOrEqual(1.5);
    expect(avg["CF"].po).toBeLessThanOrEqual(3.5);
  });

  it("C: 1試合あたりPOが5-12", () => {
    expect(avg["C"].po).toBeGreaterThanOrEqual(5);
    expect(avg["C"].po).toBeLessThanOrEqual(12);
  });

  it("全ポジションPO合計 ≒ アウト数(27前後)", () => {
    const totalPO = positions.reduce((sum, pos) => sum + avg[pos].po, 0);
    console.log(`\n全ポジションPO合計: ${totalPO.toFixed(2)}`);
    expect(totalPO).toBeGreaterThanOrEqual(25);
    expect(totalPO).toBeLessThanOrEqual(35);
  });
});


describe("守備統計の整合性", () => {
  const N = 100;
  const teamA = createTestTeam("C");
  const teamB = createTestTeam("D");

  let totalAssists = 0;
  let totalPutOuts = 0;
  let totalErrors = 0;

  for (let i = 0; i < N; i++) {
    const result = simulateGame(teamA, teamB);
    for (const stats of result.playerStats) {
      totalPutOuts += stats.putOuts ?? 0;
      totalAssists += stats.assists ?? 0;
      totalErrors += stats.errors ?? 0;
    }
  }

  it("A合計 <= PO合計", () => {
    expect(totalAssists).toBeLessThanOrEqual(totalPutOuts);
  });

  it("エラーは1試合あたり0-10の範囲", () => {
    const avgErrors = totalErrors / N;
    expect(avgErrors).toBeGreaterThanOrEqual(0);
    expect(avgErrors).toBeLessThanOrEqual(10);
  });
});

describe("新物理エンジン export確認", () => {
  it("generateBattedBall がexportされている", () => {
    expect(typeof generateBattedBall).toBe("function");
  });

  it("classifyBattedBallType がexportされている", () => {
    expect(typeof classifyBattedBallType).toBe("function");
  });

  it("generateBattedBall の戻り値が有効", () => {
    const pitcher: Player = createTestPlayer("p1", "P", true);
    const batter: Player = createTestPlayer("b1", "CF", false);
    const validTypes = ["ground_ball", "fly_ball", "line_drive", "popup"];
    for (let i = 0; i < 100; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(validTypes).toContain(ball.type);
      expect(ball.direction).toBeGreaterThanOrEqual(0);
      expect(ball.direction).toBeLessThanOrEqual(90);
    }
  });
});
