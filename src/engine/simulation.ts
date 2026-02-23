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

/** 打球タイプを決定する */
function determineBattedBallType(batter: Player, pitcher: Player): BattedBallType {
  const powerFactor = batter.batting.power / 100;
  const contactFactor = batter.batting.contact / 100;

  // シンカー系球種のゴロ率ボーナスを計算
  let sinkerBonus = 0;
  if (pitcher.pitching?.pitches) {
    for (const pitch of pitcher.pitching.pitches) {
      if (pitch.type === "sinker" || pitch.type === "shoot") {
        sinkerBonus += pitch.level * (pitch.type === "sinker" ? 0.8 : 0.5);
      }
    }
    sinkerBonus = Math.min(7, sinkerBonus); // 最大+7%
  }

  let groundBallRate = 0.44 - powerFactor * 0.06 + sinkerBonus * 0.01;
  let flyBallRate = 0.34 + powerFactor * 0.06;
  const lineDriveRate = 0.20 + contactFactor * 0.02;
  let popupRate = 0.02 + (1 - contactFactor) * 0.02;

  // 合計が1になるよう正規化
  const total = groundBallRate + flyBallRate + lineDriveRate + popupRate;
  groundBallRate /= total;
  flyBallRate /= total;
  const normalizedLineRate = lineDriveRate / total;
  popupRate /= total;

  const roll = Math.random();
  if (roll < groundBallRate) return "ground_ball";
  if (roll < groundBallRate + flyBallRate) return "fly_ball";
  if (roll < groundBallRate + flyBallRate + normalizedLineRate) return "line_drive";
  return "popup";
}

