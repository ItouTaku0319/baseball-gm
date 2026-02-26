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
  AGENT_BASE_REACTION_IF,
  AGENT_BASE_REACTION_OF,
  AGENT_PITCHER_REACTION,
  AGENT_CATCHER_REACTION,
  AGENT_CATCH_RADIUS_IF,
  AGENT_CATCH_RADIUS_OF,
  AGENT_GROUND_INTERCEPT_RADIUS,
  AGENT_DIVE_MIN_DIST,
  AGENT_DIVE_MAX_DIST,
  AGENT_DIVE_BASE_RATE,
  AGENT_DIVE_SKILL_FACTOR,
  AGENT_RUNNING_CATCH_BASE,
  AGENT_RUNNING_CATCH_SKILL,
  AGENT_PERCEPTION_BASE_NOISE,
  AGENT_PERCEPTION_LINE_DRIVE_MULT,
  AGENT_PERCEPTION_POPUP_MULT,
  AGENT_CALLOFF_RADIUS,
  AGENT_ACCELERATION_TIME,
  AGENT_SPEED_SKILL_FACTOR,
} from "./physics-constants";
import type {
  Vec2,
  BallTrajectory,
  BallType,
  FielderPosition,
  FielderAgent,
  AgentState,
  CatchResult,
  AgentSimOptions,
  AgentFieldingResult,
  AtBatResult,
  AgentTimelineEntry,
  AgentSnapshot,
} from "./fielding-agent-types";
import {
  CALLOFF_PRIORITY,
  BASE_POSITIONS,
  BASE_LENGTH,
  BASE_NAMES,
  vec2Distance,
  clamp,
  gaussianRandom,
} from "./fielding-agent-types";
import type { FielderAction } from "../models/league";

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
  let prevBallPos: Vec2 = { x: 0, y: 0 };
  let catchTime = 0;
  let finalT = 0;

  // === Phase 1: ティックループ ===
  for (let t = 0; t <= maxTime; t = round(t + dt)) {
    const ballPos = trajectory.getPositionAt(t);
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

    // --- Step 2: コールオフ解決 ---
    resolveCallOffs(agents);

    // --- Step 3: 行動決定 ---
    for (const agent of agents) {
      if (agent.reactionRemaining > 0) continue;
      if (agent.state === "FIELDING" || agent.state === "THROWING") continue;
      updateDecision(agent, trajectory, t, agents, bases, outs);
    }

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
        break;
      }
    }

    if (!trajectory.isGroundBall && ballOnGround && t > 0) {
      const result = checkFlyCatchAtLanding(agents, trajectory, t, rng);
      if (result) {
        catcherAgent = result.agent;
        catchResult = result.catchResult;
        catchTime = t;
        break;
      }
    }

    // --- Step 6: タイムライン記録 ---
    if (collectTimeline) {
      timeline.push(snapshotAll(agents, ballPos, ballH, t));
    }

    // --- Step 7: 早期終了 ---
    // ゴロ: isOnGround が常に true なので、ボール停止後のみ判定
    // フライ: 着地後に全PURSUINGが目標到着済みなら終了
    if (trajectory.isGroundBall) {
      // ゴロ: ボール停止 + 全追跡者が目標に到達、または追跡者なし
      if (t >= trajectory.flightTime) {
        const pursuers = agents.filter((a) => a.state === "PURSUING");
        if (pursuers.length === 0) break;
        const allSettled = pursuers.every(
          (a) => vec2Distance(a.currentPos, a.targetPos) < 0.5
        );
        if (allSettled) break;
      }
    } else if (ballOnGround) {
      // フライ着地後
      const allSettled = agents.every(
        (a) =>
          a.state !== "PURSUING" ||
          vec2Distance(a.currentPos, a.targetPos) < 0.5
      );
      if (allSettled) break;
    }

    prevBallPos = ballPos;
    finalT = t;
  }

  // === Phase 2: 結果解決 ===

  // ケース1: 捕球成功
  if (catchResult && catchResult.success && catcherAgent) {
    return resolveSuccessfulCatch(
      catcherAgent,
      ball,
      trajectory,
      batter,
      bases,
      outs,
      agents,
      timeline,
      rng
    );
  }

  // ケース2: 捕球失敗
  if (catchResult && !catchResult.success && catcherAgent) {
    return resolveFieldingError(
      catcherAgent,
      ball,
      landing,
      trajectory,
      batter,
      bases,
      agents,
      timeline,
      rng,
      finalT
    );
  }

  // ケース3: 誰も到達できなかった
  const retriever = findNearestAgent(agents, trajectory.landingPos);
  if (!retriever) {
    return {
      result: "single",
      fielderPos: 8 as FielderPosition,
    };
  }
  return resolveHitWithRetriever(
    retriever,
    ball,
    landing,
    trajectory,
    batter,
    bases,
    agents,
    timeline,
    rng,
    finalT
  );
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
    };

    // 反応時間
    let baseReaction: number;
    if (pos === 1) baseReaction = AGENT_PITCHER_REACTION;
    else if (pos === 2) baseReaction = AGENT_CATCHER_REACTION;
    else if (pos >= 7) baseReaction = AGENT_BASE_REACTION_OF;
    else baseReaction = AGENT_BASE_REACTION_IF;

    // 走速
    const isOF = pos >= 7;
    const baseSpeed = isOF ? 7.0 : 6.5;
    const maxSpeed = baseSpeed + (skill.speed / 100) * AGENT_SPEED_SKILL_FACTOR;

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
    agent.perceivedLanding = { position: { ...trueLanding }, confidence: 1.0 };
    return;
  }

  let sigma: number;
  if (trajectory.isGroundBall) {
    // ゴロ: 初期は方向読みが不正確、時間経過で改善
    const gbProgress = clamp(t / trajectory.flightTime, 0, 0.95);
    sigma =
      3.0 *
      (1 - agent.skill.fielding / 200) *
      Math.sqrt(1 - gbProgress) *
      noiseScale;
  } else {
    const progressRatio = clamp(t / trajectory.flightTime, 0, 0.95);
    const skillFactor = 1 - agent.skill.fielding / 200;
    let baseSigma = AGENT_PERCEPTION_BASE_NOISE;
    if (trajectory.ballType === "line_drive") {
      baseSigma *= AGENT_PERCEPTION_LINE_DRIVE_MULT;
    } else if (trajectory.ballType === "popup") {
      baseSigma *= AGENT_PERCEPTION_POPUP_MULT;
    }
    sigma = baseSigma * Math.sqrt(1 - progressRatio) * skillFactor * noiseScale;
  }

  const noiseX = gaussianRandom(0, sigma, rng);
  const noiseY = gaussianRandom(0, sigma, rng);
  agent.perceivedLanding = {
    position: {
      x: trueLanding.x + noiseX,
      y: trueLanding.y + noiseY,
    },
    confidence: clamp(1 - sigma / AGENT_PERCEPTION_BASE_NOISE, 0, 1),
  };
}

