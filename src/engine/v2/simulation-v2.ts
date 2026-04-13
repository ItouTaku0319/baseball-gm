/**
 * v2エンジン: 試合シミュレーション
 *
 * outcome-resolver で打席結果を決定し、走者進塁・得点を処理する。
 * 物理シミュレーション（守備AI）は含まない — 純粋な結果決定エンジン。
 */

import type { Team } from "@/models/team";
import type { Player, PitchRepertoire } from "@/models/player";
import type { GameResult, InningScore, PlayerGameStats, PitcherGameLog, AtBatLog } from "@/models/league";
import type { Injury } from "@/models/player";
import { emptyBatterStats, emptyPitcherStats } from "@/models/player";
import { resolvePlateAppearance, type PAOutcome, type RunnerState, type BattedBallType, type PAResult } from "./outcome-resolver";
import {
  RUNNER_2B_SCORE_ON_SINGLE_BASE, RUNNER_2B_SCORE_ON_SINGLE_SPEED_SCALE,
  RUNNER_1B_TO_3B_ON_SINGLE_BASE, RUNNER_1B_TO_3B_ON_SINGLE_SPEED_SCALE,
  RUNNER_1B_SCORE_ON_DOUBLE_BASE, RUNNER_1B_SCORE_ON_DOUBLE_SPEED_SCALE,
} from "./outcome-tables";

// ============================================================
// 型定義
// ============================================================

export interface BaseRunners {
  first: Player | null;
  second: Player | null;
  third: Player | null;
}

interface TeamState {
  team: Team;
  batters: Player[];
  batterIndex: number;
  pitcher: Player;
  pitcherFatigue: number;
  pitcherPitchCount: number;
  bullpen: Player[];
  usedPitcherIds: Set<string>;
  /** 投手ログ */
  pitcherLogs: Map<string, PitcherGameLog>;
}

/** collectAtBatLogs に依存しない打者成績集計用マップ値 */
interface BatterAccum {
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  hitByPitch: number;
  sacrificeFlies: number;
  groundedIntoDP: number;
}

interface GameState {
  home: TeamState;
  away: TeamState;
  inning: number;
  isTop: boolean;
  outs: number;
  runners: BaseRunners;
  homeScore: number;
  awayScore: number;
  inningScores: { home: number[]; away: number[] };
  atBatLogs: AtBatLog[];
  /** collectAtBatLogs に依存しない打者成績 */
  batterStats: Map<string, BatterAccum>;
}

export interface SimulateOptions {
  collectAtBatLogs?: boolean;
  /** DH制を使用するか (true=DH有り、false=投手が打席に立つ) */
  useDH?: boolean;
}

// ============================================================
// チーム状態の初期化
// ============================================================

function selectLineup(team: Team, useDH: boolean, pitcher: Player): Player[] {
  const batters = team.roster.filter(p => !p.isPitcher);
  // contact + power + speed でソート、上位9人(DH有り) or 8人(DH無し)
  batters.sort((a, b) => {
    const sa = a.batting.contact + a.batting.power + a.batting.speed;
    const sb = b.batting.contact + b.batting.power + b.batting.speed;
    return sb - sa;
  });

  if (useDH) {
    return batters.slice(0, 9);
  } else {
    // DH無し: 野手8人 + 投手が9番
    const lineup = batters.slice(0, 8);
    lineup.push(pitcher);
    return lineup;
  }
}

function selectStartingPitcher(team: Team): Player {
  const pitchers = team.roster.filter(p => p.isPitcher && p.pitching);
  // スタミナ重視
  pitchers.sort((a, b) => (b.pitching?.stamina ?? 0) - (a.pitching?.stamina ?? 0));
  return pitchers[0];
}

function selectBullpen(team: Team, starterId: string): Player[] {
  return team.roster.filter(p => p.isPitcher && p.pitching && p.id !== starterId);
}

function createPitcherLog(pitcher: Player, isStarter: boolean): PitcherGameLog {
  return {
    playerId: pitcher.id,
    isStarter,
    inningsPitched: 0,
    hits: 0,
    earnedRuns: 0,
    walks: 0,
    strikeouts: 0,
    homeRunsAllowed: 0,
    pitchCount: 0,
    hitBatsmen: 0,
    groundBallOuts: 0,
    flyBallOuts: 0,
    groundBalls: 0,
    flyBalls: 0,
    lineDrives: 0,
    popups: 0,
  };
}

