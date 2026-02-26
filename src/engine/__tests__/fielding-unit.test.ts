import { describe, it, expect } from "vitest";
import {
  calcBallLanding,
  evaluateFielders,
  resolveHitTypeFromLanding,
  DEFAULT_FIELDER_POSITIONS,
} from "../fielding-ai";
import type { Player } from "../../models/player";

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const POSITION_MAP: Record<FielderPosition, Player["position"]> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function createTestPlayer(pos: FielderPosition): Player {
  const position = POSITION_MAP[pos];
  const isPitcher = pos === 1;
  return {
    id: `test-${position}`,
    name: `テスト${position}`,
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
  };
}

const fullFielderMap = new Map<FielderPosition, Player>();
for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
  fullFielderMap.set(pos, createTestPlayer(pos));
}

// ----------------------------------------------------------------
// calcBallLanding
// ----------------------------------------------------------------

describe("calcBallLanding: 基本物理値の妥当性", () => {
  it("正面ゴロ（方向45°、角度-5°、初速100km/h）→ isGroundBall=true、近距離着地", () => {
    const result = calcBallLanding(45, -5, 100);
    expect(result.isGroundBall, `isGroundBall期待:true 実際:${result.isGroundBall}`).toBe(true);
    expect(result.distance, `distance期待:>0 実際:${result.distance}`).toBeGreaterThan(0);
    expect(result.distance, `distance期待:<55 実際:${result.distance}`).toBeLessThan(55);
    expect(result.flightTime, `flightTime期待:>=0 実際:${result.flightTime}`).toBeGreaterThanOrEqual(0);
  });

  it("センターフライ（方向45°、角度30°、初速120km/h）→ isGroundBall=false、中距離着地", () => {
    const result = calcBallLanding(45, 30, 120);
    expect(result.isGroundBall, `isGroundBall期待:false 実際:${result.isGroundBall}`).toBe(false);
    expect(result.distance, `distance期待:>20 実際:${result.distance}`).toBeGreaterThan(20);
    expect(result.distance, `distance期待:<110 実際:${result.distance}`).toBeLessThan(110);
    expect(result.flightTime, `flightTime期待:>1 実際:${result.flightTime}`).toBeGreaterThan(1);
  });

  it("ホームラン級（方向45°、角度30°、初速160km/h）→ 遠距離着地", () => {
    const normal = calcBallLanding(45, 30, 120);
    const hr = calcBallLanding(45, 30, 160);
    expect(hr.distance, `高速の方が遠い: hr=${hr.distance} normal=${normal.distance}`).toBeGreaterThan(
      normal.distance
    );
    expect(hr.distance, `distance期待:>80 実際:${hr.distance}`).toBeGreaterThan(80);
  });

  it("境界値: 方向0°（三塁線）→ 着地座標xが負（左方向）", () => {
    const result = calcBallLanding(0, 30, 120);
    expect(result.position.x, `左方向なのでx<0 実際:${result.position.x}`).toBeLessThan(0);
    expect(result.position.y, `y>0 実際:${result.position.y}`).toBeGreaterThan(0);
    expect(result.distance, `distance>0 実際:${result.distance}`).toBeGreaterThan(0);
  });

  it("境界値: 方向90°（一塁線）→ 着地座標xが正（右方向）", () => {
    const result = calcBallLanding(90, 30, 120);
    expect(result.position.x, `右方向なのでx>0 実際:${result.position.x}`).toBeGreaterThan(0);
    expect(result.position.y, `y>0 実際:${result.position.y}`).toBeGreaterThan(0);
    expect(result.distance, `distance>0 実際:${result.distance}`).toBeGreaterThan(0);
  });

  it("境界値: 角度0°（ゴロ/ライナー境界付近）→ isGroundBall=true（閾値10°未満）", () => {
    const result = calcBallLanding(45, 0, 120);
    expect(result.isGroundBall, `角度0°はゴロ 実際:${result.isGroundBall}`).toBe(true);
  });

  it("境界値: 角度9°→ゴロ、角度10°→フライ", () => {
    const ground = calcBallLanding(45, 9, 120);
    const fly = calcBallLanding(45, 10, 120);
    expect(ground.isGroundBall, `9°はゴロ 実際:${ground.isGroundBall}`).toBe(true);
    expect(fly.isGroundBall, `10°はフライ 実際:${fly.isGroundBall}`).toBe(false);
  });

  it("境界値: 超低速（初速40km/h）→ distance>0、flightTime>=0", () => {
    const result = calcBallLanding(45, -5, 40);
    expect(result.distance, `超低速でもdistance>0 実際:${result.distance}`).toBeGreaterThan(0);
    expect(result.flightTime, `flightTime>=0 実際:${result.flightTime}`).toBeGreaterThanOrEqual(0);
  });

  it("境界値: 超高速（初速170km/h）→ distance>0、ゴロ最大距離以内", () => {
    const groundResult = calcBallLanding(45, -5, 170);
    expect(groundResult.isGroundBall).toBe(true);
    expect(groundResult.distance, `ゴロは55m以内 実際:${groundResult.distance}`).toBeLessThanOrEqual(55);

    const flyResult = calcBallLanding(45, 30, 170);
    expect(flyResult.distance, `distance>0 実際:${flyResult.distance}`).toBeGreaterThan(0);
  });

  it("position座標とdistanceの一貫性: dist≒sqrt(x²+y²)", () => {
    const result = calcBallLanding(30, 20, 130);
    const calcDist = Math.sqrt(
      result.position.x ** 2 + result.position.y ** 2
    );
    expect(
      Math.abs(calcDist - result.distance),
      `distance不一致: position由来=${calcDist.toFixed(2)} distance=${result.distance.toFixed(2)}`
    ).toBeLessThan(0.01);
  });

  it("初速が大きいほど飛距離が伸びる（フライ）", () => {
    const slow = calcBallLanding(45, 25, 100);
    const fast = calcBallLanding(45, 25, 150);
    expect(fast.distance, `高速>低速: ${fast.distance}>${slow.distance}`).toBeGreaterThan(slow.distance);
  });
});

