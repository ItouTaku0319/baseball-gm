/**
 * エージェントベース守備AI — メインロジック
 *
 * 9人の野手エージェントが独立して知覚・判断・移動し、
 * ボールを追跡・捕球する時間ステップシミュレーション。
 */
import type { Player } from "../models/player";
import type { FieldingTrace } from "../models/league";
import type { BallLanding } from "./fielding-ai";
import { DEFAULT_FIELDER_POSITIONS } from "./fielding-ai";
import { createBallTrajectory } from "./ball-trajectory";
import {
  FENCE_BASE,
  FENCE_CENTER_EXTRA,
  AGENT_DT,
  AGENT_MAX_TIME_GROUND,
  AGENT_MAX_TIME_FLY,
  AGENT_BASE_REACTION,
  AGENT_AWARENESS_REACTION_SCALE,
  AGENT_REACTING_SPEED_RATIO,
  AGENT_DIVE_MIN_DIST,
  AGENT_DIVE_MAX_DIST,
  AGENT_DIVE_BASE_RATE,
  AGENT_DIVE_SKILL_FACTOR,
  AGENT_RUNNING_CATCH_BASE,
  AGENT_RUNNING_CATCH_SKILL,
  AGENT_PERCEPTION_BASE_NOISE,
  PERCEPTION_ANGLE_DECAY_RATE,
  AGENT_ACCELERATION_TIME,
  AGENT_SPEED_SKILL_FACTOR,
  AGENT_BASE_SPEED,
  CATCH_REACH_BASE,
  CATCH_REACH_SKILL_FACTOR,
  GROUND_BALL_HARD_HIT_SPEED,
  GROUND_BALL_CATCH_SPEED_PENALTY,
  GROUND_BALL_CATCH_FLOOR,
  GROUND_BALL_REACH_PENALTY,
  SF_CATCH_TO_THROW_OVERHEAD,
  OUTFIELD_DEPTH_THRESHOLD,
  PHASE2_DT,
  MAX_PHASE2_TIME,
  SECURING_TIME_BASE,
  SECURING_TIME_SKILL_SCALE,
  PIVOT_TIME,
  THROW_SPEED_BASE,
  THROW_SPEED_ARM_SCALE,
  RUNNER_SPEED_BASE,
  RUNNER_SPEED_SCALE,
  BATTER_START_DELAY,
  TAGUP_DELAY,
  BASE_TAG_TIME,
  RETRIEVER_APPROACH_FACTOR,
  RETRIEVER_PICKUP_TIME,
  DEEP_HIT_PENALTY_THRESHOLD,
  DEEP_HIT_PENALTY_SCALE,
  DEEP_HIT_PENALTY_MAX,
  EXTRA_BASE_ROUNDING_TIME,
  EXTRA_BASE_GO_THRESHOLD,
  EXTRA_BASE_ROUNDING_FATIGUE,

  EXTRA_BASE_DECISION_NOISE,
  TAGUP_ARM_PERCEPTION_NOISE,
  TAGUP_GO_THRESHOLD,
  TAGUP_DECISION_NOISE,
  GROUND_ADVANCE_GO_THRESHOLD,
  GROUND_ADVANCE_DECISION_NOISE,
  TAGUP_THROW_MARGIN_BASE,
  TAGUP_THROW_MARGIN_AWARENESS_SCALE,
  POPUP_LAUNCH_ANGLE,
  LINER_LAUNCH_ANGLE_MAX,
} from "./physics-constants";
import type {
  Vec2,
  BallTrajectory,
  FielderPosition,
  FielderAgent,
  AgentState,
  CatchResult,
  AgentSimOptions,
  AgentFieldingResult,
  AtBatResult,
  AgentTimelineEntry,
  AgentSnapshot,
  ThrowPlay,
  RunnerAgent,
  RunnerState,
  ThrowBallState,
  RunnerSnapshot,
  ThrowBallSnapshot,
  RunnerResult,
} from "./fielding-agent-types";
import {
  BASE_POSITIONS,
  BASE_LENGTH,
  BASE_NAMES,
  vec2Distance,
  vec2DistanceSq,
  clamp,
  gaussianRandom,
} from "./fielding-agent-types";
import type { FielderAction } from "../models/league";
import { calcAndStorePursuitScore, autonomousDecide } from "./autonomous-fielder";
import type { CoverSnapshot } from "./autonomous-fielder";

// ====================================================================
// BattedBall / BaseRunners — simulation.ts 内部型のミラー
// ====================================================================
interface BattedBall {
  direction: number;
  launchAngle: number;
  exitVelocity: number;
  type: string;
}

interface BaseRunners {
  first: Player | null;
  second: Player | null;
  third: Player | null;
}

// ====================================================================
// エントリポイント
// ====================================================================

export function resolvePlayWithAgents(
  ball: BattedBall,
  landing: BallLanding,
  fielderMap: Map<FielderPosition, Player>,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  options?: AgentSimOptions
): AgentFieldingResult {
  const rng = options?.random ?? Math.random;
  const noiseScale = options?.perceptionNoise ?? 1.0;
  const collectTimeline = options?.collectTimeline ?? false;

  // === Phase 0: 初期化 ===
  const trajectory = createBallTrajectory(
    ball.direction,
    ball.launchAngle,
    ball.exitVelocity
  );
  const agents = createAgents(fielderMap, trajectory);
  const timeline: AgentTimelineEntry[] = [];

  const dt = AGENT_DT;
  const maxTime = trajectory.isGroundBall
    ? AGENT_MAX_TIME_GROUND
    : AGENT_MAX_TIME_FLY;
  let catcherAgent: FielderAgent | null = null;
  let catchResult: CatchResult | null = null;
  // GC圧力削減: ballPosバッファを1回だけ確保して毎ティック再利用
  const ballPosBuf: Vec2 = { x: 0, y: 0 };
  let prevBallPos: Vec2 = { x: 0, y: 0 };
  let catchTime = 0;
  let finalT = 0;

  // === Phase 1: ティックループ ===
  for (let t = 0; t <= maxTime; t = round(t + dt)) {
    const ballPos = trajectory.getPositionAt(t, ballPosBuf);
    const ballH = trajectory.getHeightAt(t);
    const ballOnGround = trajectory.isOnGround(t);

    // --- Step 1: 知覚更新 ---
    for (const agent of agents) {
      if (agent.state === "READY") {
        (agent as { state: AgentState }).state = "REACTING";
      }
      if (agent.state === "REACTING") {
        (agent as { reactionRemaining: number }).reactionRemaining -= dt;
        if (agent.reactionRemaining <= 0) {
          (agent as { reactionRemaining: number }).reactionRemaining = 0;
        }
      }
      updatePerception(agent, trajectory, t, noiseScale, rng);
    }

    // --- Step 1.5: REACTING中の初動目標設定 ---
    for (const agent of agents) {
      if (agent.state === "REACTING" && agent.reactionRemaining > 0) {
        (agent as { targetPos: Vec2 }).targetPos = {
          x: agent.perceivedLanding.position.x,
          y: agent.perceivedLanding.position.y,
        };
      }
    }

    // --- Step 2: 自律行動決定（2パス: 順序非依存） ---
    // Pass 1: 全員の raw pursuit score を計算（他者のスコアに依存しない）
    for (const agent of agents) {
      calcAndStorePursuitScore(agent, agents, trajectory, t);
    }
    // カバー割当スナップショット: 前tickの状態を保持し処理順序非依存にする
    const coverSnapshot = snapshotCoverAssignments(agents);
    // Pass 2: 全員のスコアを見て最終行動決定
    for (const agent of agents) {
      autonomousDecide(agent, agents, trajectory, t, bases, outs, coverSnapshot);
    }

    // --- Step 3: カバー衝突解決 ---
    // 同じベースを複数エージェントがカバーしている場合、最も近いエージェントだけ残す
    deconflictBaseCoverage(agents);

    // --- Step 4: 移動 ---
    for (const agent of agents) {
      moveAgent(agent, dt);
    }

    // --- Step 5: 捕球チェック ---
    if (trajectory.isGroundBall && t > 0) {
      const result = checkGroundBallIntercept(
        agents,
        prevBallPos,
        ballPos,
        trajectory,
        t,
        rng
      );
      if (result) {
        catcherAgent = result.agent;
        catchResult = result.catchResult;
        catchTime = t;
        // 捕球フレームをタイムラインに記録してからbreak
        if (collectTimeline) {
          timeline.push(snapshotAll(agents, ballPos, ballH, t, trajectory));
        }
        break;
      }
    }

    if (!trajectory.isGroundBall && ballOnGround && t > 0) {
      const result = checkFlyCatchAtLanding(agents, trajectory, t, rng);
      if (result) {
        catcherAgent = result.agent;
        catchResult = result.catchResult;
        catchTime = t;
        // 捕球フレームをタイムラインに記録してからbreak
        if (collectTimeline) {
          timeline.push(snapshotAll(agents, ballPos, ballH, t, trajectory));
        }
        break;
      }
    }

    // --- Step 6: タイムライン記録 ---
    if (collectTimeline) {
      timeline.push(snapshotAll(agents, ballPos, ballH, t, trajectory));
    }

    // --- Step 7: 早期終了 ---
    // GC圧力削減: filter/everyの代わりにforループでインラインチェック
    // ゴロ: isOnGround が常に true なので、ボール停止後のみ判定
    // フライ: 着地後に全PURSUINGが目標到着済みなら終了
    if (trajectory.isGroundBall) {
      if (t >= trajectory.flightTime) {
        // ゴロ: ボール停止 + 全追跡者が目標に到達、または追跡者なし
        // 距離0.5m^2=0.25 で比較（sqrt不要）
        let hasPursuer = false;
        let allSettled = true;
        for (let ai = 0; ai < agents.length; ai++) {
          const a = agents[ai];
          if (a.state !== "PURSUING") continue;
          hasPursuer = true;
          if (vec2DistanceSq(a.currentPos, a.targetPos) >= 0.25) {
            allSettled = false;
            break;
          }
        }
        if (!hasPursuer || allSettled) break;
      }
    } else if (ballOnGround) {
      // フライ着地後: 距離0.5m^2=0.25 で比較（sqrt不要）
      let allSettled = true;
      for (let ai = 0; ai < agents.length; ai++) {
        const a = agents[ai];
        if (a.state === "PURSUING" && vec2DistanceSq(a.currentPos, a.targetPos) >= 0.25) {
          allSettled = false;
          break;
        }
      }
      if (allSettled) break;
    }

    prevBallPos.x = ballPos.x;
    prevBallPos.y = ballPos.y;
    finalT = t;
  }

  // === Phase 2: 捕球後ティックベースシミュレーション ===

  // 捕球失敗時のエラー判定（Phase 2 に渡す前に判定）
  if (catchResult && !catchResult.success && catcherAgent) {
    // ゴロの強い打球は捕球失敗でもヒット扱い
    if (trajectory.isGroundBall) {
      const ballSpeedAtCatch = trajectory.getSpeedAt(catcherAgent.arrivalTime);
      if (ballSpeedAtCatch >= GROUND_BALL_HARD_HIT_SPEED) {
        const collectedTimeline = collectTimeline ? timeline : undefined;
        return {
          result: "single",
          fielderPos: catcherAgent.pos,
          agentTimeline: collectedTimeline,
        };
      }
      // 捕球可能球の捕球失敗 → エラー
      const collectedTimeline = collectTimeline ? timeline : undefined;
      return {
        result: "error",
        fielderPos: catcherAgent.pos,
        errorPos: catcherAgent.pos,
        agentTimeline: collectedTimeline,
      };
    }
  }

  // フェンス直撃: 捕球不可（ボールはフェンスに当たって跳ねるため）
  const fenceDistance = options?.fenceDistance;
  if (fenceDistance !== undefined) {
    catchResult = null;
  }

  // 捕球成功 / 捕球失敗(フライ落球) / 未到達 → Phase 2 ティックループ
  const catchSuccess = !!(catchResult && catchResult.success && catcherAgent);

  // フェンス直撃時はボール静止位置をフェンス付近にキャップ
  const restPos = fenceDistance !== undefined
    ? capRestPositionToFence(trajectory, fenceDistance)
    : estimateRestPosition(trajectory);
  const effectiveCatcher = catchSuccess ? catcherAgent : (
    // 未到達時: ボール停止位置に最も早く到達できる野手を回収者に
    findNearestAgent(agents, restPos)
  );

  if (!effectiveCatcher) {
    const collectedTimeline = collectTimeline ? timeline : undefined;
    return {
      result: "single",
      fielderPos: 8 as FielderPosition,
      agentTimeline: collectedTimeline,
    };
  }

  const phase2Result = resolvePhase2WithTicks(
    effectiveCatcher,
    catchSuccess,
    ball,
    trajectory,
    batter,
    bases,
    outs,
    agents,
    catchTime,
    rng,
    collectTimeline,
    timeline,
    fenceDistance
  );
  return { ...phase2Result, agentTimeline: collectTimeline ? timeline : undefined };
}