function initTeamState(team: Team, isHome: boolean, useDH: boolean): TeamState {
  const pitcher = selectStartingPitcher(team);
  const batters = selectLineup(team, useDH, pitcher);
  const bullpen = selectBullpen(team, pitcher.id);
  const logs = new Map<string, PitcherGameLog>();
  logs.set(pitcher.id, createPitcherLog(pitcher, true));

  return {
    team,
    batters,
    batterIndex: 0,
    pitcher,
    pitcherFatigue: 0,
    pitcherPitchCount: 0,
    bullpen,
    usedPitcherIds: new Set([pitcher.id]),
    pitcherLogs: logs,
  };
}

// ============================================================
// 走者進塁ロジック
// ============================================================

export type RunnerAdvanceResult = { scored: Player[]; newRunners: BaseRunners };

export function advanceRunners(
  runners: BaseRunners,
  result: PAResult,
  batter: Player,
): RunnerAdvanceResult {
  const scored: Player[] = [];
  let newRunners: BaseRunners = { first: null, second: null, third: null };

  switch (result) {
    case "homerun": {
      if (runners.third) scored.push(runners.third);
      if (runners.second) scored.push(runners.second);
      if (runners.first) scored.push(runners.first);
      scored.push(batter);
      break;
    }
    case "triple": {
      if (runners.third) scored.push(runners.third);
      if (runners.second) scored.push(runners.second);
      if (runners.first) scored.push(runners.first);
      newRunners.third = batter;
      break;
    }
    case "double": {
      if (runners.third) scored.push(runners.third);
      if (runners.second) scored.push(runners.second);
      if (runners.first) {
        const scoreChance = RUNNER_1B_SCORE_ON_DOUBLE_BASE
          + (runners.first.batting.speed - 50) / 100 * RUNNER_1B_SCORE_ON_DOUBLE_SPEED_SCALE;
        if (Math.random() < scoreChance) {
          scored.push(runners.first);
        } else {
          newRunners.third = runners.first;
        }
      }
      newRunners.second = batter;
      break;
    }
    case "single":
    case "infield_hit":
    case "error": {
      if (runners.third) scored.push(runners.third);
      if (runners.second) {
        const scoreChance = RUNNER_2B_SCORE_ON_SINGLE_BASE
          + (runners.second.batting.speed - 50) / 100 * RUNNER_2B_SCORE_ON_SINGLE_SPEED_SCALE;
        if (Math.random() < scoreChance) {
          scored.push(runners.second);
        } else {
          newRunners.third = runners.second;
        }
      }
      if (runners.first) {
        const advanceChance = RUNNER_1B_TO_3B_ON_SINGLE_BASE
          + (runners.first.batting.speed - 50) / 100 * RUNNER_1B_TO_3B_ON_SINGLE_SPEED_SCALE;
        if (!newRunners.third && Math.random() < advanceChance) {
          newRunners.third = runners.first;
        } else {
          newRunners.second = runners.first;
        }
      }
      newRunners.first = batter;
      break;
    }
    case "walk":
    case "hit_by_pitch": {
      // 押し出し
      if (runners.first && runners.second && runners.third) {
        scored.push(runners.third);
        newRunners.third = runners.second;
        newRunners.second = runners.first;
        newRunners.first = batter;
      } else if (runners.first && runners.second) {
        newRunners.third = runners.second;
        newRunners.second = runners.first;
        newRunners.first = batter;
      } else if (runners.first) {
        newRunners.second = runners.first;
        newRunners.first = batter;
        newRunners.third = runners.third; // 3塁走者はそのまま
      } else {
        newRunners.first = batter;
        newRunners.second = runners.second;
        newRunners.third = runners.third;
      }
      break;
    }
    case "sac_fly": {
      // 3塁走者がタッチアップで生還
      if (runners.third) scored.push(runners.third);
      newRunners.first = runners.first;
      newRunners.second = runners.second;
      newRunners.third = null;
      break;
    }
    case "fielders_choice": {
      // FC = 先行走者がアウト、打者は1塁へ出塁
      if (runners.first && runners.second && runners.third) {
        // 満塁: 3塁走者をホームタッチアウト、他は1つ進塁
        newRunners.first = batter;
        newRunners.second = runners.first;
        newRunners.third = runners.second;
        // 3塁走者はアウト（得点なし）
      } else if (runners.first && runners.second) {
        // 1-2塁: 2塁走者がアウト、1塁走者→2塁、打者→1塁
        newRunners.first = batter;
        newRunners.second = runners.first;
        newRunners.third = runners.third; // null
      } else if (runners.first) {
        // 1塁のみ: 1塁走者フォースアウト、打者→1塁
        newRunners.first = batter;
        newRunners.second = runners.second; // null
        newRunners.third = runners.third;
      } else {
        // 走者なし（通常はFC発生しないがフォールバック）
        newRunners.first = batter;
      }
      break;
    }
    case "double_play": {
      // 打者アウト + 1塁走者フォースアウト（2アウト追加はgetOutsFromResultで管理）
      if (runners.first && runners.second) {
        // 1-2塁: 1塁走者アウト、2塁走者→3塁、3塁走者がいれば得点
        if (runners.third) scored.push(runners.third);
        newRunners.first = null;
        newRunners.second = null;
        newRunners.third = runners.second;
      } else if (runners.first) {
        // 1塁のみ: 打者アウト + 1塁走者フォースアウト、走者全クリア
        // 3塁走者がいれば得点（タッチアップ可能、2アウト前なのでゴーする）
        if (runners.third) scored.push(runners.third);
        newRunners.first = null;
        newRunners.second = null;
        newRunners.third = null;
      } else {
        // 走者なし（通常はDP発生しないがフォールバック: 打者アウトのみ）
        newRunners.first = null;
        newRunners.second = null;
        newRunners.third = runners.third;
      }
      break;
    }
    case "groundout":
    case "flyout":
    case "lineout":
    case "popout":
    case "strikeout": {
      // 走者はそのまま
      newRunners.first = runners.first;
      newRunners.second = runners.second;
      newRunners.third = runners.third;
      break;
    }
  }

  return { scored, newRunners };
}

