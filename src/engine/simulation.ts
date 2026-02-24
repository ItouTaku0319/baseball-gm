import type { Team } from "@/models/team";
import type { GameResult, InningScore, PlayerGameStats, PitcherGameLog, AtBatLog } from "@/models/league";
import type { Player, PitchRepertoire, PitchType } from "@/models/player";
import { calcBallLanding, evaluateFielders, resolveHitTypeFromLanding } from "./fielding-ai";
import type { BallLanding, FielderDecision } from "./fielding-ai";

/** 球種リストから旧来の breaking 相当の 0-100 スケール値を算出 */
export function calcBreakingPower(pitches: PitchRepertoire[] | undefined): number {
  if (!pitches || pitches.length === 0) return 30; // 旧データ互換用デフォルト
  const total = pitches.reduce((sum, p) => sum + p.level * p.level, 0);
  // 理論最大: 5球種 × 49(=7²) = 245
  return Math.min(100, (total / 245) * 130);
}

/** 打球タイプ */
type BattedBallType = "ground_ball" | "line_drive" | "fly_ball" | "popup";

/** ポジション番号 (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF) */
type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 打席結果の種類 */
type AtBatResult =
  | "single" | "double" | "triple" | "homerun"
  | "walk" | "hitByPitch"
  | "strikeout"
  | "groundout" | "flyout" | "lineout" | "popout"
  | "doublePlay" | "sacrificeFly"
  | "fieldersChoice" | "infieldHit" | "error";

/** 1打席の詳細結果 */
interface AtBatDetail {
  result: AtBatResult;
  battedBallType: BattedBallType | null; // 三振・四球・死球はnull
  fielderPosition: FielderPosition | null;
  direction: number | null;
  launchAngle: number | null;
  exitVelocity: number | null;
}

/** 走者の状態 */
interface BaseRunners {
  first: Player | null;
  second: Player | null;
  third: Player | null;
}

/** 守備能力を取得するヘルパー (投手は pitching から、野手は batting から) */
function getFieldingAbility(
  player: Player,
  pos: FielderPosition
): { fielding: number; catching: number; arm: number } {
  if (pos === 1) {
    // 投手は pitching の守備能力を使う
    return {
      fielding: player.pitching?.fielding ?? 50,
      catching: player.pitching?.catching ?? 50,
      arm: player.pitching?.arm ?? 50,
    };
  }
  return {
    fielding: player.batting.fielding,
    catching: player.batting.catching,
    arm: player.batting.arm,
  };
}

/** 守備側チームのフィールダーマップを構築 */
function buildFielderMap(
  fieldingTeam: Player[],
  pitcher: Player,
  fullRoster?: Player[]
): Map<FielderPosition, Player> {
  const map = new Map<FielderPosition, Player>();
  map.set(1, pitcher);

  const posMap: Record<string, FielderPosition> = {
    C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9,
  };

  // まず打順(fieldingTeam)から登録
  for (const player of fieldingTeam) {
    const pos = posMap[player.position];
    if (pos !== undefined && !map.has(pos)) {
      map.set(pos, player);
    }
  }

  // フルロスターから未登録ポジションを補完
  if (fullRoster) {
    for (const player of fullRoster) {
      const pos = posMap[player.position];
      if (pos !== undefined && !map.has(pos)) {
        map.set(pos, player);
      }
    }
  }

  return map;
}

/** ダミー野手 (該当ポジションが存在しない場合のフォールバック) */
function createDummyFielder(): Player {
  return {
    id: "dummy",
    name: "ダミー",
    age: 25,
    position: "LF",
    isPitcher: false,
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
    pitching: null,
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
  };
}

/** 打球の物理データ */
interface BattedBall {
  /** 方向角 (度): 0=レフト線, 45=センター, 90=ライト線 */
  direction: number;
  /** 打球角度 (度): 負=ゴロ, 0-10=低い打球, 10-25=ライナー, 25-50=フライ, 50+=ポップフライ */
  launchAngle: number;
  /** 打球速度 (km/h): 80-185 */
  exitVelocity: number;
  /** 後方互換用の打球タイプ分類 */
  type: BattedBallType;
}

/** ガウス乱数 (Box-Muller法) */
export function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 投手の球種レパートリーから打席結果に応じた球種を選ぶ */
function selectPitch(pitcher: Player, result: AtBatResult): PitchType {
  const pit = pitcher.pitching!;
  const vel = pit.velocity <= 100 ? 120 + (pit.velocity / 100) * 45 : pit.velocity;
  const fastballWeight = 3 + (vel - 130) / 10;

  const candidates: { type: PitchType; weight: number }[] = [
    { type: "fastball", weight: Math.max(1, fastballWeight) },
  ];
  for (const p of pit.pitches) {
    candidates.push({ type: p.type, weight: p.level * 0.8 });
  }

  for (const c of candidates) {
    if (result === "strikeout") {
      if (c.type === "fork" || c.type === "splitter" || c.type === "slider") c.weight *= 2.0;
      else if (c.type !== "fastball") c.weight *= 1.5;
    } else if (result === "walk" || result === "hitByPitch") {
      if (c.type === "fastball") c.weight *= 2.0;
    } else if (result === "homerun") {
      if (c.type === "fastball" || c.type === "changeup") c.weight *= 1.8;
    }
  }

  const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * totalWeight;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c.type;
  }
  return candidates[candidates.length - 1].type;
}

/** 制球と打席結果に応じたコース(x,y)を生成。-1〜1がゾーン内 */
function generatePitchLocation(
  pitcher: Player,
  result: AtBatResult,
  pitchType: PitchType
): { x: number; y: number } {
  const control = pitcher.pitching?.control ?? 50;
  const spread = 1.5 - (control / 100) * 0.8;

  let meanX = 0;
  let meanY = 0;

  switch (result) {
    case "strikeout":
      meanX = (Math.random() > 0.5 ? 1 : -1) * 0.6;
      meanY = -0.6;
      if (pitchType === "fork" || pitchType === "splitter" || pitchType === "sinker") {
        meanY = -1.0;
      }
      break;
    case "walk":
    case "hitByPitch":
      meanX = (Math.random() > 0.5 ? 1 : -1) * 1.3;
      meanY = gaussianRandom(0, 0.5);
      break;
    case "homerun":
      meanX = gaussianRandom(0, 0.3);
      meanY = 0.4;
      break;
    case "groundout":
    case "doublePlay":
    case "fieldersChoice":
      meanY = -0.4;
      meanX = gaussianRandom(0, 0.5);
      break;
    case "flyout":
    case "popout":
    case "sacrificeFly":
      meanY = 0.3;
      meanX = gaussianRandom(0, 0.5);
      break;
    default:
      meanX = gaussianRandom(0, 0.4);
      meanY = gaussianRandom(0, 0.3);
      break;
  }

  const x = clamp(gaussianRandom(meanX, spread * 0.4), -2, 2);
  const y = clamp(gaussianRandom(meanY, spread * 0.4), -2, 2);
  return { x, y };
}

