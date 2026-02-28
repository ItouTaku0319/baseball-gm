/**
 * 自律分散型守備AI — Phase 1
 *
 * 各野手エージェントが独立して状況判断し、協調行動を実現する。
 * 中央制御ではなく callingIntensity / pursuitScore による自然な協調。
 *
 * Phase 2 で fielding-agent.ts のメインループに接続予定。
 */
import type {
  Vec2,
  BallTrajectory,
  FielderAgent,
  FielderPosition,
} from "./fielding-agent-types";
import {
  vec2Distance,
  clamp,
  BASE_POSITIONS,
} from "./fielding-agent-types";
import { DEFAULT_FIELDER_POSITIONS } from "./fielding-ai";
import {
  AGENT_ACCELERATION_TIME,
  CATCH_REACH_BASE,
  CATCH_REACH_SKILL_FACTOR,
  BACKUP_DRIFT_THRESHOLD,
  DRIFT_RATIO_MIN,
  DRIFT_RATIO_MAX,
  HIGH_BALL_THRESHOLD,
  CONCURRENT_PURSUIT_HEIGHT,
} from "./physics-constants";

// ====================================================================
// ローカル定数
// ====================================================================

/** proximity スコアの正規化距離(m) */
const PROXIMITY_NORM_DIST = 60;

/** mobility スコアの正規化距離(m) */
const MOBILITY_NORM_DIST = 50;

/** calling 強度のペナルティ閾値 */
const CALLING_INTENSITY_THRESHOLD = 0.3;

/** calling 強度ペナルティ係数 */
const CALLING_INTENSITY_PENALTY_FACTOR = 0.5;

/** 到達時間ペナルティ比率（相手がこの比率より速いならペナルティ） */
const ARRIVAL_TIME_PENALTY_RATIO = 0.8;

/** 到達時間ペナルティ量 */
const ARRIVAL_TIME_PENALTY = 0.4;

/** hold スコアのデフォルト値 */
const HOLD_SCORE_DEFAULT = 0.1;

/** awareness 低下による hold スコア加算係数 */
const AWARENESS_HOLD_BOOST = 0.15;

/** awareness が低い場合バックアップ計算をスキップする閾値 */
const BACKUP_AWARENESS_MIN = 50;

/** フライの中継カットオフ判定距離(m) */
const RELAY_DISTANCE_THRESHOLD = 60;

/** リレースコア */
const RELAY_SCORE = 0.8;

/** カバースコア: 誰もいない塁 */
const COVER_SCORE_UNCOVERED = 1.0;

/** カバースコア: 走者進塁先 urgency ボーナス */
const COVER_URGENCY_BONUS = 0.2;

/** カバースコアの近接性正規化距離(m) */
const COVER_PROXIMITY_NORM_DIST = 30;

/**
 * ゴロインターセプト時の捕球リーチ係数。
 * fielding-agent.ts の checkGroundBallIntercept と一致させること。
 * 移動中のゴロ捕球: 伸身・逆シングル・飛びつきを含む実効リーチ。
 */
const GROUND_INTERCEPT_REACH_FACTOR = 1.0;

/** チェーシング（停止球を追う）のarrivalMargin上限。インターセプトより低く抑える */
const CHASE_ARRIVAL_MARGIN_CAP = 0.3;

/** ゴロ時のカバースコア減衰。追跡が最優先で、カバーは補助的行動 */
const GROUND_BALL_COVER_DAMPING = 0.5;

// ====================================================================
// 型定義
// ====================================================================

interface BaseRunners {
  first: unknown | null;
  second: unknown | null;
  third: unknown | null;
}

/** 行動候補とそのスコア */
export interface ActionScore {
  action: "pursuit" | "cover" | "backup" | "hold";
  score: number;
  target: Vec2;
  /** cover/backup の詳細 */
  coverBase?: keyof typeof BASE_POSITIONS;
}

