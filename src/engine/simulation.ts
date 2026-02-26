import type { Team } from "@/models/team";
import type { GameResult, InningScore, PlayerGameStats, PitcherGameLog, AtBatLog, FieldingTrace, FielderMovement } from "@/models/league";
import type { Player, Position, PitchRepertoire, PitchType, Injury } from "@/models/player";
import { calcBallLanding, evaluateFielders, resolveHitTypeFromLanding, DEFAULT_FIELDER_POSITIONS } from "./fielding-ai";
import type { BallLanding, FielderDecision } from "./fielding-ai";
import {
  GRAVITY, BAT_HEIGHT, DRAG_FACTOR, FLIGHT_TIME_FACTOR,
  FENCE_BASE, FENCE_CENTER_EXTRA, FENCE_HEIGHT,
  GROUND_BALL_ANGLE_THRESHOLD, GROUND_BALL_MAX_DISTANCE,
  GROUND_BALL_SPEED_FACTOR, GROUND_BALL_AVG_SPEED_RATIO,
  TRAJECTORY_CARRY_FACTORS,
  MENTAL_FATIGUE_RESISTANCE, MENTAL_PINCH_CONTROL_FACTOR,
  BOUNCE_CLOSE_THRESHOLD, BOUNCE_NEAR_THRESHOLD, BOUNCE_MID_THRESHOLD,
  FIELDER_CATCH_RADIUS,
} from "./physics-constants";

/** 球種リストから旧来の breaking 相当の 0-100 スケール値を算出 */
export function calcBreakingPower(pitches: PitchRepertoire[] | undefined): number {
  if (!pitches || pitches.length === 0) return 30; // 旧データ互換用デフォルト
  const total = pitches.reduce((sum, p) => sum + p.level * p.level, 0);
  // 理論最大: 5球種 × 49(=7²) = 245
  return Math.min(100, (total / 245) * 130);
}

/** 打球タイプ */
type BattedBallType = "ground_ball" | "line_drive" | "fly_ball" | "popup";

/** 試合中の投手状態 */
interface PitcherGameState {
  player: Player;
  log: PitcherGameLog;
  pitchCount: number;
  currentStamina: number;
  battersFaced: number;
}

/** チームの試合中状態 */
interface TeamGameState {
  batters: Player[];
  batterIndex: number;
  currentPitcher: PitcherGameState;
  bullpen: Player[];
  usedPitcherIds: Set<string>;
  pitcherLogs: PitcherGameLog[];
  catcher: Player;
  fullRoster: Player[];
  /** 途中交代で退場した選手ID（再出場不可） */
  usedBatterIds?: Set<string>;
}

/** 1球ごとのスタミナ消費量 */
const STAMINA_PER_PITCH = 0.7;

/** 疲労による能力低下率を算出 (0.0 ~ 0.25) */
function getFatiguePenalty(pitcherState: PitcherGameState): number {
  const stamina = pitcherState.player.pitching!.stamina;
  const ratio = pitcherState.currentStamina / stamina;
  if (ratio >= 0.5) return 0;
  return (1 - ratio / 0.5) * 0.25;
}

/** 疲労を考慮した投手能力を返す */
function getEffectivePitcherAbilities(pitcherState: PitcherGameState): {
  velocity: number;
  control: number;
  pitches: { type: PitchType; level: number }[];
  stamina: number;
  mentalToughness: number;
  arm: number;
  fielding: number;
  catching: number;
} {
  const pit = pitcherState.player.pitching!;
  const penalty = getFatiguePenalty(pitcherState);
  // 精神力(0-100)による疲労ペナルティ軽減。mentalToughness 50が基準（軽減なし）
  // mentalToughness 100 → 疲労ペナルティを最大30%軽減、0 → 軽減なし
  const mentalResistance = 1 - (pit.mentalToughness / 100) * MENTAL_FATIGUE_RESISTANCE;
  const adjustedPenalty = penalty * mentalResistance;
  const vel = pit.velocity <= 100 ? 120 + (pit.velocity / 100) * 45 : pit.velocity;
  const effectiveVelocity = vel * (1 - adjustedPenalty * 0.5);
  const effectiveControl = pit.control * (1 - adjustedPenalty);
  const effectivePitches = pit.pitches.map(p => ({
    ...p,
    level: Math.max(1, Math.round(p.level * (1 - adjustedPenalty * 0.5)))
  }));
  return {
    velocity: effectiveVelocity,
    control: effectiveControl,
    pitches: effectivePitches,
    stamina: pit.stamina,
    mentalToughness: pit.mentalToughness,
    arm: pit.arm,
    fielding: pit.fielding,
    catching: pit.catching,
  };
}

/** ポジション番号 (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF) */
type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 打席結果の種類 */
type AtBatResult =
  | "single" | "double" | "triple" | "homerun"
  | "walk" | "hitByPitch"
  | "strikeout"
  | "groundout" | "flyout" | "lineout" | "popout"
  | "doublePlay" | "sacrificeFly"
  | "fieldersChoice" | "infieldHit" | "error"
  | "sacrifice_bunt" | "bunt_hit" | "bunt_out";

/** 1打席の詳細結果 */
interface AtBatDetail {
  result: AtBatResult;
  battedBallType: BattedBallType | null; // 三振・四球・死球はnull
  fielderPosition: FielderPosition | null;
  direction: number | null;
  launchAngle: number | null;
  exitVelocity: number | null;
  fieldingTrace?: FieldingTrace;
}

/** 走者の状態 */
interface BaseRunners {
  first: Player | null;
  second: Player | null;
  third: Player | null;
}

const FIELDER_POSITION_NAMES: Record<FielderPosition, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

/** 選手が守備位置に対して持つ実効守備力を算出 */
function getEffectiveFielding(player: Player, assignedPos: FielderPosition): number {
  if (assignedPos === 1) return player.pitching?.fielding ?? 50;
  const posName = FIELDER_POSITION_NAMES[assignedPos] as Position;
  if (player.position === posName) return player.batting.fielding;
  if (player.subPositions?.includes(posName)) {
    return Math.round(player.batting.fielding * 0.80);
  }
  return Math.round(player.batting.fielding * 0.60);
}

/** 守備能力を取得するヘルパー (投手は pitching から、野手は batting から) */
function getFieldingAbility(
  player: Player,
  pos: FielderPosition
): { fielding: number; catching: number; arm: number } {
  if (pos === 1) {
    return {
      fielding: player.pitching?.fielding ?? 50,
      catching: player.pitching?.catching ?? 50,
      arm: player.pitching?.arm ?? 50,
    };
  }
  return {
    fielding: getEffectiveFielding(player, pos),
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
  if (launchAngle < GROUND_BALL_ANGLE_THRESHOLD) return "ground_ball";
  // 10-19°: ライナー帯（低速・低角度の弱い打球はゴロ扱い）
  if (launchAngle < 20) {
    if (launchAngle < 12 && exitVelocity < 85) return "ground_ball";
    return "line_drive";
  }
  // 20-39°: フライ
  return "fly_ball";
}

/** 推定打球飛距離(メートル)を放物運動+空気抵抗補正で計算 */
export function estimateDistance(exitVelocityKmh: number, launchAngleDeg: number): number {
  if (launchAngleDeg < GROUND_BALL_ANGLE_THRESHOLD) {
    // ゴロ: 摩擦減速モデル（calcBallLanding と同じロジック）
    const v0 = exitVelocityKmh / 3.6;
    const bounceFactor = launchAngleDeg < 0
      ? Math.max(0.3, 1 + launchAngleDeg / 30)
      : 1 - (launchAngleDeg / GROUND_BALL_ANGLE_THRESHOLD) * 0.15;
    return Math.min(GROUND_BALL_MAX_DISTANCE, v0 * GROUND_BALL_SPEED_FACTOR) * bounceFactor;
  }

  const v0 = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const vy0 = v0 * Math.sin(theta);
  const vx = v0 * Math.cos(theta);
  const tUp = vy0 / GRAVITY;
  const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * GRAVITY);
  const tDown = Math.sqrt(2 * maxH / GRAVITY);
  const flightTime = (tUp + tDown) * FLIGHT_TIME_FACTOR;
  return vx * flightTime * DRAG_FACTOR;
}

/** フェンス距離(メートル): NPB標準 両翼100m, 中堅122m */
export function getFenceDistance(directionDeg: number): number {
  return FENCE_BASE + FENCE_CENTER_EXTRA * Math.sin(directionDeg * Math.PI / 90);
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
  let angleMean = 10 + (power - 50) * 0.08 - (contact - 50) * 0.04;
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
  const velMean = 132 + (power - 50) * 0.15 + (contact - 50) * 0.15;
  const breakingPenalty = (breakingPower - 50) * 0.15;
  const exitVelocity = clamp(gaussianRandom(velMean - breakingPenalty, 18), 80, 170);

  // --- 4. 打球タイプ分類 (後方互換) ---
  const type = classifyBattedBallType(launchAngle, exitVelocity);

  return { direction, launchAngle, exitVelocity, type };
}

// === バント判定 ===

/** 犠牲バント試行条件を判定 */
function shouldAttemptSacrificeBunt(
  bases: BaseRunners,
  outs: number,
  batter: Player,
  batterIndex: number
): boolean {
  // 2アウトは犠打不要
  if (outs >= 2) return false;
  // 走者が1塁または2塁にいることが条件
  const hasRunner = bases.first !== null || bases.second !== null;
  if (!hasRunner) return false;
  // 投手、または打順7-9番かつミート50未満
  const isLowOrderBatter = batterIndex >= 6 && batter.batting.contact < 50;
  return batter.isPitcher || isLowOrderBatter;
}

/** セーフティバント試行条件を判定 */
function shouldAttemptSafetyBunt(batter: Player): boolean {
  // 走力85以上が条件
  if (batter.batting.speed < 85) return false;
  // 試行確率: 1〜2%（NPB基準に準じた低頻度）
  const attemptRate = 0.01 + (batter.batting.speed - 85) * 0.0005;
  return Math.random() < attemptRate;
}

/** 犠牲バントを解決する */
function resolveSacrificeBunt(
  batter: Player,
  bases: BaseRunners
): { result: AtBatResult; newBases: BaseRunners } {
  // 成功率: contact 50 → 70%, contact 100 → 80%
  const successRate = 0.60 + batter.batting.contact * 0.002;
  const rand = Math.random();

  if (rand < successRate) {
    // 成功: 走者を1つ進塁、打者アウト
    const newBases: BaseRunners = { first: null, second: null, third: null };
    if (bases.third) {
      // 3塁走者はホームへ（この関数では得点処理は呼び出し元で行う）
    }
    if (bases.second) newBases.third = bases.second;
    if (bases.first) newBases.second = bases.first;
    return { result: "sacrifice_bunt", newBases };
  }

  // 失敗分岐
  const failRand = Math.random();
  if (failRand < 0.40) {
    // ファウル → 再試行は呼び出し元で管理（ここでは失敗として返す）
    return { result: "bunt_out", newBases: bases };
  } else if (failRand < 0.80) {
    // ゴロアウト: 打者アウト、走者進塁なし
    return { result: "bunt_out", newBases: bases };
  } else {
    // フィルダースチョイス: 打者1塁、走者アウト
    const newBases: BaseRunners = { first: batter, second: null, third: null };
    if (bases.second) newBases.third = bases.second;
    return { result: "bunt_out", newBases };
  }
}