/** 打球角度と速度から打球タイプを分類する */
export function classifyBattedBallType(launchAngle: number, exitVelocity: number): BattedBallType {
  if (launchAngle >= 50) return "popup";
  if (launchAngle < 10) return "ground_ball";
  // 10-19°: ライナー帯（低速・低角度の弱い打球はゴロ扱い）
  if (launchAngle < 20) {
    if (launchAngle < 15 && exitVelocity < 100) return "ground_ball";
    return "line_drive";
  }
  // 22°以上: フライ
  return "fly_ball";
}

/** 推定打球飛距離(メートル)を放物運動+空気抵抗補正で計算 */
export function estimateDistance(exitVelocityKmh: number, launchAngleDeg: number): number {
  if (launchAngleDeg <= 0) return 0;

  const v = exitVelocityKmh / 3.6; // km/h → m/s
  const theta = launchAngleDeg * Math.PI / 180;
  const g = 9.8;
  const h = 1.2; // 打点高さ(m)

  const vSinT = v * Math.sin(theta);
  const vCosT = v * Math.cos(theta);
  const baseDistance = vCosT * (vSinT + Math.sqrt(vSinT * vSinT + 2 * g * h)) / g;

  const dragFactor = 0.60; // 空気抵抗補正(約40%減)
  return baseDistance * dragFactor;
}

/** フェンス距離(メートル): NPB標準 両翼100m, 中堅122m */
export function getFenceDistance(directionDeg: number): number {
  return 100 + 22 * Math.sin(directionDeg * Math.PI / 90);
}

/** 打球の物理データを生成する */
export function generateBattedBall(batter: Player, pitcher: Player): BattedBall {
  const power = batter.batting.power;
  const contact = batter.batting.contact;
  const breakingPower = calcBreakingPower(pitcher.pitching?.pitches);

  // --- 1. 打球方向 (0-90°) ---
  let dirMean = 45;
  if (batter.batSide === "R") dirMean = 38;
  if (batter.batSide === "L") dirMean = 52;
  const pullShift = (power - 50) * 0.08;
  if (batter.batSide === "R") dirMean -= pullShift;
  else if (batter.batSide === "L") dirMean += pullShift;

  const direction = clamp(gaussianRandom(dirMean, 18), 0, 90);

  // --- 2. 打球角度 (-15° ~ 70°) ---
  let angleMean = 12 + (power - 50) * 0.08 - (contact - 50) * 0.04;
  // 弾道(trajectory)による角度補正: 弾道1=-3°, 2=±0°, 3=+3°, 4=+6°
  const trajectory = batter.batting.trajectory ?? 2;
  angleMean += (trajectory - 2) * 3;
  let sinkerBonus = 0;
  if (pitcher.pitching?.pitches) {
    for (const pitch of pitcher.pitching.pitches) {
      if (pitch.type === "sinker" || pitch.type === "shoot") {
        sinkerBonus += pitch.level * (pitch.type === "sinker" ? 0.6 : 0.4);
      }
    }
    sinkerBonus = Math.min(5, sinkerBonus);
  }
  angleMean -= sinkerBonus;

  const launchAngle = clamp(gaussianRandom(angleMean, 16), -15, 70);

  // --- 3. 打球速度 (80-185 km/h) ---
  const velMean = 120 + (power - 50) * 0.5 + (contact - 50) * 0.15;
  const breakingPenalty = (breakingPower - 50) * 0.15;
  const exitVelocity = clamp(gaussianRandom(velMean - breakingPenalty, 18), 80, 170);

  // --- 4. 打球タイプ分類 (後方互換) ---
  const type = classifyBattedBallType(launchAngle, exitVelocity);

  return { direction, launchAngle, exitVelocity, type };
}

/** 内野手をゾーンベースで決定 */
function assignInfielder(direction: number, exitVelocity: number): FielderPosition {
  // ピッチャー返し: 中央付近の低速ゴロ
  if (direction > 25 && direction < 65 && exitVelocity < 120) {
    if (Math.random() < 0.20) return 1;
  }

  const noise = gaussianRandom(0, 5);
  const adj = direction + noise;

  if (adj < 18) return 5;       // 3B
  if (adj < 40) return 6;       // SS
  if (adj < 58) return 4;       // 2B
  return 3;                     // 1B
}

/** 外野手をゾーンベースで決定 */
function assignOutfielder(direction: number): FielderPosition {
  const noise = gaussianRandom(0, 7);
  const adj = direction + noise;

  if (adj < 33) return 7;    // LF
  if (adj < 52) return 8;    // CF
  return 9;                  // RF
}

/** ポップフライの処理野手を決定 */
function assignPopupFielder(direction: number): FielderPosition {
  if (Math.random() < 0.15) return 2;  // C
  if (direction > 35 && direction < 55 && Math.random() < 0.05) return 1; // P

  const noise = gaussianRandom(0, 5);
  const adj = direction + noise;
  if (adj < 22) return 5;    // 3B
  if (adj < 44) return 6;    // SS
  if (adj < 66) return 4;    // 2B
  return 3;                  // 1B
}


/** fieldingResultから最も到達が早い野手を探す */
function findBestFielder(
  fieldingResult: Map<FielderPosition, FielderDecision>
): FielderDecision | null {
  let best: FielderDecision | null = null;
  for (const decision of fieldingResult.values()) {
    if (decision.role === "primary") return decision;
  }
  for (const decision of fieldingResult.values()) {
    if (!best || decision.timeToReach < best.timeToReach) {
      best = decision;
    }
  }
  return best;
}

// 塁の座標 (メートル) — ダイヤモンド: 1辺27.4m
const BASE_POSITIONS = {
  home:  { x: 0, y: 0 },
  first: { x: 19.4, y: 19.4 },
  second: { x: 0, y: 38.8 },
  third: { x: -19.4, y: 19.4 },
} as const;
const BASE_LENGTH = 27.4; // 塁間距離(m)

// ポジション別の1Bへの送球距離 (デフォルト守備位置から)
const THROW_DIST_TO_FIRST: Record<number, number> = {
  1: 19.4, // P (0,18.4) → 1B
  2: 26.7, // C (0,1) → 1B
  3: 9.0,  // 1B (20,28) → 1B (自分の近く)
  4: 19.3, // 2B (10,36) → 1B
  5: 40.3, // 3B (-20,28) → 1B
  6: 33.8, // SS (-10,36) → 1B
  7: 55.0, // LF → 1B
  8: 65.0, // CF → 1B
  9: 55.0, // RF → 1B
};

function getThrowDistToFirst(pos: FielderPosition): number {
  return THROW_DIST_TO_FIRST[pos] ?? 30;
}

/**
 * 守備AIによるインプレー結果判定
 *
 * 打球タイプごとに異なるメカニクス:
 *
 * ゴロ:
 *   1. 野手がボール経路に到達 → 捕球(高確率)
 *   2. 捕球後、1Bへ送球 → 走者との競争で安打/アウト判定
 *   3. 到達できない → 外野手が回収 → ヒット(距離ベースで長打判定)
 *
 * フライ/ライナー:
 *   1. 野手が着地点に到達 → 捕球試行(余裕度+打球速度で成功率)
 *   2. 到達できない → ヒット → 回収+送球 vs 走者の進塁で長打判定
 */