/** チームメイト観察結果 */
export interface TeammateObservation {
  /** PURSUING 中のエージェント */
  pursuers: readonly FielderAgent[];
  /** 各塁をカバー中のエージェントのポジション識別子 */
  coveredBases: Set<string>;
  /** 最も強い calling 強度 */
  strongestCallingNearby: number;
  /** 最も近い追跡者の到達時間 */
  bestPursuerArrivalTime: number;
  /** 全エージェント参照（内野手のOFフライ参加抑制判定に使用） */
  allAgents: readonly FielderAgent[];
}

// ====================================================================
// メインエントリポイント
// ====================================================================

/**
 * 2パス方式の自律行動決定。
 * fielding-agent.ts のティックループから呼ばれる。
 *
 * 使い方:
 *   // Pass 1: 全員の raw pursuit score を計算（順序非依存）
 *   for (agent of agents) calcAndStorePursuitScore(agent, ...);
 *   // Pass 2: 全員のスコアを見て最終判断
 *   for (agent of agents) autonomousDecide(agent, ...);
 */

/** Pass 1: 各エージェントの raw pursuit score を計算し pursuitScore/pursuitTarget に保存 */
export function calcAndStorePursuitScore(
  agent: FielderAgent,
  allAgents: readonly FielderAgent[],
  trajectory: BallTrajectory,
  t: number
): void {
  const agentMut = agent as {
    pursuitScore?: number;
    pursuitTarget?: Vec2;
    estimatedArrivalTime?: number;
  };

  // スキップ条件
  if (agent.reactionRemaining > 0 ||
      agent.state === "FIELDING" || agent.state === "THROWING" ||
      agent.hasYielded) {
    agentMut.pursuitScore = -1;
    return;
  }

  // 高い打球で遠方のBACKING_UP → pursuit しない（近距離は再評価可能）
  if (agent.state === "BACKING_UP" && trajectory.maxHeight > HIGH_BALL_THRESHOLD) {
    const distToLanding = vec2Distance(agent.currentPos, trajectory.landingPos);
    if (distToLanding > BACKUP_DRIFT_THRESHOLD) {
      agentMut.pursuitScore = -1;
      return;
    }
  }

  // 高い打球で既にPURSUING → 現在のスコアを維持
  if (agent.state === "PURSUING" && trajectory.maxHeight > HIGH_BALL_THRESHOLD) {
    return;
  }

  const observation = observeTeammates(agent, allAgents, trajectory);
  const score = calcPursuitScore(agent, observation, trajectory, t);
  agentMut.pursuitScore = score.score;
  agentMut.pursuitTarget = score.target;
  agentMut.estimatedArrivalTime = estimateArrivalTime(agent, trajectory, t);
}

