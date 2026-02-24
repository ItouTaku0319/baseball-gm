import { describe, it, expect } from "vitest";
import { generateBattedBall, classifyBattedBallType, gaussianRandom } from "@/engine/simulation";
import type { Player } from "@/models/player";

function createTestBatter(overrides: Partial<Player> = {}): Player {
  return {
    id: "batter1",
    name: "テスト打者",
    age: 25,
    position: "CF",
    isPitcher: false,
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
    pitching: null,
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
    ...overrides,
  };
}

function createTestPitcher(overrides: Partial<Player> = {}): Player {
  return {
    id: "pitcher1",
    name: "テスト投手",
    age: 25,
    position: "P",
    isPitcher: true,
    throwHand: "R",
    batSide: "R",
    batting: {
      contact: 30,
      power: 20,
      speed: 30,
      arm: 50,
      fielding: 50,
      catching: 50,
      eye: 30,
    },
    pitching: {
      velocity: 145,
      control: 50,
      pitches: [{ type: "slider", level: 4 }],
      stamina: 60,
      mentalToughness: 50,
      arm: 50,
      fielding: 50,
      catching: 50,
    },
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
    ...overrides,
  };
}

describe("gaussianRandom", () => {
  it("平均値付近に集まる", () => {
    const N = 10000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += gaussianRandom(50, 10);
    }
    const avg = sum / N;
    expect(avg).toBeGreaterThan(48);
    expect(avg).toBeLessThan(52);
  });
});

describe("generateBattedBall 物理値の範囲", () => {
  const batter = createTestBatter();
  const pitcher = createTestPitcher();
  const N = 1000;

  it("direction: 0-90の範囲内", () => {
    for (let i = 0; i < N; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(ball.direction).toBeGreaterThanOrEqual(0);
      expect(ball.direction).toBeLessThanOrEqual(90);
    }
  });

  it("launchAngle: -15~70の範囲内", () => {
    for (let i = 0; i < N; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(ball.launchAngle).toBeGreaterThanOrEqual(-15);
      expect(ball.launchAngle).toBeLessThanOrEqual(70);
    }
  });

  it("exitVelocity: 80-185の範囲内", () => {
    for (let i = 0; i < N; i++) {
      const ball = generateBattedBall(batter, pitcher);
      expect(ball.exitVelocity).toBeGreaterThanOrEqual(80);
      expect(ball.exitVelocity).toBeLessThanOrEqual(185);
    }
  });

  it("右打者: 方向平均が45未満（プル傾向）", () => {
    const rBatter = createTestBatter({ batSide: "R" });
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += generateBattedBall(rBatter, pitcher).direction;
    }
    expect(sum / N).toBeLessThan(45);
  });

  it("左打者: 方向平均が45超（プル傾向）", () => {
    const lBatter = createTestBatter({ batSide: "L" });
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += generateBattedBall(lBatter, pitcher).direction;
    }
    expect(sum / N).toBeGreaterThan(45);
  });

  it("パワー高: exitVelocity平均がパワー低より高い", () => {
    const highPower = createTestBatter({ batting: { ...createTestBatter().batting, power: 90 } });
    const lowPower = createTestBatter({ batting: { ...createTestBatter().batting, power: 20 } });
    let sumHigh = 0, sumLow = 0;
    for (let i = 0; i < N; i++) {
      sumHigh += generateBattedBall(highPower, pitcher).exitVelocity;
      sumLow += generateBattedBall(lowPower, pitcher).exitVelocity;
    }
    expect(sumHigh / N).toBeGreaterThan(sumLow / N);
  });

  it("シンカー投手: launchAngle平均が低い", () => {
    const sinkerPitcher = createTestPitcher({
      pitching: {
        velocity: 145, control: 50,
        pitches: [{ type: "sinker", level: 6 }],
        stamina: 60, mentalToughness: 50, arm: 50, fielding: 50, catching: 50,
      },
    });
    const normalPitcher = createTestPitcher();
    let sumSinker = 0, sumNormal = 0;
    for (let i = 0; i < N; i++) {
      sumSinker += generateBattedBall(batter, sinkerPitcher).launchAngle;
      sumNormal += generateBattedBall(batter, normalPitcher).launchAngle;
    }
    expect(sumSinker / N).toBeLessThan(sumNormal / N);
  });
});

describe("classifyBattedBallType", () => {
  it("-10° → ground_ball", () => {
    expect(classifyBattedBallType(-10, 130)).toBe("ground_ball");
  });

  it("15° + 130km/h → line_drive", () => {
    expect(classifyBattedBallType(15, 130)).toBe("line_drive");
  });

  it("30° → fly_ball", () => {
    expect(classifyBattedBallType(30, 130)).toBe("fly_ball");
  });

  it("55° → popup", () => {
    expect(classifyBattedBallType(55, 130)).toBe("popup");
  });

  it("15° + 90km/h → line_drive (15°は低速でもライナー)", () => {
    // 低速ゴロ判定は launchAngle < 15 の場合のみ
    expect(classifyBattedBallType(15, 90)).toBe("line_drive");
  });
});

describe("classifyBattedBallType フライ判定", () => {
  it("高角度(22-38°) + フライ → fly_ball", () => {
    expect(classifyBattedBallType(28, 160)).toBe("fly_ball");
    expect(classifyBattedBallType(35, 155)).toBe("fly_ball");
  });
});