function resolvePlayWithAI(
  ball: BattedBall,
  landing: BallLanding,
  fieldingResult: Map<FielderPosition, FielderDecision>,
  _fielderMap: Map<FielderPosition, Player>,
  batter: Player,
  bases: BaseRunners,
  outs: number
): { result: AtBatResult; fielderPos: FielderPosition } {
  // === ポップフライ → 常にアウト ===
  if (ball.type === "popup") {
    const best = findBestFielder(fieldingResult);
    return { result: "popout", fielderPos: best?.position ?? assignPopupFielder(ball.direction) };
  }

  // === フライ → HR判定（フェンス越え）===
  if (ball.type === "fly_ball") {
    const distance = estimateDistance(ball.exitVelocity, ball.launchAngle);
    const fenceDist = getFenceDistance(ball.direction);
    const ratio = distance / fenceDist;

    if (ratio >= 1.05) {
      const best = findBestFielder(fieldingResult);
      return { result: "homerun", fielderPos: best?.position ?? assignOutfielder(ball.direction) };
    } else if (ratio >= 0.95) {
      const powerBonus = (batter.batting.power - 50) * 0.002;
      const hrChance = (ratio - 0.95) / 0.10 + powerBonus;
      if (Math.random() < clamp(hrChance, 0.01, 0.90)) {
        const best = findBestFielder(fieldingResult);
        return { result: "homerun", fielderPos: best?.position ?? assignOutfielder(ball.direction) };
      }
    }
  }

  // === 最適野手を取得 ===
  const best = findBestFielder(fieldingResult);
  if (!best) {
    return { result: "single", fielderPos: 8 };
  }

  const fielderPos = best.position;
  const skill = best.skill;
  const fieldingRate = (skill.fielding * 0.6 + skill.catching * 0.4) / 100;

  // 野手がボール地点に到達する時間
  const fielderArrivalTime = best.timeToReach;
  // ボールが野手の位置に到達する時間（ゴロ=経路通過時間、フライ=滞空時間）
  const ballArrivalTime = best.ballArrivalTime;

  // =====================================
  // ゴロ専用処理
  // =====================================
  if (ball.type === "ground_ball") {
    return resolveGroundBall(
      ball, landing, best, fieldingResult, batter, bases, outs, fieldingRate
    );
  }

  // =====================================
  // フライ / ライナー処理
  // =====================================
  return resolveFlyOrLineDrive(
    ball, landing, best, fieldingResult, batter, bases, outs, fieldingRate
  );
}

/**
 * ゴロの結果判定
 *
 * 1. 野手がボール経路に到達できるか (timing)
 * 2. 到達 → 捕球 → 送球 → 走者との競争
 * 3. 不到達 → 外野へ抜ける → 回収 → 長打判定
 */
function resolveGroundBall(
  ball: BattedBall,
  landing: BallLanding,
  best: FielderDecision,
  fieldingResult: Map<FielderPosition, FielderDecision>,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  fieldingRate: number
): { result: AtBatResult; fielderPos: FielderPosition } {
  const fielderPos = best.position;
  const skill = best.skill;

  // 走者パラメータ
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;

  if (best.timeToReach <= best.ballArrivalTime) {
    // === 野手がボール到達前に到着 → 捕球試行 ===

    // ゴロ捕球成功率: 非常に高い (97-99.5%)
    const margin = best.ballArrivalTime - best.timeToReach;
    const marginBonus = Math.min(0.015, margin * 0.01);
    const fieldRate = clamp(0.97 + fieldingRate * 0.02 + marginBonus, 0.97, 0.995);

    if (Math.random() >= fieldRate) {
      // === 捕球失策 → エラー ===
      return { result: "error", fielderPos };
    }

    // === 捕球成功 → 1Bへ送球、走者との競争 ===
    // ボール確保時間 (腰を落として捕球→グラブ内で確保)
    const secureTime = 0.3 + (1 - skill.fielding / 100) * 0.3; // 0.3-0.6秒
    // 持ち替え+送球モーション時間
    const transferTime = 0.6 + (1 - skill.arm / 100) * 0.4; // 0.6-1.0秒

    // 送球速度 (m/s)
    const throwSpeed = 25 + (skill.arm / 100) * 15;

    // 野手がボールを捕った時点
    const fieldTime = Math.max(best.timeToReach, best.ballArrivalTime);

    // 野手位置から1Bへの送球距離 (デフォルト守備位置ベース)
    const throwDist = getThrowDistToFirst(fielderPos);

    // 守備完了時間 = 野手捕球時 + 確保 + 持ち替え + 送球飛行時間
    const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;

    // 走者の1B到達時間 = バット→走り出し(0.3s) + 塁間
    const runnerTo1B = 0.3 + timePerBase;

    if (runnerTo1B < defenseTime) {
      // === 走者がセーフ → 内野安打 ===
      return { result: "infieldHit", fielderPos };
    }

    // === 送球が間に合う → アウト ===
    // 併殺判定
    if (bases.first && outs < 2) {
      const dpRate = 0.12 + (1 - batter.batting.speed / 100) * 0.06;
      if (Math.random() < dpRate) {
        return { result: "doublePlay", fielderPos };
      }
    }
    // フィルダースチョイス判定
    if (bases.first || bases.second || bases.third) {
      if (Math.random() < 0.05) {
        return { result: "fieldersChoice", fielderPos };
      }
    }
    return { result: "groundout", fielderPos };
  }

  // === 野手が間に合わない → ボールが外野へ抜ける ===
  // 外野手(backup)がボールを回収
  let retriever = best;
  for (const decision of fieldingResult.values()) {
    if (decision.position >= 7 && decision.timeToReach < retriever.timeToReach * 2.5) {
      retriever = decision;
      break;
    }
  }

  // 回収 → 送球 → 走者の進塁判定
  return resolveHitAdvancement(ball, landing, retriever, batter);
}

/**
 * フライ・ライナーの結果判定
 *
 * 1. 野手が着地点に到達できるか (timing)
 * 2. 到達 → 捕球試行 (余裕度 + 打球速度で成功率決定)
 * 3. 不到達 → ヒット → 回収+送球で長打判定
 */
function resolveFlyOrLineDrive(
  ball: BattedBall,
  landing: BallLanding,
  best: FielderDecision,
  fieldingResult: Map<FielderPosition, FielderDecision>,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  fieldingRate: number
): { result: AtBatResult; fielderPos: FielderPosition } {
  const fielderPos = best.position;

  if (best.timeToReach <= best.ballArrivalTime) {
    // === 野手が着地前に到着 → 捕球試行 ===

    const margin = best.ballArrivalTime - best.timeToReach;

    // 到達した野手の捕球成功率: 余裕があれば高い、ギリギリなら低い
    // margin >= 1.0s → ほぼ確実 (97-99%)
    // margin ~= 0s  → 難しい (85-95%)
    const marginFactor = clamp(margin / 1.0, 0, 1); // 0-1に正規化
    const baseCatchRate = 0.85 + marginFactor * 0.12; // 0.85-0.97
    const skillBonus = fieldingRate * 0.03; // 0-0.03
    const catchRate = clamp(baseCatchRate + skillBonus, 0.85, 0.99);

    if (Math.random() < catchRate) {
      // === 捕球成功 → アウト ===
      if (ball.type === "fly_ball") {
        // 犠飛判定
        if (bases.third && outs < 2 && Math.random() < 0.15) {
          return { result: "sacrificeFly", fielderPos };
        }
        return { result: "flyout", fielderPos };
      }
      return { result: "lineout", fielderPos };
    } else {
      // === 捕球失敗 → エラー ===
      return { result: "error", fielderPos };
    }
  }

  // === 野手が間に合わない → ヒット確定 ===
  return resolveHitAdvancement(ball, landing, best, batter);
}

