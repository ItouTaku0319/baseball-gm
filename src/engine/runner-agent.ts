/**
 * ランナーエージェント — 統一ティックループ用
 *
 * 打球発生の瞬間からランナーを生成し、毎ティック自律的に判断・移動する。
 * Phase 1（捕球前）/ Phase 2（捕球後）を通じてrunners[]一本で管理する。
 */
import type { Player } from "../models/player";
import type {
  Vec2,
  BallTrajectory,
  RunnerAgent,
  RunnerState,
  FielderAgent,
  ThrowBallState,
  UnifiedBallState,
} from "./fielding-agent-types";
import {
  BASE_POSITIONS,
  BASE_LENGTH,
  vec2Distance,
  clamp,
  gaussianRandom,
  getBasePosition,
  interpolateBasepath,
} from "./fielding-agent-types";
import {
  RUNNER_SPEED_BASE,
  RUNNER_SPEED_SCALE,
  RUNNER_LEAD_DISTANCE,
  RUNNER_LEAD_SPEED,
  RUNNER_RETREAT_SPEED_RATIO,
  RUNNER_LEAD_REACTION_TIME,
  BATTER_SWING_TO_RUN_TIME,
  RUNNER_GROUND_HESITATION_DIST,
  EXTRA_BASE_ROUNDING_TIME,
  EXTRA_BASE_ROUNDING_FATIGUE,
  EXTRA_BASE_GO_THRESHOLD,
  EXTRA_BASE_DECISION_NOISE,
  TAGUP_ARM_PERCEPTION_NOISE,
  TAGUP_GO_THRESHOLD,
  TAGUP_DECISION_NOISE,
  TAGUP_DELAY,
  SF_CATCH_TO_THROW_OVERHEAD,
  SECURING_TIME_BASE,
  THROW_SPEED_BASE,
  THROW_SPEED_ARM_SCALE,
  PIVOT_TIME,
  GROUND_ADVANCE_GO_THRESHOLD,
  GROUND_ADVANCE_DECISION_NOISE,
  RETRIEVER_PICKUP_TIME,
  RETRIEVER_APPROACH_FACTOR,
  OUTFIELD_DEPTH_THRESHOLD,
} from "./physics-constants";

// --- ヘルパー ---

function calcRunnerSpeed(player: Player): number {
  return RUNNER_SPEED_BASE + (player.batting.speed / 100) * RUNNER_SPEED_SCALE;
}

function makeRunnerSkill(player: Player) {
  return {
    speed: player.batting.speed,
    baseRunning: player.batting.baseRunning ?? 50,
  };
}

interface BaseRunners {
  first: Player | null;
  second: Player | null;
  third: Player | null;
}

// --- 送球速度・準備時間（fielding-agent.tsからも使用） ---

/** 野手の送球速度を計算（位置に応じて内野/外野を自動判定） */
export function calcThrowSpeed(agent: FielderAgent): number {
  const distFromHome = Math.sqrt(agent.currentPos.x ** 2 + agent.currentPos.y ** 2);
  if (distFromHome > OUTFIELD_DEPTH_THRESHOLD) {
    // 外野: 長距離送球は制御重視で速度が落ちる
    return 25 + (agent.skill.arm / 100) * 15;
  }
  // 内野: 短距離クイックスロー
  return THROW_SPEED_BASE + (agent.skill.arm / 100) * THROW_SPEED_ARM_SCALE;
}

/** 捕球→送球準備の所要時間を計算 */
export function calcSecuringTime(agent: FielderAgent): number {
  return SECURING_TIME_BASE + (1 - agent.skill.fielding / 100) * 0.15;
}

// ====================================================================
// 初期化
// ====================================================================

/**
 * 打球発生時にランナーを統一初期化する。
 * バッター + 既存ランナーをすべてHOLDING状態で生成。
 * フォースフラグは呼び出し側で設定する。
 */