/** Pass 2: pursuitScore を踏まえて最終行動決定（pursuit を再計算しない） */
export function autonomousDecide(
  agent: FielderAgent,
  allAgents: readonly FielderAgent[],
  trajectory: BallTrajectory,
  t: number,
  bases: BaseRunners,
  outs: number
): void {
  // スキップ条件
  if (agent.reactionRemaining > 0 ||
      agent.state === "FIELDING" || agent.state === "THROWING" ||
      agent.hasYielded) return;

  // 高い打球で遠方のBACKING_UP → 目標を維持（近距離は再評価可能）
  if (agent.state === "BACKING_UP" && trajectory.maxHeight > HIGH_BALL_THRESHOLD) {
    const distToLanding = vec2Distance(agent.currentPos, trajectory.landingPos);
    if (distToLanding > BACKUP_DRIFT_THRESHOLD) {
      return;
    }
  }

  // 高い打球で既にPURSUING → 知覚更新のみ
  if (agent.state === "PURSUING" && trajectory.maxHeight > HIGH_BALL_THRESHOLD) {
    agent.targetPos = agent.perceivedLanding.position;
    return;
  }

  // pursuit スコアは Pass 1 の結果を使用（順序非依存にするため再計算しない）
  let myPursuitScore = agent.pursuitScore ?? -1;
  const myPursuitTarget = agent.pursuitTarget ?? agent.perceivedLanding.position;

  // コーディネーション: 低い打球は2人追跡可能、高い打球は1人のみ
  if (myPursuitScore > 0) {
    const maxConcurrentPursuers = trajectory.maxHeight < CONCURRENT_PURSUIT_HEIGHT ? 2 : 1;
    let betterCount = 0;
    for (const other of allAgents) {
      if (other === agent) continue;
      const otherScore = other.pursuitScore ?? -1;
      if (otherScore > myPursuitScore) {
        betterCount++;
        if (betterCount >= maxConcurrentPursuers) {
          myPursuitScore = -1;
          break;
        }
      }
    }
  }

  // 非pursuit行動のスコアを計算（cover, backup, hold はチーム状況依存なので Pass 2 で計算）
  const observation = observeTeammates(agent, allAgents, trajectory);
  const scores: ActionScore[] = [];
  scores.push({ action: "pursuit", score: myPursuitScore, target: myPursuitTarget });
  const coverScores = calcCoverScores(agent, observation, trajectory, bases, outs);
  // カバー減衰: 打球高さ+着弾距離の連続関数
  // 低い打球(ゴロ/低ライナー): 追跡優先でカバー弱め(0.5)
  // 近距離フライ(ポップ20m): 追跡優先(0.25)
  // 遠距離フライ(60m+): カバー重要(0.7)
  const coverDamping = trajectory.maxHeight < HIGH_BALL_THRESHOLD
    ? GROUND_BALL_COVER_DAMPING
    : clamp(trajectory.landingDistance / 80, 0.15, 0.7);
  for (const s of coverScores) {
    s.score *= coverDamping;
  }
  scores.push(...coverScores);
  scores.push(calcBackupScore(agent, observation, trajectory, bases));
  scores.push(calcHoldScore(agent));

  applyDecision(agent, scores, trajectory);
}

// ====================================================================
// 味方観察
// ====================================================================

function observeTeammates(
  agent: FielderAgent,
  allAgents: readonly FielderAgent[],
  _trajectory: BallTrajectory
): TeammateObservation {
  const pursuers: FielderAgent[] = [];
  const coveredBases = new Set<string>();
  let strongestCallingNearby = 0;
  let bestPursuerArrivalTime = Infinity;

  for (const other of allAgents) {
    if (other === agent) continue;

    if (other.state === "PURSUING") {
      pursuers.push(other);
      const calling = other.callingIntensity ?? 0;
      if (calling > strongestCallingNearby) {
        strongestCallingNearby = calling;
      }
      const arrivalTime = other.estimatedArrivalTime ?? Infinity;
      if (arrivalTime < bestPursuerArrivalTime) {
        bestPursuerArrivalTime = arrivalTime;
      }
    }

    // targetPos からどの塁をカバーしているか推定
    if (other.state === "COVERING" && other.action === "cover_base") {
      const base = inferCoveredBase(other);
      if (base) coveredBases.add(base);
    }
  }

  return {
    pursuers,
    coveredBases,
    strongestCallingNearby,
    bestPursuerArrivalTime,
    allAgents,
  };
}

/** targetPos からどの塁をカバーしているか推定 */
function inferCoveredBase(agent: FielderAgent): keyof typeof BASE_POSITIONS | null {
  const tp = agent.targetPos;
  const threshold = 3.0;
  for (const [name, pos] of Object.entries(BASE_POSITIONS)) {
    const d = vec2Distance(tp, pos as Vec2);
    if (d <= threshold) return name as keyof typeof BASE_POSITIONS;
  }
  return null;
}

// ====================================================================
// 行動スコアリング
// ====================================================================

// ====================================================================
// pursuit スコア計算
// ====================================================================