/**
 * ヒット確定後の進塁判定 (物理ベース)
 * ボール回収位置から各塁への送球時間 vs 走者の到達時間
 */
function resolveHitAdvancement(
  ball: BattedBall,
  landing: BallLanding,
  retriever: FielderDecision,
  batter: Player,
): { result: AtBatResult; fielderPos: FielderPosition } {
  const retrieverSkill = retriever.skill;
  const fenceDist = getFenceDistance(ball.direction);

  // === ボール回収時間の計算 ===
  // 捕球できなかったボールは着地後にバウンド・ロールして不規則に動く
  // 深い打球ほどバウンドが大きく、追跡に時間がかかる
  const pickupTime = 0.3 + (1 - retrieverSkill.catching / 100) * 0.4;

  let bouncePenalty: number;
  let rollDistance: number;

  if (landing.isGroundBall) {
    // ゴロが外野に抜けた場合: 比較的予測しやすいがまだ転がっている
    bouncePenalty = 0.5 + Math.random() * 0.5; // 0.5-1.0s
    rollDistance = 3;
  } else {
    // フライ/ライナー: 着地後のバウンドは不規則、深いほど大きい
    const depthFactor = clamp((landing.distance - 50) / 50, 0, 1); // 0 (浅い) → 1 (深い)
    bouncePenalty = 1.4 + depthFactor * 2.2 + Math.random() * 0.8; // 1.4-4.4s

    // フェンス際: 壁リバウンドでさらに不規則
    if (landing.distance >= fenceDist * 0.90) {
      bouncePenalty += 0.6 + Math.random() * 0.6; // +0.6-1.2s
    }

    rollDistance = clamp((landing.distance - 50) * 0.15, 0, 12);
  }

  // ボールの停止位置（ロール方向に延伸、送球距離計算用）
  const angleRad = (ball.direction - 45) * Math.PI / 180;
  const retrievalPos = {
    x: landing.position.x + rollDistance * Math.sin(angleRad),
    y: landing.position.y + rollDistance * Math.cos(angleRad),
  };

  // 野手の総回収時間
  const totalFielderTime = retriever.timeToReach + bouncePenalty + pickupTime;

  // 送球速度: 肩力ベース (25-40 m/s)
  const throwSpeed = 25 + (retrieverSkill.arm / 100) * 15;

  // 走者の走塁速度: 走力ベース (6.5-9.0 m/s)
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;

  // ボール回収位置からの送球距離
  const throwTo2B = Math.sqrt(
    (retrievalPos.x - BASE_POSITIONS.second.x) ** 2 +
    (retrievalPos.y - BASE_POSITIONS.second.y) ** 2
  );
  const throwTo3B = Math.sqrt(
    (retrievalPos.x - BASE_POSITIONS.third.x) ** 2 +
    (retrievalPos.y - BASE_POSITIONS.third.y) ** 2
  );

  // 走者の各塁到達時間（1Bは既にセーフ確定）
  const runnerTo2B = 0.3 + timePerBase * 2;
  const runnerTo3B = 0.3 + timePerBase * 3;

  // 守備の各塁への送球完了時間
  const defenseTo2B = totalFielderTime + throwTo2B / throwSpeed;
  const defenseTo3B = totalFielderTime + throwTo3B / throwSpeed;

  // 走者がセーフな最大進塁数を計算 (1B はヒット確定なので最低1)
  // 3Bへの進塁はリスクが高いため、走者は十分な余裕がある場合のみ試みる
  let basesReached = 1;
  if (runnerTo2B < defenseTo2B) basesReached = 2;
  if (basesReached >= 2 && runnerTo3B < defenseTo3B - 1.5) basesReached = 3;

  const fielderPos = retriever.position;
  if (basesReached >= 3) return { result: "triple", fielderPos };
  if (basesReached >= 2) return { result: "double", fielderPos };
  return { result: "single", fielderPos };
}


/** 1打席の結果を決定する */
function simulateAtBat(
  batter: Player,
  pitcher: Player,
  fielderMap: Map<FielderPosition, Player>,
  bases: BaseRunners,
  outs: number
): AtBatDetail {
  const bat = batter.batting;
  const pit = pitcher.pitching!;

  const breakingPower = calcBreakingPower(pit.pitches);
  const contactFactor = (bat.contact - breakingPower * 0.5) / 100;
  const eyeFactor = (bat.eye - pit.control * 0.3) / 100;
  // 旧データ(1-100)と新データ(120-165)の互換
  const vel = pit.velocity <= 100 ? 120 + (pit.velocity / 100) * 45 : pit.velocity;
  const velocityFactor = (vel - 120) / 45;
  const controlFactor = pit.control / 100;

  const roll = Math.random();
  let cumulative = 0;

  // 死球率
  const hbpRate = 0.008 + (1 - controlFactor) * 0.007;
  cumulative += Math.max(0.003, hbpRate);
  if (roll < cumulative) {
    return { result: "hitByPitch", battedBallType: null, fielderPosition: null, direction: null, launchAngle: null, exitVelocity: null };
  }

  // 四球率
  const walkRate = 0.075 + eyeFactor * 0.05 - controlFactor * 0.04;
  cumulative += Math.max(0.02, walkRate);
  if (roll < cumulative) {
    return { result: "walk", battedBallType: null, fielderPosition: null, direction: null, launchAngle: null, exitVelocity: null };
  }

  // 三振率
  const maxPitchLevel = pit.pitches && pit.pitches.length > 0
    ? Math.max(...pit.pitches.map(p => p.level))
    : 0;
  const finisherBonus = maxPitchLevel >= 5 ? (maxPitchLevel - 4) * 0.015 : 0;
  const strikeoutRate = 0.20 + velocityFactor * 0.08 - contactFactor * 0.10 + finisherBonus;
  cumulative += Math.max(0.05, strikeoutRate);
  if (roll < cumulative) {
    return { result: "strikeout", battedBallType: null, fielderPosition: null, direction: null, launchAngle: null, exitVelocity: null };
  }

  // インプレー: 打球物理データ → 着地位置 → 守備AI → 結果判定
  const ball = generateBattedBall(batter, pitcher);
  const landing = calcBallLanding(ball.direction, ball.launchAngle, ball.exitVelocity);
  const fieldingResult = evaluateFielders(landing, ball.type, fielderMap);
  const aiResult = resolvePlayWithAI(ball, landing, fieldingResult, fielderMap, batter, bases, outs);

  return { result: aiResult.result, battedBallType: ball.type, fielderPosition: aiResult.fielderPos, direction: ball.direction, launchAngle: ball.launchAngle, exitVelocity: ball.exitVelocity };
}