// ============================================================
// 投手交代判定
// ============================================================

function shouldReplacePitcher(ts: TeamState, inning: number): boolean {
  const fatigue = ts.pitcherFatigue;
  const pitchCount = ts.pitcherPitchCount;
  const stamina = ts.pitcher.pitching?.stamina ?? 50;

  // 先発: スタミナベースで交代判定
  if (ts.pitcherLogs.get(ts.pitcher.id)?.isStarter) {
    const maxPitches = 60 + stamina * 0.5; // スタミナ50→85球、100→110球
    if (pitchCount >= maxPitches) return true;
    if (fatigue > 0.7) return true;
  } else {
    // リリーフ: 1イニング目安
    const log = ts.pitcherLogs.get(ts.pitcher.id);
    if (log && log.inningsPitched >= 3) return true; // 1イニング = 3アウト
    if (fatigue > 0.5) return true;
  }
  return false;
}

function replacePitcher(ts: TeamState): void {
  if (ts.bullpen.length === 0) return;

  // 次の投手を選択（球速+変化球重視）
  ts.bullpen.sort((a, b) => {
    const sa = (a.pitching?.velocity ?? 0) + calcBreakingScore(a.pitching?.pitches);
    const sb = (b.pitching?.velocity ?? 0) + calcBreakingScore(b.pitching?.pitches);
    return sb - sa;
  });

  const next = ts.bullpen.shift()!;
  ts.pitcher = next;
  ts.pitcherFatigue = 0;
  ts.pitcherPitchCount = 0;
  ts.usedPitcherIds.add(next.id);
  ts.pitcherLogs.set(next.id, createPitcherLog(next, false));
}

function calcBreakingScore(pitches: PitchRepertoire[] | undefined): number {
  if (!pitches) return 0;
  return pitches.reduce((s, p) => s + p.level * 5, 0);
}

// ============================================================
// メインシミュレーション
// ============================================================