export function initRunnersUnified(
  batter: Player,
  bases: BaseRunners,
): RunnerAgent[] {
  const runners: RunnerAgent[] = [];

  // バッター: HOLDING（走り始めまで待機）
  runners.push({
    player: batter,
    state: "HOLDING",
    currentPos: { ...BASE_POSITIONS.home },
    fromBase: 0,
    targetBase: 1,
    speed: calcRunnerSpeed(batter),
    progress: 0,
    isBatter: true,
    isForced: true,
    skill: makeRunnerSkill(batter),
    originalBase: 0,
  });

  if (bases.first) {
    runners.push({
      player: bases.first,
      state: "HOLDING",
      currentPos: { ...BASE_POSITIONS.first },
      fromBase: 1,
      targetBase: 1,
      speed: calcRunnerSpeed(bases.first),
      progress: 0,
      isBatter: false,
      isForced: false,
      skill: makeRunnerSkill(bases.first),
      originalBase: 1,
    });
  }

  if (bases.second) {
    runners.push({
      player: bases.second,
      state: "HOLDING",
      currentPos: { ...BASE_POSITIONS.second },
      fromBase: 2,
      targetBase: 2,
      speed: calcRunnerSpeed(bases.second),
      progress: 0,
      isBatter: false,
      isForced: false,
      skill: makeRunnerSkill(bases.second),
      originalBase: 2,
    });
  }

  if (bases.third) {
    runners.push({
      player: bases.third,
      state: "HOLDING",
      currentPos: { ...BASE_POSITIONS.third },
      fromBase: 3,
      targetBase: 3,
      speed: calcRunnerSpeed(bases.third),
      progress: 0,
      isBatter: false,
      isForced: false,
      skill: makeRunnerSkill(bases.third),
      originalBase: 3,
    });
  }

  return runners;
}

// ====================================================================
// Phase 1: 捕球前のランナー更新
// ====================================================================

/**
 * 捕球前のランナー毎ティック更新。
 * ボール飛行中のバッター走り出し・フォース走塁・非フォース飛び出し・フライリードを処理。
 */
export function updateRunnerPreCatch(
  runner: RunnerAgent,
  ball: UnifiedBallState,
  agents: readonly FielderAgent[],
  t: number,
  dt: number,
  rng: () => number,
): void {
  const isGrounder = ball.trajectory.isGroundBall;

  // バッター: スイング後一定時間で走り出し
  if (runner.isBatter) {
    if (runner.state === "HOLDING" && t >= BATTER_SWING_TO_RUN_TIME) {
      runner.state = "RUNNING";
    }
    if (runner.state === "RUNNING") {
      moveRunnerBasic(runner, dt);
    }
    return;
  }

  // ゴロ時
  if (isGrounder) {
    if (runner.isForced) {
      // フォースランナー: 全力走塁
      if (runner.state === "HOLDING") runner.state = "RUNNING";
      if (runner.state === "RUNNING") {
        moveRunnerBasic(runner, dt);
      }
    } else {
      // 非フォースランナー: 飛び出し（RUNNER_GROUND_HESITATION_DISTまで）
      if (runner.state === "HOLDING") {
        runner.state = "LEADING";
      }
      if (runner.state === "LEADING") {
        const nextBase = runner.fromBase + 1;
        if (nextBase <= 4) {
          const fromPos = getBasePosition(runner.fromBase);
          const toPos = getBasePosition(nextBase);
          const dx = toPos.x - fromPos.x;
          const dy = toPos.y - fromPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxFraction = RUNNER_GROUND_HESITATION_DIST / dist;
          const targetX = fromPos.x + dx * maxFraction;
          const targetY = fromPos.y + dy * maxFraction;
          const diffX = targetX - runner.currentPos.x;
          const diffY = targetY - runner.currentPos.y;
          const diffDist = Math.sqrt(diffX * diffX + diffY * diffY);
          if (diffDist > 0.05) {
            const moveDist = RUNNER_LEAD_SPEED * dt;
            if (moveDist >= diffDist) {
              runner.currentPos.x = targetX;
              runner.currentPos.y = targetY;
            } else {
              runner.currentPos.x += (diffX / diffDist) * moveDist;
              runner.currentPos.y += (diffY / diffDist) * moveDist;
            }
          }
        }
      }
    }
    return;
  }

  // フライ時: リード行動
  runnerAutonomousDecide(runner, ball, agents, t, rng);
  moveLeadingRunner(runner, dt);
}