/** 個人成績マップを取得・初期化するヘルパー */
function getOrCreateBatterStats(
  map: Map<string, PlayerGameStats>,
  playerId: string
): PlayerGameStats {
  let stats = map.get(playerId);
  if (!stats) {
    stats = {
      playerId,
      atBats: 0,
      hits: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      rbi: 0,
      runs: 0,
      walks: 0,
      strikeouts: 0,
      stolenBases: 0,
      caughtStealing: 0,
    };
    map.set(playerId, stats);
  }
  return stats;
}

/** 守備スタッツ（刺殺/補殺/失策）を記録するヘルパー */
function recordFielding(
  statsMap: Map<string, PlayerGameStats>,
  fielderMap: Map<FielderPosition, Player>,
  pos: FielderPosition,
  type: "putOut" | "assist" | "error"
): void {
  const fielder = fielderMap.get(pos);
  if (!fielder || fielder.id === "dummy") return;
  const stats = getOrCreateBatterStats(statsMap, fielder.id);
  if (type === "putOut") stats.putOuts = (stats.putOuts ?? 0) + 1;
  else if (type === "assist") stats.assists = (stats.assists ?? 0) + 1;
  else stats.errors = (stats.errors ?? 0) + 1;
}

/**
 * 打席結果に応じて走者を進塁させ、得点を計算する
 */
function advanceRunners(
  bases: BaseRunners,
  result: AtBatResult,
  batter: Player
): { bases: BaseRunners; runsScored: number; scoredRunners: Player[] } {
  let runs = 0;
  const scored: Player[] = [];
  const newBases: BaseRunners = { first: null, second: null, third: null };

  switch (result) {
    case "homerun": {
      if (bases.third) scored.push(bases.third);
      if (bases.second) scored.push(bases.second);
      if (bases.first) scored.push(bases.first);
      scored.push(batter);
      runs = scored.length;
      break;
    }

    case "triple":
      if (bases.first) scored.push(bases.first);
      if (bases.second) scored.push(bases.second);
      if (bases.third) scored.push(bases.third);
      runs = scored.length;
      newBases.third = batter;
      break;

    case "double":
      if (bases.second) scored.push(bases.second);
      if (bases.third) scored.push(bases.third);
      runs = scored.length;
      if (bases.first) newBases.third = bases.first;
      newBases.second = batter;
      break;

    case "single":
    case "infieldHit":
    case "error":
      if (bases.third) scored.push(bases.third);
      runs = scored.length;
      if (bases.second) newBases.third = bases.second;
      if (bases.first) newBases.second = bases.first;
      newBases.first = batter;
      break;

    case "walk":
    case "hitByPitch": {
      // 押し出し: フォースされた走者のみ進塁
      if (bases.first && bases.second && bases.third) {
        scored.push(bases.third);
        runs = 1;
      }
      if (bases.first && bases.second) newBases.third = bases.second;
      if (bases.first) newBases.second = bases.first;
      newBases.first = batter;
      // フォースされない走者はそのまま
      if (bases.third && !(bases.first && bases.second)) newBases.third = bases.third;
      if (bases.second && !bases.first) newBases.second = bases.second;
      break;
    }

    case "doublePlay":
      // 1塁走者アウト + 打者アウト (3塁走者は生還しない、2塁走者は2塁のまま)
      if (bases.second) newBases.second = bases.second;
      if (bases.third) newBases.third = bases.third;
      return { bases: newBases, runsScored: 0, scoredRunners: [] };

    case "sacrificeFly":
      // 3塁走者生還、打者アウト
      if (bases.third) {
        scored.push(bases.third);
        runs = 1;
      }
      if (bases.second) newBases.third = bases.second;
      if (bases.first) newBases.second = bases.first;
      break;

    case "fieldersChoice": {
      // 先頭ランナーアウト、打者1塁
      if (bases.third) {
        // 3塁走者アウト
        if (bases.second) newBases.third = bases.second;
        if (bases.first) newBases.second = bases.first;
        newBases.first = batter;
      } else if (bases.second) {
        // 2塁走者アウト
        if (bases.first) newBases.second = bases.first;
        newBases.first = batter;
      } else {
        // 1塁走者アウト
        newBases.first = batter;
      }
      break;
    }

    default:
      // アウト系: 走者はそのまま
      return { bases, runsScored: 0, scoredRunners: [] };
  }

  return { bases: newBases, runsScored: runs, scoredRunners: scored };
}

/**
 * 盗塁を試みる
 *
 * 走力が高い走者ほど盗塁を試み、成功率は走力 vs 捕手の肩力で決まる。
 * - 1塁→2塁: 走力50以上で試行の可能性あり
 * - 2塁→3塁: 走力65以上で試行（頻度低め）
 * - 2アウト時は試行率が下がる
 */
function attemptStolenBases(
  bases: BaseRunners,
  outs: number,
  catcher: Player,
  batterStatsMap: Map<string, PlayerGameStats>,
  fielderMap: Map<FielderPosition, Player>
): { bases: BaseRunners; additionalOuts: number } {
  const newBases = { ...bases };
  let additionalOuts = 0;

  const outsFactor = outs === 2 ? 0.3 : 1.0;
  const catcherArm = catcher.batting.arm;

  // 1塁走者 → 2塁盗塁 (2塁が空いている場合のみ)
  if (newBases.first && !newBases.second) {
    const runner = newBases.first;
    const speed = runner.batting.speed;

    let attemptRate = 0;
    if (speed >= 80) attemptRate = 0.20;
    else if (speed >= 70) attemptRate = 0.12;
    else if (speed >= 60) attemptRate = 0.05;
    else if (speed >= 50) attemptRate = 0.02;

    if (attemptRate > 0 && Math.random() < attemptRate * outsFactor) {
      const baseRate = 0.65;
      const speedBonus = (speed - 50) * 0.005;
      const armPenalty = (catcherArm - 50) * 0.004;
      const successRate = Math.min(0.95, Math.max(0.30, baseRate + speedBonus - armPenalty));

      const bs = getOrCreateBatterStats(batterStatsMap, runner.id);
      if (Math.random() < successRate) {
        newBases.second = runner;
        newBases.first = null;
        bs.stolenBases++;
      } else {
        newBases.first = null;
        bs.caughtStealing++;
        additionalOuts++;
        // 盗塁死: 捕手にA、SSにPO
        recordFielding(batterStatsMap, fielderMap, 2, "assist");
        recordFielding(batterStatsMap, fielderMap, 6, "putOut");
      }
    }
  }

  // 2塁走者 → 3塁盗塁 (3塁が空いている場合のみ、頻度低め)
  if (newBases.second && !newBases.third && additionalOuts === 0) {
    const runner = newBases.second;
    const speed = runner.batting.speed;

    let attemptRate = 0;
    if (speed >= 85) attemptRate = 0.08;
    else if (speed >= 75) attemptRate = 0.04;
    else if (speed >= 65) attemptRate = 0.01;

    if (attemptRate > 0 && Math.random() < attemptRate * outsFactor) {
      const baseRate = 0.60;
      const speedBonus = (speed - 50) * 0.005;
      const armPenalty = (catcherArm - 50) * 0.005;
      const successRate = Math.min(0.90, Math.max(0.25, baseRate + speedBonus - armPenalty));

      const bs = getOrCreateBatterStats(batterStatsMap, runner.id);
      if (Math.random() < successRate) {
        newBases.third = runner;
        newBases.second = null;
        bs.stolenBases++;
      } else {
        newBases.second = null;
        bs.caughtStealing++;
        additionalOuts++;
        // 盗塁死: 捕手にA、3BにPO
        recordFielding(batterStatsMap, fielderMap, 2, "assist");
        recordFielding(batterStatsMap, fielderMap, 5, "putOut");
      }
    }
  }

  return { bases: newBases, additionalOuts };
}