// ====================================================================
// エージェント生成
// ====================================================================

function createAgents(
  fielderMap: Map<FielderPosition, Player>,
  trajectory: BallTrajectory
): FielderAgent[] {
  const agents: FielderAgent[] = [];
  for (const [pos, player] of fielderMap) {
    const defPos = DEFAULT_FIELDER_POSITIONS.get(pos);
    if (!defPos) continue;
    const startPos: Vec2 = { x: defPos.x, y: defPos.y };

    // スキル取得
    const isPitcher = pos === 1;
    const skill = {
      fielding: isPitcher
        ? player.pitching?.fielding ?? 50
        : player.batting.fielding,
      catching: isPitcher
        ? player.pitching?.catching ?? 50
        : player.batting.catching,
      arm: isPitcher ? player.pitching?.arm ?? 50 : player.batting.arm,
      speed: player.batting.speed,
      awareness: player.batting.awareness ?? 50,
    };

    // 統一反応時間 + awareness のみで決定
    let baseReaction = AGENT_BASE_REACTION;
    baseReaction -= (skill.awareness - 50) * AGENT_AWARENESS_REACTION_SCALE;
    baseReaction = Math.max(0.05, baseReaction);

    // 統一走速
    const maxSpeed = AGENT_BASE_SPEED + (skill.speed / 100) * AGENT_SPEED_SKILL_FACTOR;

    agents.push({
      pos,
      player,
      state: "READY",
      currentPos: { ...startPos },
      targetPos: { ...startPos },
      currentSpeed: 0,
      maxSpeed,
      reactionRemaining: baseReaction,
      baseReactionTime: baseReaction,
      perceivedLanding: {
        position: { ...trajectory.landingPos },
        confidence: 0,
      },
      hasCalled: false,
      hasYielded: false,
      action: "hold" as FielderAction,
      skill,
      homePos: { ...startPos },
      distanceAtArrival: Infinity,
      arrivalTime: Infinity,
    });
  }
  return agents;
}

// ====================================================================
// 知覚更新
// ====================================================================

function updatePerception(
  agent: FielderAgent,
  trajectory: BallTrajectory,
  t: number,
  noiseScale: number,
  rng: () => number
): void {
  const trueLanding = trajectory.landingPos;

  if (noiseScale === 0) {
    // GC圧力削減: 既存オブジェクトを書き換え（新規生成しない）
    agent.perceivedLanding.position.x = trueLanding.x;
    agent.perceivedLanding.position.y = trueLanding.y;
    agent.perceivedLanding.confidence = 1.0;
    return;
  }

  // 打球の物理特性(maxHeight/exitVelocity)から連続的にノイズ計算
  // heightM < 1.0  → 低ノイズ（ゴロ相当: 予測しやすい）
  // heightM 5-10m  → 高ノイズ（ライナー相当: 読みにくい）
  // heightM 20m+   → 中ノイズ（フライ相当: 放物線から予測可能）
  const progressRatio = clamp(t / trajectory.flightTime, 0, 0.95);
  const skillFactor = 1 - agent.skill.fielding / 200;
  const heightM = trajectory.maxHeight;

  let sigma: number;
  if (heightM < 1.0) {
    // 地面近くの打球: 予測しやすい（ゴロ相当）
    sigma = 3.0 * skillFactor * Math.sqrt(1 - progressRatio) * noiseScale;
  } else {
    // 高さファクター: 低い(ライナー)=読みにくい、高い(ポップ/フライ)=放物線で予測可能
    const heightNoise = 2.0 * Math.exp(-PERCEPTION_ANGLE_DECAY_RATE * clamp(heightM - 1.0, 0, 60));
    // 速度ファクター: 速い=読みにくい
    const speedNoise = 0.7 + 0.3 * clamp(trajectory.exitVelocity / 170, 0, 1);
    const baseSigma = AGENT_PERCEPTION_BASE_NOISE * heightNoise * speedNoise;
    sigma = baseSigma * Math.sqrt(1 - progressRatio) * skillFactor * noiseScale;
  }

  const noiseX = gaussianRandom(0, sigma, rng);
  const noiseY = gaussianRandom(0, sigma, rng);
  // GC圧力削減: 既存オブジェクトを書き換え（新規生成しない）
  agent.perceivedLanding.position.x = trueLanding.x + noiseX;
  agent.perceivedLanding.position.y = trueLanding.y + noiseY;
  agent.perceivedLanding.confidence = clamp(1 - sigma / AGENT_PERCEPTION_BASE_NOISE, 0, 1);
}

// ====================================================================
// 物理ベース守備範囲計算
// ====================================================================

function calcReachableDistance(agent: FielderAgent, tRemaining: number): number {
  const moveTime = tRemaining - agent.reactionRemaining;
  if (moveTime <= 0) return 0;

  const accelTime = AGENT_ACCELERATION_TIME;
  const a = agent.maxSpeed / accelTime;

  if (moveTime <= accelTime) {
    return 0.5 * a * moveTime * moveTime;
  }

  const accelDist = 0.5 * a * accelTime * accelTime;
  const cruiseDist = agent.maxSpeed * (moveTime - accelTime);
  return accelDist + cruiseDist;
}