/**
 * Phase 1での単純な塁間移動。progress更新 + interpolateBasepath。
 * 塁到達時は progress=1.0 で止まる（ROUNDINGには遷移しない）。
 */
export function moveRunnerBasic(runner: RunnerAgent, dt: number): void {
  runner.progress += (runner.speed * dt) / BASE_LENGTH;
  if (runner.progress >= 1.0) {
    runner.progress = 1.0;
  }
  const pos = interpolateBasepath(runner.fromBase, runner.targetBase, runner.progress);
  runner.currentPos.x = pos.x;
  runner.currentPos.y = pos.y;
}

// ====================================================================
// Phase境界: 捕球時のランナー状態遷移
// ====================================================================

/**
 * 捕球イベント時にランナーの状態を遷移させる。
 * earlyRunners→runners転写コードの代替。
 */
export function transitionRunnersOnCatch(
  runners: RunnerAgent[],
  isGrounder: boolean,
  catchSuccess: boolean,
): void {
  if (isGrounder && catchSuccess) {
    // ゴロ捕球成功: フォース→RUNNING継続、非フォースLEADING→RETREATING
    for (const runner of runners) {
      if (runner.isBatter) continue; // バッターはRUNNING継続
      if (runner.isForced) {
        // フォース: RUNNING継続（既にRUNNINGのはず）
      } else if (runner.state === "LEADING") {
        runner.state = "RETREATING";
      }
    }
  } else if (!isGrounder && catchSuccess) {
    // フライ捕球成功: バッター→OUT、他→RETREATING（帰塁開始）
    for (const runner of runners) {
      if (runner.isBatter) {
        runner.state = "OUT";
        continue;
      }
      // タッチアップ先を設定
      runner.targetBase = runner.fromBase + 1;
      if (runner.state === "LEADING" || runner.state === "HOLDING") {
        runner.state = "RETREATING";
      }
    }
  } else {
    // 捕球失敗（ゴロ/フライ共通）
    for (const runner of runners) {
      if (runner.isBatter) continue; // バッターはRUNNING継続
      if (runner.isForced) {
        // フォース: RUNNING継続
      } else if (runner.state === "LEADING") {
        // 非フォース: HOLDINGに戻す（後でdecideHitAdvanceが走る）
        // ゴロの場合は飛び出し位置を維持してRETREATING
        if (isGrounder) {
          runner.state = "RETREATING";
        } else {
          runner.state = "HOLDING";
          // フライの場合は位置を塁上に戻す
          const basePos = getBasePosition(runner.fromBase);
          runner.currentPos.x = basePos.x;
          runner.currentPos.y = basePos.y;
        }
      }
    }
  }
}

// ====================================================================
// Phase 2: 捕球後のランナー移動・判断
// ====================================================================

/** Phase 2のランナー移動（RUNNING/TAGGED_UP状態） */
export function moveRunner(runner: RunnerAgent, dt: number, catchSuccess: boolean): void {
  if (runner.state !== "RUNNING" && runner.state !== "TAGGED_UP") return;
  runner.progress += (runner.speed * dt) / BASE_LENGTH;
  if (runner.progress >= 1.0) {
    runner.progress = 1.0;
    const reachedBase = getBasePosition(runner.targetBase);
    runner.currentPos = { x: reachedBase.x, y: reachedBase.y };
    if (runner.targetBase >= 4) {
      // ホーム到達 → 得点
      runner.state = "SAFE";
    } else if (runner.state === "TAGGED_UP") {
      // タッチアップ到達
      runner.state = "SAFE";
    } else if (!catchSuccess && runner.targetBase < 4) {
      // ヒット時 → ROUNDING（エキストラベース判断へ）
      const basesRun = runner.targetBase - (runner.originalBase ?? 0);
      const fatigue = Math.max(0, basesRun - 1) * EXTRA_BASE_ROUNDING_FATIGUE;
      runner.state = "ROUNDING";
      runner.roundingTimer = EXTRA_BASE_ROUNDING_TIME + fatigue;
    } else {
      // ゴロフォースプレー到達 → 暫定セーフ
      runner.state = "SAFE";
    }
  } else {
    const pos = interpolateBasepath(runner.fromBase, runner.targetBase, runner.progress);
    runner.currentPos.x = pos.x;
    runner.currentPos.y = pos.y;
  }
}