/** セーフティバントを解決する */
function resolveSafetyBunt(batter: Player, bases: BaseRunners): { result: AtBatResult; newBases: BaseRunners } {
  // 成功率: speed 80, contact 50 → 41%
  const successRate = 0.20 + batter.batting.speed * 0.002 + batter.batting.contact * 0.001;
  if (Math.random() < successRate) {
    // 成功: 打者1塁、走者も進塁
    const newBases: BaseRunners = { first: batter, second: null, third: null };
    if (bases.third) {
      // 3塁走者は生還（呼び出し元で処理）
    }
    if (bases.second) newBases.third = bases.second;
    if (bases.first) newBases.second = bases.first;
    return { result: "bunt_hit", newBases };
  }
  // 失敗: 打者アウト、走者進塁なし
  return { result: "bunt_out", newBases: bases };
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


/** fieldingResultからcanReach=trueの野手のうち最も近い野手を探す */
function findBestFielder(
  fieldingResult: Map<FielderPosition, FielderDecision>
): FielderDecision | null {
  let best: FielderDecision | null = null;
  // canReach=true の全野手から最短距離を選ぶ
  for (const d of fieldingResult.values()) {
    if (!d.canReach) continue;
    if (!best
      || (d.distanceAtLanding ?? d.distanceToBall)
       < (best.distanceAtLanding ?? best.distanceToBall)) {
      best = d;
    }
  }
  if (best) return best;
  // 誰も到達不能 → 最短距離の野手
  for (const d of fieldingResult.values()) {
    if (!best || d.distanceToBall < best.distanceToBall) best = d;
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
): { result: AtBatResult; fielderPos: FielderPosition; trace?: FieldingTrace } {
  // 野手情報の配列と移動計画を構築（trace用）
  const traceFielders: FieldingTrace["fielders"] = [];
  const traceMovements: FielderMovement[] = [];
  for (const [pos, decision] of fieldingResult) {
    const player = _fielderMap.get(pos);
    const defPos = DEFAULT_FIELDER_POSITIONS.get(pos);
    traceFielders.push({
      position: pos,
      role: decision.role,
      defaultPos: defPos ? { x: defPos.x, y: defPos.y } : { x: 0, y: 0 },
      distanceToBall: decision.distanceToBall,
      timeToReach: decision.timeToReach,
      ballArrivalTime: decision.ballArrivalTime,
      canReach: decision.canReach,
      skill: { ...decision.skill, speed: player?.batting.speed ?? 50 },
      distanceAtLanding: decision.distanceAtLanding,
      posAtLanding: decision.posAtLanding,
    });
    if (defPos && decision.action && decision.targetPos) {
      const spd = decision.speed ?? 6.5;
      const startPos = { x: defPos.x, y: defPos.y };
      traceMovements.push({
        position: pos,
        startPos,
        targetPos: decision.targetPos,
        action: decision.action,
        startTime: Math.max(0, decision.timeToReach - decision.distanceToBall / spd),
        speed: spd,
      });
    }
  }

  const traceLanding: FieldingTrace["landing"] = {
    position: { x: landing.position.x, y: landing.position.y },
    distance: landing.distance,
    flightTime: landing.flightTime,
    isGroundBall: landing.isGroundBall,
  };

  // === フライ系（fly_ball / popup）→ HR判定（フェンス越え）===
  if (ball.type === "fly_ball" || ball.type === "popup") {
    const distance = estimateDistance(ball.exitVelocity, ball.launchAngle);
    const fenceDist = getFenceDistance(ball.direction);

    // 弾道によるHR飛距離補正（低弾道=ゴロ打ちでキャリーが落ちる、高弾道=控えめにボーナス）
    const trajectory = batter.batting.trajectory ?? 2;
    const baseCarryFactor = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, trajectory - 1))];

    // 急角度ではキャリー効果が減衰（バックスピン揚力は急角度で水平成分に効きにくい）
    // 35°以下: フルキャリー、35-50°: 線形減衰、50°以上: キャリー無し
    let trajectoryCarryFactor = baseCarryFactor;
    if (ball.launchAngle > 35) {
      const taper = Math.max(0, 1 - (ball.launchAngle - 35) / 15);
      trajectoryCarryFactor = 1 + (baseCarryFactor - 1) * taper;
    }

    const effectiveDistance = distance * trajectoryCarryFactor;
    const ratio = effectiveDistance / fenceDist;

    const hrCalcBase: FieldingTrace["hrCalc"] = {
      rawDistance: distance,
      fenceDistance: fenceDist,
      trajectory,
      carryFactor: trajectoryCarryFactor,
      effectiveDistance,
      ratio,
    };

    if (ratio >= 1.0) {
      // フェンス水平距離到達時の打球高さを計算
      // carryFactorをバックスピン揚力（実効重力の軽減）としてモデル化
      const v0 = ball.exitVelocity / 3.6;
      const theta = ball.launchAngle * Math.PI / 180;
      const vy0 = v0 * Math.sin(theta);
      const gEff = GRAVITY / trajectoryCarryFactor;
      const tUp = vy0 / gEff;
      const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * gEff);
      const tDown = Math.sqrt(2 * maxH / gEff);
      const tRaw = tUp + tDown;
      const tFence = (fenceDist / effectiveDistance) * tRaw;
      const heightAtFence = BAT_HEIGHT + vy0 * tFence - 0.5 * gEff * tFence * tFence;

      const hrCalc: FieldingTrace["hrCalc"] = {
        ...hrCalcBase,
        heightAtFence,
        fenceCleared: heightAtFence >= FENCE_HEIGHT,
      };

      if (heightAtFence >= FENCE_HEIGHT) {
        // フェンスの高さを越えた → HR確定
        const best = findBestFielder(fieldingResult);
        const fielderPos = best?.position ?? assignOutfielder(ball.direction);
        const trace: FieldingTrace = {
          landing: traceLanding,
          fielders: traceFielders,
          movements: traceMovements,
          hrCalc,
          resolution: {
            phase: "homerun",
            bestFielderPos: fielderPos,
            fielderArrival: best?.timeToReach ?? 0,
            ballArrival: best?.ballArrivalTime ?? 0,
            canReach: best?.canReach ?? false,
          },
        };
        return { result: "homerun", fielderPos, trace };
      }
      // 距離は足りるが高さ不足 → フェンス直撃（捕球不可→ヒット確定）
      {
        const best = findBestFielder(fieldingResult);
        const fielderPos = best?.position ?? assignOutfielder(ball.direction);
        // フェンス直撃はほぼダブル、走力次第でトリプル
        const runnerSpeed = batter.batting.speed;
        const tripleChance = 0.15 + (runnerSpeed / 100) * 0.15; // 15〜30%
        const hitResult: AtBatResult = Math.random() < tripleChance ? "triple" : "double";
        const trace: FieldingTrace = {
          landing: traceLanding,
          fielders: traceFielders,
          movements: traceMovements,
          hrCalc,
          resolution: {
            phase: "fence_hit",
            bestFielderPos: fielderPos,
            fielderArrival: best?.timeToReach ?? 0,
            ballArrival: best?.ballArrivalTime ?? 0,
            canReach: best?.canReach ?? false,
          },
        };
        return { result: hitResult, fielderPos, trace };
      }
    }

    // ポップフライでフェンス越えでなければ常にアウト
    if (ball.type === "popup") {
      const best = findBestFielder(fieldingResult);
      const fielderPos = best?.position ?? assignPopupFielder(ball.direction);
      const trace: FieldingTrace = {
        landing: traceLanding,
        fielders: traceFielders,
        movements: traceMovements,
        hrCalc: hrCalcBase,
        resolution: {
          phase: "popup_out",
          bestFielderPos: fielderPos,
          fielderArrival: best?.timeToReach ?? 0,
          ballArrival: best?.ballArrivalTime ?? 0,
          canReach: best?.canReach ?? false,
        },
      };
      return { result: "popout", fielderPos, trace };
    }
  }

  // =====================================
  // ゴロ処理
  // =====================================
  if (ball.type === "ground_ball") {
    const groundResult = resolveGroundBallSequential(
      ball, landing, fieldingResult, batter, bases, outs
    );
    const trace: FieldingTrace = {
      landing: traceLanding,
      fielders: traceFielders,
      movements: traceMovements,
      resolution: {
        phase: "ground_ball",
        bestFielderPos: groundResult.fielderPos,
        fielderArrival: 0,
        ballArrival: 0,
        canReach: true,
        ...groundResult.trace,
      },
    };
    return { result: groundResult.result, fielderPos: groundResult.fielderPos, trace };
  }

  // =====================================
  // フライ / ライナー処理
  // =====================================
  const flyResult = resolveFlyMultiConverge(
    ball, landing, fieldingResult, batter, bases, outs
  );
  const trace: FieldingTrace = {
    landing: traceLanding,
    fielders: traceFielders,
    movements: traceMovements,
    resolution: {
      phase: ball.type === "line_drive" ? "line_drive" : "fly_ball",
      bestFielderPos: flyResult.fielderPos,
      fielderArrival: 0,
      ballArrival: 0,
      canReach: true,
      ...flyResult.trace,
    },
  };
  return { result: flyResult.result, fielderPos: flyResult.fielderPos, trace };
}

/**
 * ゴロ逐次インターセプトモデル
 *
 * 1. path_intercept 野手（ボール経路上で間に合う野手、投手を除く）を
 *    守備完了時間（fieldTime + throw時間）が短い順にソートし、
 *    先頭の野手 1 人で捕球を試みる。
 * 2. 捕球成功 → groundout / infieldHit / doublePlay / fieldersChoice
 * 3. 捕球失敗 → error（捕球逸らし、次野手へのトンネル記録のみ残す）
 * 4. path_intercept がいない → chase_to_stop && canReach=true の内野手（投手含む）で捕球試行
 * 5. それもいない → resolveHitAdvancement（外野まで転がった場合のヒット判定）
 */