function getCatchReach(agent: FielderAgent): number {
  return CATCH_REACH_BASE + (agent.skill.fielding / 100) * CATCH_REACH_SKILL_FACTOR;
}

function getEffectiveRange(agent: FielderAgent, tRemaining: number): number {
  return calcReachableDistance(agent, tRemaining) + getCatchReach(agent);
}

// ====================================================================
// 移動
// ====================================================================

function moveAgent(agent: FielderAgent, dt: number): void {
  if (
    agent.state === "READY" ||
    agent.state === "HOLDING" ||
    agent.state === "FIELDING" ||
    agent.state === "THROWING" ||
    agent.state === "SECURING" ||
    agent.state === "RECEIVING"
  ) {
    (agent as { currentSpeed: number }).currentSpeed = 0;
    return;
  }

  // REACTING中は最高速度を制限（初動フェーズ: 打球への最初の一歩）
  const effectiveMaxSpeed = agent.state === "REACTING"
    ? agent.maxSpeed * AGENT_REACTING_SPEED_RATIO
    : agent.maxSpeed;

  const dx = agent.targetPos.x - agent.currentPos.x;
  const dy = agent.targetPos.y - agent.currentPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.1) {
    (agent as { currentSpeed: number }).currentSpeed = 0;
    return;
  }

  // 加速
  if (agent.currentSpeed < effectiveMaxSpeed) {
    (agent as { currentSpeed: number }).currentSpeed = Math.min(
      effectiveMaxSpeed,
      agent.currentSpeed + (effectiveMaxSpeed / AGENT_ACCELERATION_TIME) * dt
    );
  } else if (agent.currentSpeed > effectiveMaxSpeed) {
    // REACTING中の速度制限 or 状態遷移後の速度調整
    (agent as { currentSpeed: number }).currentSpeed = effectiveMaxSpeed;
  }

  const moveDist = agent.currentSpeed * dt;
  if (moveDist >= dist) {
    agent.currentPos.x = agent.targetPos.x;
    agent.currentPos.y = agent.targetPos.y;
    (agent as { currentSpeed: number }).currentSpeed = 0;
  } else {
    agent.currentPos.x += (dx / dist) * moveDist;
    agent.currentPos.y += (dy / dist) * moveDist;
  }

  // フェンス境界クランプ: 野手がフェンスを超えないようにする
  if (agent.currentPos.y > 0) {
    const distFromHome = Math.sqrt(
      agent.currentPos.x ** 2 + agent.currentPos.y ** 2
    );
    if (distFromHome > 0) {
      // atan2(x, y) で角度を得て 0-90° スケール（0°=三塁線, 45°=センター, 90°=一塁線）に変換
      const dirDeg = Math.atan2(agent.currentPos.x, agent.currentPos.y) * (180 / Math.PI) + 45;
      const clampedDir = Math.max(0, Math.min(90, dirDeg));
      const fenceDist = FENCE_BASE + FENCE_CENTER_EXTRA * Math.sin((clampedDir * 2 * Math.PI) / 180);
      // フェンスの1m手前を限界とする
      const maxDist = fenceDist - 1.0;
      if (distFromHome > maxDist) {
        const scale = maxDist / distFromHome;
        agent.currentPos.x *= scale;
        agent.currentPos.y *= scale;
      }
    }
  }
}

// ====================================================================
// ゴロ捕球（線分ベース）
// ====================================================================

function checkGroundBallIntercept(
  agents: FielderAgent[],
  prevBallPos: Vec2,
  currBallPos: Vec2,
  trajectory: BallTrajectory,
  t: number,
  rng: () => number
): { agent: FielderAgent; catchResult: CatchResult } | null {
  const segDx = currBallPos.x - prevBallPos.x;
  const segDy = currBallPos.y - prevBallPos.y;
  const segLenSq = segDx * segDx + segDy * segDy;

  // 停止球到達チェック（ボール停止後は線分長が0になるため先にチェック）
  // GC圧力削減: filter+sortをforループ+最近傍探索に変換
  if (t >= trajectory.flightTime) {
    let bestChaser: FielderAgent | null = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (a.state !== "PURSUING" || a.action !== "field_ball" || a.hasYielded) continue;
      const distSq = vec2DistanceSq(a.currentPos, currBallPos);
      if (distSq < bestDistSq) { bestDistSq = distSq; bestChaser = a; }
    }
    if (bestChaser) {
      const reach = getCatchReach(bestChaser) * 0.9; // 停止球も正確な到達が必要
      if (bestDistSq < reach * reach) {
        bestChaser.state = "FIELDING";
        bestChaser.arrivalTime = t;
        return {
          agent: bestChaser,
          catchResult: {
            success: true,
            catchType: "ground_field",
            catchRate: 0.99,
            agentPos: bestChaser.pos,
          },
        };
      }
    }
  }

  if (segLenSq < 0.0001) return null;

  // 経路インターセプト中のエージェント: インターセプト点への近さでソート
  // GC圧力削減: filter+sortをforループ+インラインソートに変換
  // （移動中の野手が目標に近いほど優先 = 先着者が処理）
  const candidates: FielderAgent[] = [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.state === "PURSUING" && !a.hasYielded && a.interceptPoint != null) {
      candidates.push(a);
    }
  }
  candidates.sort((a, b) => {
    const da = vec2DistanceSq(a.currentPos, a.interceptPoint!);
    const db = vec2DistanceSq(b.currentPos, b.interceptPoint!);
    return da - db;
  });

  // 停止球チャーシング中
  const chasers: FielderAgent[] = [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.state === "PURSUING" && !a.hasYielded && a.action === "field_ball") {
      chasers.push(a);
    }
  }

  for (const agent of [...candidates, ...chasers]) {
    const ax = prevBallPos.x;
    const ay = prevBallPos.y;
    const bx = currBallPos.x;
    const by = currBallPos.y;
    const px = agent.currentPos.x;
    const py = agent.currentPos.y;

    const tParam = clamp(
      ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / segLenSq,
      0,
      1
    );
    const nearestX = ax + tParam * (bx - ax);
    const nearestY = ay + tParam * (by - ay);
    const distSq =
      (px - nearestX) * (px - nearestX) + (py - nearestY) * (py - nearestY);

    const interceptReach = getCatchReach(agent) * 0.6; // ゴロ用インターセプトリーチ（通過球は正確な位置取りが必要）
    if (distSq < interceptReach * interceptReach) {
      agent.state = "FIELDING";
      agent.arrivalTime = t;
      const fieldingRate =
        (agent.skill.fielding * 0.6 + agent.skill.catching * 0.4) / 100;
      const ballSpeed = trajectory.getSpeedAt(t);
      const speedPenalty = Math.max(0, (ballSpeed - 20) * GROUND_BALL_CATCH_SPEED_PENALTY);
      // リーチ端での捕球難易度上昇（距離比が1に近いほど難しい）
      const reachRatio = distSq / (interceptReach * interceptReach);
      const reachPenalty = reachRatio * GROUND_BALL_REACH_PENALTY;
      const catchRate = clamp(
        0.97 + fieldingRate * 0.04 - speedPenalty - reachPenalty,
        GROUND_BALL_CATCH_FLOOR,
        0.995
      );
      const success = rng() < catchRate;
      return {
        agent,
        catchResult: {
          success,
          catchType: "ground_field",
          catchRate,
          agentPos: agent.pos,
        },
      };
    }
  }

  // 停止球到達チェック（移動中の停止球も捕球可能 - interceptPoint持ちの野手用）
  // GC圧力削減: filter+sortをforループ+最近傍探索に変換
  if (t >= trajectory.flightTime) {
    let bestPursuer: FielderAgent | null = null;
    let bestPursuerDistSq = Infinity;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (a.state !== "PURSUING") continue;
      const distSq = vec2DistanceSq(a.currentPos, currBallPos);
      if (distSq < bestPursuerDistSq) { bestPursuerDistSq = distSq; bestPursuer = a; }
    }
    if (bestPursuer) {
      const reach = getCatchReach(bestPursuer) * 0.9; // 停止球も正確な到達が必要
      if (bestPursuerDistSq < reach * reach) {
        bestPursuer.state = "FIELDING";
        bestPursuer.arrivalTime = t;
        return {
          agent: bestPursuer,
          catchResult: {
            success: true,
            catchType: "ground_field",
            catchRate: 0.99,
            agentPos: bestPursuer.pos,
          },
        };
      }
    }
  }

  return null;
}

// ====================================================================
// フライ捕球
// ====================================================================

