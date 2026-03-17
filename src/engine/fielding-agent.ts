/**
 * エージェントベース守備AI — メインロジック
 *
 * ゴロ: 台本方式（Play Script）で事前に9人の役割を決定し、物理実行
 * フライ/ライナー: 従来の自律判断方式（autonomous-fielder.ts）
 */
import type { Player } from "../models/player";
import type { FieldingTrace } from "../models/league";
import type { BallLanding } from "./fielding-ai";
import { DEFAULT_FIELDER_POSITIONS } from "./fielding-ai";
import { generateGroundBallScript, determineGroundBallOutcome } from "./play-script";
import type { PlayScript, PredeterminedOutcome } from "./play-script";
import { createBallTrajectory } from "./ball-trajectory";
import {
  FENCE_BASE,
  FENCE_CENTER_EXTRA,
  AGENT_DT,
  AGENT_MAX_TIME_GROUND,
  AGENT_MAX_TIME_FLY,
  AGENT_REACTION_INFIELD,
  AGENT_REACTION_CATCHER,
  AGENT_REACTION_DEFAULT,
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
  MAX_PHASE2_TIME,
  SECURING_TIME_BASE,
  PIVOT_TIME,
  TAGUP_DELAY,
  BASE_TAG_TIME,
  THROW_ERROR_BASE,
  THROW_ERROR_SKILL_SCALE,
  THROW_ERROR_DISTANCE_SCALE,
  RETRIEVER_APPROACH_FACTOR,
  RETRIEVER_PICKUP_TIME,
  RETRIEVER_PICKUP_RADIUS,
  RETRIEVER_PICKUP_SPEED,
  TAGUP_THROW_MARGIN_BASE,
  TAGUP_THROW_MARGIN_AWARENESS_SCALE,
  POPUP_LAUNCH_ANGLE,
  LINER_LAUNCH_ANGLE_MAX,
  UNIFIED_DT,
  FIELDER_DECISION_INTERVAL,
  RECEIVER_BASE_PROXIMITY_THRESHOLD,
  RECEIVER_WAIT_TOLERANCE,
  RECEIVER_MAX_WAIT_TIME,
  GROUND_BALL_APPROACH_WAIT_DIST,
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
  RunnerResult,
  UnifiedBallState,
} from "./fielding-agent-types";
import {
  BASE_POSITIONS,
  BASE_LENGTH,
  BASE_NAMES,
  vec2Distance,
  vec2DistanceSq,
  clamp,
  gaussianRandom,
  getBasePosition,
  interpolateBasepath,
} from "./fielding-agent-types";
import type { FielderAction } from "../models/league";
import { calcAndStorePursuitScore, autonomousDecide } from "./autonomous-fielder";
import type { CoverSnapshot } from "./autonomous-fielder";
import {
  initRunnersUnified,
  updateRunnerPreCatch,
  transitionRunnersOnCatch,
  moveRunner,
  decideTagup,
  decideExtraBase,
  decideGroundAdvance,
  decideHitAdvance,
  moveRetreatingRunner,
  calcThrowSpeed,
  calcSecuringTime,
} from "./runner-agent";
import { createUnifiedBallState, updateBallPosition, transitionBallPhase } from "./ball-state";

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

  // ランナー統一初期化（バッター含む、全員HOLDING）
  const runners = initRunnersUnified(batter, bases);

  // ゴロ時: フォースランナーをマーク（Phase 1中に走塁開始する）
  // フォース連鎖: 1塁から連続して埋まっている塁のみ強制走塁
  if (trajectory.isGroundBall) {
    const forceThrough = bases.first ? (bases.second ? (bases.third ? 3 : 2) : 1) : 0;
    for (const runner of runners) {
      if (runner.isBatter) continue; // バッターは別途処理
      if (runner.fromBase <= forceThrough) {
        runner.isForced = true;
        runner.targetBase = runner.fromBase + 1;
      }
    }
  }

  // 統一ボール状態
  const restPosForBall = options?.fenceDistance !== undefined
    ? capRestPositionToFence(trajectory, options.fenceDistance)
    : estimateRestPosition(trajectory);
  const unifiedBall = createUnifiedBallState(trajectory, restPosForBall);

  // === ゴロ台本生成 ===
  // 台本が生成できた場合のみ台本方式を使用。内野を抜ける打球はnull→自律方式
  let script: PlayScript | null = null;
  if (trajectory.isGroundBall) {
    const runnerSituation = {
      first: !!bases.first,
      second: !!bases.second,
      third: !!bases.third,
    };
    script = generateGroundBallScript(trajectory, agents, runnerSituation, outs);
  }
  const useScript = script !== null;

  // === ゴロ結果の事前決定 (Statcast確率テーブル) ===
  let predeterminedOutcome: PredeterminedOutcome | null = null;
  if (useScript && script) {
    const primaryAgent = agents.find(a => a.pos === script.primaryFielder);
    if (primaryAgent) {
      predeterminedOutcome = determineGroundBallOutcome(
        trajectory.exitVelocity,
        primaryAgent.skill.fielding,
        { first: !!bases.first, second: !!bases.second, third: !!bases.third },
        outs,
        rng,
      );
    }
  }

  // === 統一ループ状態 ===
  const unifiedDt = UNIFIED_DT;
  const maxPreCatchTime = trajectory.isGroundBall
    ? AGENT_MAX_TIME_GROUND
    : AGENT_MAX_TIME_FLY;
  const maxTotalTime = maxPreCatchTime + MAX_PHASE2_TIME;

  // 捕球前状態
  let catcherAgent: FielderAgent | null = null;
  let catchResult: CatchResult | null = null;
  let catchTime = 0;
  let postCatchStarted = false;
  let fielderDecisionTick = FIELDER_DECISION_INTERVAL - 1; // 初回ティックで即座に知覚・判断を実行

  // 捕球後状態（postCatchStarted = true で初期化）
  let catchSuccess = false;
  let catchError = false;
  let catchErrorPos: FielderPosition | undefined;
  let ballHolder: FielderAgent | null = null;
  let throwBall: ThrowBallState | null = null;
  const throwPlays: ThrowPlay[] = [];
  let pendingThrowPlay: ThrowPlay | null = null;
  let outsAdded = 0;
  let securingTimer = 0;
  let retrieverAgent: FielderAgent | null = null;
  let tagupTimer = 0;

  // GC圧力削減: バッファを1回だけ確保して毎ティック再利用
  const ballPosBuf: Vec2 = { x: 0, y: 0 };
  const prevBallPos: Vec2 = { x: 0, y: 0 };

  // === 統一ティックループ ===
  for (let t = 0; t <= maxTotalTime; t = round(t + unifiedDt)) {
    // Step 1: ボール位置更新
    const ballPos = trajectory.getPositionAt(t, ballPosBuf);
    const ballH = trajectory.getHeightAt(t);
    const ballOnGround = trajectory.isOnGround(t);
    updateBallPosition(unifiedBall, t, ballPosBuf);

    // ===== 捕球前フェーズ =====
    if (!postCatchStarted) {
      // 毎ティック: 状態遷移（軽量、GC影響なし）
      for (const agent of agents) {
        if (agent.state === "READY") {
          (agent as { state: AgentState }).state = "REACTING";
        }
      }

      // 知覚・判断（2ティックごと = 0.1秒相当）
      // GC圧力削減: updatePerception, autonomousDecide 等の
      // 配列アロケーションを0.1秒間隔に抑制する
      fielderDecisionTick++;
      let isDecisionTick = false;
      if (fielderDecisionTick >= FIELDER_DECISION_INTERVAL) {
        fielderDecisionTick = 0;
        isDecisionTick = true;

        // 反応カウントダウン（AGENT_DT=0.1sで減算）
        // autonomousDecide と同じゲートブロック内で実行し、
        // reaction=0到達とPURSUING遷移が同一ティックで起こることを保証する
        for (const agent of agents) {
          if (agent.state === "REACTING") {
            (agent as { reactionRemaining: number }).reactionRemaining -= AGENT_DT;
            if (agent.reactionRemaining <= 0) {
              (agent as { reactionRemaining: number }).reactionRemaining = 0;
            }
          }
        }

        // 知覚更新
        for (const agent of agents) {
          updatePerception(agent, trajectory, t, noiseScale, rng);
        }

        // REACTING中の初動目標設定（in-place mutation でGC圧力削減）
        for (const agent of agents) {
          if (agent.state === "REACTING" && agent.reactionRemaining > 0) {
            agent.targetPos.x = agent.perceivedLanding.position.x;
            agent.targetPos.y = agent.perceivedLanding.position.y;
          }
        }

        // 行動決定: ゴロは台本方式、その他は自律方式
        if (useScript && script) {
          // 台本方式: 反応完了した野手に台本の役割を適用（1回のみ）
          for (const agent of agents) {
            if (agent.reactionRemaining <= 0 && agent.state === "REACTING") {
              const assignment = script.assignments.get(agent.pos);
              if (assignment) {
                (agent as { state: AgentState }).state = assignment.state;
                agent.targetPos.x = assignment.targetPos.x;
                agent.targetPos.y = assignment.targetPos.y;
                agent.action = assignment.action;

                // 捕球者: checkGroundBallIntercept が必要とするフィールドを設定
                if (agent.pos === script.primaryFielder && assignment.state === "PURSUING") {
                  (agent as { interceptPoint?: Vec2 }).interceptPoint = {
                    x: assignment.targetPos.x,
                    y: assignment.targetPos.y,
                  };
                  agent.action = "field_ball";
                }
              }
            }
          }
        } else {
          // 自律方式（フライ/ライナー/ポップフライ）
          for (const agent of agents) {
            calcAndStorePursuitScore(agent, agents, trajectory, t);
          }
          const coverSnapshot = snapshotCoverAssignments(agents);
          for (const agent of agents) {
            autonomousDecide(agent, agents, trajectory, t, bases, outs, coverSnapshot);
          }
          deconflictBaseCoverage(agents);
        }
      }

      // 捕球前フェーズ: 判断・移動・捕球チェック（2ティックごと = dt=0.1s）
      // NOTE: 移動もAGENT_DT=0.1sで実行。0.05sステップでは位置がずれるため、
      // 捕球前フェーズではAGENT_DTの時間進行を正確に使用する。
      if (isDecisionTick) {
        // 移動（判断の後、catch checkの前）
        for (const agent of agents) {
          moveAgent(agent, AGENT_DT);
        }
        // 捕球チェック: ゴロ
        if (trajectory.isGroundBall && t > 0) {
          const result = checkGroundBallIntercept(
            agents, prevBallPos, ballPos, trajectory, t, rng
          );
          if (result) {
            // 確率テーブル補正: ヒット/エラー判定なら捕球を失敗に変更
            if (predeterminedOutcome === "single" || predeterminedOutcome === "error") {
              result.catchResult.success = false;
            }
            catcherAgent = result.agent;
            catchResult = result.catchResult;
            catchTime = t;
            if (result.catchResult.success) {
              transitionBallPhase(unifiedBall, "HELD", {
                holder: result.agent, catchResult: result.catchResult,
                catchTime: t, catcherAgent: result.agent,
              });
            } else {
              transitionBallPhase(unifiedBall, "ON_GROUND");
              unifiedBall.catchResult = result.catchResult;
              unifiedBall.catchTime = t;
              unifiedBall.catcherAgent = result.agent;
            }
          }
        }

        // 捕球チェック: フライ
        if (!catcherAgent && !trajectory.isGroundBall && ballOnGround && t > 0) {
          const result = checkFlyCatchAtLanding(agents, trajectory, t, rng);
          if (result) {
            catcherAgent = result.agent;
            catchResult = result.catchResult;
            catchTime = t;
            if (result.catchResult.success) {
              transitionBallPhase(unifiedBall, "HELD", {
                holder: result.agent, catchResult: result.catchResult,
                catchTime: t, catcherAgent: result.agent,
              });
            } else {
              transitionBallPhase(unifiedBall, "ON_GROUND");
              unifiedBall.catchResult = result.catchResult;
              unifiedBall.catchTime = t;
              unifiedBall.catcherAgent = result.agent;
            }
          }
        }

        // 捕球前フェーズの終了判定
        let shouldEndPreCatch = false;
        if (catcherAgent) {
          shouldEndPreCatch = true;
        } else if (trajectory.isGroundBall && t >= trajectory.flightTime) {
          let hasPursuer = false;
          let allSettled = true;
          let hasNearbyApproacher = false;
          for (let ai = 0; ai < agents.length; ai++) {
            const a = agents[ai];
            if (a.state === "PURSUING") {
              hasPursuer = true;
              if (vec2DistanceSq(a.currentPos, a.targetPos) >= 0.25) {
                allSettled = false;
              }
            } else if (a.state === "BACKING_UP" || a.state === "REACTING") {
              // PURSUING以外でもボールに接近中の野手がいれば捕球チャンスを待つ
              const distToBallSq = vec2DistanceSq(a.currentPos, restPosForBall);
              if (distToBallSq < GROUND_BALL_APPROACH_WAIT_DIST * GROUND_BALL_APPROACH_WAIT_DIST) {
                hasNearbyApproacher = true;
              }
            }
          }
          if ((!hasPursuer && !hasNearbyApproacher) || (hasPursuer && allSettled)) shouldEndPreCatch = true;
        } else if (!trajectory.isGroundBall && ballOnGround) {
          // フライ着地後：捕球圏内に追球者がいるかチェック
          let hasCatchCandidate = false;
          for (let ai = 0; ai < agents.length; ai++) {
            const a = agents[ai];
            if (a.state !== "PURSUING" || a.hasYielded) continue;
            const dist = vec2DistanceSq(a.currentPos, trajectory.landingPos);
            if (dist <= (AGENT_DIVE_MAX_DIST * 1.5) * (AGENT_DIVE_MAX_DIST * 1.5)) {
              hasCatchCandidate = true;
              break;
            }
          }
          if (!hasCatchCandidate) {
            shouldEndPreCatch = true;
          } else {
            let allSettled = true;
            for (let ai = 0; ai < agents.length; ai++) {
              const a = agents[ai];
              if (a.state === "PURSUING" && vec2DistanceSq(a.currentPos, a.targetPos) >= 0.25) {
                allSettled = false;
                break;
              }
            }
            if (allSettled) shouldEndPreCatch = true;
          }
        }

        if (shouldEndPreCatch) {
          // 捕球フレームをタイムラインに記録（捕球前状態のスナップショット）
          if (collectTimeline) {
            const entry = snapshotAll(agents, ballPos, ballH, t, trajectory);
            entry.runners = runners
              .filter(r => r.state !== "HOLDING" || r.fromBase > 0)
              .map(r => ({
                fromBase: r.fromBase, targetBase: r.targetBase,
                x: r.currentPos.x, y: r.currentPos.y, state: r.state,
              }));
            if (entry.runners.length === 0) delete entry.runners;
            timeline.push(entry);
          }

          postCatchStarted = true;

          // --- フェーズ遷移: 捕球後状態の初期化 ---

          // エラーフラグ
          if (catchResult && !catchResult.success && catcherAgent && trajectory.isGroundBall) {
            if (predeterminedOutcome === "error") {
              catchError = true;
              catchErrorPos = catcherAgent.pos;
            } else {
              const ballSpeedAtCatch = trajectory.getSpeedAt(catcherAgent.arrivalTime);
              if (ballSpeedAtCatch < GROUND_BALL_HARD_HIT_SPEED) {
                catchError = true;
                catchErrorPos = catcherAgent.pos;
              }
            }
          }

          // フェンス直撃
          const fenceDistance = options?.fenceDistance;
          if (fenceDistance !== undefined) {
            catchResult = null;
          }

          catchSuccess = !!(catchResult && catchResult.success && catcherAgent);

          // ランナー状態遷移（earlyRunners転写の代替）
          transitionRunnersOnCatch(runners, trajectory.isGroundBall, catchSuccess);

          // 回収者選定
          const groundBallThroughFielder = !catchSuccess && !catchError && catcherAgent
            && trajectory.isGroundBall && catchResult && !catchResult.success;
          const retrieverCandidates = groundBallThroughFielder
            ? agents.filter(a => a !== catcherAgent)
            : agents;
          const effectiveCatcher = catchSuccess ? catcherAgent : (
            catchError ? catcherAgent : findNearestAgent(retrieverCandidates, restPosForBall)
          );

          if (!effectiveCatcher) {
            return {
              result: "single",
              fielderPos: 8 as FielderPosition,
              agentTimeline: collectTimeline ? timeline : undefined,
            };
          }

          // ボール保持者 / 回収者の設定
          ballHolder = catchSuccess && effectiveCatcher ? effectiveCatcher : null;
          if (!catchSuccess && effectiveCatcher) {
            retrieverAgent = effectiveCatcher;
            retrieverAgent.state = "RETRIEVING";
            retrieverAgent.targetPos.x = restPosForBall.x;
            retrieverAgent.targetPos.y = restPosForBall.y;
            retrieverAgent.currentSpeed = retrieverAgent.maxSpeed * RETRIEVER_APPROACH_FACTOR;
          }

          // 捕球成功: SECURING状態
          if (ballHolder) {
            ballHolder.state = "SECURING";
            securingTimer = calcSecuringTime(ballHolder);
            if (!trajectory.isGroundBall) {
              const distFromHome = Math.sqrt(
                ballHolder.currentPos.x ** 2 + ballHolder.currentPos.y ** 2
              );
              if (distFromHome > OUTFIELD_DEPTH_THRESHOLD) {
                securingTimer += SF_CATCH_TO_THROW_OVERHEAD;
              }
            }
          }

          // タッチアップ遅延
          tagupTimer = catchSuccess && !trajectory.isGroundBall ? TAGUP_DELAY : 0;

          // COVERING → RECEIVING
          for (const a of agents) {
            if (a.state === "COVERING" && a.action === "cover_base") {
              a.state = "RECEIVING";
            }
          }

          // 捕球者以外のPURSUING → RETURNING（デフォルト位置に復帰）
          for (const a of agents) {
            if (a !== effectiveCatcher && a.state === "PURSUING") {
              if (a.homePos) {
                a.state = "RETURNING";
                a.targetPos.x = a.homePos.x;
                a.targetPos.y = a.homePos.y;
              } else {
                a.state = "HOLDING";
              }
              a.action = "hold";
            }
          }
        }

        // prevBallPos更新（catch checkと同期: 0.1秒間隔）
        prevBallPos.x = ballPos.x;
        prevBallPos.y = ballPos.y;
      }

      // ランナー行動（毎ティック）
      for (const runner of runners) {
        updateRunnerPreCatch(runner, unifiedBall, agents, t, unifiedDt, rng);
      }
    }

    // ===== 捕球後フェーズ =====
    if (postCatchStarted) {
      // 帰塁中ランナーの移動（リードからの帰塁 → WAITING_TAG）
      for (const runner of runners) {
        if (runner.state === "RETREATING") {
          moveRetreatingRunner(runner, unifiedDt);
        }
      }

      // タッチアップ遅延
      if (tagupTimer > 0) {
        tagupTimer -= unifiedDt;
      }
      // 継続チェック: タイマー満了後にWAITING_TAGになったランナー（帰塁完了後）も処理
      if (tagupTimer <= 0 && catchSuccess && !trajectory.isGroundBall) {
        for (const runner of runners) {
          if (runner.state === "WAITING_TAG") {
            runner.state = "DECIDING";
          }
        }
      }
      // ゴロ帰塁完了: 非フォースランナーはHOLDINGに戻す（プレー終了判定から除外）
      if (trajectory.isGroundBall) {
        for (const runner of runners) {
          if (runner.state === "WAITING_TAG" && !runner.isForced) {
            runner.state = "HOLDING";
          }
        }
      }

      // タッチアップ判断
      for (const runner of runners) {
        if (runner.state === "DECIDING" && catcherAgent) {
          runner.state = decideTagup(runner, catcherAgent, rng) ? "TAGGED_UP" : "HOLDING";
        } else if (runner.state === "DECIDING") {
          runner.state = "HOLDING";
        }
      }

      // ランナー移動
      for (const runner of runners) {
        if (runner.state === "RUNNING" || runner.state === "TAGGED_UP") {
          moveRunner(runner, unifiedDt, catchSuccess);
        }
      }

      // ROUNDING → エキストラベース判断
      // 先の塁のランナーから判断（3塁→2塁→1塁の順）
      const roundingRunners = runners
        .filter(r => r.state === "ROUNDING")
        .sort((a, b) => b.targetBase - a.targetBase);
      for (const runner of roundingRunners) {
        runner.roundingTimer = (runner.roundingTimer ?? 0) - unifiedDt;
        if (runner.roundingTimer <= 0) {
          const nextBase = runner.targetBase + 1;
          // 後ろのランナーが自分の塁に向かっている → 押し出し（必ず進塁）
          const pushedForward = runners.some(r =>
            r !== runner && r.state !== "OUT" &&
            r.targetBase === runner.targetBase &&
            (r.state === "RUNNING" || r.state === "ROUNDING")
          );
          // 次の塁に他のランナーが停留中 → 進塁不可（ただし押し出し時は連鎖押し出し）
          const blocker = nextBase <= 3 ? runners.find(r =>
            r !== runner && r.state !== "OUT" &&
            (r.state === "SAFE" || r.state === "HOLDING") && r.targetBase === nextBase
          ) : null;
          const shouldAdvance = pushedForward || (
            !blocker && decideExtraBase(runner, ballHolder, retrieverAgent, throwBall, t, trajectory, restPosForBall, rng, getPhase2BallGroundPos)
          );
          if (shouldAdvance && nextBase <= 4) {
            // 押し出し連鎖: 次の塁に居るランナーも強制進塁
            if (blocker && pushedForward && blocker.targetBase + 1 <= 4) {
              blocker.fromBase = blocker.targetBase;
              blocker.targetBase += 1;
              blocker.progress = 0;
              blocker.state = "RUNNING";
            }
            runner.fromBase = runner.targetBase;
            runner.targetBase = nextBase;
            runner.progress = 0;
            runner.state = "RUNNING";
            runner.isForced = false;
          } else {
            runner.state = "SAFE";
          }
        }
      }

      // ballHolder が HOLDING のまま待機中にランナーが走り始めたら再送球判断
      // ただし3アウト到達済みなら送球不要
      if (ballHolder && ballHolder.state === "HOLDING" && !throwBall && (outs + outsAdded) < 3) {
        const hasActiveRunner = runners.some(r =>
          r.state === "RUNNING" || r.state === "TAGGED_UP"
        );
        if (hasActiveRunner) {
          ballHolder.state = "SECURING";
          securingTimer = SECURING_TIME_BASE;
        }
      }

      // ボール回収
      if (!ballHolder && retrieverAgent && retrieverAgent.state === "RETRIEVING") {
        const ballInfo = getPhase2BallGroundPos(trajectory, restPosForBall, t, ballPosBuf);
        retrieverAgent.targetPos.x = ballPosBuf.x;
        retrieverAgent.targetPos.y = ballPosBuf.y;
        moveAgent(retrieverAgent, unifiedDt);

        const distToBall = vec2Distance(retrieverAgent.currentPos, ballPosBuf);
        if (distToBall < RETRIEVER_PICKUP_RADIUS && ballInfo.speed < RETRIEVER_PICKUP_SPEED) {
          ballHolder = retrieverAgent;
          ballHolder.state = "SECURING";
          securingTimer = calcSecuringTime(ballHolder) + RETRIEVER_PICKUP_TIME;
          retrieverAgent = null;
        }
      }

      // 送球判定
      if (ballHolder && ballHolder.state === "SECURING") {
        securingTimer -= unifiedDt;
        if (securingTimer <= 0) {
          const target = decideThrowTarget(ballHolder, runners, agents, outs + outsAdded, rng);
          if (options?.debugThrow) {
            const activeR = runners.filter(r => r.state === "RUNNING" || r.state === "TAGGED_UP");
            console.log(`[THROW] t=${t.toFixed(2)} target=${target ? `base${target.baseNum} recv=${target.receiverAgent.pos}` : "null"} activeRunners=${activeR.length} states=[${runners.map(r=>r.state).join(",")}]`);
          }
          if (target) {
            // レシーバーのベース到達確認
            // DP機会（フォースランナー2人以上 or pivot中）はタイミング最重要→スキップ
            const basePos = getBasePosition(target.baseNum);
            const receiverDist = vec2Distance(target.receiverAgent.currentPos, basePos);
            const forceRunnerCount = runners.filter(r =>
              r.isForced && (r.state === "RUNNING" || r.state === "TAGGED_UP")
            ).length;
            const isDpOpportunity = forceRunnerCount >= 2 || outsAdded > 0;
            let shouldWait = false;
            if (options?.debugThrow) {
              console.log(`  receiverDist=${receiverDist.toFixed(2)} threshold=${RECEIVER_BASE_PROXIMITY_THRESHOLD} isDp=${isDpOpportunity}`);
            }
            if (!isDpOpportunity && receiverDist > RECEIVER_BASE_PROXIMITY_THRESHOLD) {
              const throwSpeed = calcThrowSpeed(ballHolder);
              const throwFlightTime = target.throwDist / throwSpeed;
              const receiverTimeToBase = receiverDist / target.receiverAgent.maxSpeed;
              if (receiverTimeToBase > throwFlightTime + RECEIVER_WAIT_TOLERANCE) {
                // レシーバーがまだ遠い → 少し待機してベースへ誘導
                securingTimer = Math.min(receiverTimeToBase - throwFlightTime, RECEIVER_MAX_WAIT_TIME);
                target.receiverAgent.targetPos = { x: basePos.x, y: basePos.y };
                if (target.receiverAgent.state !== "PURSUING") {
                  target.receiverAgent.state = "COVERING";
                  target.receiverAgent.action = "cover_base";
                }
                shouldWait = true;
              }
            }
            if (!shouldWait) {
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
            }
          } else {
            // 送球先がないがボールは保持し続ける（nullにするとランナーが認識できなくなる）
            ballHolder.state = "HOLDING";
          }
        }
      }

      // 送球到達判定
      if (throwBall && t >= throwBall.arrivalTime) {
        const receiverPos = throwBall.receiverPos;
        const receiver = receiverPos ? agents.find(a => a.pos === receiverPos) : null;
        const receiverFielding = receiver?.skill.fielding ?? 50;
        const { isOut } = resolveBasePlay(throwBall, runners, rng, receiverFielding);

        if (isOut) {
          outsAdded++;
          if (pendingThrowPlay) {
            throwPlays.push(pendingThrowPlay);
            pendingThrowPlay = null;
          }
          const canContinue = outsAdded < 3 && (outs + outsAdded) < 3 &&
            runners.some(r => r.isForced && (r.state === "RUNNING" || r.state === "TAGGED_UP"));
          if (receiver) {
            ballHolder = receiver;
            throwBall = null;
            if (canContinue) {
              receiver.state = "SECURING";
              securingTimer = PIVOT_TIME;
            } else {
              receiver.state = "HOLDING";
            }
          } else {
            throwBall = null;
          }
        } else {
          pendingThrowPlay = null;
          throwBall = null;
          if (receiver) {
            ballHolder = receiver;
            // 3アウト到達済みなら追加送球不要
            if ((outs + outsAdded) < 3 &&
                runners.some(r => r.state === "RUNNING" || r.state === "TAGGED_UP")) {
              receiver.state = "SECURING";
              securingTimer = PIVOT_TIME;
            } else {
              receiver.state = "HOLDING";
            }
          }
        }
      }

      // カバー・復帰・バックアップ野手移動
      for (const agent of agents) {
        if (agent.state === "RECEIVING" || agent.state === "COVERING" || agent.state === "RETURNING" || agent.state === "BACKING_UP") {
          moveAgent(agent, unifiedDt);
        }
      }

      // ゴロ非フォース走者の進塁判断
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

      // 捕球失敗時の非フォース走者の進塁判断
      if (!catchSuccess) {
        for (const runner of runners) {
          if (runner.state === "HOLDING" && !runner.isForced && !runner.isBatter) {
            if (decideHitAdvance(runner, retrieverAgent, ballHolder, throwBall, t, rng)) {
              runner.targetBase = runner.fromBase + 1;
              runner.progress = 0;
              runner.state = "RUNNING";
            }
          }
        }
      }

      // 終了判定
      const hasActiveRunners = runners.some(r =>
        r.state === "RUNNING" || r.state === "ROUNDING" || r.state === "RETREATING" ||
        r.state === "TAGGED_UP" || r.state === "WAITING_TAG" || r.state === "DECIDING"
      );
      const retrieverPending = hasActiveRunners && !ballHolder && retrieverAgent != null;
      if (isPhase2Complete(runners, throwBall, ballHolder, retrieverPending)) break;
    }

    // タイムライン記録
    if (collectTimeline) {
      if (!postCatchStarted) {
        // 捕球前: 野手+ボールのスナップショット（decisionTick時のみ記録）
        if (fielderDecisionTick === 0) {
          const entry = snapshotAll(agents, ballPos, ballH, t, trajectory);
          // Phase 1: ホームでHOLDINGのバッターは除外（走り始めていない）
          const phase1Runners = runners
            .filter(r => r.state !== "HOLDING" || r.fromBase > 0)
            .map(r => ({
              fromBase: r.fromBase, targetBase: r.targetBase,
              x: r.currentPos.x, y: r.currentPos.y, state: r.state,
            }));
          if (phase1Runners.length > 0) entry.runners = phase1Runners;
          timeline.push(entry);
        }
      } else {
        // 捕球後: ランナー・送球を含むスナップショット
        // 同一タイムスタンプの捕球前フレームを上書き（UI補間の連続性を保証）
        if (timeline.length > 0 && timeline[timeline.length - 1].t === t && !timeline[timeline.length - 1].runners) {
          timeline.pop();
        }
        let timelineBallPos: Vec2;
        if (throwBall) {
          timelineBallPos = interpolateThrowBall(throwBall, t);
        } else if (ballHolder) {
          timelineBallPos = ballHolder.currentPos;
        } else {
          const tmpBuf: Vec2 = { x: 0, y: 0 };
          getPhase2BallGroundPos(trajectory, restPosForBall, t, tmpBuf);
          timelineBallPos = tmpBuf;
        }
        const entry: AgentTimelineEntry = {
          t,
          ballPos: { ...timelineBallPos },
          ballHeight: throwBall ? 2.0 : 0.5,
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
            progress: clamp(
              (t - throwBall.startTime) / (throwBall.arrivalTime - throwBall.startTime),
              0, 1
            ),
          } : undefined,
        };
        timeline.push(entry);
      }
    }

  }

  // === 結果構築 ===
  if (!postCatchStarted) {
    // 誰も処理できなかった場合、最寄りの野手をfielderPosにする
    const nearestPos = agents.reduce((best, a) => {
      const d = vec2DistanceSq(a.currentPos, restPosForBall);
      return d < best.d ? { d, pos: a.pos } : best;
    }, { d: Infinity, pos: 8 as FielderPosition }).pos;
    return {
      result: "single",
      fielderPos: nearestPos,
      agentTimeline: collectTimeline ? timeline : undefined,
    };
  }

  const finalResult = buildPhase2Result(
    catcherAgent,
    catchSuccess,
    trajectory,
    runners,
    throwPlays,
    outsAdded,
    outs,
    agents,
    rng,
    catchError,
    catchErrorPos
  );
  return { ...finalResult, agentTimeline: collectTimeline ? timeline : undefined };
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

    // ポジション別反応時間 + awareness で決定
    const isInfielder = pos >= 3 && pos <= 6;
    const isCatcher = pos === 2;
    let baseReaction = isInfielder ? AGENT_REACTION_INFIELD
      : isCatcher ? AGENT_REACTION_CATCHER
      : AGENT_REACTION_DEFAULT;
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
    agent.state === "SECURING"
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
        0.90 + fieldingRate * 0.10 - speedPenalty - reachPenalty,
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
        0.85 + marginFactor * 0.07 + fieldingRate * 0.08,
        0.82,
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