function resolveGroundBallSequential(
  ball: BattedBall,
  landing: BallLanding,
  fieldingResult: Map<FielderPosition, FielderDecision>,
  batter: Player,
  bases: BaseRunners,
  outs: number,
): { result: AtBatResult; fielderPos: FielderPosition; trace?: Partial<FieldingTrace["resolution"]> } {
  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const timePerBase = BASE_LENGTH / runnerSpeed;
  // ゴロ時の走者到達時間: スイング完了→打球方向確認→加速フェーズを含む
  const runnerStartDelay = 0.7;

  // 実際の捕球位置から1Bへの送球距離を計算
  const calcThrowDistFromCatchPos = (d: FielderDecision): number => {
    if (d.targetPos) {
      return Math.sqrt(
        (d.targetPos.x - BASE_POSITIONS.first.x) ** 2 +
        (d.targetPos.y - BASE_POSITIONS.first.y) ** 2
      );
    }
    return getThrowDistToFirst(d.position);
  };

  // path_intercept 全野手（P含む）を projectionDistance 昇順にソート（逐次インターセプト）
  const pathInterceptors = Array.from(fieldingResult.values())
    .filter(d => d.interceptType === "path_intercept")
    .sort((a, b) => (a.projectionDistance ?? 0) - (b.projectionDistance ?? 0));

  // トレース用: 全インターセプター候補を記録
  const interceptSequence: Array<{ pos: number; projDist: number; canIntercept: boolean; result?: string }> = [];
  for (const d of pathInterceptors) {
    interceptSequence.push({ pos: d.position, projDist: d.projectionDistance ?? 0, canIntercept: false });
  }

  // --- フェーズ1: 逐次インターセプト ---
  // projDist昇順でボール経路上の各野手を順番にチェック。
  // timeToReach > ballArrival → ボール通過（次の野手へ）
  // timeToReach <= ballArrival → 到達OK → 捕球試行
  for (let i = 0; i < pathInterceptors.length; i++) {
    const fielder = pathInterceptors[i];

    // timeToReach vs ballArrival チェック（path_intercept時のオリジナル値）
    if (fielder.timeToReach > fielder.ballArrivalTime) {
      // ボール通過 → 次の野手
      interceptSequence[i] = { ...interceptSequence[i], result: "miss" };
      continue;
    }

    // この野手がインターセプト可能
    interceptSequence[i] = { ...interceptSequence[i], canIntercept: true };
    const fielderPos = fielder.position;
    const skill = fielder.skill;
    const fieldingRate = (skill.fielding * 0.6 + skill.catching * 0.4) / 100;

    const margin = fielder.ballArrivalTime - fielder.timeToReach;
    const marginBonus = Math.min(0.015, margin * 0.01);
    const fieldRate = clamp(0.97 + fieldingRate * 0.02 + marginBonus, 0.97, 0.995);

    if (Math.random() >= fieldRate) {
      // 捕球失敗 → ファンブル/トンネル判定
      const distAtLand = fielder.distanceAtLanding ?? fielder.distanceToBall;
      if (distAtLand < 1.0) {
        // ファンブル: 足元で逸らした → 拾い直し+0.8s → ほぼ内野安打
        interceptSequence[i] = { ...interceptSequence[i], result: "fumble" };
        return { result: "infieldHit", fielderPos, trace: {
          phase: "ground_ball_fumble",
          bestFielderPos: fielderPos,
          fielderArrival: fielder.timeToReach,
          ballArrival: fielder.ballArrivalTime,
          canReach: true, runnerSpeed, fieldingRate, interceptSequence,
        }};
      }
      // トンネル: ボールが通過 → 次のインターセプターへ
      interceptSequence[i] = { ...interceptSequence[i], result: "tunnel" };
      continue;
    }

    // 捕球成功 → 送球 vs 走者
    // ゴロの path_intercept: 練習されたルーチンプレー → secure/transfer短め
    interceptSequence[i] = { ...interceptSequence[i], result: "fielded" };
    const secureTime = 0.2 + (1 - skill.fielding / 100) * 0.2;
    const transferTime = 0.45 + (1 - skill.arm / 100) * 0.25;
    const throwSpeed = 25 + (skill.arm / 100) * 15;
    const fieldTime = Math.max(fielder.timeToReach, fielder.ballArrivalTime);
    const throwDist = calcThrowDistFromCatchPos(fielder);
    const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
    const runnerTo1B = runnerStartDelay + timePerBase;

    const groundTrace: Partial<FieldingTrace["resolution"]> = {
      phase: "ground_ball_fielded",
      bestFielderPos: fielderPos,
      fielderArrival: fielder.timeToReach,
      ballArrival: fielder.ballArrivalTime,
      canReach: true,
      secureTime, transferTime,
      throwDistance: throwDist, throwSpeed, defenseTime,
      runnerSpeed, runnerTo1B,
      isInfieldHit: runnerTo1B < defenseTime,
      fieldingRate, interceptSequence,
    };

    if (runnerTo1B < defenseTime) {
      return { result: "infieldHit", fielderPos, trace: groundTrace };
    }
    if (bases.first && outs < 2) {
      const dpRate = 0.12 + (1 - batter.batting.speed / 100) * 0.06;
      if (Math.random() < dpRate) {
        return { result: "doublePlay", fielderPos, trace: groundTrace };
      }
    }
    if (bases.first || bases.second || bases.third) {
      if (Math.random() < 0.05) {
        return { result: "fieldersChoice", fielderPos, trace: groundTrace };
      }
    }
    return { result: "groundout", fielderPos, trace: groundTrace };
  }

  // --- フェーズ2: 全interceptor失敗 → chase_to_stop内野手(P除く)で捕球試行 ---
  // ボール停止位置まで走って拾う → 送球 vs 走者
  let chaseFielder: FielderDecision | null = null;
  let minChaseDist = Infinity;
  for (const decision of fieldingResult.values()) {
    if (decision.interceptType !== "chase_to_stop" || !decision.canReach) continue;
    if (decision.position > 6 || decision.position === 1) continue; // 外野手・投手は除外
    const distAtLand = decision.posAtLanding
      ? Math.sqrt((decision.posAtLanding.x - landing.position.x) ** 2 + (decision.posAtLanding.y - landing.position.y) ** 2)
      : (decision.distanceAtLanding ?? decision.distanceToBall);
    if (distAtLand < minChaseDist) {
      minChaseDist = distAtLand;
      chaseFielder = decision;
    }
  }

  if (chaseFielder) {
    const fielder = chaseFielder;
    const fielderPos = fielder.position;
    const skill = fielder.skill;
    const fieldingRate = (skill.fielding * 0.6 + skill.catching * 0.4) / 100;

    const margin = fielder.ballArrivalTime - fielder.timeToReach;
    const marginBonus = Math.min(0.01, margin * 0.005);
    const fieldRate = clamp(0.97 + fieldingRate * 0.02 + marginBonus, 0.97, 0.995);

    if (Math.random() >= fieldRate) {
      return { result: "error", fielderPos, trace: {
        phase: "ground_ball_error", bestFielderPos: fielderPos,
        fielderArrival: fielder.timeToReach, ballArrival: fielder.ballArrivalTime,
        canReach: true, runnerSpeed, fieldingRate, interceptSequence,
      }};
    }

    // chase_to_stop: 停止球の拾い上げ → secure/transfer短縮（ルーチンプレー）
    const secureTime = 0.15 + (1 - skill.fielding / 100) * 0.15;
    const transferTime = 0.45 + (1 - skill.arm / 100) * 0.25;
    const throwSpeed = 25 + (skill.arm / 100) * 15;
    const fieldTime = Math.max(fielder.timeToReach, fielder.ballArrivalTime);
    const throwDist = calcThrowDistFromCatchPos(fielder);
    const defenseTime = fieldTime + secureTime + transferTime + throwDist / throwSpeed;
    const runnerTo1B = runnerStartDelay + timePerBase;

    const groundTrace: Partial<FieldingTrace["resolution"]> = {
      phase: "ground_ball_fielded",
      bestFielderPos: fielderPos,
      fielderArrival: fielder.timeToReach,
      ballArrival: fielder.ballArrivalTime,
      canReach: true,
      secureTime, transferTime,
      throwDistance: throwDist, throwSpeed, defenseTime,
      runnerSpeed, runnerTo1B,
      isInfieldHit: runnerTo1B < defenseTime,
      fieldingRate, interceptSequence,
    };

    if (runnerTo1B < defenseTime) {
      return { result: "infieldHit", fielderPos, trace: groundTrace };
    }
    if (bases.first && outs < 2) {
      const dpRate = 0.12 + (1 - batter.batting.speed / 100) * 0.06;
      if (Math.random() < dpRate) {
        return { result: "doublePlay", fielderPos, trace: groundTrace };
      }
    }
    if (bases.first || bases.second || bases.third) {
      if (Math.random() < 0.05) {
        return { result: "fieldersChoice", fielderPos, trace: groundTrace };
      }
    }
    return { result: "groundout", fielderPos, trace: groundTrace };
  }

  // --- フェーズ3: 誰も届かない → 外野手が回収してヒット判定 ---
  let retriever: FielderDecision | null = null;
  let minDist = Infinity;
  for (const decision of fieldingResult.values()) {
    if (decision.position < 7) continue;
    const distAtLand = decision.posAtLanding
      ? Math.sqrt((decision.posAtLanding.x - landing.position.x) ** 2 + (decision.posAtLanding.y - landing.position.y) ** 2)
      : (decision.distanceAtLanding ?? decision.distanceToBall);
    if (distAtLand < minDist) {
      minDist = distAtLand;
      retriever = decision;
    }
  }
  if (!retriever) {
    for (const d of fieldingResult.values()) {
      const distAtLand = d.distanceAtLanding ?? d.distanceToBall;
      if (distAtLand < minDist) { minDist = distAtLand; retriever = d; }
    }
  }

  if (!retriever) {
    return { result: "single", fielderPos: 8, trace: { phase: "ground_ball_through", bestFielderPos: 8, fielderArrival: 0, ballArrival: 0, canReach: false, interceptSequence } };
  }

  if (landing.distance < 38) {
    return { result: "single", fielderPos: retriever.position, trace: { phase: "ground_ball_through", bestFielderPos: retriever.position, fielderArrival: retriever.timeToReach, ballArrival: retriever.ballArrivalTime, canReach: retriever.canReach, runnerSpeed, interceptSequence } };
  }

  const advResult = resolveHitAdvancement(ball, landing, retriever, batter);
  const throughTrace: Partial<FieldingTrace["resolution"]> = {
    phase: "ground_ball_through",
    bestFielderPos: retriever.position,
    fielderArrival: retriever.timeToReach,
    ballArrival: retriever.ballArrivalTime,
    canReach: retriever.canReach,
    runnerSpeed,
    interceptSequence,
    ...advResult.trace,
  };
  return { result: advResult.result, fielderPos: advResult.fielderPos, trace: throughTrace };
}

/**
 * フライ複数収束モデル
 *
 * interceptType="fly_converge" の野手を distanceAtLanding 昇順に並べ、
 * 最も近い野手(primary)から順に捕球を試みる。全員失敗したらヒット確定。
 */