// ====================================================================
// コールオフ
// ====================================================================

function resolveCallOffs(agents: FielderAgent[]): void {
  const pursuers = agents.filter(
    (a) => a.state === "PURSUING" && !a.hasYielded
  );
  if (pursuers.length < 2) return;

  for (let i = 0; i < pursuers.length - 1; i++) {
    for (let j = i + 1; j < pursuers.length; j++) {
      const a = pursuers[i];
      const b = pursuers[j];
      const agentDist = vec2Distance(a.currentPos, b.currentPos);
      const targetDist = vec2Distance(a.targetPos, b.targetPos);

      if (agentDist < AGENT_CALLOFF_RADIUS && targetDist < AGENT_CALLOFF_RADIUS) {
        if (CALLOFF_PRIORITY[a.pos] >= CALLOFF_PRIORITY[b.pos]) {
          (b as { hasYielded: boolean }).hasYielded = true;
          (a as { hasCalled: boolean }).hasCalled = true;
        } else {
          (a as { hasYielded: boolean }).hasYielded = true;
          (b as { hasCalled: boolean }).hasCalled = true;
        }
      }
    }
  }
}

// ====================================================================
// 行動決定
// ====================================================================

function updateDecision(
  agent: FielderAgent,
  trajectory: BallTrajectory,
  t: number,
  allAgents: FielderAgent[],
  bases: BaseRunners,
  outs: number
): void {
  if (agent.hasYielded) {
    agent.state = "BACKING_UP";
    agent.action = "backup";
    agent.targetPos = calcBackupPosition(trajectory);
    return;
  }

  const perceived = agent.perceivedLanding.position;
  const distToTarget = vec2Distance(agent.currentPos, perceived);
  const timeRemaining = Math.max(0, trajectory.flightTime - t);

  if (trajectory.isGroundBall) {
    // --- 投手(1): 経路が投手近傍を通る場合のみ捕球（perpDist < 2.0m）---
    if (agent.pos === 1) {
      const intercept = calcPathIntercept(agent, trajectory, t);
      if (intercept && intercept.canReach && intercept.perpDist < 2.0) {
        agent.state = "PURSUING";
        agent.action = "charge";
        agent.targetPos = intercept.point;
        agent.interceptPoint = intercept.point;
        agent.interceptBallTime = intercept.ballTime;
        return;
      }
      assignNonPursuitRole(agent, trajectory, bases, outs);
      return;
    }

    // --- 捕手(2): 近距離(8m以内)のみチャーシング（バント・弱いチョッパー対応）---
    if (agent.pos === 2) {
      if (distToTarget < 8.0) {
        agent.state = "PURSUING";
        agent.action = "field_ball";
        agent.targetPos = perceived;
        return;
      }
      assignNonPursuitRole(agent, trajectory, bases, outs);
      return;
    }

    // --- 内野手(3-6)・外野手(7-9): 通常インターセプト ---
    const intercept = calcPathIntercept(agent, trajectory, t);
    if (intercept && intercept.canReach) {
      agent.state = "PURSUING";
      agent.action = "charge";
      agent.targetPos = intercept.point;
      agent.interceptPoint = intercept.point;
      agent.interceptBallTime = intercept.ballTime;
      return;
    }

    // 停止球チャーシング
    const chaseTime = distToTarget / agent.maxSpeed;
    if (t + chaseTime < trajectory.flightTime + 1.5) {
      agent.state = "PURSUING";
      agent.action = "field_ball";
      agent.targetPos = perceived;
      return;
    }

    assignNonPursuitRole(agent, trajectory, bases, outs);
    return;
  }

  // フライ/ライナー/ポップフライ

  // --- 投手(1): 投手近傍(5m以内)の短いフライ/ポップのみ追跡 ---
  if (agent.pos === 1) {
    const pitcherStart = DEFAULT_FIELDER_POSITIONS.get(1);
    if (pitcherStart) {
      const distFromStart = vec2Distance(perceived, {
        x: pitcherStart.x,
        y: pitcherStart.y,
      });
      if (distFromStart > 5.0) {
        assignNonPursuitRole(agent, trajectory, bases, outs);
        return;
      }
    }
  }

  // --- 捕手(2): ホーム近傍(15m以内)のフライのみ追跡 ---
  if (agent.pos === 2) {
    if (distToTarget > 15.0) {
      assignNonPursuitRole(agent, trajectory, bases, outs);
      return;
    }
  }

  const estimatedArrivalTime = distToTarget / agent.maxSpeed;
  const canReach = estimatedArrivalTime < timeRemaining + 1.0;

  if (canReach) {
    agent.state = "PURSUING";
    if (perceived.y < agent.currentPos.y - 2) {
      agent.action = "charge";
    } else if (perceived.y > agent.currentPos.y + 5) {
      agent.action = "retreat";
    } else {
      agent.action = "lateral";
    }
    agent.targetPos = perceived;
  } else {
    assignNonPursuitRole(agent, trajectory, bases, outs);
  }
}