function calcPursuitScore(
  agent: FielderAgent,
  observation: TeammateObservation,
  trajectory: BallTrajectory,
  t: number
): ActionScore {
  const landingPos = trajectory.landingPos;
  const perceived = agent.perceivedLanding.position;

  // 到達可能性チェック
  const timeRemaining = Math.max(0, trajectory.flightTime - t);

  let canReach = false;
  let arrivalMargin = 0;
  // ゴロのインターセプト点（pursuit target として使う）
  let groundTarget: Vec2 | null = null;

  if (trajectory.isGroundBall) {
    // ゴロ: 経路インターセプト計算
    const interceptResult = calcGroundBallIntercept(agent, trajectory, t);
    if (interceptResult) {
      canReach = interceptResult.canReach;
      arrivalMargin = interceptResult.margin;
      if (canReach) {
        groundTarget = interceptResult.point;
        // interceptPoint と interceptBallTime を設定（捕球判定で使用）
        (agent as { interceptPoint?: Vec2 }).interceptPoint = interceptResult.point;
        (agent as { interceptBallTime?: number }).interceptBallTime = interceptResult.ballTime;
      }
    }
    // インターセプト不可でも停止球チェーシングを試行
    if (!canReach) {
      const distToPerceived = vec2Distance(agent.currentPos, perceived);
      const chaseDeadline = trajectory.flightTime + 4.0;
      const chaseTime = distToPerceived / agent.maxSpeed + agent.reactionRemaining;
      if (t + chaseTime < chaseDeadline) {
        canReach = true;
        // チェーシングのマージンはインターセプトより低く抑える（CHASE_ARRIVAL_MARGIN_CAP）
        arrivalMargin = clamp(1 - chaseTime / chaseDeadline, 0, 1) * CHASE_ARRIVAL_MARGIN_CAP;
        groundTarget = null; // 停止球チェーシング: targetPos = perceived
      }
    }
  } else {
    // フライ/ライナー/ポップ: 到達距離で判定
    const catchReach = calcCatchReach(agent);
    const reachable = calcReachableDistanceAuto(agent.maxSpeed, agent.reactionRemaining, timeRemaining + 1.0);
    const distToPerceived = vec2Distance(agent.currentPos, perceived);
    const effectiveRange = reachable + catchReach;
    canReach = distToPerceived <= effectiveRange;
    if (effectiveRange > 0) {
      arrivalMargin = clamp((effectiveRange - distToPerceived) / effectiveRange, 0, 1);
    }
  }

  if (!canReach) {
    return { action: "pursuit", score: -1, target: landingPos };
  }

  // proximity: homePos（デフォルト位置）からの距離
  // ゴロはインターセプト点、フライは着弾点を基準にする
  const homePos = agent.homePos ?? getDefaultPos(agent.pos) ?? agent.currentPos;
  const proximityRef = groundTarget ?? landingPos;
  const homeDist = vec2Distance(homePos, proximityRef);
  const proximity = clamp(1 - homeDist / PROXIMITY_NORM_DIST, 0, 1);

  // mobility: currentPos からの距離
  const mobilityRef = groundTarget ?? perceived;
  const moveDist = vec2Distance(agent.currentPos, mobilityRef);
  const mobility = clamp(1 - moveDist / MOBILITY_NORM_DIST, 0, 1);

  // コーディネーションペナルティ
  let coordPenalty = 0;
  const myTime = estimateArrivalTime(agent, trajectory, t);
  (agent as { estimatedArrivalTime?: number }).estimatedArrivalTime = myTime;

  for (const p of observation.pursuers) {
    if ((p as FielderAgent) === agent) continue;
    const pCalling = p.callingIntensity ?? 0;
    if (pCalling > CALLING_INTENSITY_THRESHOLD) {
      coordPenalty += pCalling * CALLING_INTENSITY_PENALTY_FACTOR;
    }
    const theirTime = p.estimatedArrivalTime ?? Infinity;
    if (theirTime < myTime * ARRIVAL_TIME_PENALTY_RATIO) {
      coordPenalty += ARRIVAL_TIME_PENALTY;
    }
  }

  const score = clamp(
    proximity * 0.3 + mobility * 0.2 + arrivalMargin * 0.4 - coordPenalty,
    -1,
    1
  );

  // ゴロ: インターセプト点がある場合はそちらをtargetに（着弾位置ではなく経路上のインターセプト点に走る）
  const pursuitTarget = groundTarget ?? perceived;
  return { action: "pursuit", score, target: pursuitTarget };
}