/** タッチアップ判断（DECIDING状態で呼ばれる） */
export function decideTagup(
  runner: RunnerAgent,
  fielder: FielderAgent,
  rng: () => number,
): boolean {
  const targetBasePos = getBasePosition(runner.targetBase);
  const throwDist = vec2Distance(fielder.currentPos, targetBasePos);
  const br = runner.skill?.baseRunning ?? 50;

  const perceivedArm = fielder.skill.arm
    + gaussianRandom(0, TAGUP_ARM_PERCEPTION_NOISE * (1 - br / 100), rng);
  const clampedArm = clamp(perceivedArm, 0, 100);

  const estThrowSpeed = THROW_SPEED_BASE + (clampedArm / 100) * THROW_SPEED_ARM_SCALE;
  const estOverhead = SF_CATCH_TO_THROW_OVERHEAD + SECURING_TIME_BASE;
  const estThrowTime = estOverhead + throwDist / estThrowSpeed;

  const runTime = TAGUP_DELAY + BASE_LENGTH / runner.speed;
  const margin = estThrowTime - runTime;

  const noise = gaussianRandom(0, TAGUP_DECISION_NOISE * (1 - br / 100), rng);
  return (margin + noise) > TAGUP_GO_THRESHOLD;
}

/** ヒット時のエキストラベース判断（ROUNDINGタイマー後に呼ばれる） */
export function decideExtraBase(
  runner: RunnerAgent,
  ballHolder: FielderAgent | null,
  retrieverAgent: FielderAgent | null,
  throwBall: ThrowBallState | null,
  currentTime: number,
  trajectory: BallTrajectory,
  restPos: Vec2,
  rng: () => number,
  getPhase2BallGroundPos: (trajectory: BallTrajectory, restPos: Vec2, t: number, out: Vec2) => { speed: number },
): boolean {
  const nextBase = runner.targetBase + 1;
  if (nextBase > 4) return false;
  const nextBasePos = getBasePosition(nextBase);

  // ボールが次塁に届くまでの推定時間
  let estBallTime: number;
  if (ballHolder) {
    const throwSpeed = calcThrowSpeed(ballHolder);
    const throwDist = vec2Distance(ballHolder.currentPos, nextBasePos);
    estBallTime = calcSecuringTime(ballHolder) + throwDist / throwSpeed;
  } else if (throwBall) {
    const throwRemaining = Math.max(0, throwBall.arrivalTime - currentTime);
    if (throwBall.targetBase === nextBase) {
      estBallTime = throwRemaining;
    } else {
      const relayBasePos = getBasePosition(throwBall.targetBase);
      const relayDist = vec2Distance(relayBasePos, nextBasePos);
      const relaySpeed = THROW_SPEED_BASE + THROW_SPEED_ARM_SCALE * 0.5;
      estBallTime = throwRemaining + SECURING_TIME_BASE + PIVOT_TIME + relayDist / relaySpeed;
    }
  } else if (retrieverAgent) {
    const tmpBuf: Vec2 = { x: 0, y: 0 };
    getPhase2BallGroundPos(trajectory, restPos, currentTime, tmpBuf);
    const distRetrieverToBall = vec2Distance(retrieverAgent.currentPos, tmpBuf);
    const pickupTime = distRetrieverToBall / (retrieverAgent.maxSpeed * 0.8);
    const throwSpeed = calcThrowSpeed(retrieverAgent);
    const throwDist = vec2Distance(tmpBuf, nextBasePos);
    estBallTime = pickupTime + RETRIEVER_PICKUP_TIME + SECURING_TIME_BASE + throwDist / throwSpeed;
  } else {
    estBallTime = 0;
  }

  const basesRun = nextBase - 1;
  const fatigue = Math.max(0, basesRun - 1) * EXTRA_BASE_ROUNDING_FATIGUE;
  const roundingTime = EXTRA_BASE_ROUNDING_TIME + fatigue;
  const estRunTime = roundingTime + BASE_LENGTH / runner.speed;
  const margin = estBallTime - estRunTime;
  const br = runner.skill?.baseRunning ?? 50;
  const noise = gaussianRandom(0, EXTRA_BASE_DECISION_NOISE * (1 - br / 100), rng);
  return (margin + noise) > EXTRA_BASE_GO_THRESHOLD;
}