function checkFlyCatchAtLanding(
  agents: FielderAgent[],
  trajectory: BallTrajectory,
  t: number,
  rng: () => number
): { agent: FielderAgent; catchResult: CatchResult } | null {
  if (!trajectory.isOnGround(t)) return null;

  const landingPos = trajectory.landingPos;

  // GC圧力削減: filter+map+sortをforループ+構造体配列に変換
  const candidates: { agent: FielderAgent; dist: number }[] = [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.state !== "PURSUING" || a.hasYielded) continue;
    candidates.push({ agent: a, dist: vec2Distance(a.currentPos, landingPos) });
  }
  candidates.sort((a, b) => a.dist - b.dist);

  for (const { agent, dist } of candidates) {
    const catchReach = getCatchReach(agent);
    const extendedRadius = catchReach * 1.2;

    const fieldingRate =
      (agent.skill.fielding * 0.6 + agent.skill.catching * 0.4) / 100;

    // 1. 標準捕球
    if (dist <= catchReach) {
      agent.state = "FIELDING";
      agent.arrivalTime = t;
      const marginFactor = clamp(
        (catchReach - dist) / catchReach,
        0,
        1
      );
      const catchRate = clamp(
        0.9 + marginFactor * 0.07 + fieldingRate * 0.03,
        0.9,
        0.99
      );
      const success = rng() < catchRate;
      return {
        agent,
        catchResult: {
          success,
          catchType: "standard",
          catchRate,
          agentPos: agent.pos,
        },
      };
    }

    // 2. ランニングキャッチ (デッドゾーン回避: catchReach < dist <= extended)
    if (dist <= extendedRadius && agent.currentSpeed > agent.maxSpeed * 0.7) {
      agent.state = "FIELDING";
      agent.arrivalTime = t;
      const runRate =
        AGENT_RUNNING_CATCH_BASE +
        agent.skill.fielding * AGENT_RUNNING_CATCH_SKILL;
      const success = rng() < runRate;
      return {
        agent,
        catchResult: {
          success,
          catchType: "running",
          catchRate: runRate,
          agentPos: agent.pos,
        },
      };
    }

    // 3. ダイビングキャッチ
    if (dist > AGENT_DIVE_MIN_DIST && dist <= AGENT_DIVE_MAX_DIST) {
      agent.state = "FIELDING";
      agent.arrivalTime = t;
      let diveRate =
        AGENT_DIVE_BASE_RATE + agent.skill.fielding * AGENT_DIVE_SKILL_FACTOR;
      diveRate = clamp(diveRate, 0.15, 0.7);
      const success = rng() < diveRate;
      return {
        agent,
        catchResult: {
          success,
          catchType: "diving",
          catchRate: diveRate,
          agentPos: agent.pos,
        },
      };
    }
  }

  return null;
}

// ====================================================================
// 旧結果解決（Phase 2 ティックベースシミュレーションで完全置換済み）
// resolveSuccessfulCatch / resolveGroundOut / resolveFlyOut /
// resolveFieldingError / resolveHitWithRetriever は削除済み
// ====================================================================


// ====================================================================
// ヘルパー関数
// ====================================================================

function calcPathIntercept(
  agent: FielderAgent,
  trajectory: BallTrajectory,
  t: number
): { canReach: boolean; point: Vec2; ballTime: number; perpDist: number } | null {
  if (!trajectory.isGroundBall) return null;

  const landing = trajectory.landingPos;
  const maxDist = trajectory.landingDistance;
  const stopTime = trajectory.flightTime;

  // P1: ゴロ経路定数はtrajectoryにキャッシュ済みのものを優先して使用（sqrt回避）
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

  const projDist =
    agent.currentPos.x * pathDirX + agent.currentPos.y * pathDirY;

  const perpX = agent.currentPos.x - projDist * pathDirX;
  const perpY = agent.currentPos.y - projDist * pathDirY;
  const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);

  const catchReach = getCatchReach(agent);

  if (projDist < 0) return null; // 野手がホーム後方

  // 早期リターン: 垂線距離がこのエージェントの全時間での最大到達距離を超える場合
  const maxReachable = calcReachableDistance(agent, stopTime) + catchReach;
  if (perpDist > maxReachable) return null;

  // 全経路スキャン（0.5m〜maxDist）— 物理ベース到達判定
  // GC圧力削減: bestPointを事前確保してx/yを書き換え
  const bestPointBuf: Vec2 = { x: 0, y: 0 };
  let hasBestPoint = false;
  let bestBallTime = 0;
  let bestMargin = -Infinity;

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

    // 物理ベース: 残り時間で移動可能な距離 + 捕球リーチ
    const tRemaining = ballTime - t;
    const reachable = calcReachableDistance(agent, tRemaining) + catchReach;
    const margin = reachable - fielderDist;

    if (margin > bestMargin) {
      bestMargin = margin;
      bestPointBuf.x = ix;
      bestPointBuf.y = iy;
      hasBestPoint = true;
      bestBallTime = ballTime;
    }
  }

  // 停止点(maxDist)も候補に含める
  if (projDist >= maxDist * 0.8) {
    const ix = landing.x;
    const iy = landing.y;
    const sdx = agent.currentPos.x - ix;
    const sdy = agent.currentPos.y - iy;
    const fielderDist = Math.sqrt(sdx * sdx + sdy * sdy);
    const tRemaining = stopTime - t;
    const reachable = calcReachableDistance(agent, tRemaining) + catchReach;
    const margin = reachable - fielderDist;
    if (margin > bestMargin) {
      bestMargin = margin;
      bestPointBuf.x = ix;
      bestPointBuf.y = iy;
      hasBestPoint = true;
      bestBallTime = stopTime;
    }
  }

  if (!hasBestPoint) return null;

  return {
    canReach: bestMargin >= 0,
    point: { x: bestPointBuf.x, y: bestPointBuf.y },
    ballTime: bestBallTime,
    perpDist,
  };
}

/**
 * 着地後のボール転がり位置を推定する。
 * ライナー/フライは着地後にバウンドして外野方向に転がる。
 * ゴロは既にシミュレーション中に経路が計算されるため着地位置をそのまま返す。
 */
function estimateRestPosition(trajectory: BallTrajectory): Vec2 {
  if (trajectory.isGroundBall) return trajectory.landingPos;

  const lp = trajectory.landingPos;
  const dist = trajectory.landingDistance;
  if (dist < 1) return lp;

  // 着地時の平均水平速度を推定
  const avgHorizontalSpeed = dist / Math.max(trajectory.flightTime, 0.5);
  // バウンド後の速度（草地で大きく減衰）
  const BOUNCE_FACTOR = 0.30; // 草地のバウンド係数
  const GRASS_FRICTION = 2.5; // 芝生の摩擦減速度(m/s²)
  const postBounceSpeed = avgHorizontalSpeed * BOUNCE_FACTOR;
  // ロールアウト距離 = v²/(2a)
  const rollout = (postBounceSpeed * postBounceSpeed) / (2 * GRASS_FRICTION);
  if (rollout < 1) return lp;

  // ホームから着地点方向にロールアウト分延長
  const dirX = lp.x / dist;
  const dirY = lp.y / dist;
  return {
    x: lp.x + dirX * rollout,
    y: lp.y + dirY * rollout,
  };
}

/** フェンス直撃時のボール静止位置: フェンスに当たり跳ね返ってフェンス手前5mに落ちる */
function capRestPositionToFence(trajectory: BallTrajectory, fenceDistance: number): Vec2 {
  const lp = trajectory.landingPos;
  const dist = trajectory.landingDistance;
  if (dist < 1) return lp;
  const dirX = lp.x / dist;
  const dirY = lp.y / dist;
  const capDist = fenceDistance - 5;
  return { x: capDist * dirX, y: capDist * dirY };
}

function findNearestAgent(
  agents: FielderAgent[],
  pos: Vec2
): FielderAgent | null {
  // 推定到達時間ベースで回収野手を決定（全野手が回収候補）
  let best: FielderAgent | null = null;
  let bestTime = Infinity;
  for (const a of agents) {
    const dist = vec2Distance(a.currentPos, pos);
    const arrivalTime = a.maxSpeed > 0 ? dist / a.maxSpeed : Infinity;
    if (arrivalTime < bestTime) {
      bestTime = arrivalTime;
      best = a;
    }
  }
  return best;
}

function getFenceDistance(directionDeg: number): number {
  return (
    FENCE_BASE +
    FENCE_CENTER_EXTRA * Math.sin((directionDeg * Math.PI) / 90)
  );
}

function snapshotAll(
  agents: FielderAgent[],
  ballPos: Vec2,
  ballHeight: number,
  t: number,
  trajectory?: BallTrajectory
): AgentTimelineEntry {
  return {
    t,
    ballPos: { ...ballPos },
    ballHeight,
    agents: (() => {
      const tRemaining = trajectory ? Math.max(0, trajectory.flightTime - t) : 0;
      return agents.map((a) => {
        return {
          pos: a.pos,
          state: a.state,
          x: a.currentPos.x,
          y: a.currentPos.y,
          targetX: a.targetPos.x,
          targetY: a.targetPos.y,
          speed: a.currentSpeed,
          action: a.action,
          perceivedX: a.perceivedLanding.position.x,
          perceivedY: a.perceivedLanding.position.y,
          effectiveRange: trajectory ? getEffectiveRange(a, tRemaining) : undefined,
        };
      });
    })(),
  };
}

/**
 * 前tickのカバー状態をスナップショットとして取得。
 * Pass 2 で全エージェントが同じ「前tick」の状態を参照し、処理順序に依存しない判定を行う。
 * 同じベースに複数エージェントがいる場合は最も近いエージェントを代表にする。
 */