function resolveFlyMultiConverge(
  ball: BattedBall,
  landing: BallLanding,
  fieldingResult: Map<FielderPosition, FielderDecision>,
  batter: Player,
  bases: BaseRunners,
  outs: number,
): { result: AtBatResult; fielderPos: FielderPosition; trace?: Partial<FieldingTrace["resolution"]> } {
  // interceptType="fly_converge" の野手を distanceAtLanding 昇順にソート
  const convergers = Array.from(fieldingResult.values())
    .filter(d => d.interceptType === "fly_converge")
    .sort((a, b) => (a.distanceAtLanding ?? a.distanceToBall) - (b.distanceAtLanding ?? b.distanceToBall));

  const convergerTrace: Array<{ pos: number; distAtLanding: number; canReach: boolean }> = convergers.map(d => ({
    pos: d.position,
    distAtLanding: d.distanceAtLanding ?? d.distanceToBall,
    canReach: d.canReach,
  }));

  // フォールバック: fly_converge が存在しない場合は canReach=true の最近傍を使う
  if (convergers.length === 0) {
    let fallback: FielderDecision | null = null;
    for (const d of fieldingResult.values()) {
      if (!d.canReach) continue;
      if (!fallback || (d.distanceAtLanding ?? d.distanceToBall) < (fallback.distanceAtLanding ?? fallback.distanceToBall)) {
        fallback = d;
      }
    }
    if (!fallback) {
      for (const d of fieldingResult.values()) { fallback = d; break; }
    }
    if (fallback) convergers.push(fallback);
  }

  for (const fielder of convergers) {
    const fielderPos = fielder.position;
    const skill = fielder.skill;
    const fieldingRate = (skill.fielding * 0.6 + skill.catching * 0.4) / 100;

    if (!fielder.canReach) continue;

    // 捕球成功率計算（既存ロジックと同一）
    const distAtLand = fielder.distanceAtLanding ?? fielder.distanceToBall;
    const margin = fielder.ballArrivalTime - fielder.timeToReach;
    const marginFactor = clamp(
      margin > 0 ? margin / 1.0 : (FIELDER_CATCH_RADIUS - distAtLand) / FIELDER_CATCH_RADIUS,
      0, 1
    );
    const baseCatchRate = 0.90 + marginFactor * 0.07;
    const skillBonus = fieldingRate * 0.03;
    const catchRate = clamp(baseCatchRate + skillBonus, 0.90, 0.99);
    const catchSuccess = Math.random() < catchRate;

    if (catchSuccess) {
      const flyTrace: Partial<FieldingTrace["resolution"]> = {
        phase: "fly_catch",
        bestFielderPos: fielderPos,
        fielderArrival: fielder.timeToReach,
        ballArrival: fielder.ballArrivalTime,
        canReach: fielder.canReach,
        catchMargin: margin,
        catchRate,
        catchSuccess: true,
        convergers: convergerTrace,
      };
      if (ball.type === "fly_ball") {
        if (bases.third && outs < 2 && Math.random() < 0.15) {
          return { result: "sacrificeFly", fielderPos, trace: flyTrace };
        }
        return { result: "flyout", fielderPos, trace: flyTrace };
      }
      return { result: "lineout", fielderPos, trace: flyTrace };
    }
    // 捕球失敗: 次のconvergerで再試行（最後のconvergerなら後続処理へ）
  }

  // === 全converger失敗 or canReach=false → ヒット確定 ===
  // まず fly_converge に canReach=true がいたかチェック（誰も届かない → 全員 canReach=false）
  const anyCanReach = convergers.some(d => d.canReach);

  // 回収者選出: converger(ボールに向かって走っていた野手)を優先
  let retriever: FielderDecision | null = null;
  // 1. 外野converger(ボールに向かって走っていた最寄り)
  for (const c of convergers) {
    if (c.position >= 7) { retriever = c; break; }
  }
  // 2. 浅い打球(<30m)では内野手の方が近い場合がある
  if (landing.distance < 30) {
    const retDist = retriever
      ? (retriever.posAtLanding
        ? Math.sqrt((retriever.posAtLanding.x - landing.position.x) ** 2 + (retriever.posAtLanding.y - landing.position.y) ** 2)
        : (retriever.distanceAtLanding ?? retriever.distanceToBall))
      : Infinity;
    for (const d of fieldingResult.values()) {
      if (d.position <= 2 || d.position >= 7) continue; // 内野手のみ(3-6)
      const dist = d.posAtLanding
        ? Math.sqrt((d.posAtLanding.x - landing.position.x) ** 2 + (d.posAtLanding.y - landing.position.y) ** 2)
        : (d.distanceAtLanding ?? d.distanceToBall);
      if (dist < retDist) { retriever = d; }
    }
  }
  // 3. フォールバック
  if (!retriever) {
    for (const c of convergers) { if (c.position >= 3) { retriever = c; break; } }
  }
  if (!retriever) {
    for (const d of fieldingResult.values()) { if (d.position >= 7) { retriever = d; break; } }
  }
  if (!retriever) {
    for (const d of fieldingResult.values()) { retriever = d; break; }
  }

  const fallbackFielderPos = retriever?.position ?? (assignOutfielder(ball.direction) as FielderPosition);

  if (!anyCanReach && retriever) {
    // 全員届かない → エラーではなくヒット判定
    const advResult = resolveHitAdvancement(ball, landing, retriever, batter);
    const noReachTrace: Partial<FieldingTrace["resolution"]> = {
      phase: "fly_hit",
      bestFielderPos: fallbackFielderPos,
      fielderArrival: retriever.timeToReach,
      ballArrival: retriever.ballArrivalTime,
      canReach: false,
      convergers: convergerTrace,
      ...advResult.trace,
    };
    return { result: advResult.result, fielderPos: advResult.fielderPos, trace: noReachTrace };
  }

  // 全員canReach=trueだったが全員捕球失敗 → エラー
  const errorTrace: Partial<FieldingTrace["resolution"]> = {
    phase: "fly_hit",
    bestFielderPos: fallbackFielderPos,
    fielderArrival: retriever?.timeToReach ?? 0,
    ballArrival: retriever?.ballArrivalTime ?? 0,
    canReach: anyCanReach,
    catchSuccess: false,
    convergers: convergerTrace,
  };
  return { result: "error", fielderPos: fallbackFielderPos, trace: errorTrace };
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
): { result: AtBatResult; fielderPos: FielderPosition; trace?: Partial<FieldingTrace["resolution"]> } {
  const retrieverSkill = retriever.skill;
  const fenceDist = getFenceDistance(ball.direction);

  // === ボール回収時間の計算 ===
  // 着地時点での野手-ボール距離 (distanceAtLanding) に基づいてバウンドペナルティを決定
  const pickupTime = 0.3 + (1 - retrieverSkill.catching / 100) * 0.4;
  const distAtLanding = retriever.distanceAtLanding ?? retriever.distanceToBall;

  let bouncePenalty: number;
  let rollDistance: number;

  if (landing.isGroundBall) {
    // ゴロが外野に抜けた場合: 比較的予測しやすいがまだ転がっている
    bouncePenalty = 0.5 + Math.random() * 0.5; // 0.5-1.0s
    rollDistance = 3;
  } else {
    // フライ/ライナー: バウンドペナルティは打球の深さ(着地距離)に依存
    // additionalRunTimeが野手の移動距離を既にカバーしているため、
    // bouncePenaltyは打球のバウンド特性（跳ね方・転がり）のみを表現
    const depthFactor = clamp((landing.distance - 50) / 50, 0, 1);
    bouncePenalty = 0.3 + depthFactor * 0.5 + Math.random() * 0.4;
    rollDistance = clamp((landing.distance - 50) * 0.08, 0, 6);

    // フェンス際: 壁リバウンドでさらに不規則
    if (landing.distance >= fenceDist * 0.90) {
      bouncePenalty += 0.6 + Math.random() * 0.6; // +0.6-1.2s
      rollDistance = Math.min(rollDistance + 3, 10);
    }
  }

  // ボールの停止位置（ロール方向に延伸、送球距離計算用）
  const angleRad = (ball.direction - 45) * Math.PI / 180;
  const retrievalPos = {
    x: landing.position.x + rollDistance * Math.sin(angleRad),
    y: landing.position.y + rollDistance * Math.cos(angleRad),
  };

  // 野手の総回収時間
  // ゴロはtimeToReach(経路上での捕球時刻)ベース
  // フライ/ライナーはballArrivalTime + 着地後追加移動 + バウンドペナルティ
  const runSpeedFielder = retriever.speed ?? 6.5;
  const additionalRunTime = distAtLanding / runSpeedFielder;
  const totalFielderTime = landing.isGroundBall
    ? retriever.timeToReach + bouncePenalty + pickupTime
    : retriever.ballArrivalTime + additionalRunTime + bouncePenalty + pickupTime;

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
  if (runnerTo2B < defenseTo2B - 0.3) basesReached = 2; // 走者が余裕を持って進塁できる場合のみ
  if (basesReached >= 2 && runnerTo3B < defenseTo3B - 0.9) basesReached = 3;

  // ゴロでトリプルは現実的でない（3塁打は外野フライ/ライナーのみ）
  if (landing.isGroundBall) basesReached = Math.min(basesReached, 2);

  // 短距離(<25m)に落ちた打球は長打にならない（内野前方/ポップフライ領域）
  if (landing.distance < 25) basesReached = Math.min(basesReached, 1);

  const fielderPos = retriever.position;

  const advTrace: Partial<FieldingTrace["resolution"]> = {
    phase: "hit_advancement",
    bestFielderPos: fielderPos,
    fielderArrival: retriever.timeToReach,
    ballArrival: retriever.ballArrivalTime,
    canReach: retriever.canReach,
    bouncePenalty,
    pickupTime,
    rollDistance,
    totalFielderTime,
    throwTo2B,
    throwTo3B,
    throwSpeed,
    runnerSpeed,
    runnerTo2B,
    runnerTo3B,
    defenseTo2B,
    defenseTo3B,
    basesReached,
    margin2B: defenseTo2B + 1.2 - runnerTo2B,
    margin3B: runnerTo3B - (defenseTo3B - 0.9),
  };

  if (basesReached >= 3) return { result: "triple", fielderPos, trace: advTrace };
  if (basesReached >= 2) return { result: "double", fielderPos, trace: advTrace };
  return { result: "single", fielderPos, trace: advTrace };
}