/** Phase 2中のボール地上位置を計算（GC削減用outバッファ） */
function getPhase2BallGroundPos(
  trajectory: BallTrajectory,
  restPos: Vec2,
  t: number,
  out: Vec2
): { speed: number } {
  if (trajectory.isGroundBall) {
    // ゴロ: trajectoryの等減速モデルをそのまま使用
    const clampedT = Math.min(t, trajectory.flightTime);
    trajectory.getPositionAt(clampedT, out);
    return { speed: trajectory.getSpeedAt(t) };
  }
  // フライ/ライナー: 着弾前は飛行中
  if (t < trajectory.flightTime) {
    trajectory.getPositionAt(t, out);
    return { speed: 10 };
  }
  // 着弾後→restPosへ減速ロール
  const timeSinceLanding = t - trajectory.flightTime;
  const rollDist = vec2Distance(trajectory.landingPos, restPos);
  if (rollDist < 0.5) {
    out.x = restPos.x; out.y = restPos.y;
    return { speed: 0 };
  }
  const avgRollSpeed = 3.0; // m/s (草地ロール平均速度)
  const totalRollTime = rollDist / avgRollSpeed;
  const progress = Math.min(1, timeSinceLanding / totalRollTime);
  const eased = 2 * progress - progress * progress; // 等減速曲線
  out.x = trajectory.landingPos.x + (restPos.x - trajectory.landingPos.x) * eased;
  out.y = trajectory.landingPos.y + (restPos.y - trajectory.landingPos.y) * eased;
  const currentSpeed = progress >= 1 ? 0 : avgRollSpeed * (1 - progress);
  return { speed: currentSpeed };
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
  // 1. PURSUING状態の野手から最速到達を探す（打球を追っていた野手が自然な回収者）
  let best: FielderAgent | null = null;
  let bestTime = Infinity;
  for (const a of agents) {
    if (a.state !== "PURSUING") continue;
    const dist = vec2Distance(a.currentPos, pos);
    const arrivalTime = a.maxSpeed > 0 ? dist / a.maxSpeed : Infinity;
    if (arrivalTime < bestTime) {
      bestTime = arrivalTime;
      best = a;
    }
  }
  if (best) return best;

  // 2. フォールバック: 移動方向＋位置関係を考慮した到達時間で選択
  const ballHomeDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
  for (const a of agents) {
    const dist = vec2Distance(a.currentPos, pos);
    const targetToBall = vec2Distance(a.targetPos, pos);
    // targetがボールより近い → ボールに向かって移動中 → 距離ボーナス
    const approachBonus = targetToBall < dist ? (dist - targetToBall) * 1.0 : 0;
    // ボールより本塁側にいる野手 → 追いかける必要がある → ペナルティ
    const agentHomeDist = Math.sqrt(a.currentPos.x * a.currentPos.x + a.currentPos.y * a.currentPos.y);
    const chasePenalty = agentHomeDist < ballHomeDist ? (ballHomeDist - agentHomeDist) * 1.0 : 0;
    const effectiveDist = Math.max(dist - approachBonus + chasePenalty, 1);
    const arrivalTime = a.maxSpeed > 0 ? effectiveDist / a.maxSpeed : Infinity;
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
 * 最も近いエージェントだけ残し、他はHOLDINGに戻す（その場で停止→次tickで再判断）。
 * これにより、Pass 2 のエージェント処理順序に依存しない公平なカバー割当を実現する。
 */
function deconflictBaseCoverage(agents: FielderAgent[]): void {
  const baseNames = ["first", "second", "third", "home"] as const;
  for (const baseName of baseNames) {
    const basePos = BASE_POSITIONS[baseName];
    // このベースをカバー中のエージェントを収集
    let first: FielderAgent | null = null;
    let firstDist = Infinity;
    for (const a of agents) {
      if (a.state !== "COVERING" || a.action !== "cover_base") continue;
      const d = vec2Distance(a.targetPos, basePos);
      if (d > 3.0) continue; // このベースをカバーしていない
      if (first === null) {
        first = a;
        firstDist = vec2Distance(a.currentPos, basePos);
      } else {
        const aDist = vec2Distance(a.currentPos, basePos);
        if (aDist < firstDist) {
          // 現在のwinnerより近い → winnerをevict → その場停止（次tickで再判断）
          first.state = "HOLDING";
          first.action = "hold";
          first.targetPos.x = first.currentPos.x;
          first.targetPos.y = first.currentPos.y;
          first = a;
          firstDist = aDist;
        } else {
          // 遠い → evict → その場停止（次tickで再判断）
          a.state = "HOLDING";
          a.action = "hold";
          a.targetPos.x = a.currentPos.x;
          a.targetPos.y = a.currentPos.y;
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
// 捕球後フェーズ: 送球・走塁ヘルパー
// ====================================================================

// ランナー関連関数は runner-agent.ts に移動済み
// getBasePosition, interpolateBasepath は fielding-agent-types.ts からimport

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

  // 守備意識に基づくDP閾値: 意識高→積極的(0.1s余裕でOK)、低→慎重(0.5s必要)
  const awareness = (holder.skill as { awareness?: number }).awareness ?? 50;
  const dpMarginThreshold = 0.5 - (awareness / 100) * 0.4;

  // DP狙い: 2アウト未満 & フォース走者が2人以上 → リードランナーから処理
  if (currentOuts < 2 && forceCandidates.length >= 2) {
    // 先の塁（リードランナー）から順に評価: 3塁→2塁
    const dpCandidates = [...forceCandidates]
      .filter(c => c.baseNum >= 2)
      .sort((a, b) => b.baseNum - a.baseNum);
    for (const dpTarget of dpCandidates) {
      if (dpTarget.margin > dpMarginThreshold) {
        const receiver = findReceiverForBase(dpTarget.baseNum, agents, holder.pos);
        if (receiver) {
          return { baseNum: dpTarget.baseNum, receiverAgent: receiver, throwDist: vec2Distance(holder.currentPos, getBasePosition(dpTarget.baseNum)) };
        }
      }
    }
  }

  // リードランナー優先: マージンに余裕がある先の塁を優先
  // 塁番号降順にソートし、余裕があれば先の塁を選択
  const leadFirst = [...forceCandidates].sort((a, b) => b.baseNum - a.baseNum);
  for (const cand of leadFirst) {
    if (cand.margin > dpMarginThreshold) {
      const receiver = findReceiverForBase(cand.baseNum, agents, holder.pos);
      if (receiver) {
        return { baseNum: cand.baseNum, receiverAgent: receiver, throwDist: vec2Distance(holder.currentPos, getBasePosition(cand.baseNum)) };
      }
    }
  }

  // フォールバック: マージンが少なくても最もアウトにしやすい塁
  forceCandidates.sort((a, b) => b.margin - a.margin);
  for (const cand of forceCandidates) {
    if (cand.margin > -0.1) {
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
/** 各塁の担当ポジション（優先順） */
const BASE_RESPONSIBLE_POSITIONS: Record<number, FielderPosition[]> = {
  1: [3],       // 1塁: 1B
  2: [4, 6],    // 2塁: 2B, SS
  3: [5],       // 3塁: 3B
  4: [2],       // 本塁: C
};

function findReceiverForBase(
  baseNum: number,
  agents: FielderAgent[],
  excludePos: FielderPosition
): FielderAgent | null {
  const baseName = BASE_NAMES[baseNum];
  if (!baseName) return null;
  const basePos = BASE_POSITIONS[baseName];

  // 候補を収集（内野手優先）
  const responsiblePositions = BASE_RESPONSIBLE_POSITIONS[baseNum] ?? [];

  // まず担当内野手から探す（塁に近い順）
  let best: FielderAgent | null = null;
  let bestDist = Infinity;
  for (const a of agents) {
    if (a.pos === excludePos) continue;
    if (a.state !== "COVERING" && a.state !== "RECEIVING" && a.state !== "HOLDING") continue;
    if (!responsiblePositions.includes(a.pos)) continue;
    const d = vec2Distance(a.currentPos, basePos);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  if (best) return best;

  // 担当が見つからなければ内野手（pos 1-6）から最寄りを選ぶ
  for (const a of agents) {
    if (a.pos === excludePos) continue;
    if (a.state !== "COVERING" && a.state !== "RECEIVING" && a.state !== "HOLDING") continue;
    if (a.pos > 6) continue; // 外野手を除外
    const d = vec2Distance(a.currentPos, basePos);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  if (best) return best;

  // 最終フォールバック: 外野手も含めて最寄り
  for (const a of agents) {
    if (a.pos === excludePos) continue;
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
  rng: () => number,
  receiverFielding: number = 50
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
      return { isOut: false, runner: safeRunner };
    }
    return { isOut: false, runner: null };
  }

  // フォースプレー: 走者がベースに到達済みか？
  if (targetRunner.progress >= 1.0) {
    targetRunner.state = "SAFE";
    return { isOut: false, runner: targetRunner };
  }

  // 送球エラー判定: 捕球側スキルと送球距離で確率が変わる
  const throwDist = vec2Distance(throwBall.fromPos, throwBall.toPos);
  const errorRate = clamp(
    THROW_ERROR_BASE - (receiverFielding / 100) * THROW_ERROR_SKILL_SCALE
      + (throwDist / 100) * THROW_ERROR_DISTANCE_SCALE,
    0,
    0.15
  );
  if (rng() < errorRate) {
    targetRunner.state = "SAFE";
    return { isOut: false, runner: targetRunner };
  }

  targetRunner.state = "OUT";
  return { isOut: true, runner: targetRunner };
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
      r.state === "DECIDING" ||
      r.state === "RETREATING"
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
  rng: () => number,
  catchError?: boolean,
  catchErrorPos?: FielderPosition
): AgentFieldingResult {
  // catcherAgentがnull（誰もインターセプトしなかった）場合、
  // 送球を行った野手 or 最後にボールを処理した野手のposを使う
  const fielderPos = catcherAgent?.pos
    ?? (throwPlays.length > 0 ? throwPlays[0].from : null)
    ?? agents.find(a => a.state === "THROWING" || a.state === "HOLDING" || a.state === "SECURING")?.pos
    ?? (8 as FielderPosition);

  // --- ゴロアウト判定（捕球成功 or リトリーバー送球アウト） ---
  if (trajectory.isGroundBall && (catchSuccess || outsAdded > 0)) {
    // DP判定: 2アウト以上追加 かつ 2アウト未満の場合のみ
    // (2アウトからDPは不可能 — 3アウト目で打者走者がアウトになり併殺にならない)
    if (outsAdded >= 2 && originalOuts < 2) {
      return {
        result: "doublePlay",
        fielderPos,
        throwPlays: throwPlays.length > 0 ? throwPlays : undefined,
        putOutPos: throwPlays.length > 0 ? throwPlays[throwPlays.length - 1].to : fielderPos,
        assistPos: throwPlays.map(tp => tp.from),
      };
    }

    // ゴロでアウト取得 → groundout（フォースアウト含む）
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
  if (catchError) {
    // ゴロ捕球可能球の捕球失敗 → エラー（走者進塁はrunnerResultsで反映）
    result = "error";
  } else if (outsAdded > 0) {
    // ランナーがアウト → ゴロアウト（FCアウト）
    result = "groundout";
  } else if (throwPlays.length > 0 && throwPlays.some(tp => tp.base !== "first")) {
    // 1塁以外への送球ありだがアウト取れず → フィールダーズチョイス
    result = "fieldersChoice";
  } else if (batterReachedBase >= 3) {
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
    errorPos: catchError ? catchErrorPos : undefined,
  };
}