function assignNonPursuitRole(
  agent: FielderAgent,
  trajectory: BallTrajectory,
  _bases: BaseRunners,
  _outs: number
): void {
  const pos = agent.pos;
  switch (pos) {
    case 1: // P
      if (trajectory.landingPos.x > 0 && trajectory.isGroundBall) {
        agent.state = "COVERING";
        agent.action = "cover_base";
        agent.targetPos = { ...BASE_POSITIONS.first };
      } else {
        agent.state = "HOLDING";
        agent.action = "hold";
        agent.targetPos = { x: 0, y: 18.4 };
      }
      break;
    case 2: // C
      agent.state = "HOLDING";
      agent.action = "hold";
      agent.targetPos = { ...BASE_POSITIONS.home };
      break;
    case 3: // 1B
      agent.state = "COVERING";
      agent.action = "cover_base";
      agent.targetPos = { ...BASE_POSITIONS.first };
      break;
    case 4: // 2B
      if (!trajectory.isGroundBall && trajectory.landingDistance >= 60) {
        agent.state = "COVERING";
        agent.action = "relay";
        agent.targetPos = calcCutoffPos(trajectory, "right");
      } else {
        agent.state = "COVERING";
        agent.action = "cover_base";
        agent.targetPos = { ...BASE_POSITIONS.second };
      }
      break;
    case 5: // 3B
      agent.state = "COVERING";
      agent.action = "cover_base";
      agent.targetPos = { ...BASE_POSITIONS.third };
      break;
    case 6: // SS
      if (!trajectory.isGroundBall && trajectory.landingDistance >= 60) {
        agent.state = "COVERING";
        agent.action = "relay";
        agent.targetPos = calcCutoffPos(trajectory, "left");
      } else {
        agent.state = "COVERING";
        agent.action = "cover_base";
        agent.targetPos = { ...BASE_POSITIONS.second };
      }
      break;
    default: // 7, 8, 9 (OF)
      agent.state = "BACKING_UP";
      agent.action = "backup";
      agent.targetPos = calcBackupPosition(trajectory);
      break;
  }
}