/** 1打席の結果を決定する（1球ずつシミュレーション） */
function simulateAtBat(
  batter: Player,
  pitcher: Player,
  fielderMap: Map<FielderPosition, Player>,
  bases: BaseRunners,
  outs: number,
  pitcherState?: PitcherGameState,
  batterIndex?: number
): AtBatDetail & { pitchCount: number; buntNewBases?: BaseRunners } {
  const bat = batter.batting;
  let balls = 0;
  let strikes = 0;
  let pitchCount = 0;

  // === 犠牲バント判定（打席開始時、死球より先に判定）===
  const actualBatterIndex = batterIndex ?? 8;
  if (shouldAttemptSacrificeBunt(bases, outs, batter, actualBatterIndex)) {
    // ファウル再試行を最大2回まで許容
    let buntAttempts = 0;
    while (buntAttempts < 3) {
      const buntR = resolveSacrificeBunt(batter, bases);
      pitchCount++;
      if (buntAttempts < 2 && buntR.result === "bunt_out" && Math.random() < 0.40) {
        // ファウル扱い: 再試行
        buntAttempts++;
        continue;
      }
      return {
        result: buntR.result,
        battedBallType: "ground_ball",
        fielderPosition: 1,
        direction: 10 + Math.random() * 60,
        launchAngle: -5,
        exitVelocity: 50 + Math.random() * 30,
        pitchCount,
        buntNewBases: buntR.newBases,
      };
    }
    // 3回目はファウル扱いで通常打席へ
  }

  // === セーフティバント判定 ===
  if (shouldAttemptSafetyBunt(batter)) {
    const safetyR = resolveSafetyBunt(batter, bases);
    pitchCount++;
    return {
      result: safetyR.result,
      battedBallType: "ground_ball",
      fielderPosition: 1,
      direction: 10 + Math.random() * 60,
      launchAngle: -5,
      exitVelocity: 50 + Math.random() * 30,
      pitchCount,
      buntNewBases: safetyR.newBases,
    };
  }

  while (true) {
    // 疲労を考慮した投手能力を取得
    const effPit = pitcherState
      ? getEffectivePitcherAbilities(pitcherState)
      : (() => {
          const pit = pitcher.pitching!;
          const vel = pit.velocity <= 100 ? 120 + (pit.velocity / 100) * 45 : pit.velocity;
          return { velocity: vel, control: pit.control, pitches: pit.pitches, stamina: pit.stamina, mentalToughness: pit.mentalToughness, arm: pit.arm, fielding: pit.fielding, catching: pit.catching };
        })();

    // 死球チェック（ゾーン外投球の低確率）
    if (Math.random() < 0.003) {
      pitchCount++;
      if (pitcherState) {
        pitcherState.currentStamina -= STAMINA_PER_PITCH;
        if (pitcherState.currentStamina < 0) pitcherState.currentStamina = 0;
      }
      return { result: "hitByPitch", battedBallType: null, fielderPosition: null, direction: null, launchAngle: null, exitVelocity: null, pitchCount };
    }

    // ピンチ時の精神力補正: 得点圏走者(2塁 or 3塁)がいる場合にcontrolを補正
    // mentalToughness 50が基準（補正なし）、100で+5ポイント、0で-5ポイント
    const runnersInScoringPosition = bases.second || bases.third;
    const mentalControlBonus = runnersInScoringPosition
      ? (effPit.mentalToughness - 50) * MENTAL_PINCH_CONTROL_FACTOR
      : 0;
    const effectiveControl = clamp(effPit.control + mentalControlBonus, 0, 100);

    // ゾーン内投球率: 制球依存。カウント補正あり
    let zoneRate = 0.35 + (effectiveControl / 100) * 0.30;
    if (strikes > balls) zoneRate -= 0.05;  // 投手有利カウント: ボール球を使いやすい
    if (balls > strikes) zoneRate += 0.05;  // 打者有利カウント: ストライクを取りにいく

    const inZone = Math.random() < zoneRate;

    // スイング判定
    let swings: boolean;
    if (inZone) {
      const swingRate = 0.55 + (bat.eye / 100) * 0.20;
      swings = Math.random() < swingRate;
    } else {
      const chaseRate = 0.40 - (bat.eye / 100) * 0.25;
      swings = Math.random() < chaseRate;
    }

    pitchCount++;
    if (pitcherState) {
      pitcherState.currentStamina -= STAMINA_PER_PITCH;
      if (pitcherState.currentStamina < 0) pitcherState.currentStamina = 0;
    }

    if (swings) {
      // コンタクト率: ミート能力 - 球種レベル依存
      const avgPitchLevel = effPit.pitches.length > 0
        ? effPit.pitches.reduce((s, p) => s + p.level, 0) / effPit.pitches.length
        : 3;
      const contactRate = 0.50 + (bat.contact / 100) * 0.40 - (avgPitchLevel / 7) * 0.15;

      if (Math.random() < contactRate) {
        // コンタクト成功
        const foulRate = 0.40 - (bat.contact / 100) * 0.10;
        if (Math.random() < foulRate) {
          // ファウル
          if (strikes < 2) strikes++;
          // 2ストライク時はファウルでカウント変わらず
        } else {
          // インプレー
          const ball = generateBattedBall(batter, pitcher);
          const landing = calcBallLanding(ball.direction, ball.launchAngle, ball.exitVelocity);
          const runnersInfo = {
            first: !!bases.first,
            second: !!bases.second,
            third: !!bases.third,
          };
          const fieldingResult = evaluateFielders(landing, ball.type, fielderMap, runnersInfo, outs);
          const aiResult = resolvePlayWithAI(ball, landing, fieldingResult, fielderMap, batter, bases, outs);
          return {
            result: aiResult.result,
            battedBallType: ball.type,
            fielderPosition: aiResult.fielderPos,
            direction: ball.direction,
            launchAngle: ball.launchAngle,
            exitVelocity: ball.exitVelocity,
            pitchCount,
            fieldingTrace: aiResult.trace,
          };
        }
      } else {
        // 空振り
        strikes++;
      }
    } else {
      // スイングしなかった
      if (inZone) {
        // 見逃しストライク
        strikes++;
      } else {
        // ボール
        balls++;
      }
    }

    // カウント判定
    if (balls >= 4) {
      return { result: "walk", battedBallType: null, fielderPosition: null, direction: null, launchAngle: null, exitVelocity: null, pitchCount };
    }
    if (strikes >= 3) {
      return { result: "strikeout", battedBallType: null, fielderPosition: null, direction: null, launchAngle: null, exitVelocity: null, pitchCount };
    }
  }
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

/** リリーフ投手を取得 */
function getReliefPitchers(team: Team): Player[] {
  const active = getActivePlayers(team);
  const pitchers = active.filter(p => p.isPitcher);

  // relieverIds があればその順番で返す
  const relieverIds = team.lineupConfig?.relieverIds;
  if (relieverIds && relieverIds.length > 0) {
    const idToPlayer = new Map(pitchers.map(p => [p.id, p]));
    return relieverIds.map(id => idToPlayer.get(id)).filter((p): p is Player => p != null);
  }

  // フォールバック: 旧ロジック
  const rotationIds = new Set(team.lineupConfig?.startingRotation ?? []);
  const relievers = pitchers.filter(p => !rotationIds.has(p.id));
  return relievers.sort((a, b) => {
    const aVal = (a.pitching?.stamina ?? 0) + (a.pitching?.control ?? 0) + (a.pitching?.velocity ?? 0);
    const bVal = (b.pitching?.stamina ?? 0) + (b.pitching?.control ?? 0) + (b.pitching?.velocity ?? 0);
    return bVal - aVal;
  });
}

/** 投手交代が必要か判定（イニング間チェック） */
function shouldChangePitcher(
  pitcherState: PitcherGameState,
  inning: number,
  teamScore: number,
  opponentScore: number,
  team: Team
): boolean {
  const stamina = pitcherState.player.pitching!.stamina;
  const ratio = pitcherState.currentStamina / stamina;
  const isStarter = pitcherState.log.isStarter === true;
  const config = team.lineupConfig;
  const usages = config?.pitcherUsages;
  const usage = usages?.[pitcherState.player.id];
  const leadAmount = teamScore - opponentScore;

  // === リリーフ投手 ===
  if (!isStarter) {
    const maxInn = usage?.maxInnings ?? 1;
    const inningsPitched = pitcherState.log.inningsPitched / 3;
    if (inningsPitched >= maxInn) return true;
    if (ratio <= 0.20) return true;
    return false;
  }

  // === 先発投手 ===
  const policy = usage?.starterPolicy ?? config?.starterUsagePolicy ?? "performance";

  switch (policy) {
    case "complete_game":
      // 完投: スタミナ10%以下 or 自責8以上で交代。8-9回の継投なし
      if (ratio <= 0.10) return true;
      if (pitcherState.log.earnedRuns >= 8) return true;
      return false;

    case "win_eligible":
      // 勝利投手: 5回+リード+スタミナ40%以下、スタミナ20%以下、自責5以上
      if (inning >= 5 && leadAmount > 0 && ratio <= 0.40) return true;
      if (ratio <= 0.20) return true;
      if (pitcherState.log.earnedRuns >= 5) return true;
      break;

    case "stamina_save":
      // スタミナ温存: スタミナ50%以下、自責3以上、6回以降
      if (ratio <= 0.50) return true;
      if (pitcherState.log.earnedRuns >= 3) return true;
      if (inning >= 6) return true;
      break;

    case "opener":
      // オープナー: 1回だけ投げて交代
      if (inning >= 1) return true;
      break;

    case "short_starter":
      // ショートスターター: 打者9人(一巡)で交代、または4回以降
      if (pitcherState.battersFaced >= 9) return true;
      if (inning >= 4) return true;
      break;

    case "performance":
    default:
      // 調子次第(デフォルト): スタミナ30%以下、自責4以上、7回+スタミナ40%以下
      if (ratio <= 0.30) return true;
      if (pitcherState.log.earnedRuns >= 4) return true;
      if (inning >= 7 && ratio <= 0.40) return true;
      break;
  }

  // 8回以降: リード時に守護神/SUへの継投（complete_game以外）
  if (inning >= 8 && leadAmount >= 1 && leadAmount <= 4) {
    if (usages) {
      // 新方式: pitcherUsagesからcloser/close_gameを探す
      const currentId = pitcherState.player.id;
      const hasCloser = Object.entries(usages).some(([id, u]) => u.relieverPolicy === "closer" && id !== currentId);
      const hasSetup = Object.entries(usages).some(([id, u]) =>
        (u.relieverPolicy === "close_game" || u.relieverPolicy === "lead_only") && id !== currentId
      );
      if (inning >= 9 && hasCloser) return true;
      if (inning === 8 && hasSetup) return true;
    } else {
      // 旧方式フォールバック
      const closerId = config?.closerId;
      const setupIds = config?.setupIds ?? [];
      const currentId = pitcherState.player.id;
      if (inning >= 9 && closerId && currentId !== closerId) return true;
      if (inning === 8 && setupIds.length > 0 && !setupIds.includes(currentId)) return true;
    }
  }

  return false;
}

/** 次のリリーフ投手を選択（役割対応版） */
function selectNextPitcher(
  gameState: TeamGameState,
  teamScore: number,
  opponentScore: number,
  inning: number,
  team: Team
): Player | null {
  const config = team.lineupConfig;
  const usages = config?.pitcherUsages;

  const available = gameState.bullpen.filter(p => !gameState.usedPitcherIds.has(p.id));
  if (available.length === 0) return null;

  const leadAmount = teamScore - opponentScore;
  const appearances = config?.pitcherAppearances;

  // 連投制限フィルター: 4連投以上は登板不可
  const isAvailableByFatigue = (p: Player): boolean => {
    if (!appearances) return true;
    const consecutive = appearances[p.id] ?? 0;
    if (consecutive >= 4) return false;
    return true;
  };

  // 連投制限を適用した利用可能投手
  let fresh = available.filter(isAvailableByFatigue);
  // 全員使用不可 → 連投制限を無視して最も連投日数が少ない投手を選択
  if (fresh.length === 0) {
    if (appearances) {
      const sorted = [...available].sort((a, b) =>
        (appearances[a.id] ?? 0) - (appearances[b.id] ?? 0)
      );
      fresh = [sorted[0]];
    } else {
      fresh = available;
    }
  }

  // ヘルパー: ポリシーに一致する利用可能な投手を探す（連投少ない投手を優先）
  const findByPolicy = (...policies: string[]): Player | undefined => {
    if (!usages) return undefined;
    for (const policy of policies) {
      const candidates = fresh.filter(p => usages[p.id]?.relieverPolicy === policy);
      if (candidates.length === 0) continue;
      if (candidates.length === 1) return candidates[0];
      // 連投日数が少ない投手を優先選択（負荷分散）
      if (appearances) {
        candidates.sort((a, b) => (appearances[a.id] ?? 0) - (appearances[b.id] ?? 0));
      }
      return candidates[0];
    }
    return undefined;
  };

  if (usages) {
    // 新方式: pitcherUsages ベース

    // 9回 + リード1-3点 → closer
    if (inning >= 9 && leadAmount >= 1 && leadAmount <= 3) {
      const closer = findByPolicy("closer");
      if (closer) return closer;
    }

    // 8回 + リード1-4点 → lead_only or close_game
    if (inning >= 8 && leadAmount >= 1 && leadAmount <= 4) {
      const setup = findByPolicy("lead_only", "close_game");
      if (setup) return setup;
    }

    // 5-7回 + リード → close_game or behind_ok
    if (inning >= 5 && inning <= 7 && leadAmount >= 1) {
      const mid = findByPolicy("close_game", "behind_ok");
      if (mid) return mid;
    }

    // ビハインド1-2点 → behind_ok
    if (leadAmount >= -2 && leadAmount < 0) {
      const behind = findByPolicy("behind_ok", "mop_up");
      if (behind) return behind;
    }

    // 大量ビハインド or 大量リード → mop_up
    if (leadAmount < -2 || leadAmount >= 5) {
      const mop = findByPolicy("mop_up", "behind_ok");
      if (mop) return mop;
    }

    // フォールバック: closer以外の先頭
    const nonCloser = fresh.find(p => usages[p.id]?.relieverPolicy !== "closer");
    return nonCloser ?? fresh[0];
  }

  // === 旧方式フォールバック ===
  const closerId = config?.closerId;
  const setupIds = new Set(config?.setupIds ?? []);

  if (inning >= 9 && leadAmount >= 1 && leadAmount <= 3 && closerId) {
    const closer = fresh.find(p => p.id === closerId);
    if (closer) return closer;
  }

  if (inning >= 8 && leadAmount >= 1 && leadAmount <= 4) {
    const setup = fresh.find(p => setupIds.has(p.id));
    if (setup) return setup;
  }

  if (inning >= 5 && inning <= 7 && leadAmount >= 1 && leadAmount <= 3) {
    const midReliever = fresh.find(p => p.id !== closerId && !setupIds.has(p.id));
    if (midReliever) return midReliever;
  }

  if (leadAmount < 0) {
    const lowPriority = fresh.filter(p => p.id !== closerId && !setupIds.has(p.id));
    if (lowPriority.length > 0) return lowPriority[lowPriority.length - 1];
    return fresh[fresh.length - 1];
  }

  if (leadAmount >= 5) {
    const lowPriority = fresh.filter(p => p.id !== closerId && !setupIds.has(p.id));
    if (lowPriority.length > 0) return lowPriority[lowPriority.length - 1];
    return fresh[fresh.length - 1];
  }

  return fresh[0];
}

/** 投手交代を実行 */
function changePitcher(gameState: TeamGameState, newPitcher: Player): void {
  gameState.currentPitcher.log.pitchCount = gameState.currentPitcher.pitchCount;
  gameState.pitcherLogs.push(gameState.currentPitcher.log);

  gameState.usedPitcherIds.add(newPitcher.id);
  gameState.currentPitcher = {
    player: newPitcher,
    log: {
      playerId: newPitcher.id,
      inningsPitched: 0,
      hits: 0,
      earnedRuns: 0,
      walks: 0,
      strikeouts: 0,
      homeRunsAllowed: 0,
      pitchCount: 0,
      isStarter: false,
    },
    pitchCount: 0,
    currentStamina: newPitcher.pitching!.stamina,
    battersFaced: 0,
  };
}

/**
 * 勝利/敗戦投手を判定
 * 先発が5回以上投げてチームが勝った場合は先発に勝利、
 * それ以外はリードが最後に変わった時点の投手を判定する
 */
function determineWinLossPitcher(
  innings: InningScore[],
  homePitcherPerInning: string[],
  awayPitcherPerInning: string[],
  allHomeLogs: PitcherGameLog[],
  allAwayLogs: PitcherGameLog[],
  homeScore: number,
  awayScore: number,
): { winningPitcherId: string | null; losingPitcherId: string | null } {
  if (homeScore === awayScore) return { winningPitcherId: null, losingPitcherId: null };

  const homeWins = homeScore > awayScore;

  let cumHome = 0;
  let cumAway = 0;
  let lastGoAheadInning = 0;

  for (let i = 0; i < innings.length; i++) {
    const prevHome = cumHome;
    const prevAway = cumAway;
    cumAway += innings[i].top;
    cumHome += innings[i].bottom;

    if (homeWins) {
      if (cumHome > cumAway && prevHome <= prevAway) {
        lastGoAheadInning = i;
      }
    } else {
      if (cumAway > cumHome && prevAway <= prevHome) {
        lastGoAheadInning = i;
      }
    }
  }

  let winPitcherId: string | null = null;
  let losePitcherId: string | null = null;

  if (homeWins) {
    winPitcherId = homePitcherPerInning[lastGoAheadInning] ?? null;
    losePitcherId = awayPitcherPerInning[lastGoAheadInning] ?? null;

    const homeStarter = allHomeLogs.find(l => l.isStarter);
    if (homeStarter && homeStarter.inningsPitched >= 15) {
      // 先発が5回以上投球した場合: 先発が降板時点でリードしていた場合のみ勝利投手
      const starterLastInning = homePitcherPerInning.lastIndexOf(homeStarter.playerId);
      if (starterLastInning >= 0) {
        let homeAtEnd = 0, awayAtEnd = 0;
        for (let i = 0; i <= starterLastInning; i++) {
          awayAtEnd += innings[i].top;
          homeAtEnd += innings[i].bottom;
        }
        if (homeAtEnd > awayAtEnd) {
          winPitcherId = homeStarter.playerId;
        }
      }
    }
  } else {
    winPitcherId = awayPitcherPerInning[lastGoAheadInning] ?? null;
    losePitcherId = homePitcherPerInning[lastGoAheadInning] ?? null;

    const awayStarter = allAwayLogs.find(l => l.isStarter);
    if (awayStarter && awayStarter.inningsPitched >= 15) {
      // 先発が5回以上投球した場合: 先発が降板時点でリードしていた場合のみ勝利投手
      const starterLastInning = awayPitcherPerInning.lastIndexOf(awayStarter.playerId);
      if (starterLastInning >= 0) {
        let homeAtEnd = 0, awayAtEnd = 0;
        for (let i = 0; i <= starterLastInning; i++) {
          awayAtEnd += innings[i].top;
          homeAtEnd += innings[i].bottom;
        }
        if (awayAtEnd > homeAtEnd) {
          winPitcherId = awayStarter.playerId;
        }
      }
    }
  }

  return { winningPitcherId: winPitcherId, losingPitcherId: losePitcherId };
}

/** セーブ判定（NPB準拠） */
function determineSavePitcher(
  allLogs: PitcherGameLog[],
  winningPitcherId: string | null,
  finalLeadAmount: number,
  lastPitcherId: string,
): string | null {
  if (!winningPitcherId) return null;

  // 勝利投手ではない
  if (lastPitcherId === winningPitcherId) return null;

  // チーム最後の投手のログ
  const lastLog = allLogs.find(l => l.playerId === lastPitcherId);
  if (!lastLog) return null;

  // 1/3イニング（アウト1つ）以上投球
  if (lastLog.inningsPitched < 1) return null;

  // リードを守り切って試合終了
  if (finalLeadAmount <= 0) return null;

  // 最終スコア差3以内 or 3イニング（9アウト）以上投球
  if (finalLeadAmount <= 3 || lastLog.inningsPitched >= 9) {
    return lastPitcherId;
  }

  return null;
}

/** ホールド判定（NPB準拠） */
function determineHoldPitchers(
  allLogs: PitcherGameLog[],
  winningPitcherId: string | null,
  losingPitcherId: string | null,
  savePitcherId: string | null,
): string[] {
  const holdPitcherIds: string[] = [];

  for (const log of allLogs) {
    // 先発/勝利/敗戦/セーブ投手は除外
    if (log.isStarter) continue;
    if (log.playerId === winningPitcherId) continue;
    if (log.playerId === losingPitcherId) continue;
    if (log.playerId === savePitcherId) continue;

    // アウト1つ以上記録
    if (log.inningsPitched < 1) continue;

    // 自責点2以下（リードを保護して降板）
    if (log.earnedRuns <= 2) {
      holdPitcherIds.push(log.playerId);
    }
  }

  return holdPitcherIds;
}

/** 捕手を取得 (1軍の position === "C" の選手、いなければ1軍の最初の選手) */
function getCatcher(team: Team): Player {
  const active = getActivePlayers(team);
  return active.find((p) => p.position === "C") || active[0];
}

/** ベンチの野手（出場中でも交代済みでもない）を取得 */
function getAvailableBenchBatters(
  team: Team,
  lineupBatterIds: string[],
  usedBatterIds: Set<string>
): Player[] {
  const active = getActivePlayers(team);
  const lineupSet = new Set(lineupBatterIds);
  return active.filter(
    (p) => !p.isPitcher && !lineupSet.has(p.id) && !usedBatterIds.has(p.id)
  );
}

/** 代打選手を選択する（8回以降・ビハインド時に現打者より能力が高い選手を起用） */
function selectPinchHitter(
  currentBatter: Player,
  team: Team,
  lineupBatterIds: string[],
  usedBatterIds: Set<string>,
  inning: number,
  teamScore: number,
  opponentScore: number
): Player | null {
  // 8回以降かつビハインドの場合のみ
  if (inning < 8) return null;
  if (teamScore >= opponentScore) return null;

  const bench = getAvailableBenchBatters(team, lineupBatterIds, usedBatterIds);
  if (bench.length === 0) return null;

  const currentPower = currentBatter.batting.contact + currentBatter.batting.power;
  const best = bench.reduce((acc, p) => {
    const val = p.batting.contact + p.batting.power;
    return val > acc.batting.contact + acc.batting.power ? p : acc;
  }, bench[0]);

  // ベンチ最強打者が現打者より能力が高い場合のみ交代
  if (best.batting.contact + best.batting.power <= currentPower) return null;
  return best;
}

/** 代走選手を選択する（7回以降・僅差時に走者より走力が大幅に高い選手を起用） */
function selectPinchRunner(
  runner: Player,
  team: Team,
  lineupBatterIds: string[],
  usedBatterIds: Set<string>,
  inning: number,
  teamScore: number,
  opponentScore: number
): Player | null {
  // 7回以降かつ点差3以内の場合のみ
  if (inning < 7) return null;
  if (Math.abs(teamScore - opponentScore) > 3) return null;

  const bench = getAvailableBenchBatters(team, lineupBatterIds, usedBatterIds);
  if (bench.length === 0) return null;

  const fastest = bench.reduce((acc, p) => {
    return p.batting.speed > acc.batting.speed ? p : acc;
  }, bench[0]);

  // 走力差20以上ある場合のみ交代
  if (fastest.batting.speed < runner.batting.speed + 20) return null;
  return fastest;
}

/** 1軍選手のみ取得（故障中の選手は除外） */
function getActivePlayers(team: Team): Player[] {
  const roster = !team.rosterLevels
    ? team.roster
    : team.roster.filter(
        (p) => !team.rosterLevels || team.rosterLevels[p.id] === "ichi_gun"
      );
  return roster.filter((p) => !p.injury);
}

const MINOR_INJURIES = ["軽い打撲", "筋肉痛", "指のまめ", "軽い捻挫", "デッドボールの痛み"];
const MODERATE_INJURIES = ["肉離れ", "靭帯損傷", "骨折（軽度）", "肩の炎症", "腰痛"];
const SEVERE_INJURIES = ["前十字靭帯断裂", "アキレス腱断裂", "肩関節手術", "椎間板ヘルニア"];

const INJURY_RATE = 0.0015;

function generateInjury(remainingSeasonDays: number): Injury {
  const roll = Math.random();
  if (roll < 0.70) {
    const desc = MINOR_INJURIES[Math.floor(Math.random() * MINOR_INJURIES.length)];
    return { type: 'minor', daysRemaining: 7 + Math.floor(Math.random() * 8), description: desc };
  } else if (roll < 0.95) {
    const desc = MODERATE_INJURIES[Math.floor(Math.random() * MODERATE_INJURIES.length)];
    return { type: 'moderate', daysRemaining: 30 + Math.floor(Math.random() * 31), description: desc };
  } else {
    const desc = SEVERE_INJURIES[Math.floor(Math.random() * SEVERE_INJURIES.length)];
    return { type: 'severe', daysRemaining: Math.max(remainingSeasonDays, 1), description: desc };
  }
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

/** 守備固め: 8回以降・リード時にfielding差15以上のベンチ選手と交代（最大2人） */
function applyDefensiveReplacements(
  state: TeamGameState,
  team: Team,
  teamScore: number,
  opponentScore: number,
  inning: number
): void {
  // 8回以降かつリード中の場合のみ
  if (inning < 8) return;
  if (teamScore <= opponentScore) return;

  const usedBatterIds = state.usedBatterIds ?? new Set<string>();
  const lineupIds = state.batters.map((p) => p.id);
  const bench = getAvailableBenchBatters(team, lineupIds, usedBatterIds);
  if (bench.length === 0) return;

  let replacements = 0;
  const maxReplacements = 2;

  for (let lineupIdx = 0; lineupIdx < state.batters.length && replacements < maxReplacements; lineupIdx++) {
    const current = state.batters[lineupIdx];
    // 投手は対象外
    if (current.isPitcher) continue;

    // 同じポジションかつfielding差15以上のベンチ選手を探す
    let bestCandidate: Player | null = null;
    let bestDiff = 15; // 最低差分の閾値

    for (const candidate of bench) {
      if (candidate.position !== current.position) continue;
      if (usedBatterIds.has(candidate.id)) continue;
      const diff = candidate.batting.fielding - current.batting.fielding;
      if (diff >= bestDiff) {
        bestDiff = diff;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      // 元の選手をusedBatterIdsに追加
      usedBatterIds.add(current.id);
      // 打順を守備固め選手に置き換え
      state.batters[lineupIdx] = bestCandidate;
      // 使用済みからも除去（ベンチから出た選手は追跡不要）
      bench.splice(bench.indexOf(bestCandidate), 1);
      replacements++;
    }
  }

  // usedBatterIdsをstateに反映
  if (!state.usedBatterIds) {
    state.usedBatterIds = usedBatterIds;
  }
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
  defensiveState: TeamGameState,
  fieldingTeam: Player[],
  batterIndex: number,
  batterStatsMap: Map<string, PlayerGameStats>,
  options?: SimulateGameOptions,
  atBatLogs?: AtBatLog[],
  inning?: number,
  halfInning?: "top" | "bottom",
  defensiveTeam?: Team,
  teamScore?: number,
  opponentScore?: number,
  attackingTeam?: Team,
  attackingState?: TeamGameState,
  remainingSeasonDays?: number,
): { runs: number; hits: number; nextBatterIndex: number; injuries: Array<{ playerId: string; injury: Injury }> } {
  let outs = 0;
  let runs = 0;
  let hits = 0;
  let bases: BaseRunners = { first: null, second: null, third: null };
  let idx = batterIndex;
  let inningRuns = 0;
  const halfInningInjuries: Array<{ playerId: string; injury: Injury }> = [];

  // 攻撃側のusedBatterIdsを参照（代打・代走の管理）
  const usedBatterIds = attackingState?.usedBatterIds ?? new Set<string>();

  // イニング内の投手交代追跡: 最後に交代したタイミングのアウト数
  let outsAtLastPitcherChange = 0;

  let fielderMap = buildFielderMap(fieldingTeam, defensiveState.currentPitcher.player, defensiveState.fullRoster);

  while (outs < 3) {
    // 盗塁試行 (打席前)
    if (bases.first || bases.second) {
      const stealResult = attemptStolenBases(bases, outs, defensiveState.catcher, batterStatsMap, fielderMap);
      bases = stealResult.bases;
      outs += stealResult.additionalOuts;
      if (outs >= 3) break;
    }

    let batter = battingTeam[idx % battingTeam.length];

    // === 代打判定 ===
    if (attackingTeam && attackingState && inning != null && teamScore != null && opponentScore != null) {
      const currentLineupIds = battingTeam.map((p) => p.id);
      const pinchHitter = selectPinchHitter(
        batter, attackingTeam, currentLineupIds, usedBatterIds,
        inning, teamScore + runs, opponentScore
      );
      if (pinchHitter) {
        // 元の打者をusedBatterIdsに追加（再出場不可）
        usedBatterIds.add(batter.id);
        // 打順の該当箇所を代打選手に置き換え
        const lineupIdx = idx % battingTeam.length;
        battingTeam[lineupIdx] = pinchHitter;
        batter = pinchHitter;
        // 代打選手の出場記録を初期化
        getOrCreateBatterStats(batterStatsMap, pinchHitter.id);
      }
    }
    const outsBeforeAtBat = outs;
    const basesBeforeAtBat: [boolean, boolean, boolean] = [
      bases.first !== null,
      bases.second !== null,
      bases.third !== null,
    ];

    // 打席開始時の投手を取得（その打席の結果はこの投手に記録する）
    const pitcherState = defensiveState.currentPitcher;
    const pitcher = pitcherState.player;
    const pitcherLog = pitcherState.log;

    const detail = simulateAtBat(batter, pitcher, fielderMap, bases, outs, pitcherState, idx % battingTeam.length);
    // 投球数をpitcherStateに累積
    pitcherState.pitchCount += detail.pitchCount;
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
        pitcherLog.flyBallOuts = (pitcherLog.flyBallOuts ?? 0) + 1;
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
        inningRuns += sfScored;
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
          inningRuns += scored;
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
          inningRuns += scored;
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
        pitcherLog.groundBallOuts = (pitcherLog.groundBallOuts ?? 0) + 1;
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
        inningRuns += fcScored;
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
        inningRuns += errScored;
        // エラーによる失点は自責点に含まない
        for (const runner of errAdvance.scoredRunners) {
          getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
        }
        break;
      }

      case "sacrifice_bunt": {
        // 犠打: 打数カウントなし、アウト+1、走者進塁
        outs++;
        bs.sacrificeBunts = (bs.sacrificeBunts ?? 0) + 1;
        pitcherLog.sacrificeBuntsAllowed = (pitcherLog.sacrificeBuntsAllowed ?? 0) + 1;
        // 守備記録: 投手(P)にA、一塁手(1B)にPO
        recordFielding(batterStatsMap, fielderMap, 1, "assist");
        recordFielding(batterStatsMap, fielderMap, 3, "putOut");
        // 走者進塁（3塁走者の生還を処理）
        const sbNewBases = detail.buntNewBases ?? bases;
        // 3塁走者が生還したかを判定: 元の3塁に走者がいて、新しい3塁にいない場合
        if (bases.third && !sbNewBases.third && sbNewBases.second !== bases.third && sbNewBases.first !== bases.third) {
          const scorer = bases.third;
          getOrCreateBatterStats(batterStatsMap, scorer.id).runs++;
          runs += 1;
          inningRuns += 1;
          bs.rbi += 1;
          pitcherLog.earnedRuns += 1;
        }
        bases = sbNewBases;
        break;
      }

      case "bunt_hit": {
        // バントヒット: 安打扱い
        bs.atBats++;
        bs.hits++;
        hits++;
        pitcherLog.hits++;
        const bhNewBases = detail.buntNewBases ?? bases;
        // 3塁走者の生還判定
        if (bases.third && !bhNewBases.third && bhNewBases.second !== bases.third && bhNewBases.first !== bases.third) {
          const scorer = bases.third;
          getOrCreateBatterStats(batterStatsMap, scorer.id).runs++;
          runs += 1;
          inningRuns += 1;
          bs.rbi += 1;
          pitcherLog.earnedRuns += 1;
        }
        bases = bhNewBases;
        break;
      }

      case "bunt_out": {
        // バント失敗: 打者アウト、打数にカウント
        outs++;
        bs.atBats++;
        // 守備記録: 投手(P)にA、一塁手(1B)にPO
        recordFielding(batterStatsMap, fielderMap, 1, "assist");
        recordFielding(batterStatsMap, fielderMap, 3, "putOut");
        bases = detail.buntNewBases ?? bases;
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
        inningRuns += hitScored;
        bs.rbi += hitScored;
        pitcherLog.earnedRuns += hitScored;
        for (const runner of hitAdvance.scoredRunners) {
          getOrCreateBatterStats(batterStatsMap, runner.id).runs++;
        }
        break;
      }
    }

    // === 代走判定: 出塁した打者またはすでにいる走者に代走を送る ===
    if (attackingTeam && attackingState && inning != null && teamScore != null && opponentScore != null) {
      const currentLineupIds = battingTeam.map((p) => p.id);
      const tryPinchRun = (runner: Player | null, baseKey: keyof BaseRunners): void => {
        if (!runner) return;
        const pr = selectPinchRunner(
          runner, attackingTeam, currentLineupIds, usedBatterIds,
          inning, teamScore + runs, opponentScore
        );
        if (pr) {
          // 元の走者をusedBatterIdsに追加
          usedBatterIds.add(runner.id);
          // 塁上の走者を代走選手に置き換え
          (bases as unknown as Record<string, Player | null>)[baseKey] = pr;
          // 打順も置き換え（代走選手が元の走者の打順に入る）
          const runnerLineupIdx = battingTeam.findIndex((p) => p.id === runner.id);
          if (runnerLineupIdx >= 0) {
            battingTeam[runnerLineupIdx] = pr;
          }
          // 代走選手の出場記録を初期化
          getOrCreateBatterStats(batterStatsMap, pr.id);
        }
      };
      // 1塁・2塁の走者を対象（3塁は次打者の打席で生還可能性高いため省略）
      tryPinchRun(bases.first, "first");
      tryPinchRun(bases.second, "second");
    }

    // サヨナラ判定: 9回以降の裏、攻撃チーム(home)がリードを取ったら即終了
    if (halfInning === "bottom" && (inning ?? 0) >= 9 && teamScore != null && opponentScore != null) {
      if (opponentScore + runs > teamScore) {
        defensiveState.currentPitcher.log.inningsPitched += (outs - outsAtLastPitcherChange);
        idx++;
        return { runs, hits, nextBatterIndex: idx, injuries: halfInningInjuries };
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
      let dist = (detail.exitVelocity != null && detail.launchAngle != null)
        ? estimateDistance(detail.exitVelocity, detail.launchAngle)
        : null;
      // ゴロ: 放物線公式は不正確なので、実際の着地距離(地面転がりモデル)を使用
      if (detail.battedBallType === "ground_ball" && detail.fieldingTrace?.landing?.distance != null) {
        dist = detail.fieldingTrace.landing.distance;
      }
      // フライ系打球にはcarryFactorを適用（表示飛距離とHR判定飛距離を一致させる）
      // 急角度ではキャリー減衰（HR判定と同一ロジック）
      if (dist !== null && (detail.battedBallType === "fly_ball" || detail.battedBallType === "popup")) {
        const traj = batter.batting.trajectory ?? 2;
        let cf = TRAJECTORY_CARRY_FACTORS[Math.min(3, Math.max(0, traj - 1))];
        if (detail.launchAngle != null && detail.launchAngle > 35) {
          const taper = Math.max(0, 1 - (detail.launchAngle - 35) / 15);
          cf = 1 + (cf - 1) * taper;
        }
        dist = dist * cf;
      }
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
        pitchCountInAtBat: detail.pitchCount,
        fieldingTrace: detail.fieldingTrace,
      });
    }

    // === 故障発生判定（インプレー結果後のみ） ===
    if (
      remainingSeasonDays != null &&
      detail.battedBallType !== null &&
      !batter.injury &&
      Math.random() < INJURY_RATE
    ) {
      const newInjury = generateInjury(remainingSeasonDays);
      halfInningInjuries.push({ playerId: batter.id, injury: newInjury });
    }

    idx++;
    defensiveState.currentPitcher.battersFaced++;

    // === イニング途中の投手交代判定 ===
    if (defensiveTeam && teamScore != null && opponentScore != null && outs < 3) {
      const currentPitcher = defensiveState.currentPitcher;
      const staminaRatio = currentPitcher.currentStamina / currentPitcher.player.pitching!.stamina;

      let shouldChangeMidInning = false;

      // リリーフのmaxInnings到達チェック
      if (!currentPitcher.log.isStarter) {
        const usage = defensiveTeam.lineupConfig?.pitcherUsages?.[currentPitcher.player.id];
        const maxInn = usage?.maxInnings ?? 1;
        const inningsPitched = currentPitcher.log.inningsPitched / 3;
        if (inningsPitched >= maxInn) shouldChangeMidInning = true;
      }

      // そのイニング3失点以上 + 1アウト以下
      if (inningRuns >= 3 && outs < 2) shouldChangeMidInning = true;

      // 満塁 + 0アウト + スタミナ30%以下
      if (bases.first && bases.second && bases.third && outs === 0 && staminaRatio <= 0.30) shouldChangeMidInning = true;

      // スタミナ10%以下（即時交代）
      if (staminaRatio <= 0.10) shouldChangeMidInning = true;

      if (shouldChangeMidInning) {
        const next = selectNextPitcher(defensiveState, teamScore, opponentScore + runs, inning ?? 1, defensiveTeam);
        if (next) {
          // 交代前の投手のイニング内アウト数を記録
          defensiveState.currentPitcher.log.inningsPitched += (outs - outsAtLastPitcherChange);
          changePitcher(defensiveState, next);
          // 新投手のfielderMapを再構築
          fielderMap = buildFielderMap(fieldingTeam, defensiveState.currentPitcher.player, defensiveState.fullRoster);
          outsAtLastPitcherChange = outs;
          inningRuns = 0;
        }
      }
    }
  }

  // イニング終了: 最後の投手の残りアウト分を記録
  defensiveState.currentPitcher.log.inningsPitched += (3 - outsAtLastPitcherChange);

  return { runs, hits, nextBatterIndex: idx, injuries: halfInningInjuries };
}