export function simulateGameV2(
  homeTeam: Team,
  awayTeam: Team,
  options: SimulateOptions = {},
): GameResult {
  const useDH = options.useDH ?? true;
  const home = initTeamState(homeTeam, true, useDH);
  const away = initTeamState(awayTeam, false, useDH);
  const collectLogs = options.collectAtBatLogs ?? false;

  const state: GameState = {
    home,
    away,
    inning: 1,
    isTop: true,
    outs: 0,
    runners: { first: null, second: null, third: null },
    homeScore: 0,
    awayScore: 0,
    inningScores: { home: [], away: [] },
    atBatLogs: [],
    batterStats: new Map<string, BatterAccum>(),
  };

  // 試合ループ
  const MAX_INNINGS = 12;
  while (state.inning <= MAX_INNINGS) {
    // 表
    state.isTop = true;
    state.outs = 0;
    state.runners = { first: null, second: null, third: null };
    const awayRuns = simulateHalfInning(state, away, home, collectLogs);
    state.awayScore += awayRuns;
    state.inningScores.away.push(awayRuns);

    // 9回裏以降、ホームチームがリードしていれば打ち切り
    if (state.inning >= 9 && state.homeScore > state.awayScore) {
      state.inningScores.home.push(0);
      break;
    }

    // 裏
    state.isTop = false;
    state.outs = 0;
    state.runners = { first: null, second: null, third: null };
    const homeRuns = simulateHalfInning(state, home, away, collectLogs);
    state.homeScore += homeRuns;
    state.inningScores.home.push(homeRuns);

    // 9回裏以降、サヨナラ判定
    if (state.inning >= 9 && state.homeScore > state.awayScore) {
      break;
    }

    state.inning++;
  }

  return buildGameResult(state, homeTeam, awayTeam);
}

/**
 * ハーフイニング（表 or 裏）をシミュレート
 */
function simulateHalfInning(
  game: GameState,
  batting: TeamState,
  fielding: TeamState,
  collectLogs: boolean,
): number {
  let runs = 0;
  game.outs = 0;
  game.runners = { first: null, second: null, third: null };

  // イニング開始時に投手交代判定
  if (shouldReplacePitcher(fielding, game.inning)) {
    replacePitcher(fielding);
  }

  while (game.outs < 3) {
    const batter = batting.batters[batting.batterIndex % batting.batters.length];
    const pitcher = fielding.pitcher;

    // 守備側チームの平均守備力
    const teamFielding = fielding.batters.reduce((s, p) => s + p.batting.fielding, 0) / fielding.batters.length;

    const runnerState: RunnerState = {
      first: game.runners.first !== null,
      second: game.runners.second !== null,
      third: game.runners.third !== null,
    };

    const outcome = resolvePlateAppearance({
      batter,
      pitcher,
      pitcherFatigue: fielding.pitcherFatigue,
      runners: runnerState,
      outs: game.outs,
      teamFielding,
    });

    // 投手の消耗（1打席 ≈ 4球）
    const pitchesThisAB = 3 + Math.floor(Math.random() * 4); // 3-6球
    fielding.pitcherPitchCount += pitchesThisAB;
    fielding.pitcherFatigue = Math.min(1,
      fielding.pitcherPitchCount / (60 + (pitcher.pitching?.stamina ?? 50) * 0.5)
    );

    // 投手ログ更新
    const pLog = fielding.pitcherLogs.get(pitcher.id)!;
    pLog.pitchCount = (pLog.pitchCount ?? 0) + pitchesThisAB;
    updatePitcherLog(pLog, outcome);

    // 走者進塁
    const { scored, newRunners } = advanceRunners(game.runners, outcome.result, batter);
    game.runners = newRunners;
    runs += scored.length;

    // アウトカウント更新
    const outsAdded = getOutsFromResult(outcome.result);
    game.outs += outsAdded;

    // 投手ログにアウト数を加算（イニング投球回として）
    pLog.inningsPitched += outsAdded;

    // 投手の自責点
    if (scored.length > 0 && outcome.result !== "error") {
      pLog.earnedRuns += scored.length;
    }

    // AtBatLog記録
    if (collectLogs) {
      game.atBatLogs.push({
        inning: game.inning,
        halfInning: game.isTop ? "top" : "bottom",
        batterId: batter.id,
        pitcherId: pitcher.id,
        result: outcome.result,
        battedBallType: outcome.battedBallType,
        direction: null,
        launchAngle: null,
        exitVelocity: null,
        estimatedDistance: null,
        fielderPosition: null,
        basesBeforePlay: null,
        outsBeforePlay: game.outs,
      });
    }

    // 打者成績集計（collectAtBatLogs に依存しない）
    {
      const r = outcome.result;
      let acc = game.batterStats.get(batter.id);
      if (!acc) {
        acc = { atBats: 0, hits: 0, doubles: 0, triples: 0, homeRuns: 0, walks: 0, strikeouts: 0, hitByPitch: 0, sacrificeFlies: 0, groundedIntoDP: 0 };
        game.batterStats.set(batter.id, acc);
      }
      if (AB_RESULTS.has(r)) acc.atBats++;
      if (HIT_RESULTS.has(r)) acc.hits++;
      if (r === "double") acc.doubles++;
      if (r === "triple") acc.triples++;
      if (r === "homerun") acc.homeRuns++;
      if (r === "walk") acc.walks++;
      if (r === "strikeout") acc.strikeouts++;
      if (r === "hit_by_pitch") acc.hitByPitch++;
      if (r === "sac_fly") acc.sacrificeFlies++;
      if (r === "double_play") acc.groundedIntoDP++;
    }

    // 打順進める
    batting.batterIndex++;

    // 3アウトチェンジ
    if (game.outs >= 3) break;

    // イニング途中の投手交代（大量失点時）
    if (runs >= 5 && fielding.bullpen.length > 0) {
      replacePitcher(fielding);
    }
  }

  return runs;
}