/** 捕手を取得 (position === "C" の選手、いなければ最初の野手) */
function getCatcher(team: Team): Player {
  return team.roster.find((p) => p.position === "C") || team.roster[0];
}

/** 1軍選手のみ取得 */
function getActivePlayers(team: Team): Player[] {
  if (!team.rosterLevels) return team.roster;
  return team.roster.filter(
    (p) => !team.rosterLevels || team.rosterLevels[p.id] === "ichi_gun"
  );
}

/** 先発投手を取得 (lineupConfig参照、未設定ならフォールバック) */
function getStartingPitcher(team: Team): Player {
  const active = getActivePlayers(team);
  const pitchers = active.filter((p) => p.isPitcher);

  if (team.lineupConfig?.startingRotation?.length) {
    const rotation = team.lineupConfig.startingRotation;
    const idx = team.lineupConfig.rotationIndex % rotation.length;
    const pitcher = active.find((p) => p.id === rotation[idx]);
    if (pitcher) return pitcher;
  }

  return pitchers[Math.floor(Math.random() * Math.min(5, pitchers.length))];
}

/** 打順を取得 (lineupConfig参照、未設定ならフォールバック) */
function getBattingOrder(team: Team): Player[] {
  const active = getActivePlayers(team);

  if (team.lineupConfig?.battingOrder?.length) {
    const order = team.lineupConfig.battingOrder
      .map((id) => active.find((p) => p.id === id))
      .filter((p): p is Player => p !== undefined);
    if (order.length >= 9) return order.slice(0, 9);
  }

  // フォールバック: 能力値の高い順にソートして上位9人
  const batters = active.filter((p) => !p.isPitcher);
  return batters
    .sort((a, b) => {
      const aOvr = a.batting.contact + a.batting.power + a.batting.speed;
      const bOvr = b.batting.contact + b.batting.power + b.batting.speed;
      return bOvr - aOvr;
    })
    .slice(0, 9);
}