// ====================================================================
// cover スコア計算
// ====================================================================

function calcCoverScores(
  agent: FielderAgent,
  observation: TeammateObservation,
  trajectory: BallTrajectory,
  bases: BaseRunners,
  _outs: number
): ActionScore[] {
  const results: ActionScore[] = [];

  // リレー判定: 高い打球で着弾距離が長い場合
  if (trajectory.maxHeight > HIGH_BALL_THRESHOLD && trajectory.landingDistance >= RELAY_DISTANCE_THRESHOLD) {
    const relayResult = calcRelayScore(agent, observation, trajectory);
    if (relayResult) results.push(relayResult);
  }

  // 各塁のカバースコア
  const baseEntries: Array<{ name: keyof typeof BASE_POSITIONS; pos: Vec2; runner: unknown | null }> = [
    { name: "first", pos: BASE_POSITIONS.first, runner: null },
    { name: "second", pos: BASE_POSITIONS.second, runner: null },
    { name: "third", pos: BASE_POSITIONS.third, runner: null },
    { name: "home", pos: BASE_POSITIONS.home, runner: null },
  ];

  for (const entry of baseEntries) {
    const isCovered = observation.coveredBases.has(entry.name);
    if (isCovered) {
      results.push({ action: "cover", score: 0, target: entry.pos, coverBase: entry.name });
      continue;
    }

    // 近接性スコア
    const distToBase = vec2Distance(agent.currentPos, entry.pos);
    const coverProximity = clamp(1 - distToBase / COVER_PROXIMITY_NORM_DIST, 0, 1);

    // urgency: 走者が進塁してくる可能性
    let urgency = 0;
    if (entry.name === "second" && bases.first) urgency = COVER_URGENCY_BONUS;
    if (entry.name === "third" && bases.second) urgency = COVER_URGENCY_BONUS;
    if (entry.name === "home" && bases.third) urgency = COVER_URGENCY_BONUS;

    const score = clamp(COVER_SCORE_UNCOVERED * coverProximity + urgency, 0, 1);
    results.push({ action: "cover", score, target: entry.pos, coverBase: entry.name });
  }

  return results;
}

function calcRelayScore(
  agent: FielderAgent,
  observation: TeammateObservation,
  trajectory: BallTrajectory
): ActionScore | null {
  // 既にリレーしている味方がいたらスキップ
  const someoneRelaying = (observation.pursuers as FielderAgent[]).some(
    a => a.action === "relay"
  );
  if (someoneRelaying) return null;

  // カットオフ位置への近接性でスコア計算（全野手がリレー候補）
  const cutoffPos = calcCutoffPosition(trajectory);
  const dist = vec2Distance(agent.currentPos, cutoffPos);
  const proximity = clamp(1 - dist / 30, 0, 1);
  if (proximity <= 0.3) return null;

  return { action: "cover", score: RELAY_SCORE * proximity, target: cutoffPos };
}

// ====================================================================
// backup スコア計算
// ====================================================================