// ============================================================
// ヘルパー
// ============================================================

export function getOutsFromResult(result: PAResult): number {
  switch (result) {
    case "double_play": return 2;
    case "groundout":
    case "flyout":
    case "lineout":
    case "popout":
    case "strikeout":
    case "sac_fly":
      return 1;
    case "fielders_choice":
      return 1;
    default:
      return 0;
  }
}

function updatePitcherLog(log: PitcherGameLog, outcome: PAOutcome): void {
  const r = outcome.result;
  const bbt = outcome.battedBallType;

  if (r === "strikeout") log.strikeouts++;
  if (r === "walk") log.walks++;
  if (r === "hit_by_pitch") log.hitBatsmen = (log.hitBatsmen ?? 0) + 1;
  if (r === "homerun") { log.homeRunsAllowed++; log.hits++; }
  if (r === "single" || r === "double" || r === "triple" || r === "infield_hit") log.hits++;
  if (r === "error") { /* エラーはヒットに含めない */ }

  // 打球タイプ別カウント
  if (bbt === "ground_ball") {
    log.groundBalls = (log.groundBalls ?? 0) + 1;
    if (r === "groundout" || r === "double_play" || r === "fielders_choice") {
      log.groundBallOuts = (log.groundBallOuts ?? 0) + 1;
    }
  }
  if (bbt === "fly_ball") {
    log.flyBalls = (log.flyBalls ?? 0) + 1;
    if (r === "flyout" || r === "sac_fly") log.flyBallOuts = (log.flyBallOuts ?? 0) + 1;
  }
  if (bbt === "line_drive") log.lineDrives = (log.lineDrives ?? 0) + 1;
  if (bbt === "popup") log.popups = (log.popups ?? 0) + 1;
}

function buildGameResult(
  state: GameState,
  homeTeam: Team,
  awayTeam: Team,
): GameResult {
  const innings: InningScore[] = [];
  const maxInnings = Math.max(
    state.inningScores.home.length,
    state.inningScores.away.length,
  );
  for (let i = 0; i < maxInnings; i++) {
    innings.push({
      top: state.inningScores.away[i] ?? 0,
      bottom: state.inningScores.home[i] ?? 0,
    });
  }

  // 打者成績を batterStats マップから構築（collectAtBatLogs に依存しない）
  const playerStats: PlayerGameStats[] = [];
  for (const ts of [state.away, state.home]) {
    for (const batter of ts.batters) {
      const acc = state.batterStats.get(batter.id);
      playerStats.push({
        playerId: batter.id,
        atBats: acc?.atBats ?? 0,
        hits: acc?.hits ?? 0,
        doubles: acc?.doubles ?? 0,
        triples: acc?.triples ?? 0,
        homeRuns: acc?.homeRuns ?? 0,
        rbi: 0,
        runs: 0,
        walks: acc?.walks ?? 0,
        strikeouts: acc?.strikeouts ?? 0,
        stolenBases: 0,
        caughtStealing: 0,
        errors: 0,
        putOuts: 0,
        assists: 0,
        hitByPitch: acc?.hitByPitch ?? 0,
        sacrificeFlies: acc?.sacrificeFlies ?? 0,
        groundedIntoDP: acc?.groundedIntoDP ?? 0,
        fieldingPosition: undefined,
      });
    }
  }

  // 投手成績
  const pitcherStats: PitcherGameLog[] = [];
  for (const ts of [state.away, state.home]) {
    for (const [, log] of ts.pitcherLogs) {
      pitcherStats.push(log);
    }
  }

  // 勝敗投手判定
  const { winningPitcherId, losingPitcherId, savePitcherId } = determinePitcherDecisions(
    state,
    pitcherStats,
  );

  return {
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    innings,
    winningPitcherId,
    losingPitcherId,
    savePitcherId,
    playerStats,
    pitcherStats,
    atBatLogs: state.atBatLogs.length > 0 ? state.atBatLogs : undefined,
  };
}