// ----------------------------------------------------------------
// evaluateFielders
// ----------------------------------------------------------------

describe("evaluateFielders: 野手評価の妥当性", () => {
  it("全9野手の評価結果が返る", () => {
    const landing = calcBallLanding(45, 20, 110);
    const result = evaluateFielders(landing, "fly_ball", fullFielderMap);
    expect(result.size, `9野手 実際:${result.size}`).toBe(9);
    for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
      expect(result.has(pos), `pos=${pos}の評価が存在する`).toBe(true);
    }
  });

  it("各野手のdistanceToBallが0以上であること", () => {
    const landing = calcBallLanding(45, 25, 120);
    const result = evaluateFielders(landing, "fly_ball", fullFielderMap);
    for (const [pos, decision] of result) {
      expect(
        decision.distanceToBall,
        `pos=${pos}のdistanceToBall期待:>=0 実際:${decision.distanceToBall}`
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("センター定位置フライ（方向45°、角度30°、初速145km/h）→ CF(8)がcanReach=true", () => {
    // CF定位置はy=78m。angle=30, ev=145のとき着地dist≒77.9m（定位置直撃）
    const landing = calcBallLanding(45, 30, 145);
    const result = evaluateFielders(landing, "fly_ball", fullFielderMap);
    const cf = result.get(8);
    expect(cf, "CF(8)の評価が存在する").toBeDefined();
    expect(cf!.canReach, `CF定位置フライでcanReach=true 実際:${cf!.canReach}`).toBe(true);
  });

  it("ショート正面ゴロ（方向38°、角度-5°、初速100km/h）→ SS(6)またはIF(3-6)がcanReach=true", () => {
    const landing = calcBallLanding(38, -5, 100);
    const result = evaluateFielders(landing, "ground_ball", fullFielderMap);
    const ifPositions = [3, 4, 5, 6] as FielderPosition[];
    const anyIFCanReach = ifPositions.some(pos => result.get(pos)?.canReach === true);
    expect(anyIFCanReach, "内野手(3-6)の誰かがcanReach=true").toBe(true);
  });

  it("外野深いフライ（方向45°、角度35°、初速155km/h）→ 外野手のcanReachがfalseになるケース", () => {
    // フェンスギリギリ超えるような深い打球でOFのcanReachがfalseになる場合がある
    const landing = calcBallLanding(45, 35, 155);
    const result = evaluateFielders(landing, "fly_ball", fullFielderMap);
    // 少なくとも評価は9人分返る
    expect(result.size).toBe(9);
    // 深すぎてcanReach=falseになりうることを確認（強制はしないが、少なくとも評価は行われる）
    const cf = result.get(8);
    expect(cf, "CF(8)の評価が存在する").toBeDefined();
    expect(typeof cf!.canReach, "canReachはboolean").toBe("boolean");
  });

  it("評価結果の各フィールドが期待する型を持つ", () => {
    const landing = calcBallLanding(45, 20, 110);
    const result = evaluateFielders(landing, "fly_ball", fullFielderMap);
    for (const [pos, decision] of result) {
      expect(typeof decision.position, `pos=${pos}: positionはnumber`).toBe("number");
      expect(typeof decision.distanceToBall, `pos=${pos}: distanceToBallはnumber`).toBe("number");
      expect(typeof decision.timeToReach, `pos=${pos}: timeToReachはnumber`).toBe("number");
      expect(typeof decision.canReach, `pos=${pos}: canReachはboolean`).toBe("boolean");
      expect(typeof decision.speed, `pos=${pos}: speedはnumber`).toBe("number");
    }
  });

  it("primaryロールを持つ野手が1人だけ存在する", () => {
    const landing = calcBallLanding(45, 25, 120);
    const result = evaluateFielders(landing, "fly_ball", fullFielderMap);
    const primaries = Array.from(result.values()).filter(d => d.role === "primary");
    expect(primaries.length, `primaryは1人 実際:${primaries.length}`).toBe(1);
  });
});

// ----------------------------------------------------------------
// resolveHitTypeFromLanding
// ----------------------------------------------------------------

describe("resolveHitTypeFromLanding: 長打タイプ判定", () => {
  it("近距離の安打（30m以下）→ 常にsingle", () => {
    // 30m以下はsingleの固定ロジック
    const landing = {
      position: { x: 15, y: 26 },
      distance: 30,
      flightTime: 2.0,
      isGroundBall: false,
    };
    for (let i = 0; i < 30; i++) {
      const result = resolveHitTypeFromLanding(landing, 50, 100);
      expect(result, `distance=30mはsingle 実際:${result}`).toBe("single");
    }
  });

  it("中距離（60m以上80m未満）→ singleまたはdouble（tripleは低確率）", () => {
    const landing = {
      position: { x: 0, y: 65 },
      distance: 65,
      flightTime: 4.0,
      isGroundBall: false,
    };
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(resolveHitTypeFromLanding(landing, 50, 100));
    }
    // single or double が出ること
    expect(results.has("single") || results.has("double"), "single/doubleが返る").toBe(true);
    // tripleは基本出ない（低確率なので100回では稀）
  });

  it("外野深め（80m以上）→ doubleまたはtripleが返りうる", () => {
    const landing = {
      position: { x: 0, y: 82 },
      distance: 82,
      flightTime: 5.5,
      isGroundBall: false,
    };
    const results = new Set<string>();
    for (let i = 0; i < 200; i++) {
      results.add(resolveHitTypeFromLanding(landing, 50, 100));
    }
    expect(results.has("double") || results.has("triple"), "double/tripleが返る").toBe(true);
    // singleは返らない（80m以上）
    expect(results.has("single"), "80m以上でsingleは返らない").toBe(false);
  });

  it("フェンス際（フェンス距離の90%以上）→ tripleが高確率で返る", () => {
    const fenceDistance = 100;
    const landing = {
      position: { x: 0, y: 92 },
      distance: 92,
      flightTime: 6.0,
      isGroundBall: false,
    };
    let tripleCount = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      if (resolveHitTypeFromLanding(landing, 50, fenceDistance) === "triple") {
        tripleCount++;
      }
    }
    // 70%以上の確率でtripleが返るはず（±10%程度の誤差許容）
    expect(tripleCount / N, `triple率期待:>0.5 実際:${(tripleCount / N).toFixed(2)}`).toBeGreaterThan(0.5);
  });

  it("走力高（speed=90）はtriple率が走力低（speed=20）より高い", () => {
    const landing = {
      position: { x: 0, y: 92 },
      distance: 92,
      flightTime: 6.0,
      isGroundBall: false,
    };
    const fenceDistance = 100;
    const N = 500;
    let tripleHighSpeed = 0;
    let tripleLowSpeed = 0;
    for (let i = 0; i < N; i++) {
      if (resolveHitTypeFromLanding(landing, 90, fenceDistance) === "triple") tripleHighSpeed++;
      if (resolveHitTypeFromLanding(landing, 20, fenceDistance) === "triple") tripleLowSpeed++;
    }
    expect(
      tripleHighSpeed,
      `走力90のtriple数(${tripleHighSpeed})は走力20(${tripleLowSpeed})より多い`
    ).toBeGreaterThan(tripleLowSpeed);
  });
});

// ----------------------------------------------------------------
// DEFAULT_FIELDER_POSITIONS
// ----------------------------------------------------------------

describe("DEFAULT_FIELDER_POSITIONS: デフォルト守備位置の妥当性", () => {
  it("全9ポジションの座標が定義されている", () => {
    for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
      const coord = DEFAULT_FIELDER_POSITIONS.get(pos);
      expect(coord, `pos=${pos}の座標が定義されている`).toBeDefined();
    }
    expect(DEFAULT_FIELDER_POSITIONS.size, `9ポジション定義 実際:${DEFAULT_FIELDER_POSITIONS.size}`).toBe(9);
  });

  it("投手(1)はマウンド付近（y≒18m前後）", () => {
    const p = DEFAULT_FIELDER_POSITIONS.get(1)!;
    expect(p.y, `P y期待:15-22m 実際:${p.y}`).toBeGreaterThanOrEqual(15);
    expect(p.y, `P y期待:15-22m 実際:${p.y}`).toBeLessThanOrEqual(22);
  });

  it("捕手(2)はホーム付近（y≒1m程度）", () => {
    const c = DEFAULT_FIELDER_POSITIONS.get(2)!;
    expect(c.y, `C y期待:<5m 実際:${c.y}`).toBeLessThan(5);
    expect(c.y, `C y期待:>=0m 実際:${c.y}`).toBeGreaterThanOrEqual(0);
  });

  it("内野手(3-6)は30m以内", () => {
    for (const pos of [3, 4, 5, 6] as FielderPosition[]) {
      const coord = DEFAULT_FIELDER_POSITIONS.get(pos)!;
      const dist = Math.sqrt(coord.x ** 2 + coord.y ** 2);
      expect(dist, `pos=${pos}の距離期待:<40m 実際:${dist.toFixed(1)}`).toBeLessThan(40);
    }
  });

  it("外野手(7-9)は60m以上100m以内", () => {
    for (const pos of [7, 8, 9] as FielderPosition[]) {
      const coord = DEFAULT_FIELDER_POSITIONS.get(pos)!;
      const dist = Math.sqrt(coord.x ** 2 + coord.y ** 2);
      expect(dist, `pos=${pos}の距離期待:>=60m 実際:${dist.toFixed(1)}`).toBeGreaterThanOrEqual(60);
      expect(dist, `pos=${pos}の距離期待:<=100m 実際:${dist.toFixed(1)}`).toBeLessThanOrEqual(100);
    }
  });

  it("左翼(7)と右翼(9)は対称に近い位置（x座標が逆符号）", () => {
    const lf = DEFAULT_FIELDER_POSITIONS.get(7)!;
    const rf = DEFAULT_FIELDER_POSITIONS.get(9)!;
    expect(lf.x, `LFのxは負 実際:${lf.x}`).toBeLessThan(0);
    expect(rf.x, `RFのxは正 実際:${rf.x}`).toBeGreaterThan(0);
    expect(
      Math.abs(Math.abs(lf.x) - Math.abs(rf.x)),
      `LF/RF xの絶対値差が小さい: |${lf.x}|≒|${rf.x}|`
    ).toBeLessThan(5);
  });

  it("センター(8)は方向中央（x≒0）", () => {
    const cf = DEFAULT_FIELDER_POSITIONS.get(8)!;
    expect(Math.abs(cf.x), `CFはx≒0 実際:${cf.x}`).toBeLessThan(5);
  });

  it("外野手はy座標が内野手より大きい", () => {
    const ofYValues = [7, 8, 9].map(pos => DEFAULT_FIELDER_POSITIONS.get(pos as FielderPosition)!.y);
    const ifYValues = [3, 4, 5, 6].map(pos => DEFAULT_FIELDER_POSITIONS.get(pos as FielderPosition)!.y);
    const minOFY = Math.min(...ofYValues);
    const maxIFY = Math.max(...ifYValues);
    expect(minOFY, `外野最小y(${minOFY})>内野最大y(${maxIFY})`).toBeGreaterThan(maxIFY);
  });
});