function calcBackupScore(
  agent: FielderAgent,
  _observation: TeammateObservation,
  trajectory: BallTrajectory,
  bases: BaseRunners
): ActionScore {
  const awareness = (agent.skill as { awareness?: number }).awareness ?? 50;

  // awareness が低すぎる場合はバックアップ計算をスキップ
  if (awareness < BACKUP_AWARENESS_MIN) {
    return { action: "backup", score: 0, target: agent.currentPos };
  }

  // 送球先を予測
  const throwTarget = predictThrowTarget(trajectory, bases);
  const backupPos = calcBackupPos(trajectory, throwTarget);

  // 自分がバックアップ位置に近いかスコア化
  const distToBackup = vec2Distance(agent.currentPos, backupPos);
  const backupProximity = clamp(1 - distToBackup / COVER_PROXIMITY_NORM_DIST, 0, 1);

  // 着地点から遠い場合はドリフト（全野手適用）
  const distToLanding = vec2Distance(agent.currentPos, trajectory.landingPos);
  if (distToLanding >= BACKUP_DRIFT_THRESHOLD) {
    const driftRatio = DRIFT_RATIO_MIN + (agent.skill.fielding / 100) * (DRIFT_RATIO_MAX - DRIFT_RATIO_MIN);
    const driftTarget = {
      x: agent.currentPos.x + (backupPos.x - agent.currentPos.x) * driftRatio,
      y: agent.currentPos.y + (backupPos.y - agent.currentPos.y) * driftRatio,
    };
    const score = backupProximity * 0.5;
    return { action: "backup", score, target: driftTarget };
  }

  const score = backupProximity * 0.6;
  return { action: "backup", score, target: backupPos };
}

/** ゴロ/フライの状況から送球先を予測 */
function predictThrowTarget(trajectory: BallTrajectory, bases: BaseRunners): keyof typeof BASE_POSITIONS {
  if (trajectory.isGroundBall) {
    if (bases.first) return "second";
    return "first";
  }
  if (bases.third) return "home";
  return "second";
}

// ====================================================================
// hold スコア計算
// ====================================================================

function calcHoldScore(agent: FielderAgent): ActionScore {
  let holdScore = HOLD_SCORE_DEFAULT;

  // awareness が低い選手は hold スコアが相対的に上がる
  const awareness = (agent.skill as { awareness?: number }).awareness ?? 50;
  holdScore += (1 - awareness / 100) * AWARENESS_HOLD_BOOST;

  const target = agent.homePos ?? getDefaultPos(agent.pos) ?? agent.currentPos;
  return { action: "hold", score: holdScore, target };
}

// ====================================================================
// 行動適用
// ====================================================================

function applyDecision(
  agent: FielderAgent,
  scores: ActionScore[],
  trajectory: BallTrajectory
): void {
  // 降順ソート
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const best = sorted[0];

  if (!best || best.score < 0) {
    // 全て score < 0（到達不可等） → hold にフォールバック
    const holdScore = scores.find(s => s.action === "hold");
    if (holdScore) {
      applyHold(agent, holdScore);
    }
    return;
  }

  switch (best.action) {
    case "pursuit":
      applyPursuit(agent, best, trajectory);
      break;
    case "cover":
      applyCover(agent, best);
      break;
    case "backup":
      applyBackup(agent, best);
      break;
    case "hold":
      applyHold(agent, best);
      break;
  }
}

function applyPursuit(agent: FielderAgent, score: ActionScore, trajectory: BallTrajectory): void {
  agent.state = "PURSUING";
  agent.targetPos = score.target;
  (agent as { callingIntensity?: number }).callingIntensity = clamp(score.score, 0, 1);
  (agent as { pursuitScore?: number }).pursuitScore = score.score;

  // 打球との相対位置で action を決定
  const perceived = score.target;
  if (perceived.y < agent.currentPos.y - 2) {
    agent.action = "charge";
  } else if (perceived.y > agent.currentPos.y + 5) {
    agent.action = "retreat";
  } else {
    agent.action = "lateral";
  }

  // ゴロ: field_ball アクション（停止球チェーシング）
  if (trajectory.isGroundBall && !(agent as { interceptPoint?: Vec2 }).interceptPoint) {
    agent.action = "field_ball";
  }
}

function applyCover(agent: FielderAgent, score: ActionScore): void {
  agent.state = "COVERING";
  agent.targetPos = score.target;

  // リレーかベースカバーかを score と target で判断
  // リレーはカットオフ位置（着弾位置の40%地点）に向かう
  const landingDist = Math.sqrt(score.target.x ** 2 + score.target.y ** 2);
  const isLikelyRelay = landingDist > 0 && landingDist < 50 && score.score === RELAY_SCORE;
  agent.action = isLikelyRelay ? "relay" : "cover_base";
}

