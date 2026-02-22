import type { Team } from "@/models/team";
import type { GameResult, InningScore, PlayerGameStats, PitcherGameLog } from "@/models/league";
import type { Player, PitchRepertoire } from "@/models/player";

/**
 * 試合シミュレーションエンジン
 *
 * 投手の能力 vs 打者の能力に基づいて、1打席ごとの結果を確率で決定する。
 * パワプロのペナント自動進行のように、結果だけを高速に算出する。
 */

/** 球種リストから旧来の breaking 相当の 0-100 スケール値を算出 */
export function calcBreakingPower(pitches: PitchRepertoire[] | undefined): number {
  if (!pitches || pitches.length === 0) return 30; // 旧データ互換用デフォルト
  const total = pitches.reduce((sum, p) => sum + p.level * p.level, 0);
  // 理論最大: 5球種 × 49(=7²) = 245
  return Math.min(100, (total / 245) * 130);
}

/** 打席結果の種類 */
type AtBatResult =
  | "single"
  | "double"
  | "triple"
  | "homerun"
  | "walk"
  | "strikeout"
  | "groundout"
  | "flyout"
  | "error";

/** 1打席の結果を確率で決定する */
function simulateAtBat(batter: Player, pitcher: Player): AtBatResult {
  const bat = batter.batting;
  const pit = pitcher.pitching!;

  // 各能力値の対決から確率を算出 (簡易版)
  const breakingPower = calcBreakingPower(pit.pitches);
  const contactFactor = (bat.contact - breakingPower * 0.5) / 100;
  const powerFactor = bat.power / 100;
  const eyeFactor = (bat.eye - pit.control * 0.3) / 100;
  // 旧データ(1-100)と新データ(120-165)の互換: 100以下なら旧スケールとみなす
  const vel = pit.velocity <= 100 ? 120 + (pit.velocity / 100) * 45 : pit.velocity;
  const velocityFactor = (vel - 120) / 45; // 120-165を0-1に正規化

  const roll = Math.random();
  let cumulative = 0;

  // 四球率: 選球眼が高くコントロールが低いほど高い
  const walkRate = 0.08 + eyeFactor * 0.06 - pit.control * 0.0005;
  cumulative += Math.max(0.02, walkRate);
  if (roll < cumulative) return "walk";

  // 三振率: 球速が高くミートが低いほど高い
  const strikeoutRate = 0.15 + velocityFactor * 0.08 - contactFactor * 0.06;
  // 決め球ボーナス: 最大変化量の球種が三振率を押し上げ
  const maxPitchLevel = pit.pitches && pit.pitches.length > 0
    ? Math.max(...pit.pitches.map(p => p.level))
    : 0;
  const finisherBonus = maxPitchLevel >= 5 ? (maxPitchLevel - 4) * 0.015 : 0;
  cumulative += Math.max(0.05, strikeoutRate + finisherBonus);
  if (roll < cumulative) return "strikeout";

  // ヒット判定
  const hitRate = 0.22 + contactFactor * 0.08 - breakingPower * 0.001;
  cumulative += Math.max(0.10, hitRate);
  if (roll < cumulative) {
    // ヒットの種類を決定
    const extraBaseRoll = Math.random();
    const hrRate = 0.03 + powerFactor * 0.06;
    const tripleRate = 0.005 + (bat.speed / 100) * 0.01;
    const doubleRate = 0.06 + powerFactor * 0.04;

    if (extraBaseRoll < hrRate) return "homerun";
    if (extraBaseRoll < hrRate + tripleRate) return "triple";
    if (extraBaseRoll < hrRate + tripleRate + doubleRate) return "double";
    return "single";
  }

  // エラー率
  cumulative += 0.02;
  if (roll < cumulative) return "error";

  // 残り: 凡打
  return Math.random() < 0.5 ? "groundout" : "flyout";
}