function snapshotCoverAssignments(agents: readonly FielderAgent[]): CoverSnapshot {
  const assignments = new Map<string, FielderAgent>();
  for (const a of agents) {
    if (a.state !== "COVERING" || a.action !== "cover_base") continue;
    for (const [name, pos] of Object.entries(BASE_POSITIONS)) {
      if (vec2Distance(a.targetPos, pos as Vec2) <= 3.0) {
        const existing = assignments.get(name);
        if (!existing || vec2Distance(a.currentPos, pos as Vec2) < vec2Distance(existing.currentPos, pos as Vec2)) {
          assignments.set(name, a);
        }
        break;
      }
    }
  }
  return assignments;
}

/**
 * カバー衝突解決: 同じベースを複数エージェントがCOVERINGしている場合、
 * 最も近いエージェントだけ残し、他はHOLDINGに戻す。
 * これにより、Pass 2 のエージェント処理順序に依存しない公平なカバー割当を実現する。
 */
function deconflictBaseCoverage(agents: FielderAgent[]): void {
  const baseNames = ["first", "second", "third", "home"] as const;
  for (const baseName of baseNames) {
    const basePos = BASE_POSITIONS[baseName];
    // このベースをカバー中のエージェントを収集
    let first: FielderAgent | null = null;
    let firstDist = Infinity;
    let hasConflict = false;
    for (const a of agents) {
      if (a.state !== "COVERING" || a.action !== "cover_base") continue;
      const d = vec2Distance(a.targetPos, basePos);
      if (d > 3.0) continue; // このベースをカバーしていない
      if (first === null) {
        first = a;
        firstDist = vec2Distance(a.currentPos, basePos);
      } else {
        hasConflict = true;
        const aDist = vec2Distance(a.currentPos, basePos);
        if (aDist < firstDist) {
          // 現在のwinnerより近い → winnerをevict
          first.state = "HOLDING";
          first.action = "hold";
          first = a;
          firstDist = aDist;
        } else {
          // 遠い → evict
          a.state = "HOLDING";
          a.action = "hold";
        }
      }
    }
  }
}

/** 浮動小数点丸め (0.1刻みの累積誤差防止) */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ====================================================================
// Phase 2: 捕球後ティックベースシミュレーション
// ====================================================================

/** 塁番号 → 座標（コピーを返す。直接参照するとBASE_POSITIONS定数が汚染されるため） */
function getBasePosition(baseNum: number): Vec2 {
  const name = BASE_NAMES[baseNum];
  const pos = name ? BASE_POSITIONS[name] : BASE_POSITIONS.home;
  return { x: pos.x, y: pos.y };
}