/** 打球タイプに応じて処理する野手を決定する */
function assignFielder(battedBallType: BattedBallType): FielderPosition {
  const roll = Math.random();

  if (battedBallType === "ground_ball") {
    // 内野手に重み付き
    if (roll < 0.10) return 1; // P
    if (roll < 0.25) return 3; // 1B
    if (roll < 0.50) return 4; // 2B
    if (roll < 0.70) return 5; // 3B
    return 6; // SS
  }

  if (battedBallType === "fly_ball") {
    // 外野手に重み付き
    if (roll < 0.30) return 7; // LF
    if (roll < 0.70) return 8; // CF
    return 9; // RF
  }

  if (battedBallType === "line_drive") {
    // 内野30% / 外野70%
    if (roll < 0.30) {
      // 内野
      const innerRoll = Math.random();
      if (innerRoll < 0.05) return 1; // P
      if (innerRoll < 0.25) return 3; // 1B
      if (innerRoll < 0.50) return 4; // 2B
      if (innerRoll < 0.70) return 5; // 3B
      return 6; // SS
    } else {
      // 外野
      const outerRoll = Math.random();
      if (outerRoll < 0.30) return 7; // LF
      if (outerRoll < 0.70) return 8; // CF
      return 9; // RF
    }
  }

  // popup: 内野手+捕手+投手
  if (roll < 0.05) return 1; // P
  if (roll < 0.20) return 2; // C
  if (roll < 0.40) return 3; // 1B
  if (roll < 0.60) return 4; // 2B
  if (roll < 0.80) return 5; // 3B
  return 6; // SS
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

/** インプレー打球の結果を判定する */
function resolveInPlay(
  battedBallType: BattedBallType,
  fielderPos: FielderPosition,
  batter: Player,
  pitcher: Player,
  fielderMap: Map<FielderPosition, Player>,
  bases: BaseRunners,
  outs: number
): AtBatResult {
  const fielder = fielderMap.get(fielderPos) ?? createDummyFielder();
  const { fielding, catching } = getFieldingAbility(fielder, fielderPos);
  const fieldingFactor = fielding / 100;
  const catchingFactor = catching / 100;

  // ポップフライは常にアウト
  if (battedBallType === "popup") {
    return "popout";
  }

  if (battedBallType === "ground_ball") {
    // 併殺判定 (1塁に走者がいて2アウト未満)
    if (bases.first && outs < 2) {
      const dpRate = 0.12 + (1 - batter.batting.speed / 100) * 0.06;
      if (Math.random() < dpRate) return "doublePlay";
    }

    // 内野安打判定
    const infieldHitRate = 0.04 + (batter.batting.speed / 100) * 0.08 - fieldingFactor * 0.03;
    if (Math.random() < Math.max(0.01, infieldHitRate)) return "infieldHit";

    // エラー判定
    const errorRate = 0.03 - fieldingFactor * 0.015 - catchingFactor * 0.01;
    if (Math.random() < Math.max(0.005, errorRate)) return "error";

    // FC判定 (走者あり)
    if (bases.first || bases.second || bases.third) {
      if (Math.random() < 0.05) return "fieldersChoice";
    }

    return "groundout";
  }

  if (battedBallType === "fly_ball") {
    // 本塁打判定
    const powerFactor = batter.batting.power / 100;
    const hrRate = 0.08 + powerFactor * 0.12;
    if (Math.random() < hrRate) return "homerun";

    // 安打判定
    const hitRate = 0.14 - fieldingFactor * 0.03 - (getFieldingAbility(fielder, fielderPos).arm / 100) * 0.01;
    if (Math.random() < Math.max(0.05, hitRate)) {
      const hitType = determineHitType(battedBallType, batter);
      // 犠飛判定 (3塁に走者がいて2アウト未満、かつアウトになる場合のみ)
      // フライ安打の場合は犠飛にならない
      return hitType;
    }

    // アウト確定後の犠飛判定 (3塁に走者がいて2アウト未満)
    if (bases.third && outs < 2) {
      if (Math.random() < 0.50) return "sacrificeFly";
    }

    // エラー判定
    const errorRate = 0.015 - fieldingFactor * 0.008;
    if (Math.random() < Math.max(0.002, errorRate)) return "error";

    return "flyout";
  }

  // line_drive
  // 本塁打判定
  const powerFactor = batter.batting.power / 100;
  const hrRate = 0.03 + powerFactor * 0.04;
  if (Math.random() < hrRate) return "homerun";

  // 安打判定 (ライナーはBABIP高い)
  const hitRate = 0.68 + (batter.batting.contact / 100) * 0.05 - fieldingFactor * 0.03;
  if (Math.random() < Math.max(0.50, hitRate)) {
    return determineHitType(battedBallType, batter);
  }

  return "lineout";
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

  // インプレー: 打球タイプと野手を決定してから結果を判定
  const battedBallType = determineBattedBallType(batter, pitcher);
  const fielderPos = assignFielder(battedBallType);
  const result = resolveInPlay(battedBallType, fielderPos, batter, pitcher, fielderMap, bases, outs);

  return { result, battedBallType, fielderPosition: fielderPos };
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
  batterStatsMap: Map<string, PlayerGameStats>
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
      const stealResult = attemptStolenBases(bases, outs, catcher, batterStatsMap);
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
        break;

      case "groundout":
        outs++;
        bs.atBats++;
        pitcherLog.groundBallOuts = (pitcherLog.groundBallOuts ?? 0) + 1;
        break;

      case "flyout":
      case "popout":
        outs++;
        bs.atBats++;
        pitcherLog.flyBallOuts = (pitcherLog.flyBallOuts ?? 0) + 1;
        break;

      case "lineout":
        outs++;
        bs.atBats++;
        break;

      case "doublePlay": {
        outs += 2;
        bs.atBats++;
        bs.groundedIntoDP = (bs.groundedIntoDP ?? 0) + 1;
        pitcherLog.groundBallOuts = (pitcherLog.groundBallOuts ?? 0) + 1;
        const dpAdvance = advanceRunners(bases, result, batter);
        bases = dpAdvance.bases;
        break;
      }

      case "sacrificeFly": {
        outs++;
        // 犠飛は打数にカウントしない
        bs.sacrificeFlies = (bs.sacrificeFlies ?? 0) + 1;
        pitcherLog.flyBallOuts = (pitcherLog.flyBallOuts ?? 0) + 1;
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