/** 走者の状態 (Player を追跡して盗塁時に走力を参照) */
interface BaseRunners {
  first: Player | null;
  second: Player | null;
  third: Player | null;
}

/** 打席結果に応じて走者を進塁させ、得点を計算する (簡易版) */
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
    case "error":
      runs = bases.third ? 1 : 0;
      if (bases.second) newBases.third = bases.second;
      if (bases.first) newBases.second = bases.first;
      newBases.first = batter;
      break;
    case "walk": {
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
    default:
      // アウト: 走者はそのまま (簡易版)
      return { bases, runsScored: 0 };
  }

  return { bases: newBases, runsScored: runs };
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

/** 1イニングの半分 (表 or 裏) をシミュレート */
function simulateHalfInning(
  battingTeam: Player[],
  pitcher: Player,
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

  while (outs < 3) {
    // 盗塁試行 (打席前)
    if (bases.first || bases.second) {
      const stealResult = attemptStolenBases(bases, outs, catcher, batterStatsMap);
      bases = stealResult.bases;
      outs += stealResult.additionalOuts;
      if (outs >= 3) break;
    }

    const batter = battingTeam[idx % battingTeam.length];
    const result = simulateAtBat(batter, pitcher);
    const bs = getOrCreateBatterStats(batterStatsMap, batter.id);

    if (result === "strikeout" || result === "groundout" || result === "flyout") {
      outs++;
      if (result === "strikeout") {
        bs.strikeouts++;
        pitcherLog.strikeouts++;
      }
      // groundout/flyout は打数にカウント
      bs.atBats++;
    } else if (result === "walk") {
      bs.walks++;
      pitcherLog.walks++;
      const advance = advanceRunners(bases, result, batter);
      bases = advance.bases;
      const scored = advance.runsScored;
      runs += scored;
      bs.rbi += scored;
      pitcherLog.earnedRuns += scored;
    } else {
      // ヒット系 (single, double, triple, homerun, error)
      bs.atBats++;
      if (result !== "error") {
        bs.hits++;
        hits++;
        pitcherLog.hits++;
      }
      if (result === "double") bs.doubles++;
      if (result === "triple") bs.triples++;
      if (result === "homerun") {
        bs.homeRuns++;
        pitcherLog.homeRunsAllowed++;
      }

      const advance = advanceRunners(bases, result, batter);
      bases = advance.bases;
      const scored = advance.runsScored;
      runs += scored;
      bs.rbi += scored;
      pitcherLog.earnedRuns += scored;

      // ホームランの場合、打者自身も得点
      if (result === "homerun") {
        bs.runs++;
      }
    }

    idx++;
  }

  // 3アウトで1イニング分 (outs数 = 投球回としてカウント)
  pitcherLog.inningsPitched += 3;

  return { runs, hits, nextBatterIndex: idx };
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
    // 表 (アウェイチームの攻撃 → ホームチームが守備 → homeCatcher)
    const topResult = simulateHalfInning(
      awayBatters, homePitcher, awayBatterIdx, batterStatsMap, homePitcherLog, homeCatcher
    );
    awayScore += topResult.runs;
    awayBatterIdx = topResult.nextBatterIndex;

    // 裏 (ホームチームの攻撃 → アウェイチームが守備 → awayCatcher)
    // 9回裏でホームチームがリードしていたらスキップ
    let bottomRuns = 0;
    if (!(i === 8 && homeScore > awayScore)) {
      const bottomResult = simulateHalfInning(
        homeBatters, awayPitcher, homeBatterIdx, batterStatsMap, awayPitcherLog, awayCatcher
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
      awayBatters, homePitcher, awayBatterIdx, batterStatsMap, homePitcherLog, homeCatcher
    );
    awayScore += topResult.runs;
    awayBatterIdx = topResult.nextBatterIndex;

    const bottomResult = simulateHalfInning(
      homeBatters, awayPitcher, homeBatterIdx, batterStatsMap, awayPitcherLog, awayCatcher
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