/**
 * 勝利・敗戦・セーブ投手を判定する。
 *
 * 勝利投手ルール（NPB簡易版）:
 * - 勝ちチームの先発が5回以上（15アウト以上）投げていれば先発が勝利投手
 * - そうでなければ勝ちチームの中で最も多くアウトを取ったリリーフ
 *
 * 敗戦投手ルール:
 * - 負けチームで最も自責点が多い投手
 * - 同数の場合は先発を優先
 *
 * セーブ投手ルール:
 * - 最終回を投げた先発以外の投手が勝ちチームに属し、3点差以内でリードを守った場合
 */
function determinePitcherDecisions(
  state: GameState,
  pitcherStats: PitcherGameLog[],
): { winningPitcherId: string | null; losingPitcherId: string | null; savePitcherId: string | null } {
  const { homeScore, awayScore } = state;

  // 引き分け
  if (homeScore === awayScore) {
    return { winningPitcherId: null, losingPitcherId: null, savePitcherId: null };
  }

  const winningTeamState = homeScore > awayScore ? state.home : state.away;
  const losingTeamState = homeScore > awayScore ? state.away : state.home;
  const scoreDiff = Math.abs(homeScore - awayScore);

  // 勝ちチームの投手ログを取得
  const winLogs = pitcherStats.filter(l => winningTeamState.pitcherLogs.has(l.playerId));
  const loseLogs = pitcherStats.filter(l => losingTeamState.pitcherLogs.has(l.playerId));

  // 勝利投手
  let winningPitcherId: string | null = null;
  const winStarter = winLogs.find(l => l.isStarter);
  if (winStarter && winStarter.inningsPitched >= 15) {
    // 先発が5回以上（15アウト）投げていれば先発が勝利投手
    winningPitcherId = winStarter.playerId;
  } else {
    // 最も多くアウトを取ったリリーフ
    const relievers = winLogs.filter(l => !l.isStarter);
    if (relievers.length > 0) {
      relievers.sort((a, b) => b.inningsPitched - a.inningsPitched);
      winningPitcherId = relievers[0].playerId;
    } else if (winStarter) {
      // リリーフ不在なら先発（5回未満でも）
      winningPitcherId = winStarter.playerId;
    }
  }

  // 敗戦投手: 自責点が最も多い投手（同数なら先発優先）
  let losingPitcherId: string | null = null;
  if (loseLogs.length > 0) {
    loseLogs.sort((a, b) => {
      if (b.earnedRuns !== a.earnedRuns) return b.earnedRuns - a.earnedRuns;
      return (b.isStarter ? 1 : 0) - (a.isStarter ? 1 : 0);
    });
    losingPitcherId = loseLogs[0].playerId;
  }

  // セーブ投手: 勝ちチームの最終登板投手が先発でなく、3点差以内の場合
  let savePitcherId: string | null = null;
  const lastWinPitcher = winLogs[winLogs.length - 1]; // pitcherLogsは登板順に挿入されている
  if (lastWinPitcher && !lastWinPitcher.isStarter && scoreDiff <= 3) {
    // 勝利投手と異なる投手がセーブ（最終回を締めたリリーフ）
    if (lastWinPitcher.playerId !== winningPitcherId) {
      savePitcherId = lastWinPitcher.playerId;
    }
  }

  return { winningPitcherId, losingPitcherId, savePitcherId };
}

export const HIT_RESULTS = new Set([
  "single", "double", "triple", "homerun", "infield_hit",
]);

export const AB_RESULTS = new Set([
  "single", "double", "triple", "homerun", "infield_hit",
  "strikeout", "groundout", "flyout", "lineout", "popout",
  "double_play", "fielders_choice", "error",
]);

