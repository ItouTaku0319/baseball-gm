import type { Team } from "@/models/team";
import type { GameResult, InningScore, PlayerGameStats, PitcherGameLog } from "@/models/league";
import type { Player, PitchRepertoire } from "@/models/player";

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
  pitcher: Player
): Map<FielderPosition, Player> {
  const map = new Map<FielderPosition, Player>();
  map.set(1, pitcher);

  const posMap: Record<string, FielderPosition> = {
    C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9,
  };

  for (const player of fieldingTeam) {
    const pos = posMap[player.position];
    if (pos !== undefined && !map.has(pos)) {
      map.set(pos, player);
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

/** 打球角度と速度から打球タイプを分類する */
export function classifyBattedBallType(launchAngle: number, exitVelocity: number): BattedBallType {
  if (launchAngle >= 50) return "popup";
  if (launchAngle < 5) return "ground_ball";
  if (launchAngle < 20) {
    if (exitVelocity < 100) return "ground_ball";
    return "line_drive";
  }
  return "fly_ball";
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
  const exitVelocity = clamp(gaussianRandom(velMean - breakingPenalty, 18), 80, 185);

  // --- 4. 打球タイプ分類 (後方互換) ---
  const type = classifyBattedBallType(launchAngle, exitVelocity);

  return { direction, launchAngle, exitVelocity, type };
}

/** 内野手をゾーンベースで決定 */
function assignInfielder(direction: number, exitVelocity: number): FielderPosition {
  // 投手は低速ゴロのみ（ピッチャー返し）
  if (direction > 30 && direction < 60 && exitVelocity < 110) {
    if (Math.random() < 0.12) return 1;
  }

  const noise = gaussianRandom(0, 5);
  const adj = direction + noise;

  if (adj < 18) return 5;       // 3B
  if (adj < 40) return 6;       // SS
  if (adj < 55) return 4;       // 2B
  return 3;                     // 1B
}

/** 外野手をゾーンベースで決定 */
function assignOutfielder(direction: number): FielderPosition {
  const noise = gaussianRandom(0, 4);
  const adj = direction + noise;

  if (adj < 30) return 7;    // LF
  if (adj < 60) return 8;    // CF
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

/** 打球物理データからフィールダーを決定する */
export function determineFielderFromBall(ball: BattedBall): FielderPosition {
  if (ball.type === "popup") {
    return assignPopupFielder(ball.direction);
  }

  if (ball.type === "fly_ball") {
    return assignOutfielder(ball.direction);
  }

  if (ball.type === "ground_ball") {
    return assignInfielder(ball.direction, ball.exitVelocity);
  }

  // ライナー: 方向と速度で内野/外野を振り分け
  if (ball.exitVelocity > 140 || ball.launchAngle > 14) {
    return assignOutfielder(ball.direction);
  }
  return assignInfielder(ball.direction, ball.exitVelocity);
}

/** 打球物理ベースでインプレーの結果を判定する */
function resolveInPlayFromBall(
  ball: BattedBall,
  fielderPos: FielderPosition,
  batter: Player,
  _pitcher: Player,
  fielderMap: Map<FielderPosition, Player>,
  bases: BaseRunners,
  outs: number
): AtBatResult {
  const fielder = fielderMap.get(fielderPos) ?? createDummyFielder();
  const { fielding, catching } = getFieldingAbility(fielder, fielderPos);
  const fieldingFactor = fielding / 100;
  const catchingFactor = catching / 100;

  // ポップフライ → 常にアウト
  if (ball.type === "popup") return "popout";

  // --- 本塁打判定 ---
  if (ball.type === "fly_ball" || ball.type === "line_drive") {
    const isBarrel = ball.exitVelocity >= 150 && ball.launchAngle >= 22 && ball.launchAngle <= 38;
    const powerFactor = batter.batting.power / 100;
    let hrRate: number;
    if (isBarrel) {
      hrRate = 0.35 + powerFactor * 0.15;
    } else if (ball.type === "fly_ball") {
      hrRate = 0.05 + powerFactor * 0.08 + (ball.exitVelocity - 120) * 0.001;
    } else {
      hrRate = 0.02 + powerFactor * 0.03 + Math.max(0, (ball.exitVelocity - 145)) * 0.002;
    }
    if (Math.random() < Math.max(0.01, hrRate)) return "homerun";
  }

  // --- ゴロ処理 ---
  if (ball.type === "ground_ball") {
    if (bases.first && outs < 2) {
      const dpRate = 0.12 + (1 - batter.batting.speed / 100) * 0.06;
      if (Math.random() < dpRate) return "doublePlay";
    }

    const speedBonus = batter.batting.speed / 100;
    const velPenalty = Math.max(0, (ball.exitVelocity - 100)) * 0.001;
    const infieldHitRate = 0.04 + speedBonus * 0.08 - fieldingFactor * 0.03 - velPenalty;
    if (Math.random() < Math.max(0.01, infieldHitRate)) return "infieldHit";

    const velErrorBonus = Math.max(0, (ball.exitVelocity - 130)) * 0.0005;
    const errorRate = 0.03 - fieldingFactor * 0.015 - catchingFactor * 0.01 + velErrorBonus;
    if (Math.random() < Math.max(0.005, errorRate)) return "error";

    if (bases.first || bases.second || bases.third) {
      if (Math.random() < 0.05) return "fieldersChoice";
    }

    return "groundout";
  }

  // --- フライ処理 ---
  if (ball.type === "fly_ball") {
    const hitRate = 0.14 - fieldingFactor * 0.03 + (ball.exitVelocity - 120) * 0.0005;
    if (Math.random() < Math.max(0.05, hitRate)) {
      return determineHitType(ball.type, batter);
    }

    if (bases.third && outs < 2) {
      if (Math.random() < 0.50) return "sacrificeFly";
    }

    const errorRate = 0.015 - fieldingFactor * 0.008;
    if (Math.random() < Math.max(0.002, errorRate)) return "error";

    return "flyout";
  }

  // --- ライナー処理 ---
  const hitRate = 0.68 + (batter.batting.contact / 100) * 0.05 - fieldingFactor * 0.03;
  if (Math.random() < Math.max(0.50, hitRate)) {
    return determineHitType(ball.type, batter);
  }

  return "lineout";
}

/** 安打時の長打タイプを決定する */
function determineHitType(
  battedBallType: BattedBallType,
  batter: Player
): "single" | "double" | "triple" {
  const speedFactor = batter.batting.speed / 100;
  const powerFactor = batter.batting.power / 100;
  const roll = Math.random();

  if (battedBallType === "fly_ball") {
    const tripleRate = 0.06 + speedFactor * 0.04;
    if (roll < tripleRate) return "triple";
    return "double";
  }

  if (battedBallType === "line_drive") {
    const doubleRate = 0.20 + powerFactor * 0.08;
    const tripleRate = doubleRate + 0.02 + speedFactor * 0.02;
    if (roll < doubleRate) return "double";
    if (roll < tripleRate) return "triple";
    return "single";
  }

  // ground_ball (内野安打含む): ほぼ単打
  const doubleRate = 0.08 + speedFactor * 0.03;
  if (roll < doubleRate) return "double";
  return "single";
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
    return { result: "hitByPitch", battedBallType: null, fielderPosition: null };
  }

  // 四球率
  const walkRate = 0.075 + eyeFactor * 0.05 - controlFactor * 0.04;
  cumulative += Math.max(0.02, walkRate);
  if (roll < cumulative) {
    return { result: "walk", battedBallType: null, fielderPosition: null };
  }

  // 三振率
  const maxPitchLevel = pit.pitches && pit.pitches.length > 0
    ? Math.max(...pit.pitches.map(p => p.level))
    : 0;
  const finisherBonus = maxPitchLevel >= 5 ? (maxPitchLevel - 4) * 0.015 : 0;
  const strikeoutRate = 0.14 + velocityFactor * 0.08 - contactFactor * 0.06 + finisherBonus;
  cumulative += Math.max(0.05, strikeoutRate);
  if (roll < cumulative) {
    return { result: "strikeout", battedBallType: null, fielderPosition: null };
  }

  // インプレー: 打球物理データを生成 → フィールダーを幾何学的に決定 → 結果判定
  const ball = generateBattedBall(batter, pitcher);
  const fielderPos = determineFielderFromBall(ball);
  const result = resolveInPlayFromBall(ball, fielderPos, batter, pitcher, fielderMap, bases, outs);

  return { result, battedBallType: ball.type, fielderPosition: fielderPos };
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
): { bases: BaseRunners; runsScored: number } {
  let runs = 0;
  const newBases: BaseRunners = { first: null, second: null, third: null };

  switch (result) {
    case "homerun":
      runs = 1 + (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0);
      break;

    case "triple":
      runs = (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0);
      newBases.third = batter;
      break;

    case "double":
      runs = (bases.second ? 1 : 0) + (bases.third ? 1 : 0);
      if (bases.first) newBases.third = bases.first;
      newBases.second = batter;
      break;

    case "single":
    case "infieldHit":
    case "error":
      runs = bases.third ? 1 : 0;
      if (bases.second) newBases.third = bases.second;
      if (bases.first) newBases.second = bases.first;
      newBases.first = batter;
      break;

    case "walk":
    case "hitByPitch": {
      // 押し出し: フォースされた走者のみ進塁
      if (bases.first && bases.second && bases.third) runs = 1;
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
      return { bases: newBases, runsScored: 0 };

    case "sacrificeFly":
      // 3塁走者生還、打者アウト
      runs = bases.third ? 1 : 0;
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
      return { bases, runsScored: 0 };
  }

  return { bases: newBases, runsScored: runs };
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
  catcher: Player
): { runs: number; hits: number; nextBatterIndex: number } {
  let outs = 0;
  let runs = 0;
  let hits = 0;
  let bases: BaseRunners = { first: null, second: null, third: null };
  let idx = batterIndex;

  const fielderMap = buildFielderMap(fieldingTeam, pitcher);

  while (outs < 3) {
    // 盗塁試行 (打席前)
    if (bases.first || bases.second) {
      const stealResult = attemptStolenBases(bases, outs, catcher, batterStatsMap, fielderMap);
      bases = stealResult.bases;
      outs += stealResult.additionalOuts;
      if (outs >= 3) break;
    }

    const batter = battingTeam[idx % battingTeam.length];
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
          if (bases.first && Math.random() < 0.95) {
            // 2塁フォースアウト: 走者1塁時の95%
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
            // 従来通り: 1塁送球
            recordFielding(batterStatsMap, fielderMap, fp, "assist");
            recordFielding(batterStatsMap, fielderMap, 3, "putOut");
          }
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
            if (Math.random() < 0.20) {
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
            if (Math.random() < 0.18) {
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
            if (Math.random() < 0.25) {
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
        if (result === "homerun") {
          bs.runs++;
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

    idx++;
  }

  // 3アウトで1イニング分
  pitcherLog.inningsPitched += 3;

  return { runs, hits, nextBatterIndex: idx };
}

/**
 * 1試合をシミュレートする
 * @returns GameResult
 */
export function simulateGame(homeTeam: Team, awayTeam: Team): GameResult {
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

  // 9イニング
  for (let i = 0; i < 9; i++) {
    // 表 (アウェイチームの攻撃 → ホームチームが守備)
    const topResult = simulateHalfInning(
      awayBatters, homePitcher, homeBatters, awayBatterIdx, batterStatsMap, homePitcherLog, homeCatcher
    );
    awayScore += topResult.runs;
    awayBatterIdx = topResult.nextBatterIndex;

    // 裏 (ホームチームの攻撃 → アウェイチームが守備)
    // 9回裏でホームチームがリードしていたらスキップ
    let bottomRuns = 0;
    if (!(i === 8 && homeScore > awayScore)) {
      const bottomResult = simulateHalfInning(
        homeBatters, awayPitcher, awayBatters, homeBatterIdx, batterStatsMap, awayPitcherLog, awayCatcher
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
    const topResult = simulateHalfInning(
      awayBatters, homePitcher, homeBatters, awayBatterIdx, batterStatsMap, homePitcherLog, homeCatcher
    );
    awayScore += topResult.runs;
    awayBatterIdx = topResult.nextBatterIndex;

    const bottomResult = simulateHalfInning(
      homeBatters, awayPitcher, awayBatters, homeBatterIdx, batterStatsMap, awayPitcherLog, awayCatcher
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
  };
}