/** 1イニングの半分 (表 or 裏) をシミュレート */
function simulateHalfInning(
  battingTeam: Player[],
  pitcher: Player,
  fieldingTeam: Player[],
  batterIndex: number,
  batterStatsMap: Map<string, PlayerGameStats>,
  pitcherLog: PitcherGameLog,
  catcher: Player,
  fullRoster?: Player[],
  options?: SimulateGameOptions,
  atBatLogs?: AtBatLog[],
  inning?: number,
  halfInning?: "top" | "bottom"
): { runs: number; hits: number; nextBatterIndex: number } {
  let outs = 0;
  let runs = 0;
  let hits = 0;
  let bases: BaseRunners = { first: null, second: null, third: null };
  let idx = batterIndex;

  const fielderMap = buildFielderMap(fieldingTeam, pitcher, fullRoster);

  while (outs < 3) {
    // 盗塁試行 (打席前)
    if (bases.first || bases.second) {
      const stealResult = attemptStolenBases(bases, outs, catcher, batterStatsMap, fielderMap);
      bases = stealResult.bases;
      outs += stealResult.additionalOuts;
      if (outs >= 3) break;
    }

    const batter = battingTeam[idx % battingTeam.length];
    const outsBeforeAtBat = outs;
    const basesBeforeAtBat: [boolean, boolean, boolean] = [
      bases.first !== null,
      bases.second !== null,
      bases.third !== null,
    ];
    const detail = simulateAtBat(batter, pitcher, fielderMap, bases, outs);
    const result = detail.result;
    const bs = getOrCreateBatterStats(batterStatsMap, batter.id);

    switch (result) {
      case "strikeout":
        outs++;
        bs.atBats++;
        bs.strikeouts++;
        pitcherLog.strikeouts++;
        recordFielding(batterStatsMap, fielderMap, 2, "putOut");
        break;

      case "groundout":
        outs++;
        bs.atBats++;
        pitcherLog.groundBallOuts = (pitcherLog.groundBallOuts ?? 0) + 1;
        if (detail.fielderPosition) {
          const fp = detail.fielderPosition;
          if (bases.first && Math.random() < 0.40) {
            // 2塁フォースアウト: 走者1塁時の40%
            if (fp === 6) {
              // SS自身が2塁ベースを踏む → 無補殺刺殺
              recordFielding(batterStatsMap, fielderMap, 6, "putOut");
            } else if (fp === 4) {
              // 2B自身が2塁ベースを踏む → 無補殺刺殺
              recordFielding(batterStatsMap, fielderMap, 4, "putOut");
            } else {
              // 他の内野手 → 2塁送球 → 処理野手A + SS(85%) or 2B(15%)が刺殺
              recordFielding(batterStatsMap, fielderMap, fp, "assist");
              const coverPos: FielderPosition = Math.random() < 0.85 ? 6 : 4;
              recordFielding(batterStatsMap, fielderMap, coverPos, "putOut");
            }
          } else if (!bases.first && (bases.second || bases.third) && Math.random() < 0.35) {
            // 走者2B/3Bで1B空き: 他塁への送球 (35%)
            recordFielding(batterStatsMap, fielderMap, fp, "assist");
            if (bases.third && Math.random() < 0.40) {
              // 本塁送球 → 捕手PO
              recordFielding(batterStatsMap, fielderMap, 2, "putOut");
            } else {
              // 2塁/3塁タッチプレー → SS(70%) or 3B(30%) PO
              const tagPos: FielderPosition = Math.random() < 0.70 ? 6 : 5;
              recordFielding(batterStatsMap, fielderMap, tagPos, "putOut");
            }
          } else if (fp !== 6 && fp !== 4 && Math.random() < 0.12) {
            // SSタグプレー: SS(70%) or 2B(30%)が2塁ベースカバーでPO
            recordFielding(batterStatsMap, fielderMap, fp, "assist");
            const tagCoverPos: FielderPosition = Math.random() < 0.70 ? 6 : 4;
            recordFielding(batterStatsMap, fielderMap, tagCoverPos, "putOut");
          } else {
            // 1塁送球
            if (fp === 3) {
              // 1B自己処理: 無補殺刺殺 (3U)
              recordFielding(batterStatsMap, fielderMap, 3, "putOut");
            } else {
              // 他の内野手 → 1B送球
              recordFielding(batterStatsMap, fielderMap, fp, "assist");
              recordFielding(batterStatsMap, fielderMap, 3, "putOut");
            }
          }
        }
        // 捕手が関与したプレー（バント処理・牽制等）
        if (Math.random() < 0.05) {
          recordFielding(batterStatsMap, fielderMap, 2, "assist");
        }
        break;

      case "flyout":
      case "popout": {
        outs++;
        bs.atBats++;
        pitcherLog.flyBallOuts = (pitcherLog.flyBallOuts ?? 0) + 1;
        if (detail.fielderPosition) {
          recordFielding(batterStatsMap, fielderMap, detail.fielderPosition, "putOut");
          // 外野フライでの中継/カットオフ補殺 (走者ありの場合)
          const fp = detail.fielderPosition;
          if (fp >= 7 && fp <= 9 && (bases.first || bases.second || bases.third)) {
            if (Math.random() < 0.03) {
              recordFielding(batterStatsMap, fielderMap, fp, "assist");
              const relayPos: FielderPosition = Math.random() < 0.70 ? 6 : 4;
              recordFielding(batterStatsMap, fielderMap, relayPos, "assist");
            }
          }
        }
        break;
      }

      case "lineout": {
        outs++;
        bs.atBats++;
        if (detail.fielderPosition) {
          recordFielding(batterStatsMap, fielderMap, detail.fielderPosition, "putOut");
          // 外野ライナーでの中継補殺 (走者ありの場合)
          const fp = detail.fielderPosition;
          if (fp >= 7 && fp <= 9 && (bases.first || bases.second || bases.third)) {
            if (Math.random() < 0.03) {
              recordFielding(batterStatsMap, fielderMap, fp, "assist");
              const relayPos: FielderPosition = Math.random() < 0.70 ? 6 : 4;
              recordFielding(batterStatsMap, fielderMap, relayPos, "assist");
            }
          }
        }
        break;
      }

      case "doublePlay": {
        outs += 2;
        bs.atBats++;
        bs.groundedIntoDP = (bs.groundedIntoDP ?? 0) + 1;
        pitcherLog.groundBallOuts = (pitcherLog.groundBallOuts ?? 0) + 1;
        if (detail.fielderPosition) {
          const dpPos = detail.fielderPosition;
          recordFielding(batterStatsMap, fielderMap, dpPos, "assist");
          if (dpPos === 4) {
            // 4-6-3: 2B(A)→SS: PO(2塁フォース)+A(1塁送球)→1B: PO
            recordFielding(batterStatsMap, fielderMap, 6, "putOut");
            recordFielding(batterStatsMap, fielderMap, 6, "assist");
            recordFielding(batterStatsMap, fielderMap, 3, "putOut");
          } else if (dpPos === 6) {
            // 6-4-3: SS(A)→2B: PO(2塁フォース)+A(1塁送球)→1B: PO
            recordFielding(batterStatsMap, fielderMap, 4, "putOut");
            recordFielding(batterStatsMap, fielderMap, 4, "assist");
            recordFielding(batterStatsMap, fielderMap, 3, "putOut");
          } else {
            // 5-6-3等: 処理野手(A)→SS or 2B: PO+A→1B: PO
            const pivotPos: FielderPosition = Math.random() < 0.65 ? 6 : 4;
            recordFielding(batterStatsMap, fielderMap, pivotPos, "putOut");
            recordFielding(batterStatsMap, fielderMap, pivotPos, "assist");
            recordFielding(batterStatsMap, fielderMap, 3, "putOut");
          }
        }
        const dpAdvance = advanceRunners(bases, result, batter);
        bases = dpAdvance.bases;
        for (const runner of dpAdvance.scoredRunners) {
          getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
        }
        break;
      }

      case "sacrificeFly": {
        outs++;
        // 犠飛は打数にカウントしない
        bs.sacrificeFlies = (bs.sacrificeFlies ?? 0) + 1;
        pitcherLog.flyBallOuts = (pitcherLog.flyBallOuts ?? 0) + 1;
        if (detail.fielderPosition) {
          recordFielding(batterStatsMap, fielderMap, detail.fielderPosition, "putOut");
          // 犠飛での中継補殺
          if (detail.fielderPosition >= 7 && detail.fielderPosition <= 9) {
            if (Math.random() < 0.05) {
              recordFielding(batterStatsMap, fielderMap, detail.fielderPosition, "assist");
              const relayPos: FielderPosition = Math.random() < 0.70 ? 6 : 4;
              recordFielding(batterStatsMap, fielderMap, relayPos, "assist");
            }
          }
        }
        const sfAdvance = advanceRunners(bases, result, batter);
        bases = sfAdvance.bases;
        const sfScored = sfAdvance.runsScored;
        runs += sfScored;
        bs.rbi += sfScored;
        pitcherLog.earnedRuns += sfScored;
        for (const runner of sfAdvance.scoredRunners) {
          getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
        }
        break;
      }

      case "walk":
        bs.walks++;
        pitcherLog.walks++;
        {
          const advance = advanceRunners(bases, result, batter);
          bases = advance.bases;
          const scored = advance.runsScored;
          runs += scored;
          bs.rbi += scored;
          pitcherLog.earnedRuns += scored;
          for (const runner of advance.scoredRunners) {
            getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
          }
        }
        break;

      case "hitByPitch":
        bs.hitByPitch = (bs.hitByPitch ?? 0) + 1;
        pitcherLog.hitBatsmen = (pitcherLog.hitBatsmen ?? 0) + 1;
        {
          const advance = advanceRunners(bases, result, batter);
          bases = advance.bases;
          const scored = advance.runsScored;
          runs += scored;
          bs.rbi += scored;
          pitcherLog.earnedRuns += scored;
          for (const runner of advance.scoredRunners) {
            getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
          }
        }
        break;

      case "fieldersChoice": {
        outs++;
        bs.atBats++;
        if (detail.fielderPosition) {
          recordFielding(batterStatsMap, fielderMap, detail.fielderPosition, "assist");
          // アウトになった走者に応じてPOを記録
          if (bases.third) {
            // 3塁走者アウト: 捕手にPO
            recordFielding(batterStatsMap, fielderMap, 2, "putOut");
          } else if (bases.second) {
            // 2塁走者アウト: 3BにPO
            recordFielding(batterStatsMap, fielderMap, 5, "putOut");
          } else {
            // 1塁走者アウト: SSにPO
            recordFielding(batterStatsMap, fielderMap, 6, "putOut");
          }
        }
        const fcAdvance = advanceRunners(bases, result, batter);
        bases = fcAdvance.bases;
        const fcScored = fcAdvance.runsScored;
        runs += fcScored;
        bs.rbi += fcScored;
        pitcherLog.earnedRuns += fcScored;
        for (const runner of fcAdvance.scoredRunners) {
          getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
        }
        break;
      }

      case "error": {
        bs.atBats++;
        // エラーは安打にカウントしない
        if (detail.fielderPosition) {
          recordFielding(batterStatsMap, fielderMap, detail.fielderPosition, "error");
        }
        const errAdvance = advanceRunners(bases, result, batter);
        bases = errAdvance.bases;
        const errScored = errAdvance.runsScored;
        runs += errScored;
        // エラーによる失点は自責点に含まない
        for (const runner of errAdvance.scoredRunners) {
          getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
        }
        break;
      }

      case "single":
      case "infieldHit":
      case "double":
      case "triple":
      case "homerun": {
        bs.atBats++;
        bs.hits++;
        hits++;
        pitcherLog.hits++;
        if (result === "double") bs.doubles++;
        if (result === "triple") bs.triples++;
        if (result === "homerun") {
          bs.homeRuns++;
          pitcherLog.homeRunsAllowed++;
        }
        const hitAdvance = advanceRunners(bases, result, batter);
        bases = hitAdvance.bases;
        const hitScored = hitAdvance.runsScored;
        runs += hitScored;
        bs.rbi += hitScored;
        pitcherLog.earnedRuns += hitScored;
        for (const runner of hitAdvance.scoredRunners) {
          getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
        }
        break;
      }
    }

    // 全打球タイプをカウント（三振・四球・死球以外）
    if (detail.battedBallType) {
      switch (detail.battedBallType) {
        case "ground_ball":
          pitcherLog.groundBalls = (pitcherLog.groundBalls ?? 0) + 1;
          break;
        case "fly_ball":
          pitcherLog.flyBalls = (pitcherLog.flyBalls ?? 0) + 1;
          break;
        case "line_drive":
          pitcherLog.lineDrives = (pitcherLog.lineDrives ?? 0) + 1;
          break;
        case "popup":
          pitcherLog.popups = (pitcherLog.popups ?? 0) + 1;
          break;
      }
    }

    if (options?.collectAtBatLogs && atBatLogs) {
      const dist = (detail.exitVelocity != null && detail.launchAngle != null)
        ? estimateDistance(detail.exitVelocity, detail.launchAngle)
        : null;
      const pitchType = selectPitch(pitcher, detail.result);
      const pitchLocation = generatePitchLocation(pitcher, detail.result, pitchType);
      atBatLogs.push({
        inning: inning ?? 0,
        halfInning: halfInning ?? "top",
        batterId: batter.id,
        pitcherId: pitcher.id,
        result: detail.result,
        battedBallType: detail.battedBallType,
        direction: detail.direction,
        launchAngle: detail.launchAngle,
        exitVelocity: detail.exitVelocity,
        fielderPosition: detail.fielderPosition,
        estimatedDistance: dist,
        basesBeforePlay: basesBeforeAtBat,
        outsBeforePlay: outsBeforeAtBat,
        pitchType,
        pitchLocation,
      });
    }

    idx++;
  }

  // 3アウトで1イニング分
  pitcherLog.inningsPitched += 3;

  return { runs, hits, nextBatterIndex: idx };
}

