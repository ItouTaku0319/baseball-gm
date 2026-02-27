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
  AGENT_DIVE_MIN_DIST,
  AGENT_DIVE_MAX_DIST,
  AGENT_DIVE_BASE_RATE,
  AGENT_DIVE_SKILL_FACTOR,
  AGENT_RUNNING_CATCH_BASE,
  AGENT_RUNNING_CATCH_SKILL,
  AGENT_PERCEPTION_BASE_NOISE,
  AGENT_PERCEPTION_LINE_DRIVE_MULT,
  AGENT_PERCEPTION_POPUP_MULT,
  AGENT_ACCELERATION_TIME,
  AGENT_SPEED_SKILL_FACTOR,
  AGENT_BASE_SPEED_IF,
  AGENT_BASE_SPEED_OF,
  TRANSFER_TIME_BASE,
  TRANSFER_TIME_ARM_SCALE,
  RUNNER_START_DELAY,
  CATCH_REACH_BASE_IF,
  CATCH_REACH_GROUND_BONUS,
  CATCH_REACH_BASE_P_GROUND,
  CATCH_REACH_BASE_OF,
  CATCH_REACH_BASE_C,
  CATCH_REACH_SKILL_FACTOR,
  POPUP_LAUNCH_ANGLE_THRESHOLD,
  CALLOFF_TARGET_THRESHOLD,
  CLOSER_PURSUER_INTERCEPT_RATIO,
  CLOSER_PURSUER_CHASE_RATIO,
  PITCHER_GROUND_BALL_MAX_DIST,
  INFIELD_HIT_PROB,
  INFIELD_HIT_MARGIN_SCALE,
  INFIELD_HIT_SPEED_BONUS,
  GROUND_BALL_HARD_HIT_SPEED,
  GROUND_BALL_CATCH_SPEED_PENALTY,
  GROUND_BALL_CATCH_FLOOR,
  GROUND_BALL_REACH_PENALTY,
  GROUND_BALL_GAP_BASE_PROB,
  GROUND_BALL_GAP_SPEED_BONUS,
  GROUND_BALL_GAP_MIN_EV,
  SF_CATCH_TO_THROW_OVERHEAD,
  DP_PIVOT_SUCCESS_BASE,
  DP_PIVOT_SUCCESS_SPEED_FACTOR,
  DP_STEP_ON_BASE_SUCCESS,
  DP_STEP_ON_BASE_SPEED_FACTOR,
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
  ThrowPlay,
} from "./fielding-agent-types";
import {
  CALLOFF_PRIORITY,
  BASE_POSITIONS,
  BASE_LENGTH,
  BASE_NAMES,
  vec2Distance,
  vec2DistanceSq,
  clamp,
  gaussianRandom,
  PRIMARY_ZONE,
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
// ギャップ抜け判定
// ====================================================================

/**
 * 内野手のデフォルト守備位置から計算した方向角度。
 * 打球がこれらの角度に近いほど野手の正面 → 抜けにくい。
 * 角度が遠いほどギャップ → 抜けやすい。
 */
const FIELDER_DIRECTION_ANGLES = [0, 10, 27, 59, 76, 90]; // ファウルライン + 3B, SS, 2B, 1B

/**
 * ゴロのギャップ抜け確率を計算。
 * 打球方向が野手の正面から離れるほど（ギャップに近いほど）確率が上がる。
 */
function calcGroundBallGapProb(direction: number, exitVelocity: number): number {
  if (exitVelocity < GROUND_BALL_GAP_MIN_EV) return 0;

  // 最も近い野手位置からの距離を計算
  let minDistFromFielder = 90;
  for (const angle of FIELDER_DIRECTION_ANGLES) {
    const dist = Math.abs(direction - angle);
    if (dist < minDistFromFielder) minDistFromFielder = dist;
  }

  // 野手近く（<8°）→ 抜けない
  if (minDistFromFielder < 8) return 0;

  // 野手から離れるほど抜けやすい（8°から線形に増加、最大16°で飽和）
  const gapFactor = clamp((minDistFromFielder - 8) / 8, 0, 1);

  // 打球速度ボーナス（130km/h以上で加算）
  const speedFactor = clamp((exitVelocity - 130) / 40, 0, 1);
  const speedBonus = speedFactor * GROUND_BALL_GAP_SPEED_BONUS;

  return GROUND_BALL_GAP_BASE_PROB * gapFactor + speedBonus;
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

  // === Phase -1: ゴロのギャップ抜けチェック ===
  if (ball.launchAngle < 10 && ball.exitVelocity >= GROUND_BALL_GAP_MIN_EV) {
    const gapProb = calcGroundBallGapProb(ball.direction, ball.exitVelocity);
    if (gapProb > 0 && rng() < gapProb) {
      return { result: "single", fielderPos: 6 }; // ギャップ抜けシングル
    }
  }

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

    // --- Step 2: 行動決定 ---
    for (const agent of agents) {
      if (agent.reactionRemaining > 0) continue;
      if (agent.state === "FIELDING" || agent.state === "THROWING") continue;
      updateDecision(agent, trajectory, t, agents, bases, outs, ball.launchAngle);
    }

    // --- Step 3: コールオフ解決（行動決定後に実行し、捕球チェック前に競合解消） ---
    resolveCallOffs(agents, trajectory);

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
      const result = checkFlyCatchAtLanding(agents, trajectory, t, rng, ball.launchAngle);
      if (result) {
        catcherAgent = result.agent;
        catchResult = result.catchResult;
        catchTime = t;
        break;
      }
    }

    // --- Step 6: タイムライン記録 ---
    if (collectTimeline) {
      timeline.push(snapshotAll(agents, ballPos, ballH, t, trajectory, ball.launchAngle));
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

  // === Phase 2: 結果解決 ===
  const collectedTimeline = collectTimeline ? timeline : undefined;

  // ケース1: 捕球成功
  if (catchResult && catchResult.success && catcherAgent) {
    const res = resolveSuccessfulCatch(
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
    return { ...res, agentTimeline: collectedTimeline };
  }

  // ケース2: 捕球失敗
  if (catchResult && !catchResult.success && catcherAgent) {
    const res = resolveFieldingError(
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
    return { ...res, agentTimeline: collectedTimeline };
  }

  // ケース3: 誰も到達できなかった
  const retriever = findNearestAgent(agents, trajectory.landingPos);
  if (!retriever) {
    return {
      result: "single",
      fielderPos: 8 as FielderPosition,
      agentTimeline: collectedTimeline,
    };
  }
  const res = resolveHitWithRetriever(
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
  return { ...res, agentTimeline: collectedTimeline };
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

    // 反応時間（ゴロ時は内野手がレディ姿勢で構えており初動が速い）
    let baseReaction: number;
    if (pos === 1) baseReaction = AGENT_PITCHER_REACTION;
    else if (pos === 2) baseReaction = AGENT_CATCHER_REACTION;
    else if (pos >= 7) baseReaction = AGENT_BASE_REACTION_OF;
    else baseReaction = AGENT_BASE_REACTION_IF;
    if (trajectory.isGroundBall && (pos === 1 || (pos >= 3 && pos <= 6))) {
      baseReaction *= 0.60;
    }
    // ライナーは弾道が低く速いため初動判断が遅れる
    if (trajectory.ballType === "line_drive") {
      baseReaction *= 2.5;
    }

    // 走速
    const isOF = pos >= 7;
    const baseSpeed = isOF ? AGENT_BASE_SPEED_OF : AGENT_BASE_SPEED_IF;
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
    // GC圧力削減: 既存オブジェクトを書き換え（新規生成しない）
    agent.perceivedLanding.position.x = trueLanding.x;
    agent.perceivedLanding.position.y = trueLanding.y;
    agent.perceivedLanding.confidence = 1.0;
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
  // GC圧力削減: 既存オブジェクトを書き換え（新規生成しない）
  agent.perceivedLanding.position.x = trueLanding.x + noiseX;
  agent.perceivedLanding.position.y = trueLanding.y + noiseY;
  agent.perceivedLanding.confidence = clamp(1 - sigma / AGENT_PERCEPTION_BASE_NOISE, 0, 1);
}

// ====================================================================
// コールオフ
// ====================================================================

function resolveCallOffs(agents: FielderAgent[], trajectory: BallTrajectory): void {
  // GC圧力削減: filter()の代わりにforループでpursuersを収集
  const pursuers: FielderAgent[] = [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.state === "PURSUING" && !a.hasYielded) pursuers.push(a);
  }
  if (pursuers.length < 2) return;

  // 投手がゴロインターセプトモード（interceptPointあり）の場合、
  // コールオフの対象から除外（弱ゴロ追跡時は他の内野手と競合させる）
  const pitcherIntercepting = trajectory.isGroundBall &&
    pursuers.some(a => a.pos === 1 && a.interceptPoint != null);

  for (let i = 0; i < pursuers.length - 1; i++) {
    for (let j = i + 1; j < pursuers.length; j++) {
      const a = pursuers[i];
      const b = pursuers[j];
      // GC圧力削減: DistanceSqで比較（sqrt不要）CALLOFF_TARGET_THRESHOLD^2=225
      const targetDistSq = vec2DistanceSq(a.targetPos, b.targetPos);

      if (targetDistSq < CALLOFF_TARGET_THRESHOLD * CALLOFF_TARGET_THRESHOLD) {
        // 投手がゴロインターセプト中なら、投手を含むペアのコールオフをスキップ
        // （投手と内野手が同じゴロを追う場合、先にインターセプトした方が処理する）
        if (pitcherIntercepting && (a.pos === 1 || b.pos === 1)) continue;

        // 外野手同士(pos>=7): ゾーン持ちが優先、同条件ならターゲットに近い方が呼び込む
        if (a.pos >= 7 && b.pos >= 7) {
          const ballAngle = getBallZoneAngle(trajectory);
          const aInZone = isInPrimaryZone(a.pos, ballAngle);
          const bInZone = isInPrimaryZone(b.pos, ballAngle);
          // GC圧力削減: DistanceSqで比較（sqrt不要）
          const aDist = vec2DistanceSq(a.currentPos, a.targetPos);
          const bDist = vec2DistanceSq(b.currentPos, b.targetPos);
          if (aInZone && !bInZone) {
            (b as { hasYielded: boolean }).hasYielded = true;
            (a as { hasCalled: boolean }).hasCalled = true;
          } else if (!aInZone && bInZone) {
            (a as { hasYielded: boolean }).hasYielded = true;
            (b as { hasCalled: boolean }).hasCalled = true;
          } else if (aDist <= bDist) {
            (b as { hasYielded: boolean }).hasYielded = true;
            (a as { hasCalled: boolean }).hasCalled = true;
          } else {
            (a as { hasYielded: boolean }).hasYielded = true;
            (b as { hasCalled: boolean }).hasCalled = true;
          }
        } else {
          // 内野手含む一般ケース: ゾーン持ちが優先、同条件ならCALLOFF_PRIORITYで決定
          const ballAngleIF = getBallZoneAngle(trajectory);
          const aInZoneIF = isInPrimaryZone(a.pos, ballAngleIF);
          const bInZoneIF = isInPrimaryZone(b.pos, ballAngleIF);
          if (aInZoneIF && !bInZoneIF) {
            (b as { hasYielded: boolean }).hasYielded = true;
            (a as { hasCalled: boolean }).hasCalled = true;
          } else if (!aInZoneIF && bInZoneIF) {
            (a as { hasYielded: boolean }).hasYielded = true;
            (b as { hasCalled: boolean }).hasCalled = true;
          } else if (CALLOFF_PRIORITY[a.pos] >= CALLOFF_PRIORITY[b.pos]) {
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

function getCatchReach(agent: FielderAgent, forGroundBall = false, launchAngle?: number): number {
  let base: number;
  if (agent.pos === 1 && forGroundBall) {
    // 投手: マウンド上でゴロを捕球（横方向に伸ばせる範囲が広い）
    base = CATCH_REACH_BASE_P_GROUND;
  } else if (agent.pos === 2) {
    // 捕手: ゴロはIF同等
    // ポップフライ(launchAngle>=50°)のみ専門訓練で広いリーチ
    // ライナー・通常フライは前方に飛ぶため捕れない → IF並み
    if (forGroundBall) {
      base = CATCH_REACH_BASE_IF;
    } else if (launchAngle !== undefined && launchAngle >= POPUP_LAUNCH_ANGLE_THRESHOLD) {
      base = CATCH_REACH_BASE_C;
    } else {
      base = CATCH_REACH_BASE_IF;
    }
  } else if (agent.pos >= 7) {
    base = CATCH_REACH_BASE_OF;
  } else {
    base = CATCH_REACH_BASE_IF;
    if (forGroundBall) base += CATCH_REACH_GROUND_BONUS;
  }
  return base + (agent.skill.fielding / 100) * CATCH_REACH_SKILL_FACTOR;
}

function getEffectiveRange(agent: FielderAgent, tRemaining: number, forGroundBall = false, launchAngle?: number): number {
  return calcReachableDistance(agent, tRemaining) + getCatchReach(agent, forGroundBall, launchAngle);
}

function getBallZoneAngle(trajectory: BallTrajectory): number {
  return clamp(trajectory.direction, 0, 90);
}

function isInPrimaryZone(pos: FielderPosition, ballAngle: number): boolean {
  const zone = PRIMARY_ZONE[pos];
  if (!zone) return false;
  return ballAngle >= zone.min && ballAngle <= zone.max;
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
  outs: number,
  launchAngle?: number
): void {
  if (agent.hasYielded) {
    agent.state = "BACKING_UP";
    agent.action = "backup";
    agent.targetPos = calcBackupPosition(trajectory);
    return;
  }

  const perceived = agent.perceivedLanding.position;
  // GC圧力削減: 距離二乗で比較できる箇所はDistanceSqを使用
  const distToTargetSq = vec2DistanceSq(agent.currentPos, perceived);
  const distToTarget = Math.sqrt(distToTargetSq);
  const timeRemaining = Math.max(0, trajectory.flightTime - t);

  if (trajectory.isGroundBall) {
    // 投手専用ゴロ処理: 弱いゴロ(着弾距離<=30m)のみインターセプトを試行
    // 投手はゾーンなし(PRIMARY_ZONE=null)だが、弱ゴロでは自発的に追跡
    if (agent.pos === 1 && trajectory.landingDistance <= PITCHER_GROUND_BALL_MAX_DIST) {
      const intercept = calcPathIntercept(agent, trajectory, t);
      if (intercept && intercept.canReach) {
        agent.state = "PURSUING";
        agent.action = "charge";
        agent.targetPos = intercept.point;
        agent.interceptPoint = intercept.point;
        agent.interceptBallTime = intercept.ballTime;
        return;
      }
    }

    // ゴロ: 統一ロジック — インターセプト点を物理計算で求める
    const intercept = calcPathIntercept(agent, trajectory, t);
    const ballAngle = getBallZoneAngle(trajectory);
    const iAmZoneOwner = isInPrimaryZone(agent.pos, ballAngle);
    if (intercept && intercept.canReach) {
      // より近い野手が既にインターセプトに向かっている場合はカバーに回る
      // ただし自分がゾーン持ちで相手がゾーン外の場合は譲らない
      const interceptThresholdSq = (distToTarget * CLOSER_PURSUER_INTERCEPT_RATIO) * (distToTarget * CLOSER_PURSUER_INTERCEPT_RATIO);
      const closerPursuer = allAgents.find((other) => {
        if (other === agent || other.state !== "PURSUING") return false;
        if (!other.interceptPoint) return false;
        const otherDistSq = vec2DistanceSq(other.currentPos, other.interceptPoint);
        if (otherDistSq >= interceptThresholdSq) return false;
        if (iAmZoneOwner && !isInPrimaryZone(other.pos, ballAngle)) return false;
        return true;
      });
      if (closerPursuer) {
        assignNonPursuitRole(agent, trajectory, bases, outs);
        return;
      }
      agent.state = "PURSUING";
      agent.action = "charge";
      agent.targetPos = intercept.point;
      agent.interceptPoint = intercept.point;
      agent.interceptBallTime = intercept.ballTime;
      return;
    }

    // 停止球チャーシング: 移動速度ベースで到達可能か判定
    const chaseDeadline = trajectory.flightTime + 4.0;
    const chaseTime = distToTarget / agent.maxSpeed + agent.reactionRemaining;
    if (t + chaseTime < chaseDeadline) {
      // より近い野手が既に追跡中ならカバーに回る
      // ただし自分がゾーン持ちで相手がゾーン外の場合は譲らない
      const chaseThresholdSq = (distToTarget * CLOSER_PURSUER_CHASE_RATIO) * (distToTarget * CLOSER_PURSUER_CHASE_RATIO);
      const closerChaser = allAgents.find((other) => {
        if (other === agent || other.state !== "PURSUING") return false;
        const otherDistSq = vec2DistanceSq(other.currentPos, perceived);
        if (otherDistSq >= chaseThresholdSq) return false;
        if (iAmZoneOwner && !isInPrimaryZone(other.pos, ballAngle)) return false;
        return true;
      });
      if (closerChaser) {
        assignNonPursuitRole(agent, trajectory, bases, outs);
        return;
      }
      agent.state = "PURSUING";
      agent.action = "field_ball";
      agent.targetPos = perceived;
      return;
    }

    assignNonPursuitRole(agent, trajectory, bases, outs);
    return;
  }

  // フライ/ライナー/ポップフライ: 統一ロジック（投手含む全ポジション）
  // 投手は反応時間0.6sと位置(0, 18.44)で自然に制限される

  // 既にPURSUINGなら知覚更新のみ反映して継続（再判定でfloat誤差による脱落を防ぐ）
  if (agent.state === "PURSUING") {
    agent.targetPos = perceived;
    return;
  }

  // 到達判定: 物理ベース（加速フェーズ+等速フェーズでの移動距離 + 捕球リーチ）
  const flyRange = getEffectiveRange(agent, timeRemaining + 1.0, false, launchAngle);
  const canReachFly = distToTarget <= flyRange;

  if (!canReachFly) {
    assignNonPursuitRole(agent, trajectory, bases, outs);
    return;
  }

  // 内野手(3-6)は外野手が到達可能or既に追跡中の外野フライには参加しない
  if (agent.pos >= 3 && agent.pos <= 6) {
    const ofCanReach = allAgents.some((other) => {
      if (other === agent || other.pos < 7) return false;
      // OFが既にPURSUING → 処理を任せる
      if (other.state === "PURSUING") return true;
      const ofDist = vec2Distance(other.currentPos, perceived);
      const ofRange = getEffectiveRange(other, timeRemaining + 1.0, false, launchAngle);
      return ofDist <= ofRange;
    });
    if (ofCanReach) {
      assignNonPursuitRole(agent, trajectory, bases, outs);
      return;
    }
  }

  // より近い野手が既に追跡中ならカバーに回る
  // ただし自分がゾーン持ちで相手がゾーン外の場合は譲らない
  const flyBallAngle = getBallZoneAngle(trajectory);
  const iAmFlyZoneOwner = isInPrimaryZone(agent.pos, flyBallAngle);
  // GC圧力削減: DistanceSqで比較
  const flyChaseThresholdSq = (distToTarget * CLOSER_PURSUER_CHASE_RATIO) * (distToTarget * CLOSER_PURSUER_CHASE_RATIO);
  const closerFlyPursuer = allAgents.find((other) => {
    if (other === agent || other.state !== "PURSUING") return false;
    const otherDistSq = vec2DistanceSq(other.currentPos, perceived);
    if (otherDistSq >= flyChaseThresholdSq) return false;
    if (iAmFlyZoneOwner && !isInPrimaryZone(other.pos, flyBallAngle)) return false;
    return true;
  });
  if (closerFlyPursuer) {
    assignNonPursuitRole(agent, trajectory, bases, outs);
    return;
  }

  agent.state = "PURSUING";
  if (perceived.y < agent.currentPos.y - 2) {
    agent.action = "charge";
  } else if (perceived.y > agent.currentPos.y + 5) {
    agent.action = "retreat";
  } else {
    agent.action = "lateral";
  }
  agent.targetPos = perceived;
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
      const reach = getCatchReach(bestChaser, true) * 1.4;
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

    const interceptReach = getCatchReach(agent, true) * 0.7; // ゴロ用リーチ
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
      const reach = getCatchReach(bestPursuer, true) * 1.4;
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
  rng: () => number,
  launchAngle?: number
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
    let catchReach = getCatchReach(agent, false, launchAngle);
    // ライナーは低弾道・高速で到達するため外野手の捕球ゾーンが狭い
    if (trajectory.ballType === "line_drive" && agent.pos >= 7) {
      catchReach *= 0.40;
    }
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
      // ライナー: marginが小さい（ギリギリ到達）ほど捕球困難
      let catchRate: number;
      if (trajectory.ballType === "line_drive" && agent.pos >= 7) {
        catchRate = clamp(
          0.70 + marginFactor * 0.20 + fieldingRate * 0.05,
          0.70,
          0.95
        );
      } else {
        catchRate = clamp(
          0.9 + marginFactor * 0.07 + fieldingRate * 0.03,
          0.9,
          0.99
        );
      }
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
// 結果解決
// ====================================================================

/** ベースカバーに向かっているエージェントを返す。home は捕手固定 */
function findBaseCoverer(
  agents: FielderAgent[],
  base: keyof typeof BASE_POSITIONS,
  excludePos: FielderPosition
): FielderAgent | undefined {
  if (base === "home") {
    const c = agents.find(a => a.pos === 2);
    return c && c.pos !== excludePos ? c : undefined;
  }
  const basePos = BASE_POSITIONS[base];
  return agents
    .filter(a => a.pos !== excludePos && a.state === "COVERING" && a.action === "cover_base")
    .sort((a, b) => vec2Distance(a.currentPos, basePos) - vec2Distance(b.currentPos, basePos))[0];
}

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
  // 外野手がゴロを回収 → 内野を抜けたヒット（シングル確定）
  if (catcher.pos >= 7) {
    return { result: "single", fielderPos: catcher.pos };
  }

  const fieldTime = catcher.arrivalTime;
  const secureTime = 0.3 + (1 - catcher.skill.fielding / 100) * 0.2;
  const transferTime = TRANSFER_TIME_BASE + (1 - catcher.skill.arm / 100) * TRANSFER_TIME_ARM_SCALE;
  // NPB内野手の平均送球速度: arm=50で40m/s(144km/h)、arm=100で50m/s(180km/h)
  const throwSpeed = 30 + (catcher.skill.arm / 100) * 20;

  // ベースカバー野手を特定
  const firstCover = findBaseCoverer(agents, "first", catcher.pos);
  const secondCover = findBaseCoverer(agents, "second", catcher.pos);
  const thirdCover = findBaseCoverer(agents, "third", catcher.pos);
  const homeCover = findBaseCoverer(agents, "home", catcher.pos);

  // フォールバック用ポジション（COVERINGエージェントが見つからない場合のデフォルト）
  const firstCoverPos: FielderPosition = firstCover?.pos ?? 3;
  const secondCoverPos: FielderPosition = secondCover?.pos ?? (catcher.pos === 6 ? 4 : 6);
  const thirdCoverPos: FielderPosition = thirdCover?.pos ?? 5;

  const runnerSpeed = 6.5 + (batter.batting.speed / 100) * 2.5;
  const runnerTo1B = RUNNER_START_DELAY + BASE_LENGTH / runnerSpeed;

  // 1塁送球時間（基本）
  const throwDistFirst = firstCover
    ? vec2Distance(catcher.currentPos, firstCover.currentPos)
    : vec2Distance(catcher.currentPos, BASE_POSITIONS.first);
  const defenseTimeFirst = fieldTime + secureTime + transferTime + throwDistFirst / throwSpeed;

  // 内野安打判定（マージンベース）
  // ihMargin: 正=防御が速い(アウト側), 負=ランナーが速い(安打側)
  const ihMargin = runnerTo1B - defenseTimeFirst;
  if (ihMargin < 0) {
    // ランナーが送球より速い → 確定内野安打
    return { result: "infieldHit", fielderPos: catcher.pos };
  }
  // マージンが小さい場合、確率的に内野安打（悪送球・バウンド送球・ベース踏み外し等）
  if (ihMargin < INFIELD_HIT_MARGIN_SCALE) {
    const marginFactor = 1 - ihMargin / INFIELD_HIT_MARGIN_SCALE;
    const hitProb = (INFIELD_HIT_PROB + (batter.batting.speed / 100) * INFIELD_HIT_SPEED_BONUS) * marginFactor;
    if (rng() < hitProb) {
      return { result: "infieldHit", fielderPos: catcher.pos };
    }
  }

  // === 走者1塁時 → 2塁フォースアウト判定 ===
  if (bases.first) {
    const throwDistSecond = secondCover
      ? vec2Distance(catcher.currentPos, secondCover.currentPos)
      : vec2Distance(catcher.currentPos, BASE_POSITIONS.second);
    const defenseTimeSecond = fieldTime + secureTime + transferTime + throwDistSecond / throwSpeed;
    const runnerFirstToSecond = BASE_LENGTH / (6.5 + ((bases.first.batting?.speed ?? 50) / 100) * 2.5);

    if (defenseTimeSecond < runnerFirstToSecond + 0.3) {
      // 2塁フォースアウト成功

      // SS/2Bが2塁ベース付近で打球処理 → 自分でベースを踏む（5m以内）
      const distToSecondBase = vec2Distance(catcher.currentPos, BASE_POSITIONS.second);
      if ((catcher.pos === 6 || catcher.pos === 4) && distToSecondBase < 5.0) {
        if (outs < 2) {
          const dpRate = DP_STEP_ON_BASE_SUCCESS + (1 - batter.batting.speed / 100) * DP_STEP_ON_BASE_SPEED_FACTOR;
          if (rng() < dpRate) {
            // ピボット送球（2塁を踏んだ後1塁へ）
            const pivotThrowDist = firstCover
              ? vec2Distance(BASE_POSITIONS.second, firstCover.currentPos)
              : vec2Distance(BASE_POSITIONS.second, BASE_POSITIONS.first);
            const pivotThrowSpeed = 28 + (catcher.skill.arm / 100) * 18;
            const pivotTime = defenseTimeSecond + 0.4 + pivotThrowDist / pivotThrowSpeed;
            if (pivotTime < runnerTo1B + 0.2) {
              return {
                result: "doublePlay",
                fielderPos: catcher.pos,
                throwPlays: [
                  { from: catcher.pos, to: catcher.pos, base: "second" },
                  { from: catcher.pos, to: firstCoverPos, base: "first" },
                ],
              };
            }
          }
        }
        // 2塁フォースのみ（無補殺刺殺）
        return {
          result: "groundout",
          fielderPos: catcher.pos,
          putOutPos: catcher.pos,
          throwPlays: [],
        };
      }

      // 他の内野手: 2塁フォース可能でも40%は確実な1塁送球を選択（NPB準拠比率）
      if (rng() >= 0.40) {
        // DP判定
        if (outs < 2) {
          const dpRate = DP_PIVOT_SUCCESS_BASE + (1 - batter.batting.speed / 100) * DP_PIVOT_SUCCESS_SPEED_FACTOR;
          if (rng() < dpRate) {
            const pivotAgent = secondCover;
            const pivotThrowDist = pivotAgent && firstCover
              ? vec2Distance(pivotAgent.currentPos, firstCover.currentPos)
              : vec2Distance(BASE_POSITIONS.second, BASE_POSITIONS.first);
            const pivotThrowSpeed = pivotAgent
              ? 28 + (pivotAgent.skill.arm / 100) * 18
              : 36;
            const pivotTime = defenseTimeSecond + 0.4 + pivotThrowDist / pivotThrowSpeed;
            if (pivotTime < runnerTo1B + 0.2) {
              return {
                result: "doublePlay",
                fielderPos: catcher.pos,
                throwPlays: [
                  { from: catcher.pos, to: secondCoverPos, base: "second" },
                  { from: secondCoverPos, to: firstCoverPos, base: "first" },
                ],
              };
            }
          }
        }

        // FC判定（走者1塁→2塁フォース: 走者アウト、打者1塁へ）
        if (rng() < 0.05) {
          return {
            result: "fieldersChoice",
            fielderPos: catcher.pos,
            throwPlays: [{ from: catcher.pos, to: secondCoverPos, base: "second" }],
          };
        }

        // 2塁フォースアウトのみ
        return {
          result: "groundout",
          fielderPos: catcher.pos,
          throwPlays: [{ from: catcher.pos, to: secondCoverPos, base: "second" }],
        };
      }
      // 40% → 下のデフォルト1塁送球に進む
    }
  }

  // === FC判定（走者あり、2塁フォース不成立/走者1塁なし） ===
  if (bases.first || bases.second || bases.third) {
    if (rng() < 0.05) {
      const fcThrows: ThrowPlay[] = [];
      if (bases.third && homeCover) {
        fcThrows.push({ from: catcher.pos, to: homeCover.pos, base: "home" });
      } else if (bases.second && thirdCover) {
        fcThrows.push({ from: catcher.pos, to: thirdCoverPos, base: "third" });
      } else if (bases.first && secondCover) {
        fcThrows.push({ from: catcher.pos, to: secondCoverPos, base: "second" });
      }
      if (fcThrows.length > 0) {
        return { result: "fieldersChoice", fielderPos: catcher.pos, throwPlays: fcThrows };
      }
    }
  }

  // === 1塁送球（デフォルト） ===
  // 1B自己処理または1Bが打球処理→投手等がベースカバー
  if (catcher.pos === 3) {
    const pCover = findBaseCoverer(agents, "first", 3);
    if (pCover) {
      return {
        result: "groundout",
        fielderPos: catcher.pos,
        throwPlays: [{ from: 3, to: pCover.pos, base: "first" }],
      };
    }
    // 1B自己処理: 3U（無補殺刺殺）
    return {
      result: "groundout",
      fielderPos: catcher.pos,
      putOutPos: 3 as FielderPosition,
      throwPlays: [],
    };
  }

  // 他の内野手 → 1B送球
  return {
    result: "groundout",
    fielderPos: catcher.pos,
    throwPlays: [{ from: catcher.pos, to: firstCoverPos, base: "first" }],
  };
}

function resolveFlyOut(
  catcher: FielderAgent,
  ballType: BallType,
  batter: Player,
  bases: BaseRunners,
  outs: number,
  _agents: FielderAgent[],
  rng: () => number
): AgentFieldingResult {
  const throwSpeed = 25 + (catcher.skill.arm / 100) * 15;

  // 犠牲フライ判定: 3塁走者あり + 2アウト未満 + フライ(ライナー除く)
  if (bases.third && outs < 2 && ballType === "fly_ball") {
    const throwDist = vec2Distance(catcher.currentPos, BASE_POSITIONS.home);
    const throwTime = throwDist / throwSpeed;
    const runnerSpeed = 6.5 + (bases.third.batting.speed / 100) * 2.5;
    const tagUpTime = BASE_LENGTH / runnerSpeed;
    if (tagUpTime < throwTime + SF_CATCH_TO_THROW_OVERHEAD) {
      if (rng() < 0.6) {
        return {
          result: "sacrificeFly",
          fielderPos: catcher.pos,
          putOutPos: catcher.pos,
        };
      }
    }
  }

  // タグアップ阻止: 走者をアウトにするのではなくタグアップを断念させるだけ
  // （得点阻止は走塁処理側で反映。守備スタッツへの影響なし）

  // unused parameter lint 回避
  void batter;

  if (ballType === "popup") {
    return {
      result: "popout",
      fielderPos: catcher.pos,
      putOutPos: catcher.pos,
    };
  }

  if (ballType === "fly_ball") {
    return {
      result: "flyout",
      fielderPos: catcher.pos,
      putOutPos: catcher.pos,
    };
  }

  return {
    result: "lineout",
    fielderPos: catcher.pos,
    putOutPos: catcher.pos,
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
    // 強い打球の捕球失敗はヒット扱い（エラーではない）
    const ballSpeedAtCatch = trajectory.getSpeedAt(catcher.arrivalTime);
    if (ballSpeedAtCatch >= GROUND_BALL_HARD_HIT_SPEED) {
      return {
        result: "single",
        fielderPos: catcher.pos,
      };
    }
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
  if (landing.isGroundBall) basesReached = 1;
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

  const catchReach = getCatchReach(agent, true); // ゴロ用リーチ

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
  // 優先度順にプールを構成:
  // 1. PURSUING状態の野手（実際に追跡していた）
  // 2. 内野手・外野手（P/Cを除外）
  // 3. 全員（最終フォールバック）
  const pursuers = agents.filter((a) => a.state === "PURSUING");
  if (pursuers.length > 0) {
    let nearest: FielderAgent | null = null;
    let minDist = Infinity;
    for (const a of pursuers) {
      const d = vec2Distance(a.currentPos, pos);
      if (d < minDist) { minDist = d; nearest = a; }
    }
    return nearest;
  }
  // P/Cは回収者にならない（バックアップ/カバー担当）
  const fieldPlayers = agents.filter((a) => a.pos >= 3);
  const pool = fieldPlayers.length > 0 ? fieldPlayers : agents;
  let nearest: FielderAgent | null = null;
  let minDist = Infinity;
  for (const a of pool) {
    const d = vec2Distance(a.currentPos, pos);
    if (d < minDist) { minDist = d; nearest = a; }
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
  t: number,
  trajectory?: BallTrajectory,
  launchAngle?: number
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
          effectiveRange: trajectory ? getEffectiveRange(a, tRemaining, false, launchAngle) : undefined,
        };
      });
    })(),
  };
}

/** 浮動小数点丸め (0.1刻みの累積誤差防止) */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