/** ゴロ時の非フォース走者進塁判断 */
export function decideGroundAdvance(
  runner: RunnerAgent,
  throwBall: ThrowBallState | null,
  currentTime: number,
  rng: () => number,
): boolean {
  if (!throwBall) return false;
  const nextBase = runner.fromBase + 1;
  if (nextBase > 4) return false;
  const nextBasePos = getBasePosition(nextBase);

  const throwRemaining = Math.max(0, throwBall.arrivalTime - currentTime);
  const returnThrowDist = vec2Distance(
    getBasePosition(throwBall.targetBase), nextBasePos);
  const estBallTime = throwRemaining + PIVOT_TIME + returnThrowDist / 35;

  const runTime = BASE_LENGTH / runner.speed;
  const margin = estBallTime - runTime;
  const br = runner.skill?.baseRunning ?? 50;
  const noise = gaussianRandom(0, GROUND_ADVANCE_DECISION_NOISE * (1 - br / 100), rng);
  return (margin + noise) > GROUND_ADVANCE_GO_THRESHOLD;
}

/**
 * 捕球失敗/ヒット時の非フォースランナー進塁判断。
 */
export function decideHitAdvance(
  runner: RunnerAgent,
  retriever: FielderAgent | null,
  holder: FielderAgent | null,
  throwBall: ThrowBallState | null,
  currentTime: number,
  rng: () => number,
): boolean {
  const nextBase = runner.fromBase + 1;
  if (nextBase > 4) return false;
  const nextBasePos = getBasePosition(nextBase);

  const runnerDist = vec2Distance(runner.currentPos, nextBasePos);
  const runnerTime = runnerDist / runner.speed;
  const throwSpeed = THROW_SPEED_BASE + THROW_SPEED_ARM_SCALE * 0.5;

  let fielderTime: number;
  if (throwBall) {
    const throwRemaining = Math.max(0, throwBall.arrivalTime - currentTime);
    const returnThrowDist = vec2Distance(
      getBasePosition(throwBall.targetBase), nextBasePos);
    fielderTime = throwRemaining + PIVOT_TIME + returnThrowDist / throwSpeed;
  } else if (holder) {
    const throwDist = vec2Distance(holder.currentPos, nextBasePos);
    fielderTime = PIVOT_TIME + throwDist / throwSpeed;
  } else if (retriever) {
    const retrieveDist = vec2Distance(retriever.currentPos, retriever.targetPos);
    const retrieveTime = retrieveDist / (retriever.maxSpeed * RETRIEVER_APPROACH_FACTOR);
    const throwDist = vec2Distance(retriever.targetPos, nextBasePos);
    fielderTime = retrieveTime + RETRIEVER_PICKUP_TIME + PIVOT_TIME +
      throwDist / throwSpeed;
  } else {
    return true;
  }

  const margin = fielderTime - runnerTime;
  const br = runner.skill?.baseRunning ?? 50;
  const noise = gaussianRandom(0, GROUND_ADVANCE_DECISION_NOISE * (1 - br / 100), rng);
  return (margin + noise) > GROUND_ADVANCE_GO_THRESHOLD;
}