// ====================================================================
// 移動
// ====================================================================

function moveAgent(agent: FielderAgent, dt: number): void {
  if (
    agent.state === "READY" ||
    agent.state === "REACTING" ||
    agent.state === "HOLDING" ||
    agent.state === "FIELDING" ||
    agent.state === "THROWING"
  ) {
    (agent as { currentSpeed: number }).currentSpeed = 0;
    return;
  }

  const dx = agent.targetPos.x - agent.currentPos.x;
  const dy = agent.targetPos.y - agent.currentPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.1) {
    (agent as { currentSpeed: number }).currentSpeed = 0;
    return;
  }

  // 加速
  if (agent.currentSpeed < agent.maxSpeed) {
    (agent as { currentSpeed: number }).currentSpeed = Math.min(
      agent.maxSpeed,
      agent.currentSpeed + (agent.maxSpeed / AGENT_ACCELERATION_TIME) * dt
    );
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
  if (t >= trajectory.flightTime) {
    const chasersForStop = agents.filter(
      (a) => a.state === "PURSUING" && a.action === "field_ball"
    );
    for (const agent of chasersForStop) {
      const d = vec2Distance(agent.currentPos, currBallPos);
      if (d < AGENT_CATCH_RADIUS_IF * 2) {
        agent.state = "FIELDING";
        agent.arrivalTime = t;
        return {
          agent,
          catchResult: {
            success: true,
            catchType: "ground_field",
            catchRate: 0.99,
            agentPos: agent.pos,
          },
        };
      }
    }
  }

  if (segLenSq < 0.0001) return null;

  // 経路インターセプト中のエージェント
  const candidates = agents
    .filter((a) => a.state === "PURSUING" && a.interceptPoint != null)
    .sort((a, b) => {
      // ホームに近い方 (projDist) 優先
      const da = vec2Distance(a.currentPos, BASE_POSITIONS.home);
      const db = vec2Distance(b.currentPos, BASE_POSITIONS.home);
      return da - db;
    });

  // 停止球チャーシング中
  const chasers = agents.filter(
    (a) => a.state === "PURSUING" && a.action === "field_ball"
  );

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

    if (distSq < AGENT_CATCH_RADIUS_IF * AGENT_CATCH_RADIUS_IF) {
      agent.state = "FIELDING";
      agent.arrivalTime = t;
      const fieldingRate =
        (agent.skill.fielding * 0.6 + agent.skill.catching * 0.4) / 100;
      const ballSpeed = trajectory.getSpeedAt(t);
      const speedPenalty = Math.max(0, (ballSpeed - 20) * 0.005);
      const catchRate = clamp(
        0.97 + fieldingRate * 0.02 - speedPenalty,
        0.92,
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
  if (t >= trajectory.flightTime) {
    const allPursuers = agents.filter((a) => a.state === "PURSUING");
    for (const agent of allPursuers) {
      const d = vec2Distance(agent.currentPos, currBallPos);
      if (d < AGENT_CATCH_RADIUS_IF * 2) {
        agent.state = "FIELDING";
        agent.arrivalTime = t;
        return {
          agent,
          catchResult: {
            success: true,
            catchType: "ground_field",
            catchRate: 0.99,
            agentPos: agent.pos,
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

  const candidates = agents
    .filter((a) => a.state === "PURSUING")
    .map((a) => ({ agent: a, dist: vec2Distance(a.currentPos, landingPos) }))
    .sort((a, b) => a.dist - b.dist);

  for (const { agent, dist } of candidates) {
    const isOF = agent.pos >= 7;
    const standardRadius = isOF
      ? AGENT_CATCH_RADIUS_OF
      : AGENT_CATCH_RADIUS_IF;
    const extendedRadius = standardRadius * 1.2;

    const fieldingRate =
      (agent.skill.fielding * 0.6 + agent.skill.catching * 0.4) / 100;

    // 1. 標準捕球
    if (dist <= standardRadius) {
      agent.state = "FIELDING";
      agent.arrivalTime = t;
      const marginFactor = clamp(
        (standardRadius - dist) / standardRadius,
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

    // 2. ランニングキャッチ (デッドゾーン回避: standard < dist <= extended)
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
// 結果解決
// ====================================================================

function resolveSuccessfulCatch(
  catcher: FielderAgent,
  ball: BattedBall,
  trajectory: BallTrajectory,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  agents: FielderAgent[],
  _timeline: AgentTimelineEntry[],
  rng: () => number
): AgentFieldingResult {
  if (trajectory.isGroundBall) {
    return resolveGroundOut(catcher, batter, bases, outs, agents, rng);
  }
  return resolveFlyOut(catcher, trajectory.ballType, batter, bases, outs, agents, rng);
}

function resolveGroundOut(
  catcher: FielderAgent,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  agents: FielderAgent[],
  rng: () => number
): AgentFieldingResult {
  const fieldTime = catcher.arrivalTime;
  const secureTime = 0.3 + (1 - catcher.skill.fielding / 100) * 0.2;
  const transferTime = 0.55 + (1 - catcher.skill.arm / 100) * 0.25;
  const throwSpeed = 25 + (catcher.skill.arm / 100) * 15;

  const throwDist = vec2Distance(catcher.currentPos, BASE_POSITIONS.first);
  const defenseTime =
    fieldTime + secureTime + transferTime + throwDist / throwSpeed;

  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const runnerTo1B = 0.3 + BASE_LENGTH / runnerSpeed;

  // 内野安打
  if (runnerTo1B < defenseTime) {
    return {
      result: "infieldHit",
      fielderPos: catcher.pos,
      putOutPos: undefined,
      assistPos: undefined,
    };
  }

  // DP判定
  if (bases.first && outs < 2) {
    const dpRate = 0.12 + (1 - batter.batting.speed / 100) * 0.06;
    if (rng() < dpRate) {
      const coverAgent = agents.find(
        (a) =>
          (a.pos === 4 || a.pos === 6) &&
          a.state === "COVERING" &&
          a.action === "cover_base"
      );
      const assistPositions: FielderPosition[] = coverAgent
        ? [catcher.pos, coverAgent.pos]
        : [catcher.pos];
      return {
        result: "doublePlay",
        fielderPos: catcher.pos,
        putOutPos: 3 as FielderPosition,
        assistPos: assistPositions,
      };
    }
  }

  // FC判定
  if (bases.first || bases.second || bases.third) {
    if (rng() < 0.05) {
      return {
        result: "fieldersChoice",
        fielderPos: catcher.pos,
        putOutPos: catcher.pos,
        assistPos: undefined,
      };
    }
  }

  return {
    result: "groundout",
    fielderPos: catcher.pos,
    putOutPos: 3 as FielderPosition,
    assistPos: [catcher.pos],
  };
}

function resolveFlyOut(
  catcher: FielderAgent,
  ballType: BallType,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  agents: FielderAgent[],
  rng: () => number
): AgentFieldingResult {
  const throwSpeed = 25 + (catcher.skill.arm / 100) * 15;

  // 犠牲フライ判定: 3塁走者あり + 2アウト未満 + フライ(ライナー除く)
  if (bases.third && outs < 2 && ballType === "fly_ball") {
    const throwDist = vec2Distance(catcher.currentPos, BASE_POSITIONS.home);
    const throwTime = throwDist / throwSpeed;
    const runnerSpeed = 6.5 + (bases.third.batting.speed / 100) * 2.5;
    const tagUpTime = BASE_LENGTH / runnerSpeed;
    if (tagUpTime < throwTime + 0.3) {
      if (rng() < 0.6) {
        return {
          result: "sacrificeFly",
          fielderPos: catcher.pos,
          putOutPos: catcher.pos,
          assistPos: undefined,
        };
      }
    }
  }

  // 2塁走者→3塁タッグアップ
  // (resolveFlyOut内で処理)

  if (ballType === "popup") {
    return {
      result: "popout",
      fielderPos: catcher.pos,
      putOutPos: catcher.pos,
      assistPos: undefined,
    };
  }

  if (ballType === "fly_ball") {
    return {
      result: "flyout",
      fielderPos: catcher.pos,
      putOutPos: catcher.pos,
      assistPos: undefined,
    };
  }

  return {
    result: "lineout",
    fielderPos: catcher.pos,
    putOutPos: catcher.pos,
    assistPos: undefined,
  };
}

function resolveFieldingError(
  catcher: FielderAgent,
  ball: BattedBall,
  landing: BallLanding,
  trajectory: BallTrajectory,
  batter: Player,
  bases: BaseRunners,
  agents: FielderAgent[],
  timeline: AgentTimelineEntry[],
  rng: () => number,
  simEndTime: number
): AgentFieldingResult {
  if (trajectory.isGroundBall) {
    return {
      result: "error",
      fielderPos: catcher.pos,
      errorPos: catcher.pos,
      putOutPos: undefined,
      assistPos: undefined,
    };
  }
  // フライ落球 → 最寄り野手が回収
  const retriever = findNearestAgent(agents, trajectory.landingPos);
  if (!retriever) {
    return {
      result: "error",
      fielderPos: catcher.pos,
      errorPos: catcher.pos,
    };
  }
  return resolveHitWithRetriever(
    retriever,
    ball,
    landing,
    trajectory,
    batter,
    bases,
    agents,
    timeline,
    rng,
    simEndTime
  );
}

function resolveHitWithRetriever(
  retriever: FielderAgent,
  ball: BattedBall,
  landing: BallLanding,
  trajectory: BallTrajectory,
  batter: Player,
  bases: BaseRunners,
  agents: FielderAgent[],
  _timeline: AgentTimelineEntry[],
  rng: () => number,
  simEndTime: number
): AgentFieldingResult {
  const distToLanding = vec2Distance(
    retriever.currentPos,
    trajectory.landingPos
  );
  const pickupTime =
    0.3 + (1 - retriever.skill.catching / 100) * 0.4;
  let bouncePenalty: number;
  if (landing.isGroundBall) {
    bouncePenalty = 0.5 + rng() * 0.5;
  } else {
    bouncePenalty =
      0.3 + clamp((landing.distance - 50) / 50, 0, 1) * 0.5 + rng() * 0.4;
  }
  const fenceDist = getFenceDistance(ball.direction);
  if (landing.distance >= fenceDist * 0.9) {
    bouncePenalty += 0.6 + rng() * 0.6;
  }

  // catchTime: シミュレーション終了時点 + 残走行時間 + バウンス + 拾い上げ
  const remainingTravel = distToLanding / retriever.maxSpeed;
  const catchTime =
    simEndTime + remainingTravel + bouncePenalty + pickupTime;

  // 打者の到達塁を先に計算
  const batSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const batTimeTo2B = 0.3 + (BASE_LENGTH * 2) / batSpeed;
  const batTimeTo3B = 0.3 + (BASE_LENGTH * 3) / batSpeed;
  const defenseTo2B =
    catchTime + calcThrowTime(retriever, "second", agents);
  const defenseTo3B =
    catchTime + calcThrowTime(retriever, "third", agents);

  let basesReached = 1;
  if (batTimeTo2B < defenseTo2B - 0.3) basesReached = 2;
  if (basesReached >= 2 && batTimeTo3B < defenseTo3B - 0.3) basesReached = 3;
  if (landing.isGroundBall) basesReached = Math.min(basesReached, 2);
  if (landing.distance < 25) basesReached = 1;
  // 深いフライ（85m以上）は最低2塁打保証
  if (!landing.isGroundBall && landing.distance >= 85) {
    basesReached = Math.max(basesReached, 2);
  }

  const resultStr: AtBatResult =
    basesReached >= 3 ? "triple" : basesReached >= 2 ? "double" : "single";

  return {
    result: resultStr,
    fielderPos: retriever.pos,
    putOutPos: undefined,
    assistPos: undefined,
  };
}

// ====================================================================
// 送球時間計算
// ====================================================================

function calcThrowTime(
  retriever: FielderAgent,
  targetBase: keyof typeof BASE_POSITIONS,
  agents: FielderAgent[]
): number {
  const throwDist = vec2Distance(
    retriever.currentPos,
    BASE_POSITIONS[targetBase]
  );
  const throwSpeed = 25 + (retriever.skill.arm / 100) * 15;

  if (throwDist > 60) {
    const relayAgent = agents.find(
      (a) => a.state === "COVERING" && a.action === "relay"
    );
    if (relayAgent) {
      const d1 = vec2Distance(retriever.currentPos, relayAgent.currentPos);
      const d2 = vec2Distance(
        relayAgent.currentPos,
        BASE_POSITIONS[targetBase]
      );
      const relayThrowSpeed = 25 + (relayAgent.skill.arm / 100) * 15;
      return d1 / throwSpeed + 0.3 + d2 / relayThrowSpeed;
    }
  }

  return throwDist / throwSpeed;
}

// ====================================================================
// ヘルパー関数
// ====================================================================

function calcPathIntercept(
  agent: FielderAgent,
  trajectory: BallTrajectory,
  t: number
): { canReach: boolean; point: Vec2; ballTime: number; perpDist: number } | null {
  if (!trajectory.isGroundBall) return null;

  // ゴロの経路方向
  const landing = trajectory.landingPos;
  const pathLen = Math.sqrt(landing.x * landing.x + landing.y * landing.y);
  if (pathLen < 0.1) return null;

  const pathDirX = landing.x / pathLen;
  const pathDirY = landing.y / pathLen;

  // 野手位置をゴロ経路に射影
  const projDist =
    agent.currentPos.x * pathDirX + agent.currentPos.y * pathDirY;

  // 経路に対する垂線距離
  const perpX = agent.currentPos.x - projDist * pathDirX;
  const perpY = agent.currentPos.y - projDist * pathDirY;
  const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);

  // 垂線距離が大きすぎる場合は到達不可
  if (perpDist > 25) return null;

  const maxDist = trajectory.landingDistance;
  const stopTime = trajectory.flightTime;

  if (projDist < 0) return null; // 野手がホーム後方

  // スキャンベースの最適インターセプト点探索
  // ボール経路上の複数点を検査し、margin(=ballTime - fielderArrival)が最大の点を選ぶ
  let bestPoint: Vec2 | null = null;
  let bestBallTime = 0;
  let bestMargin = -Infinity;

  // 探索範囲: 野手の射影点 ± 15m（ただし 2m〜maxDist）
  const scanMin = Math.max(2, projDist - 15);
  const scanMax = Math.min(maxDist, projDist + 5); // 前方5mまで(後追いは少し)
  const stepSize = 1.5; // 1.5m刻み

  for (let d = scanMin; d <= scanMax; d += stepSize) {
    const ratio = d / maxDist;
    if (ratio >= 1) continue;
    const p = 1 - Math.sqrt(Math.max(0, 1 - ratio));
    const ballTime = p * stopTime;
    if (ballTime < t) continue; // ボール通過済み

    const ix = d * pathDirX;
    const iy = d * pathDirY;
    const fielderDist = Math.sqrt(
      (agent.currentPos.x - ix) * (agent.currentPos.x - ix) +
      (agent.currentPos.y - iy) * (agent.currentPos.y - iy)
    );
    const fielderArrival = t + fielderDist / agent.maxSpeed;
    const margin = ballTime - fielderArrival;

    if (margin > bestMargin) {
      bestMargin = margin;
      bestPoint = { x: ix, y: iy };
      bestBallTime = ballTime;
    }
  }

  // 停止点(maxDist)も候補に含める（射影点がmaxDistを超える場合に有効）
  if (projDist >= maxDist * 0.8) {
    const ix = landing.x;
    const iy = landing.y;
    const fielderDist = Math.sqrt(
      (agent.currentPos.x - ix) * (agent.currentPos.x - ix) +
      (agent.currentPos.y - iy) * (agent.currentPos.y - iy)
    );
    const fielderArrival = t + fielderDist / agent.maxSpeed;
    const margin = stopTime - fielderArrival;
    if (margin > bestMargin) {
      bestMargin = margin;
      bestPoint = { x: ix, y: iy };
      bestBallTime = stopTime;
    }
  }

  if (!bestPoint) return null;

  return {
    canReach: bestMargin >= -0.3,
    point: bestPoint,
    ballTime: bestBallTime,
    perpDist,
  };
}

function calcBackupPosition(trajectory: BallTrajectory): Vec2 {
  const landingPos = trajectory.landingPos;
  const angleRad = ((trajectory.direction - 45) * Math.PI) / 180;
  const backupDist = 8;
  return {
    x: landingPos.x + backupDist * Math.sin(angleRad),
    y: landingPos.y + backupDist * Math.cos(angleRad),
  };
}

function calcCutoffPos(
  trajectory: BallTrajectory,
  _side: "left" | "right"
): Vec2 {
  const landing = trajectory.landingPos;
  return {
    x: landing.x * 0.4,
    y: landing.y * 0.4,
  };
}

function findNearestAgent(
  agents: FielderAgent[],
  pos: Vec2
): FielderAgent | null {
  let nearest: FielderAgent | null = null;
  let minDist = Infinity;
  for (const a of agents) {
    const d = vec2Distance(a.currentPos, pos);
    if (d < minDist) {
      minDist = d;
      nearest = a;
    }
  }
  return nearest;
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
  t: number
): AgentTimelineEntry {
  return {
    t,
    ballPos: { ...ballPos },
    ballHeight,
    agents: agents.map((a) => ({
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
    })),
  };
}

/** 浮動小数点丸め (0.1刻みの累積誤差防止) */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