function applyBackup(agent: FielderAgent, score: ActionScore): void {
  agent.state = "BACKING_UP";
  agent.action = "backup";
  agent.targetPos = score.target;
}

function applyHold(agent: FielderAgent, score: ActionScore): void {
  agent.state = "HOLDING";
  agent.action = "hold";
  agent.targetPos = score.target;
}

// ====================================================================
// ヘルパー関数
// ====================================================================

/**
 * 到達可能距離計算。
 * fielding-agent.ts の calcReachableDistance と同等のロジック。
 */
function calcReachableDistanceAuto(
  maxSpeed: number,
  reactionRemaining: number,
  tRemaining: number
): number {
  const moveTime = tRemaining - reactionRemaining;
  if (moveTime <= 0) return 0;

  const accelTime = AGENT_ACCELERATION_TIME;
  const a = maxSpeed / accelTime;

  if (moveTime <= accelTime) {
    return 0.5 * a * moveTime * moveTime;
  }

  const accelDist = 0.5 * a * accelTime * accelTime;
  const cruiseDist = maxSpeed * (moveTime - accelTime);
  return accelDist + cruiseDist;
}

/**
 * 捕球リーチ計算。
 * fielding-agent.ts の getCatchReach と同等のロジック。
 */
function calcCatchReach(agent: FielderAgent): number {
  return CATCH_REACH_BASE + (agent.skill.fielding / 100) * CATCH_REACH_SKILL_FACTOR;
}

/**
 * ゴロ経路インターセプト計算。
 * fielding-agent.ts の calcPathIntercept と同等のロジック。
 */
function calcGroundBallIntercept(
  agent: FielderAgent,
  trajectory: BallTrajectory,
  t: number
): { canReach: boolean; point: Vec2; ballTime: number; margin: number } | null {
  if (!trajectory.isGroundBall) return null;

  const landing = trajectory.landingPos;
  const maxDist = trajectory.landingDistance;
  const stopTime = trajectory.flightTime;

  let pathDirX: number;
  let pathDirY: number;
  if (trajectory.pathDirX !== undefined && trajectory.pathDirY !== undefined) {
    pathDirX = trajectory.pathDirX;
    pathDirY = trajectory.pathDirY;
  } else {
    const pathLen = Math.sqrt(landing.x * landing.x + landing.y * landing.y);
    if (pathLen < 0.1) return null;
    pathDirX = landing.x / pathLen;
    pathDirY = landing.y / pathLen;
  }

  const projDist = agent.currentPos.x * pathDirX + agent.currentPos.y * pathDirY;
  if (projDist < 0) return null;

  const rawCatchReach = calcCatchReach(agent);
  // 物理チェック(fielding-agent.ts)と同じ0.7係数を適用して一貫性を確保
  const interceptReach = rawCatchReach * GROUND_INTERCEPT_REACH_FACTOR;
  const perpX = agent.currentPos.x - projDist * pathDirX;
  const perpY = agent.currentPos.y - projDist * pathDirY;
  const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);

  // 初期フィルタ: 経路に到達不可能なら早期リターン（残り時間ベース）
  const tRemainingTotal = Math.max(0, stopTime - t);
  const maxReachable = calcReachableDistanceAuto(agent.maxSpeed, agent.reactionRemaining, tRemainingTotal) + interceptReach;
  if (perpDist > maxReachable) return null;

  // 最初に到達可能な地点（earliest intercept）を探す
  // 理由: best-margin（停止点）を使うと外野深くの停止点を返し、内野手が不必要に遠くまで追跡する
  let earliestPoint: Vec2 | null = null;
  let earliestBallTime = 0;
  let earliestMargin = 0;

  const stepSize = 1.5;
  for (let d = 0.5; d <= maxDist; d += stepSize) {
    const ratio = d / maxDist;
    if (ratio >= 1) continue;
    const p = 1 - Math.sqrt(Math.max(0, 1 - ratio));
    const ballTime = p * stopTime;
    if (ballTime < t) continue;

    const ix = d * pathDirX;
    const iy = d * pathDirY;
    const ddx = agent.currentPos.x - ix;
    const ddy = agent.currentPos.y - iy;
    const fielderDist = Math.sqrt(ddx * ddx + ddy * ddy);

    const tRemaining = ballTime - t;
    const reachable = calcReachableDistanceAuto(agent.maxSpeed, agent.reactionRemaining, tRemaining) + interceptReach;
    const margin = reachable - fielderDist;

    if (margin >= 0) {
      // 最初に到達可能な地点 = earliest intercept
      earliestPoint = { x: ix, y: iy };
      earliestBallTime = ballTime;
      earliestMargin = margin;
      break;
    }
  }

  // 経路上で到達不可でも停止点に間に合うかチェック
  if (!earliestPoint) {
    const sdx = agent.currentPos.x - landing.x;
    const sdy = agent.currentPos.y - landing.y;
    const fielderDist = Math.sqrt(sdx * sdx + sdy * sdy);
    const tRemaining = stopTime - t;
    const reachable = calcReachableDistanceAuto(agent.maxSpeed, agent.reactionRemaining, tRemaining) + interceptReach;
    const margin = reachable - fielderDist;
    if (margin >= 0) {
      earliestPoint = { x: landing.x, y: landing.y };
      earliestBallTime = stopTime;
      earliestMargin = margin;
    }
  }

  if (!earliestPoint) return null;

  // margin を [0,1] に正規化
  // インターセプト可能 = 基本 0.5、余裕があるほど最大 1.0 に近づく
  // 5m基準: 余裕5m以上なら十分余裕ありとみなす
  const normalizedMargin = 0.5 + 0.5 * clamp(earliestMargin / 5.0, 0, 1);

  return {
    canReach: true,
    point: earliestPoint,
    ballTime: earliestBallTime,
    margin: normalizedMargin,
  };
}