/** 塁間の線形補間 */
function interpolateBasepath(fromBase: number, toBase: number, progress: number): Vec2 {
  const from = getBasePosition(fromBase);
  const to = getBasePosition(toBase);
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

/** プレイヤーの走速を計算 */
function calcRunnerSpeed(player: Player): number {
  return RUNNER_SPEED_BASE + (player.batting.speed / 100) * RUNNER_SPEED_SCALE;
}

/** 野手の送球速度を計算（位置に応じて内野/外野を自動判定） */
function calcThrowSpeed(agent: FielderAgent): number {
  const distFromHome = Math.sqrt(agent.currentPos.x ** 2 + agent.currentPos.y ** 2);
  if (distFromHome > OUTFIELD_DEPTH_THRESHOLD) {
    // 外野: 長距離送球は制御重視で速度が落ちる (旧resolveFlyOut準拠)
    return 25 + (agent.skill.arm / 100) * 15;
  }
  // 内野: 短距離クイックスロー (旧resolveGroundOut準拠)
  return THROW_SPEED_BASE + (agent.skill.arm / 100) * THROW_SPEED_ARM_SCALE;
}

/** 捕球→送球準備の所要時間を計算 */
function calcSecuringTime(agent: FielderAgent): number {
  return SECURING_TIME_BASE + (1 - agent.skill.fielding / 100) * SECURING_TIME_SKILL_SCALE;
}

// --- ランナー自律判断関数 ---

/** ヒット時のエキストラベース判断（ROUNDINGタイマー後に呼ばれる） */
function decideExtraBase(
  runner: RunnerAgent,
  ballHolder: FielderAgent | null,
  retrieverAgent: FielderAgent | null,
  retrieverArrivalTime: number,
  throwBall: ThrowBallState | null,
  currentTime: number,
  rng: () => number
): boolean {
  const nextBase = runner.targetBase + 1;
  if (nextBase > 4) return false;
  const nextBasePos = getBasePosition(nextBase);

  // ボールが次塁に届くまでの推定時間
  let estBallTime: number;
  if (ballHolder) {
    // 誰かがボール保持中 → 送球時間
    const throwSpeed = calcThrowSpeed(ballHolder);
    const throwDist = vec2Distance(ballHolder.currentPos, nextBasePos);
    estBallTime = calcSecuringTime(ballHolder) + throwDist / throwSpeed;
  } else if (throwBall) {
    // ボール飛行中 → リレー時間を推定
    const throwRemaining = Math.max(0, throwBall.arrivalTime - currentTime);
    if (throwBall.targetBase === nextBase) {
      // 次塁に直接来る → そのまま到着時間
      estBallTime = throwRemaining;
    } else {
      // 別の塁へ飛行中 → 中継(リレー)が必要
      const relayBasePos = getBasePosition(throwBall.targetBase);
      const relayDist = vec2Distance(relayBasePos, nextBasePos);
      const relaySpeed = THROW_SPEED_BASE + THROW_SPEED_ARM_SCALE * 0.5;
      estBallTime = throwRemaining + SECURING_TIME_BASE + PIVOT_TIME + relayDist / relaySpeed;
    }
  } else if (retrieverAgent) {
    // まだ回収中 → 回収+送球(直接)時間
    const remainRetrieval = Math.max(0, retrieverArrivalTime - currentTime);
    const throwSpeed = calcThrowSpeed(retrieverAgent);
    const throwDist = vec2Distance(retrieverAgent.currentPos, nextBasePos);
    estBallTime = remainRetrieval + SECURING_TIME_BASE + throwDist / throwSpeed;
  } else {
    estBallTime = 10;
  }

  // 疲労: 2→3で+0.4s, 3→4で+0.8s（走るほど遅くなる）
  const basesRun = nextBase - 1; // 1→2=1, 2→3=2, 3→4=3
  const fatigue = Math.max(0, basesRun - 1) * EXTRA_BASE_ROUNDING_FATIGUE;
  const roundingTime = EXTRA_BASE_ROUNDING_TIME + fatigue;
  const estRunTime = roundingTime + BASE_LENGTH / runner.speed;
  const margin = estBallTime - estRunTime;
  const br = runner.skill?.baseRunning ?? 50;
  const noise = gaussianRandom(0, EXTRA_BASE_DECISION_NOISE * (1 - br / 100), rng);
  return (margin + noise) > EXTRA_BASE_GO_THRESHOLD;
}

/** タッチアップ判断（DECIDING状態で呼ばれる） */
function decideTagup(
  runner: RunnerAgent,
  fielder: FielderAgent,
  rng: () => number
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

/** ゴロ時の非フォース走者進塁判断 */
function decideGroundAdvance(
  runner: RunnerAgent,
  throwBall: ThrowBallState | null,
  currentTime: number,
  rng: () => number
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

// --- ランナー初期化 ---

function makeRunnerSkill(player: Player) {
  return {
    speed: player.batting.speed,
    baseRunning: player.batting.baseRunning ?? 50,
  };
}

function initRunners(
  batter: Player,
  bases: BaseRunners,
  trajectory: BallTrajectory,
  catchSuccess: boolean
): RunnerAgent[] {
  const runners: RunnerAgent[] = [];

  if (catchSuccess && trajectory.isGroundBall) {
    // ゴロ捕球: 打者→1塁走塁、フォース走者は強制走塁
    runners.push({
      player: batter,
      state: "RUNNING",
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

    // フォース連鎖: 1塁→2塁, 2塁→3塁, 3塁→本塁
    if (bases.first) {
      runners.push({
        player: bases.first,
        state: "RUNNING",
        currentPos: { ...BASE_POSITIONS.first },
        fromBase: 1,
        targetBase: 2,
        speed: calcRunnerSpeed(bases.first),
        progress: 0,
        isBatter: false,
        isForced: true,
        skill: makeRunnerSkill(bases.first),
        originalBase: 1,
      });
      if (bases.second) {
        runners.push({
          player: bases.second,
          state: "RUNNING",
          currentPos: { ...BASE_POSITIONS.second },
          fromBase: 2,
          targetBase: 3,
          speed: calcRunnerSpeed(bases.second),
          progress: 0,
          isBatter: false,
          isForced: true,
          skill: makeRunnerSkill(bases.second),
          originalBase: 2,
        });
        if (bases.third) {
          runners.push({
            player: bases.third,
            state: "RUNNING",
            currentPos: { ...BASE_POSITIONS.third },
            fromBase: 3,
            targetBase: 4,
            speed: calcRunnerSpeed(bases.third),
            progress: 0,
            isBatter: false,
            isForced: true,
            skill: makeRunnerSkill(bases.third),
            originalBase: 3,
          });
        }
      }
    }
    // 非フォース走者はホールド
    if (!bases.first && bases.second) {
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
    if (!bases.first && bases.third) {
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
    if (bases.first && !bases.second && bases.third) {
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
  } else if (catchSuccess && !trajectory.isGroundBall) {
    // フライ捕球: 打者はアウト、走者はタッチアップ待ち
    // 打者は含めない（フライアウト確定）
    if (bases.first) {
      runners.push({
        player: bases.first,
        state: "WAITING_TAG",
        currentPos: { ...BASE_POSITIONS.first },
        fromBase: 1,
        targetBase: 2,
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
        state: "WAITING_TAG",
        currentPos: { ...BASE_POSITIONS.second },
        fromBase: 2,
        targetBase: 3,
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
        state: "WAITING_TAG",
        currentPos: { ...BASE_POSITIONS.third },
        fromBase: 3,
        targetBase: 4,
        speed: calcRunnerSpeed(bases.third),
        progress: 0,
        isBatter: false,
        isForced: false,
        skill: makeRunnerSkill(bases.third),
        originalBase: 3,
      });
    }
  } else {
    // 捕球失敗 / 未到達ヒット: 全員走塁
    runners.push({
      player: batter,
      state: "RUNNING",
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
        state: "RUNNING",
        currentPos: { ...BASE_POSITIONS.first },
        fromBase: 1,
        targetBase: 2,
        speed: calcRunnerSpeed(bases.first),
        progress: 0,
        isBatter: false,
        isForced: true,
        skill: makeRunnerSkill(bases.first),
        originalBase: 1,
      });
    }
    if (bases.second) {
      runners.push({
        player: bases.second,
        state: "RUNNING",
        currentPos: { ...BASE_POSITIONS.second },
        fromBase: 2,
        targetBase: 3,
        speed: calcRunnerSpeed(bases.second),
        progress: 0,
        isBatter: false,
        isForced: true,
        skill: makeRunnerSkill(bases.second),
        originalBase: 2,
      });
    }
    if (bases.third) {
      runners.push({
        player: bases.third,
        state: "RUNNING",
        currentPos: { ...BASE_POSITIONS.third },
        fromBase: 3,
        targetBase: 4,
        speed: calcRunnerSpeed(bases.third),
        progress: 0,
        isBatter: false,
        isForced: true,
        skill: makeRunnerSkill(bases.third),
        originalBase: 3,
      });
    }
  }

  return runners;
}

// --- ランナー移動 ---

function moveRunner(runner: RunnerAgent, dt: number, catchSuccess: boolean): void {
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
      // 疲労: 走った塁数が多いほどラウンディングが遅くなる
      const basesRun = runner.targetBase - (runner.originalBase ?? 0);
      const fatigue = Math.max(0, basesRun - 1) * EXTRA_BASE_ROUNDING_FATIGUE;
      runner.state = "ROUNDING";
      runner.roundingTimer = EXTRA_BASE_ROUNDING_TIME + fatigue;
    } else {
      // ゴロフォースプレー到達 → 暫定セーフ（後からOUTに変わりうる）
      runner.state = "SAFE";
    }
  } else {
    const pos = interpolateBasepath(runner.fromBase, runner.targetBase, runner.progress);
    runner.currentPos.x = pos.x;
    runner.currentPos.y = pos.y;
  }
}

// --- 送球先決定 ---

interface ThrowTarget {
  baseNum: number;
  receiverAgent: FielderAgent;
  throwDist: number;
}

function decideThrowTarget(
  holder: FielderAgent,
  runners: RunnerAgent[],
  agents: FielderAgent[],
  currentOuts: number,
  rng: () => number
): ThrowTarget | null {
  // 送球不要（走者なし or 全員解決済み）
  const activeRunners = runners.filter(
    r => r.state === "RUNNING" || r.state === "TAGGED_UP"
  );
  if (activeRunners.length === 0) return null;

  const throwSpeed = calcThrowSpeed(holder);

  // フォースプレー候補を優先度順に評価
  const forceCandidates: { runner: RunnerAgent; baseNum: number; margin: number }[] = [];
  for (const runner of activeRunners) {
    if (!runner.isForced) continue;
    const targetBase = runner.targetBase;
    const basePos = getBasePosition(targetBase);
    const throwDist = vec2Distance(holder.currentPos, basePos);
    const throwTime = throwDist / throwSpeed;
    const remainingProgress = 1.0 - runner.progress;
    const runnerTimeToBase = (remainingProgress * BASE_LENGTH) / runner.speed;
    const margin = runnerTimeToBase - throwTime;
    forceCandidates.push({ runner, baseNum: targetBase, margin });
  }

  // マージンが大きい（アウトにしやすい）順にソート
  forceCandidates.sort((a, b) => b.margin - a.margin);

  // DP狙い: 2アウト未満 & フォース走者が2人以上 → 先頭の塁（2塁）から処理
  if (currentOuts < 2 && forceCandidates.length >= 2) {
    // 2塁フォースから処理してDP狙い
    const dpTarget = forceCandidates.find(c => c.baseNum === 2 && c.margin > 0);
    if (dpTarget) {
      const receiver = findReceiverForBase(dpTarget.baseNum, agents, holder.pos);
      if (receiver) {
        return { baseNum: dpTarget.baseNum, receiverAgent: receiver, throwDist: vec2Distance(holder.currentPos, getBasePosition(dpTarget.baseNum)) };
      }
    }
  }

  // 最もアウトにしやすいフォース塁を選択
  for (const cand of forceCandidates) {
    if (cand.margin > -0.1) { // 若干間に合わなくても投げる
      const receiver = findReceiverForBase(cand.baseNum, agents, holder.pos);
      if (receiver) {
        return { baseNum: cand.baseNum, receiverAgent: receiver, throwDist: vec2Distance(holder.currentPos, getBasePosition(cand.baseNum)) };
      }
    }
  }

  // フォースなし → タッチアップ走者を刺す
  // ホームベース(4)を最優先で評価（得点阻止が最重要）
  const tagRunners = activeRunners.filter(r => !r.isForced);
  tagRunners.sort((a, b) => b.targetBase - a.targetBase);

  for (const runner of tagRunners) {
    const basePos = getBasePosition(runner.targetBase);
    const throwDist = vec2Distance(holder.currentPos, basePos);
    const throwTime = throwDist / throwSpeed;
    const remainingProgress = 1.0 - runner.progress;
    const runnerTimeToBase = (remainingProgress * BASE_LENGTH) / runner.speed;
    const margin = runnerTimeToBase - throwTime;

    // awareness が高い外野手は無駄な送球をしない
    const threshold = -(TAGUP_THROW_MARGIN_BASE
      - (holder.skill.awareness / 100) * TAGUP_THROW_MARGIN_AWARENESS_SCALE);

    if (margin < threshold) {
      continue; // この走者には投げない（間に合わない）
    }

    const receiver = findReceiverForBase(runner.targetBase, agents, holder.pos);
    if (receiver) {
      return { baseNum: runner.targetBase, receiverAgent: receiver, throwDist };
    }
  }

  // デフォルト: 打者走者が走っていれば1塁へ
  const batterRunner = runners.find(r => r.isBatter && (r.state === "RUNNING" || r.state === "TAGGED_UP"));
  if (batterRunner) {
    const receiver = findReceiverForBase(1, agents, holder.pos);
    if (receiver) {
      return { baseNum: 1, receiverAgent: receiver, throwDist: vec2Distance(holder.currentPos, getBasePosition(1)) };
    }
  }

  return null;
}

/** 指定ベースで送球を受ける野手を探す */
function findReceiverForBase(
  baseNum: number,
  agents: FielderAgent[],
  excludePos: FielderPosition
): FielderAgent | null {
  const baseName = BASE_NAMES[baseNum];
  if (!baseName) return null;
  const basePos = BASE_POSITIONS[baseName];

  let best: FielderAgent | null = null;
  let bestDist = Infinity;
  for (const a of agents) {
    if (a.pos === excludePos) continue;
    // COVERING/RECEIVING/HOLDING の野手を候補にする
    if (a.state !== "COVERING" && a.state !== "RECEIVING" && a.state !== "HOLDING") continue;
    const d = vec2Distance(a.currentPos, basePos);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

// --- 送球生成 ---

function createThrow(
  holder: FielderAgent,
  target: ThrowTarget,
  currentTime: number
): ThrowBallState {
  const fromPos = { ...holder.currentPos };
  const toPos = getBasePosition(target.baseNum);
  const speed = calcThrowSpeed(holder);
  const dist = vec2Distance(fromPos, toPos);
  const flightTime = dist / speed;

  return {
    fromPos,
    toPos,
    targetBase: target.baseNum,
    speed,
    startTime: currentTime,
    arrivalTime: currentTime + flightTime,
    throwerPos: holder.pos,
    receiverPos: target.receiverAgent.pos,
  };
}

// --- ベースプレー判定 ---

function resolveBasePlay(
  throwBall: ThrowBallState,
  runners: RunnerAgent[],
  _rng: () => number
): { isOut: boolean; runner: RunnerAgent | null } {
  // この塁を目標にしている走者を探す
  const targetRunner = runners.find(
    r => r.targetBase === throwBall.targetBase &&
         (r.state === "RUNNING" || r.state === "TAGGED_UP")
  );

  if (!targetRunner) {
    // 該当走者なし — 到達済み(SAFE)の走者かもしれないのでチェック
    const safeRunner = runners.find(
      r => r.targetBase === throwBall.targetBase && r.state === "SAFE"
    );
    if (safeRunner && safeRunner.isForced) {
      // 走者が先に到着 → セーフ確定
      return { isOut: false, runner: safeRunner };
    }
    return { isOut: false, runner: null };
  }

  // フォースプレー: 走者がベースに到達済みか？
  if (targetRunner.progress >= 1.0) {
    targetRunner.state = "SAFE";
    return { isOut: false, runner: targetRunner };
  } else {
    targetRunner.state = "OUT";
    return { isOut: true, runner: targetRunner };
  }
}

// --- Phase 2 メインループ ---

function resolvePhase2WithTicks(
  catcherAgent: FielderAgent | null,
  catchSuccess: boolean,
  ball: BattedBall,
  trajectory: BallTrajectory,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  agents: FielderAgent[],
  catchTime: number,
  rng: () => number,
  collectTimeline: boolean,
  existingTimeline: AgentTimelineEntry[],
  fenceDistance?: number
): AgentFieldingResult {
  const dt = PHASE2_DT;

  // 1. ランナー初期化
  const runners = initRunners(batter, bases, trajectory, catchSuccess);

  let ballHolder: FielderAgent | null = catchSuccess && catcherAgent ? catcherAgent : null;
  let throwBall: ThrowBallState | null = null;
  const throwPlays: ThrowPlay[] = [];
  let pendingThrowPlay: ThrowPlay | null = null;
  let outsAdded = 0;
  let securingTimer = 0;

  // ボール回収モデル（ヒット時: 捕球失敗→最寄り野手がボールを拾う）
  let retrieverAgent: FielderAgent | null = null;
  let retrieverArrivalTime = Infinity;

  if (!catchSuccess && catcherAgent) {
    retrieverAgent = catcherAgent;
    // フェンス直撃時はボール静止位置をフェンス付近にキャップ
    const ballRestPos = fenceDistance !== undefined
      ? capRestPositionToFence(trajectory, fenceDistance)
      : estimateRestPosition(trajectory);
    const distToBall = vec2Distance(retrieverAgent.currentPos, ballRestPos);
    // 回収時間 = 走行(減速考慮) + ボール拾い上げ時間
    const approachTime = distToBall / (retrieverAgent.maxSpeed * RETRIEVER_APPROACH_FACTOR);
    // 深い外野ヒット回収ペナルティ: 着弾距離が大きいほどボール回収に時間がかかる
    // フェンス直撃時はフェンス距離で計算（軌道上の着弾距離はフェンスを超えるため）
    const effectiveLandingDist = fenceDistance !== undefined
      ? fenceDistance
      : trajectory.landingDistance;
    const depthOverThreshold = effectiveLandingDist - DEEP_HIT_PENALTY_THRESHOLD;
    const depthPenalty = depthOverThreshold > 0
      ? DEEP_HIT_PENALTY_MAX * Math.min(depthOverThreshold / DEEP_HIT_PENALTY_SCALE, 1)
      : 0;
    retrieverArrivalTime = Math.min(
      catchTime + approachTime + RETRIEVER_PICKUP_TIME + depthPenalty,
      catchTime + MAX_PHASE2_TIME - PHASE2_DT
    );
  }

  // 打者走者のスタート遅延を進捗に反映
  const batterRunner = runners.find(r => r.isBatter);
  let batterStartTimer = catchSuccess && trajectory.isGroundBall ? BATTER_START_DELAY : 0;

  // 捕球成功時: 野手を SECURING 状態に
  if (ballHolder) {
    ballHolder.state = "SECURING";
    securingTimer = calcSecuringTime(ballHolder);
    // 外野フライ捕球: ランニングキャッチ→体勢を整える追加オーバーヘッド
    if (!trajectory.isGroundBall) {
      const distFromHome = Math.sqrt(ballHolder.currentPos.x ** 2 + ballHolder.currentPos.y ** 2);
      if (distFromHome > OUTFIELD_DEPTH_THRESHOLD) {
        securingTimer += SF_CATCH_TO_THROW_OVERHEAD;
      }
    }
  }

  // フライ捕球: タッチアップ遅延管理
  let tagupTimer = catchSuccess && !trajectory.isGroundBall ? TAGUP_DELAY : 0;

  // ベースカバー野手を RECEIVING 状態に設定
  for (const a of agents) {
    if (a.state === "COVERING" && a.action === "cover_base") {
      a.state = "RECEIVING";
    }
  }

  // 捕球者以外のPURSUING野手をHOLDINGに遷移（findReceiverForBaseで送球先候補に）
  for (const a of agents) {
    if (a !== catcherAgent && a.state === "PURSUING") {
      a.state = "HOLDING";
      a.action = "hold";
    }
  }

  // 2. ティックループ
  for (let t = catchTime; t <= catchTime + MAX_PHASE2_TIME; t = round(t + dt)) {

    // 2a. 打者走者のスタート遅延
    if (batterStartTimer > 0) {
      batterStartTimer -= dt;
      if (batterStartTimer <= 0 && batterRunner && batterRunner.state === "RUNNING") {
        // スタート遅延解除 — 走塁開始（progress は遅延分を差し引き済み）
      }
    }

    // 2b. タッチアップ遅延
    if (tagupTimer > 0) {
      tagupTimer -= dt;
      if (tagupTimer <= 0) {
        for (const runner of runners) {
          if (runner.state === "WAITING_TAG") {
            runner.state = "DECIDING";
          }
        }
      }
    }

    // タッチアップ判断 (DECIDING → TAGGED_UP or HOLDING)
    for (const runner of runners) {
      if (runner.state === "DECIDING" && catcherAgent) {
        runner.state = decideTagup(runner, catcherAgent, rng) ? "TAGGED_UP" : "HOLDING";
      } else if (runner.state === "DECIDING") {
        // catcherAgentがない場合のフォールバック
        runner.state = "HOLDING";
      }
    }

    // 2c. ランナー更新
    for (const runner of runners) {
      if (runner.state === "RUNNING" || runner.state === "TAGGED_UP") {
        // 打者走者はスタート遅延中は動かない
        if (runner.isBatter && batterStartTimer > 0) continue;
        moveRunner(runner, dt, catchSuccess);
      }
    }

    // 2c-2. ROUNDING → エキストラベース判断（ヒット時）
    for (const runner of runners) {
      if (runner.state === "ROUNDING") {
        runner.roundingTimer = (runner.roundingTimer ?? 0) - dt;
        if (runner.roundingTimer <= 0) {
          if (decideExtraBase(runner, ballHolder, retrieverAgent, retrieverArrivalTime, throwBall, t, rng)) {
            runner.fromBase = runner.targetBase;
            runner.targetBase += 1;
            runner.progress = 0;
            runner.state = "RUNNING";
            runner.isForced = false;
          } else {
            runner.state = "SAFE";
          }
        }
      }
    }

    // 2c-3. ボール回収（ヒット時: 最寄り野手がボールを拾う）
    if (!ballHolder && retrieverAgent && t >= retrieverArrivalTime) {
      ballHolder = retrieverAgent;
      ballHolder.state = "SECURING";
      securingTimer = calcSecuringTime(ballHolder);
    }

    // 2d. ボール保持野手の更新（SECURING → 送球）
    if (ballHolder && ballHolder.state === "SECURING") {
      securingTimer -= dt;
      if (securingTimer <= 0) {
        const target = decideThrowTarget(ballHolder, runners, agents, outs + outsAdded, rng);
        if (target) {
          throwBall = createThrow(ballHolder, target, t);
          const baseName = BASE_NAMES[target.baseNum] ?? "first";
          pendingThrowPlay = {
            from: ballHolder.pos,
            to: target.receiverAgent.pos,
            base: baseName as keyof typeof BASE_POSITIONS,
          };
          target.receiverAgent.state = "RECEIVING";
          ballHolder.state = "THROWING";
          ballHolder = null;
        } else {
          // 送球先なし → プレー終了
          ballHolder.state = "HOLDING";
          ballHolder = null;
        }
      }
    }

    // 2e. 送球ボール更新
    if (throwBall && t >= throwBall.arrivalTime) {
      const receiverPos = throwBall.receiverPos;
      const receiver = receiverPos ? agents.find(a => a.pos === receiverPos) : null;

      const { isOut, runner: playRunner } = resolveBasePlay(throwBall, runners, rng);

      if (isOut) {
        outsAdded++;
        if (pendingThrowPlay) {
          throwPlays.push(pendingThrowPlay);
          pendingThrowPlay = null;
        }
        // DP継続判定: まだアウトにできる走者がいるか？
        const canContinue = outsAdded < 3 && (outs + outsAdded) < 3 &&
          runners.some(r => r.isForced && (r.state === "RUNNING" || r.state === "TAGGED_UP"));
        if (canContinue && receiver) {
          ballHolder = receiver;
          receiver.state = "SECURING";
          securingTimer = PIVOT_TIME; // DP ピボット
          throwBall = null;
        } else {
          throwBall = null;
        }
      } else {
        // セーフ — 保留中のthrowPlayを破棄
        pendingThrowPlay = null;
        throwBall = null;
        // レシーバーがボールを保持（進塁阻止のため再送球可能に）
        if (receiver) {
          ballHolder = receiver;
          receiver.state = "SECURING";
          securingTimer = PIVOT_TIME;
        }
      }
    }

    // 2f. 野手カバー移動（RECEIVING 野手がベースに近づく）
    for (const agent of agents) {
      if (agent.state === "RECEIVING" || agent.state === "COVERING") {
        moveAgent(agent, dt);
      }
    }

    // 2f-2. ゴロ非フォース走者の進塁判断
    if (catchSuccess && trajectory.isGroundBall && throwBall) {
      for (const runner of runners) {
        if (runner.state === "HOLDING" && !runner.isForced) {
          if (decideGroundAdvance(runner, throwBall, t, rng)) {
            runner.targetBase = runner.fromBase + 1;
            runner.progress = 0;
            runner.state = "RUNNING";
          }
        }
      }
    }

    // 2g. タイムラインにランナー情報を追加
    if (collectTimeline) {
      const ballPos = throwBall
        ? interpolateThrowBall(throwBall, t)
        : (ballHolder ? ballHolder.currentPos : getBasePosition(1));
      const entry: AgentTimelineEntry = {
        t,
        ballPos: { ...ballPos },
        ballHeight: throwBall ? 2.0 : 0.5, // 送球中は少し高め
        agents: agents.map(a => ({
          pos: a.pos,
          state: a.state,
          x: a.currentPos.x,
          y: a.currentPos.y,
          targetX: a.targetPos.x,
          targetY: a.targetPos.y,
          speed: a.currentSpeed,
          action: a.action,
        })),
        runners: runners.map(r => ({
          fromBase: r.fromBase,
          targetBase: r.targetBase,
          x: r.currentPos.x,
          y: r.currentPos.y,
          state: r.state,
        })),
        throwBall: throwBall ? {
          fromX: throwBall.fromPos.x,
          fromY: throwBall.fromPos.y,
          toX: throwBall.toPos.x,
          toY: throwBall.toPos.y,
          targetBase: throwBall.targetBase,
          progress: clamp((t - throwBall.startTime) / (throwBall.arrivalTime - throwBall.startTime), 0, 1),
        } : undefined,
      };
      existingTimeline.push(entry);
    }

    // 2h. 終了判定
    // retrieverPendingは走者がまだ動いているときだけ完了を遅らせる
    const hasActiveRunners = runners.some(r =>
      r.state === "RUNNING" || r.state === "ROUNDING" ||
      r.state === "TAGGED_UP" || r.state === "WAITING_TAG" || r.state === "DECIDING"
    );
    const retrieverPending = hasActiveRunners && !ballHolder && retrieverAgent != null && t < retrieverArrivalTime;
    if (isPhase2Complete(runners, throwBall, ballHolder, retrieverPending)) break;
  }

  // 3. 結果構築
  return buildPhase2Result(
    catcherAgent,
    catchSuccess,
    trajectory,
    runners,
    throwPlays,
    outsAdded,
    outs,
    agents,
    rng
  );
}

/** 送球ボールの現在位置を線形補間 */
function interpolateThrowBall(throwBall: ThrowBallState, t: number): Vec2 {
  const progress = clamp(
    (t - throwBall.startTime) / (throwBall.arrivalTime - throwBall.startTime),
    0, 1
  );
  return {
    x: throwBall.fromPos.x + (throwBall.toPos.x - throwBall.fromPos.x) * progress,
    y: throwBall.fromPos.y + (throwBall.toPos.y - throwBall.fromPos.y) * progress,
  };
}

/** Phase 2 の全プレーが解決済みか判定 */
function isPhase2Complete(
  runners: RunnerAgent[],
  throwBall: ThrowBallState | null,
  ballHolder: FielderAgent | null,
  retrieverPending?: boolean
): boolean {
  if (throwBall) return false;
  if (ballHolder && ballHolder.state === "SECURING") return false;
  if (retrieverPending) return false;

  // 全走者がSAFE/OUT/HOLDINGなら完了
  for (const r of runners) {
    if (
      r.state === "RUNNING" ||
      r.state === "TAGGED_UP" ||
      r.state === "WAITING_TAG" ||
      r.state === "ROUNDING" ||
      r.state === "DECIDING"
    ) {
      return false;
    }
  }
  return true;
}

/** Phase 2 結果を AgentFieldingResult に変換 */
function buildPhase2Result(
  catcherAgent: FielderAgent | null,
  catchSuccess: boolean,
  trajectory: BallTrajectory,
  runners: RunnerAgent[],
  throwPlays: ThrowPlay[],
  outsAdded: number,
  originalOuts: number,
  agents: FielderAgent[],
  rng: () => number
): AgentFieldingResult {
  const fielderPos = catcherAgent?.pos ?? (8 as FielderPosition);

  // --- ゴロ捕球成功 ---
  if (catchSuccess && trajectory.isGroundBall) {
    // DP判定: 2アウト以上追加
    if (outsAdded >= 2) {
      return {
        result: "doublePlay",
        fielderPos,
        throwPlays: throwPlays.length > 0 ? throwPlays : undefined,
        putOutPos: throwPlays.length > 0 ? throwPlays[throwPlays.length - 1].to : fielderPos,
        assistPos: throwPlays.map(tp => tp.from),
      };
    }

    // 打者走者がアウトになったか？
    const batterRunner = runners.find(r => r.isBatter);

    // FC判定: 打者走者はセーフだが他の走者がアウト
    if (outsAdded > 0 && batterRunner && batterRunner.state === "SAFE") {
      return {
        result: "fieldersChoice",
        fielderPos,
        throwPlays: throwPlays.length > 0 ? throwPlays : undefined,
      };
    }

    // 通常アウト
    if (outsAdded > 0) {
      return {
        result: "groundout",
        fielderPos,
        throwPlays: throwPlays.length > 0 ? throwPlays : undefined,
        putOutPos: throwPlays.length > 0 ? throwPlays[throwPlays.length - 1].to : fielderPos,
        assistPos: throwPlays.length > 0 ? throwPlays.map(tp => tp.from) : undefined,
      };
    }

    // 誰もアウトにできなかった → 内野安打
    return {
      result: "infieldHit",
      fielderPos,
      throwPlays: throwPlays.length > 0 ? throwPlays : undefined,
    };
  }

  // --- フライ捕球成功 ---
  if (catchSuccess && !trajectory.isGroundBall) {
    // 犠牲フライ判定: 3塁走者がホームに到達 + 2アウト未満
    const thirdRunner = runners.find(r => r.fromBase === 3);
    if (thirdRunner && thirdRunner.state === "SAFE" && thirdRunner.targetBase === 4 && originalOuts < 2) {
      const sfPlays: ThrowPlay[] = [
        { from: fielderPos, to: fielderPos, base: "first" },
        ...throwPlays,
      ];
      return {
        result: "sacrificeFly",
        fielderPos,
        putOutPos: fielderPos,
        throwPlays: sfPlays,
      };
    }

    // タッチアップでアウト
    if (outsAdded > 0) {
      // フライアウト + タッチアップアウト: 捕球者POをself-playとして先頭に追加
      const baseResult = trajectory.launchAngle >= POPUP_LAUNCH_ANGLE ? "popout"
        : trajectory.launchAngle < LINER_LAUNCH_ANGLE_MAX ? "lineout"
        : "flyout";
      const allPlays: ThrowPlay[] = [
        { from: fielderPos, to: fielderPos, base: "first" },
        ...throwPlays,
      ];
      return {
        result: baseResult,
        fielderPos,
        putOutPos: fielderPos,
        throwPlays: allPlays,
      };
    }

    // 通常フライアウト
    const baseResult: AtBatResult = trajectory.launchAngle >= POPUP_LAUNCH_ANGLE ? "popout"
      : trajectory.launchAngle < LINER_LAUNCH_ANGLE_MAX ? "lineout"
      : "flyout";
    return {
      result: baseResult,
      fielderPos,
      putOutPos: fielderPos,
    };
  }

  // --- 捕球失敗 / 未到達ヒット ---
  // 走者の到達塁から結果を判定
  const batterRunner = runners.find(r => r.isBatter);
  const batterReachedBase = batterRunner
    ? (batterRunner.state === "SAFE" ? batterRunner.targetBase : 1)
    : 1;

  let result: AtBatResult;
  if (batterReachedBase >= 3) {
    result = "triple";
  } else if (batterReachedBase >= 2) {
    result = "double";
  } else {
    result = "single";
  }

  const runnerResults: RunnerResult[] = runners.map(r => ({
    player: r.player,
    fromBase: r.originalBase ?? (r.isBatter ? 0 : r.fromBase),
    reachedBase: r.state === "SAFE" ? r.targetBase : r.fromBase,
    isOut: r.state === "OUT",
  }));

  return {
    result,
    fielderPos,
    throwPlays: throwPlays.length > 0 ? throwPlays : undefined,
    runnerResults,
  };
}