// ====================================================================
// 自律判断・移動（Phase 1用）
// ====================================================================

/**
 * ランナーの毎ティック自律判断。
 * フライ飛行中: 反応遅延後にリード拡大開始。
 */
export function runnerAutonomousDecide(
  runner: RunnerAgent,
  ball: UnifiedBallState,
  _agents: readonly FielderAgent[],
  t: number,
  _rng: () => number,
): void {
  if (ball.phase === "IN_FLIGHT" && !ball.trajectory.isGroundBall) {
    if (runner.state === "HOLDING" && t > RUNNER_LEAD_REACTION_TIME) {
      startLeading(runner, ball.trajectory);
    }
  }
}

/** ランナーをリード状態に遷移させる */
export function startLeading(
  runner: RunnerAgent,
  _trajectory: BallTrajectory,
): void {
  if (runner.state !== "HOLDING") return;
  runner.state = "LEADING" as RunnerState;

  const nextBase = runner.fromBase + 1;
  if (nextBase > 4) return;
  const fromPos = getBasePosition(runner.fromBase);
  const toPos = getBasePosition(nextBase);
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return;
  const leadFraction = RUNNER_LEAD_DISTANCE / dist;
  runner.currentPos.x = fromPos.x + dx * leadFraction;
  runner.currentPos.y = fromPos.y + dy * leadFraction;
}

/** ランナーを帰塁状態に遷移させる */
export function startRetreating(runner: RunnerAgent): void {
  if (runner.state !== "LEADING" && runner.state !== "HOLDING") return;
  runner.state = "RETREATING" as RunnerState;
  runner.targetBase = runner.fromBase;
}

/** リード中のランナーを移動させる */
export function moveLeadingRunner(runner: RunnerAgent, dt: number): void {
  if (runner.state !== "LEADING") return;

  const nextBase = runner.fromBase + 1;
  if (nextBase > 4) return;
  const fromPos = getBasePosition(runner.fromBase);
  const toPos = getBasePosition(nextBase);
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return;

  const leadFraction = RUNNER_LEAD_DISTANCE / dist;
  const targetX = fromPos.x + dx * leadFraction;
  const targetY = fromPos.y + dy * leadFraction;

  const diffX = targetX - runner.currentPos.x;
  const diffY = targetY - runner.currentPos.y;
  const diffDist = Math.sqrt(diffX * diffX + diffY * diffY);
  if (diffDist < 0.05) return;

  const moveDist = RUNNER_LEAD_SPEED * dt;
  if (moveDist >= diffDist) {
    runner.currentPos.x = targetX;
    runner.currentPos.y = targetY;
  } else {
    runner.currentPos.x += (diffX / diffDist) * moveDist;
    runner.currentPos.y += (diffY / diffDist) * moveDist;
  }
}

/** 帰塁中のランナーを移動させる */
export function moveRetreatingRunner(runner: RunnerAgent, dt: number): void {
  if (runner.state !== "RETREATING") return;

  const basePos = getBasePosition(runner.fromBase);
  const dx = basePos.x - runner.currentPos.x;
  const dy = basePos.y - runner.currentPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) {
    runner.currentPos.x = basePos.x;
    runner.currentPos.y = basePos.y;
    runner.state = "WAITING_TAG";
    return;
  }

  const retreatSpeed = runner.speed * RUNNER_RETREAT_SPEED_RATIO;
  const moveDist = retreatSpeed * dt;
  if (moveDist >= dist) {
    runner.currentPos.x = basePos.x;
    runner.currentPos.y = basePos.y;
    runner.state = "WAITING_TAG";
  } else {
    runner.currentPos.x += (dx / dist) * moveDist;
    runner.currentPos.y += (dy / dist) * moveDist;
  }
}