export interface SimulateGameOptions {
  collectAtBatLogs?: boolean;
}

/**
 * 1試合をシミュレートする
 * @returns GameResult
 */
export function simulateGame(homeTeam: Team, awayTeam: Team, options?: SimulateGameOptions): GameResult {
  const homePitcher = getStartingPitcher(homeTeam);
  const awayPitcher = getStartingPitcher(awayTeam);
  const homeBatters = getBattingOrder(homeTeam);
  const awayBatters = getBattingOrder(awayTeam);
  const homeCatcher = getCatcher(homeTeam);
  const awayCatcher = getCatcher(awayTeam);

  // 個人成績マップ
  const batterStatsMap = new Map<string, PlayerGameStats>();
  const homePitcherLog: PitcherGameLog = {
    playerId: homePitcher.id,
    inningsPitched: 0,
    hits: 0,
    earnedRuns: 0,
    walks: 0,
    strikeouts: 0,
    homeRunsAllowed: 0,
  };
  const awayPitcherLog: PitcherGameLog = {
    playerId: awayPitcher.id,
    inningsPitched: 0,
    hits: 0,
    earnedRuns: 0,
    walks: 0,
    strikeouts: 0,
    homeRunsAllowed: 0,
  };

  const innings: InningScore[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let homeBatterIdx = 0;
  let awayBatterIdx = 0;
  const atBatLogs: AtBatLog[] = [];

  // 9イニング
  for (let i = 0; i < 9; i++) {
    // 表 (アウェイチームの攻撃 → ホームチームが守備)
    const topResult = simulateHalfInning(
      awayBatters, homePitcher, homeBatters, awayBatterIdx, batterStatsMap, homePitcherLog, homeCatcher,
      getActivePlayers(homeTeam), options, atBatLogs, i + 1, "top"
    );
    awayScore += topResult.runs;
    awayBatterIdx = topResult.nextBatterIndex;

    // 裏 (ホームチームの攻撃 → アウェイチームが守備)
    // 9回裏でホームチームがリードしていたらスキップ
    let bottomRuns = 0;
    if (!(i === 8 && homeScore > awayScore)) {
      const bottomResult = simulateHalfInning(
        homeBatters, awayPitcher, awayBatters, homeBatterIdx, batterStatsMap, awayPitcherLog, awayCatcher,
        getActivePlayers(awayTeam), options, atBatLogs, i + 1, "bottom"
      );
      bottomRuns = bottomResult.runs;
      homeScore += bottomRuns;
      homeBatterIdx = bottomResult.nextBatterIndex;
    }

    innings.push({ top: topResult.runs, bottom: bottomRuns });

    // 9回裏でサヨナラ
    if (i === 8 && homeScore > awayScore) break;
  }

  // 延長 (最大12回まで)
  while (homeScore === awayScore && innings.length < 12) {
    const extInning = innings.length + 1;
    const topResult = simulateHalfInning(
      awayBatters, homePitcher, homeBatters, awayBatterIdx, batterStatsMap, homePitcherLog, homeCatcher,
      getActivePlayers(homeTeam), options, atBatLogs, extInning, "top"
    );
    awayScore += topResult.runs;
    awayBatterIdx = topResult.nextBatterIndex;

    const bottomResult = simulateHalfInning(
      homeBatters, awayPitcher, awayBatters, homeBatterIdx, batterStatsMap, awayPitcherLog, awayCatcher,
      getActivePlayers(awayTeam), options, atBatLogs, extInning, "bottom"
    );
    homeScore += bottomResult.runs;
    homeBatterIdx = bottomResult.nextBatterIndex;

    innings.push({ top: topResult.runs, bottom: bottomResult.runs });
  }

  // 打者の出場試合数を記録
  for (const stats of batterStatsMap.values()) {
    (stats as PlayerGameStats & { games?: number }).games = 1;
  }

  return {
    homeScore,
    awayScore,
    innings,
    winningPitcherId: homeScore > awayScore ? homePitcher.id : awayScore > homeScore ? awayPitcher.id : null,
    losingPitcherId: homeScore > awayScore ? awayPitcher.id : awayScore > homeScore ? homePitcher.id : null,
    savePitcherId: null,
    playerStats: Array.from(batterStatsMap.values()),
    pitcherStats: [homePitcherLog, awayPitcherLog],
    atBatLogs: options?.collectAtBatLogs ? atBatLogs : undefined,
  };
}