/** 到達推定時刻を計算 */
function estimateArrivalTime(
  agent: FielderAgent,
  trajectory: BallTrajectory,
  _t: number
): number {
  const perceived = agent.perceivedLanding.position;
  const dist = vec2Distance(agent.currentPos, perceived);
  if (agent.maxSpeed <= 0) return Infinity;

  // 加速フェーズを考慮した到達時間の近似
  const accelTime = AGENT_ACCELERATION_TIME;
  const accelDist = 0.5 * agent.maxSpeed * accelTime;

  if (dist <= accelDist) {
    // 加速フェーズ内で到達
    const a = agent.maxSpeed / accelTime;
    return Math.sqrt((2 * dist) / a) + agent.reactionRemaining;
  }

  const remainingDist = dist - accelDist;
  return accelTime + remainingDist / agent.maxSpeed + agent.reactionRemaining;
}

/** バックアップ位置計算 */
function calcBackupPos(trajectory: BallTrajectory, _throwTarget: keyof typeof BASE_POSITIONS): Vec2 {
  const landingPos = trajectory.landingPos;
  const angleRad = ((trajectory.direction - 45) * Math.PI) / 180;
  const backupDist = 8;
  return {
    x: landingPos.x + backupDist * Math.sin(angleRad),
    y: landingPos.y + backupDist * Math.cos(angleRad),
  };
}

/** カットオフ位置計算（着弾点の40%地点） */
function calcCutoffPosition(trajectory: BallTrajectory): Vec2 {
  const landing = trajectory.landingPos;
  return {
    x: landing.x * 0.4,
    y: landing.y * 0.4,
  };
}

/** ポジション番号からデフォルト守備位置を取得 */
function getDefaultPos(pos: FielderPosition): Vec2 | null {
  const defPos = DEFAULT_FIELDER_POSITIONS.get(pos);
  if (!defPos) return null;
  return { x: defPos.x, y: defPos.y };
}