export interface SimulateGameOptions {
  collectAtBatLogs?: boolean;
  remainingSeasonDays?: number;
}

/**
 * 1試合をシミュレートする
 * @returns GameResult
 */
export function simulateGame(homeTeam: Team, awayTeam: Team, options?: SimulateGameOptions): GameResult {
  const homePitcher = getStartingPitcher(homeTeam);
  const awayPitcher = getStartingPitcher(awayTeam);

  const batterStatsMap = new Map<string, PlayerGameStats>();

  const homeState: TeamGameState = {
    batters: getBattingOrder(homeTeam),
    batterIndex: 0,
    currentPitcher: {
      player: homePitcher,
      log: {
        playerId: homePitcher.id,
        inningsPitched: 0,
        hits: 0,
        earnedRuns: 0,
        walks: 0,
        strikeouts: 0,
        homeRunsAllowed: 0,
        pitchCount: 0,
        isStarter: true,
      },
      pitchCount: 0,
      currentStamina: homePitcher.pitching!.stamina,
      battersFaced: 0,
    },
    bullpen: getReliefPitchers(homeTeam),
    usedPitcherIds: new Set([homePitcher.id]),
    pitcherLogs: [],
    catcher: getCatcher(homeTeam),
    fullRoster: getActivePlayers(homeTeam),
    usedBatterIds: new Set<string>(),
  };

  const awayState: TeamGameState = {
    batters: getBattingOrder(awayTeam),
    batterIndex: 0,
    currentPitcher: {
      player: awayPitcher,
      log: {
        playerId: awayPitcher.id,
        inningsPitched: 0,
        hits: 0,
        earnedRuns: 0,
        walks: 0,
        strikeouts: 0,
        homeRunsAllowed: 0,
        pitchCount: 0,
        isStarter: true,
      },
      pitchCount: 0,
      currentStamina: awayPitcher.pitching!.stamina,
      battersFaced: 0,
    },
    bullpen: getReliefPitchers(awayTeam),
    usedPitcherIds: new Set([awayPitcher.id]),
    pitcherLogs: [],
    catcher: getCatcher(awayTeam),
    fullRoster: getActivePlayers(awayTeam),
    usedBatterIds: new Set<string>(),
  };

  const innings: InningScore[] = [];
  let homeScore = 0;
  let awayScore = 0;
  const atBatLogs: AtBatLog[] = [];
  const gameInjuries: Array<{ playerId: string; injury: Injury }> = [];
  const rsd = options?.remainingSeasonDays;

  // 各イニングの守備投手を追跡（勝敗投手判定用）
  const homePitcherPerInning: string[] = [];
  const awayPitcherPerInning: string[] = [];

  // 9イニング
  for (let i = 0; i < 9; i++) {
    homePitcherPerInning.push(homeState.currentPitcher.player.id);

    // 表 (アウェイ攻撃 → ホーム守備)
    const topResult = simulateHalfInning(
      awayState.batters, homeState, homeState.batters,
      awayState.batterIndex, batterStatsMap,
      options, atBatLogs, i + 1, "top",
      homeTeam, homeScore, awayScore,
      awayTeam, awayState, rsd
    );
    awayScore += topResult.runs;
    awayState.batterIndex = topResult.nextBatterIndex;
    gameInjuries.push(...topResult.injuries);

    // 裏 (ホーム攻撃 → アウェイ守備)
    let bottomRuns = 0;
    awayPitcherPerInning.push(awayState.currentPitcher.player.id);
    if (!(i === 8 && homeScore > awayScore)) {
      const bottomResult = simulateHalfInning(
        homeState.batters, awayState, awayState.batters,
        homeState.batterIndex, batterStatsMap,
        options, atBatLogs, i + 1, "bottom",
        awayTeam, awayScore, homeScore,
        homeTeam, homeState, rsd
      );
      bottomRuns = bottomResult.runs;
      homeScore += bottomRuns;
      homeState.batterIndex = bottomResult.nextBatterIndex;
      gameInjuries.push(...bottomResult.injuries);
    }

    innings.push({ top: topResult.runs, bottom: bottomRuns });

    if (i === 8 && homeScore > awayScore) break;

    // イニング間の投手交代判定
    if (shouldChangePitcher(homeState.currentPitcher, i + 1, homeScore, awayScore, homeTeam)) {
      const next = selectNextPitcher(homeState, homeScore, awayScore, i + 2, homeTeam);
      if (next) changePitcher(homeState, next);
    }
    if (shouldChangePitcher(awayState.currentPitcher, i + 1, awayScore, homeScore, awayTeam)) {
      const next = selectNextPitcher(awayState, awayScore, homeScore, i + 2, awayTeam);
      if (next) changePitcher(awayState, next);
    }

    // イニング間の守備固め判定（次のイニングに備える）
    applyDefensiveReplacements(homeState, homeTeam, homeScore, awayScore, i + 2);
    applyDefensiveReplacements(awayState, awayTeam, awayScore, homeScore, i + 2);
  }

  // 延長 (最大12回まで)
  while (homeScore === awayScore && innings.length < 12) {
    const extInning = innings.length + 1;

    homePitcherPerInning.push(homeState.currentPitcher.player.id);
    const topResult = simulateHalfInning(
      awayState.batters, homeState, homeState.batters,
      awayState.batterIndex, batterStatsMap,
      options, atBatLogs, extInning, "top",
      homeTeam, homeScore, awayScore,
      awayTeam, awayState, rsd
    );
    awayScore += topResult.runs;
    awayState.batterIndex = topResult.nextBatterIndex;
    gameInjuries.push(...topResult.injuries);

    awayPitcherPerInning.push(awayState.currentPitcher.player.id);
    const bottomResult = simulateHalfInning(
      homeState.batters, awayState, awayState.batters,
      homeState.batterIndex, batterStatsMap,
      options, atBatLogs, extInning, "bottom",
      awayTeam, awayScore, homeScore,
      homeTeam, homeState, rsd
    );
    homeScore += bottomResult.runs;
    homeState.batterIndex = bottomResult.nextBatterIndex;
    gameInjuries.push(...bottomResult.injuries);

    innings.push({ top: topResult.runs, bottom: bottomResult.runs });

    // 延長中の投手交代判定（同点継続時のみ）
    if (homeScore === awayScore) {
      if (shouldChangePitcher(homeState.currentPitcher, extInning, homeScore, awayScore, homeTeam)) {
        const next = selectNextPitcher(homeState, homeScore, awayScore, extInning + 1, homeTeam);
        if (next) changePitcher(homeState, next);
      }
      if (shouldChangePitcher(awayState.currentPitcher, extInning, awayScore, homeScore, awayTeam)) {
        const next = selectNextPitcher(awayState, awayScore, homeScore, extInning + 1, awayTeam);
        if (next) changePitcher(awayState, next);
      }
    }
  }

  // 全投手ログを収集
  homeState.currentPitcher.log.pitchCount = homeState.currentPitcher.pitchCount;
  awayState.currentPitcher.log.pitchCount = awayState.currentPitcher.pitchCount;
  const allHomeLogs = [...homeState.pitcherLogs, homeState.currentPitcher.log];
  const allAwayLogs = [...awayState.pitcherLogs, awayState.currentPitcher.log];

  // 勝敗投手判定
  const { winningPitcherId, losingPitcherId } = determineWinLossPitcher(
    innings, homePitcherPerInning, awayPitcherPerInning,
    allHomeLogs, allAwayLogs, homeScore, awayScore
  );

  // セーブ判定
  let savePitcherId: string | null = null;
  if (homeScore !== awayScore) {
    if (homeScore > awayScore) {
      savePitcherId = determineSavePitcher(
        allHomeLogs, winningPitcherId, homeScore - awayScore,
        homeState.currentPitcher.player.id
      );
    } else {
      savePitcherId = determineSavePitcher(
        allAwayLogs, winningPitcherId, awayScore - homeScore,
        awayState.currentPitcher.player.id
      );
    }
  }

  // ホールド判定
  const homeHolds = determineHoldPitchers(
    allHomeLogs, winningPitcherId, losingPitcherId, savePitcherId
  );
  const awayHolds = determineHoldPitchers(
    allAwayLogs, winningPitcherId, losingPitcherId, savePitcherId
  );
  const holdPitcherIds = [...homeHolds, ...awayHolds];

  // 打者の出場試合数を記録
  for (const stats of batterStatsMap.values()) {
    (stats as PlayerGameStats & { games?: number }).games = 1;
  }

  return {
    homeScore,
    awayScore,
    innings,
    winningPitcherId,
    losingPitcherId,
    savePitcherId,
    holdPitcherIds,
    playerStats: Array.from(batterStatsMap.values()),
    pitcherStats: [...allHomeLogs, ...allAwayLogs],
    atBatLogs: options?.collectAtBatLogs ? atBatLogs : undefined,
    injuries: gameInjuries.length > 0 ? gameInjuries : undefined,
  };
}

