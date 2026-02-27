import type { Player } from "../models/player";
import type { FielderAction } from "../models/league";
import {
  GRAVITY, BAT_HEIGHT, DRAG_FACTOR, FLIGHT_TIME_FACTOR,
  GROUND_BALL_ANGLE_THRESHOLD, GROUND_BALL_MAX_DISTANCE,
  GROUND_BALL_SPEED_FACTOR, GROUND_BALL_AVG_SPEED_RATIO, GROUND_BALL_BOUNCE_ANGLE_SCALE,
  FIELDER_CATCH_RADIUS, FLY_CATCH_RADIUS, PITCHER_REACTION_PENALTY,
  CATCHER_POPUP_REACTION, CATCHER_POPUP_RUN_SPEED, CATCHER_POPUP_CATCH_RADIUS,
} from "./physics-constants";
import { assignFielderDuties, getBallZone } from "./fielding-assignments";

/** フィールド上の2D座標 (メートル) */
export interface FieldPosition2D {
  x: number; // 左右(m): 正=1塁側(ライト方向), 負=3塁側(レフト方向)
  y: number; // 前後(m): 0=ホーム, 正=外野方向
}

/** ポジション番号 (1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF) */
type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 守備役割 */
type FielderRole = "primary" | "backup" | "cover_base" | "relay" | "none";

/** 1野手の判断結果 */
export interface FielderDecision {
  position: FielderPosition;
  role: FielderRole;
  distanceToBall: number;     // ボールまでの距離(m)
  timeToReach: number;        // 野手の到達時間(秒)
  ballArrivalTime: number;    // ボールが野手地点に到達する時間(秒)
  canReach: boolean;          // 野手がボールより先に到達できるか
  skill: { fielding: number; catching: number; arm: number };
  speed: number;              // 野手の走速 (m/s)
  distanceAtLanding?: number; // ボール到達時点での野手とボールの距離(m)
  posAtLanding?: { x: number; y: number }; // ボール到達時点での野手座標
  action?: FielderAction;     // 移動アクション種別
  targetPos?: { x: number; y: number }; // 移動目標座標
  retrievalCandidate?: boolean; // 回収候補かどうか
  interceptType?: "path_intercept" | "chase_to_stop" | "fly_converge" | "none";
  projectionDistance?: number;  // ゴロ: 経路上の射影距離（ホームからの距離）
}

/** 打球の着地情報 */
export interface BallLanding {
  position: FieldPosition2D; // 着地座標
  distance: number;          // ホームからの距離(m)
  flightTime: number;        // ボールの飛行/到達時間(秒)
  isGroundBall: boolean;     // ゴロかどうか
}

/** 守備配置 (将来拡張用) */
export interface DefensiveAlignment {
  positions: Map<FielderPosition, FieldPosition2D>;
}

/** デフォルト守備位置 */
export const DEFAULT_FIELDER_POSITIONS: ReadonlyMap<FielderPosition, FieldPosition2D> = new Map([
  [1, { x: 0,   y: 18.4 }], // P (ピッチャーマウンド)
  [2, { x: 0,   y: 1.0  }], // C
  [3, { x: 20,  y: 28   }], // 1B
  [4, { x: 8,   y: 33   }], // 2B（中央ゴロ到達しやすくやや左・浅め）
  [5, { x: -19, y: 27   }], // 3B（守備範囲拡大のため3m後退）
  [6, { x: -12, y: 33   }], // SS
  [7, { x: -28, y: 75   }], // LF (フェンス95m × 79%)
  [8, { x: 0,   y: 84   }], // CF (フェンス118m × 71%)
  [9, { x: 28,  y: 75   }], // RF (フェンス95m × 79%)
]);

/** 投手は pitching 側、野手は batting 側から守備能力を取得 */
function getFieldingSkill(
  player: Player,
  pos: FielderPosition
): { fielding: number; catching: number; arm: number } {
  if (pos === 1) {
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

/**
 * 打球物理データから着地位置を計算
 * @param direction 打球方向 (0=レフト線, 45=センター, 90=ライト線)
 * @param launchAngle 打球角度 (度)
 * @param exitVelocity 打球速度 (km/h)
 */
export function calcBallLanding(
  direction: number,
  launchAngle: number,
  exitVelocity: number
): BallLanding {
  const isGroundBall = launchAngle < GROUND_BALL_ANGLE_THRESHOLD;
  const angleRad = (direction - 45) * Math.PI / 180;

  if (isGroundBall) {
    // ゴロ: 摩擦減速モデル
    const v0 = exitVelocity / 3.6; // km/h → m/s
    // 角度による減衰:
    // 負の角度: 叩きつけバウンドでエネルギー損失（-30°で最大70%減衰）
    // 正の角度: ホップするほど地面との接触回数増でエネルギー損失（9°で約15%減衰）
    const bounceFactor = launchAngle < 0
      ? Math.max(0.3, 1 + launchAngle / GROUND_BALL_BOUNCE_ANGLE_SCALE)
      : 1 - (launchAngle / GROUND_BALL_ANGLE_THRESHOLD) * 0.15;
    const groundDistance = Math.min(GROUND_BALL_MAX_DISTANCE, v0 * GROUND_BALL_SPEED_FACTOR) * bounceFactor;
    const groundTime = groundDistance / (v0 * GROUND_BALL_AVG_SPEED_RATIO);

    const x = groundDistance * Math.sin(angleRad);
    const y = groundDistance * Math.cos(angleRad);

    return {
      position: { x, y },
      distance: groundDistance,
      flightTime: groundTime,
      isGroundBall: true,
    };
  }

  // フライ/ライナー: 放物運動 + 空気抵抗補正
  const v0 = exitVelocity / 3.6;
  const theta = launchAngle * Math.PI / 180;

  const vy0 = v0 * Math.sin(theta);
  const vx  = v0 * Math.cos(theta);
  const tUp = vy0 / GRAVITY;
  const maxH = BAT_HEIGHT + (vy0 * vy0) / (2 * GRAVITY);
  const tDown = Math.sqrt(2 * maxH / GRAVITY);
  const flightTime = (tUp + tDown) * FLIGHT_TIME_FACTOR;
  const distance = vx * flightTime * DRAG_FACTOR;

  const x = distance * Math.sin(angleRad);
  const y = distance * Math.cos(angleRad);

  return {
    position: { x, y },
    distance,
    flightTime,
    isGroundBall: false,
  };
}

/**
 * 全9野手の守備判断を計算
 * @param landing 打球着地情報
 * @param battedBallType 打球タイプ
 * @param fielderMap ポジション → 選手マッピング
 * @param runners 走者状況 (省略可)
 * @param outs アウトカウント (省略可)
 * @param alignment 守備配置 (省略でデフォルト)
 */
export function evaluateFielders(
  landing: BallLanding,
  battedBallType: string,
  fielderMap: Map<FielderPosition, Player>,
  runners?: { first: boolean; second: boolean; third: boolean },
  outs?: number,
  alignment?: DefensiveAlignment
): Map<FielderPosition, FielderDecision> {
  const positions = alignment?.positions ?? DEFAULT_FIELDER_POSITIONS;

  const ALL_POSITIONS: FielderPosition[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const INFIELD_POSITIONS: FielderPosition[]  = [1, 2, 3, 4, 5, 6];
  const OUTFIELD_POSITIONS: FielderPosition[] = [7, 8, 9];

  const isLineDrive = battedBallType === "line_drive";
  const isFlyOrLine = battedBallType === "fly_ball" || battedBallType === "line_drive";

  // 各野手の到達時間・移動計画を計算
  const entries: {
    pos: FielderPosition;
    timeToReach: number;
    ballArrivalTime: number;
    distanceToBall: number;
    canReach: boolean;
    speed: number;
    distanceAtLanding: number;
    posAtLanding: { x: number; y: number };
    action: FielderAction;
    targetPos: { x: number; y: number };
    interceptType: "path_intercept" | "chase_to_stop" | "fly_converge" | "none";
    projectionDistance: number | undefined;
  }[] = [];

  for (const pos of ALL_POSITIONS) {
    const player = fielderMap.get(pos);
    const fielderPos = positions.get(pos);
    if (!player || !fielderPos) continue;

    const skill = getFieldingSkill(player, pos);

    // 反応時間: 守備力が高いほど短い (0.3-0.6秒)
    let reactionTime = 0.3 + (1 - skill.fielding / 100) * 0.3;
    // 投手: 投球フォロースルー後の体勢回復ペナルティ
    // 実際のPはゴロでもフライでも投球直後で反応が遅い
    if (pos === 1) {
      reactionTime += PITCHER_REACTION_PENALTY;
    }
    // ライナーは軌道が低く速いため読みづらい → 反応遅延 +0.3-0.5秒
    if (isLineDrive) {
      reactionTime += 0.3 + (1 - skill.fielding / 100) * 0.2;
    }
    // 走力: batting.speed 依存 (5-8 m/s)
    const runSpeed = 5.0 + (player.batting.speed / 100) * 3.0;

    let distanceToBall = 0;
    let timeToReach = 0;
    let ballArrival = 0;
    let canReach = false;
    let distanceAtLanding = 0;
    let posAtLanding = { x: fielderPos.x, y: fielderPos.y };
    let action: FielderAction = "charge";
    let targetPos = { x: landing.position.x, y: landing.position.y };
    let interceptType: "path_intercept" | "chase_to_stop" | "fly_converge" | "none" = "none";
    let projectionDistance: number | undefined = undefined;

    if (landing.isGroundBall) {
      // ゴロ: ボール経路（ホーム→着地位置の直線）への垂直距離で判定
      const pathLen = Math.sqrt(
        landing.position.x * landing.position.x + landing.position.y * landing.position.y
      );
      if (pathLen < 1) {
        distanceToBall = Math.sqrt(
          (landing.position.x - fielderPos.x) ** 2 + (landing.position.y - fielderPos.y) ** 2
        );
        timeToReach = reactionTime + distanceToBall / runSpeed;
        ballArrival = 0.1;
        canReach = true;
        targetPos = { x: landing.position.x, y: landing.position.y };
        action = "field_ball";
        interceptType = "chase_to_stop";
        projectionDistance = pathLen;
      } else {
        const pathDirX = landing.position.x / pathLen;
        const pathDirY = landing.position.y / pathLen;
        const projDist = fielderPos.x * pathDirX + fielderPos.y * pathDirY;
        const lateralDist = Math.abs(fielderPos.x * pathDirY - fielderPos.y * pathDirX);
        const avgSpeed = pathLen / landing.flightTime;

        if (projDist > 0 && projDist < pathLen) {
          // 野手の射影がボール経路上にある → 経路上で捕球を試みる
          distanceToBall = lateralDist;
          ballArrival = projDist / avgSpeed;
          timeToReach = reactionTime + lateralDist / runSpeed;
          canReach = timeToReach <= ballArrival;
          // 経路上の捕球点
          targetPos = {
            x: projDist * pathDirX,
            y: projDist * pathDirY,
          };
          action = "charge";

          if (canReach) {
            interceptType = "path_intercept";
            projectionDistance = projDist;
          }

          // チェイスフォールバック:
          // 経路上の捕球が間に合わない → ボール停止位置まで走って拾う
          if (!canReach) {
            const chaseDx = landing.position.x - fielderPos.x;
            const chaseDy = landing.position.y - fielderPos.y;
            const chaseDist = Math.sqrt(
              chaseDx * chaseDx + chaseDy * chaseDy,
            );
            const chaseTime = reactionTime + chaseDist / runSpeed;
            if (chaseTime <= landing.flightTime + 1.0) {
              canReach = true;
              distanceToBall = chaseDist;
              timeToReach = chaseTime;
              ballArrival = landing.flightTime;
              targetPos = {
                x: landing.position.x,
                y: landing.position.y,
              };
              action = "field_ball";
              interceptType = "chase_to_stop";
              projectionDistance = pathLen;
            }
          }
        } else {
          // 野手の射影がボール経路外 → まず前方チャージインターセプトを試行
          // 野手がボール経路上の手前の地点に走り込んでインターセプトできるか
          // 二次方程式: a*t^2 + b*t + c = 0 (t=経路上の距離)
          // 解がpathLen以内にあれば前方チャージ可能
          const sRatio = runSpeed / avgSpeed;
          const sRatio2 = sRatio * sRatio;
          const fx2fy2 = fielderPos.x * fielderPos.x + fielderPos.y * fielderPos.y;
          const rDist = runSpeed * reactionTime;
          const qa = 1 - sRatio2;
          const qb = -2 * projDist + 2 * sRatio2 * reactionTime * avgSpeed;
          const qc = fx2fy2 - rDist * rDist;
          const disc = qb * qb - 4 * qa * qc;
          const minT = reactionTime * avgSpeed; // ボールがfielder反応後に到達する最小距離

          let chargeIntercepted = false;
          if (disc >= 0 && qa > 0.01) {
            const sqrtDisc = Math.sqrt(disc);
            const t1 = (-qb - sqrtDisc) / (2 * qa);
            const t2 = (-qb + sqrtDisc) / (2 * qa);
            // 最小の有効なt（反応距離以上、pathLen以内）
            const interceptT = (t1 >= minT && t1 <= pathLen) ? t1
              : (t2 >= minT && t2 <= pathLen) ? t2 : -1;
            if (interceptT > 0) {
              // 前方チャージインターセプト成功
              const ix = pathDirX * interceptT;
              const iy = pathDirY * interceptT;
              const idist = Math.sqrt(
                (fielderPos.x - ix) * (fielderPos.x - ix) +
                (fielderPos.y - iy) * (fielderPos.y - iy)
              );
              distanceToBall = idist;
              ballArrival = interceptT / avgSpeed;
              timeToReach = reactionTime + idist / runSpeed;
              canReach = true;
              targetPos = { x: ix, y: iy };
              action = "charge";
              interceptType = "path_intercept";
              projectionDistance = interceptT;
              chargeIntercepted = true;
            }
          }

          if (!chargeIntercepted) {
            // 前方チャージ不可 → ボール停止位置へ走る
            const dx = landing.position.x - fielderPos.x;
            const dy = landing.position.y - fielderPos.y;
            distanceToBall = Math.sqrt(dx * dx + dy * dy);
            ballArrival = landing.flightTime;
            timeToReach = reactionTime + distanceToBall / runSpeed;
            canReach = timeToReach <= ballArrival + 1.0;
            targetPos = { x: landing.position.x, y: landing.position.y };
            action = "field_ball";
            interceptType = canReach ? "chase_to_stop" : "none";
            projectionDistance = pathLen;
          }
        }
      }

      // ゴロ時の到達時点座標: 移動可能時間だけ動いた位置
      const movableTime = Math.max(0, ballArrival - reactionTime);
      const movableDist = movableTime * runSpeed;
      const dx = targetPos.x - fielderPos.x;
      const dy = targetPos.y - fielderPos.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const moved = Math.min(movableDist, d);
      posAtLanding = {
        x: fielderPos.x + (dx / d) * moved,
        y: fielderPos.y + (dy / d) * moved,
      };
      distanceAtLanding = Math.sqrt(
        (posAtLanding.x - targetPos.x) ** 2 + (posAtLanding.y - targetPos.y) ** 2
      );
    } else if (pos >= 7) {
      // 外野手のフライ/ライナー/ポップフライ: 着地点への移動
      const dx = landing.position.x - fielderPos.x;
      const dy = landing.position.y - fielderPos.y;
      distanceToBall = Math.sqrt(dx * dx + dy * dy);
      timeToReach = reactionTime + distanceToBall / runSpeed;
      ballArrival = landing.flightTime;

      // 移動方向に応じてアクション決定
      if (landing.position.y < fielderPos.y) {
        action = "charge";
      } else if (landing.position.y > fielderPos.y + 5) {
        action = "retreat";
      } else {
        action = "lateral";
      }

      targetPos = { x: landing.position.x, y: landing.position.y };

      // ボール到達時点での野手座標
      const movableTime = Math.max(0, ballArrival - reactionTime);
      const movableDist = movableTime * runSpeed;
      const dist = distanceToBall || 1;
      const moved = Math.min(movableDist, dist);
      posAtLanding = {
        x: fielderPos.x + (dx / dist) * moved,
        y: fielderPos.y + (dy / dist) * moved,
      };
      distanceAtLanding = Math.sqrt(
        (posAtLanding.x - landing.position.x) ** 2 + (posAtLanding.y - landing.position.y) ** 2
      );
      // 外野手フライはFLY_CATCH_RADIUS(1.3m)を使用（ゴロ用FIELDER_CATCH_RADIUS=0.5mは不適切）
      canReach = distanceAtLanding < FLY_CATCH_RADIUS;
      interceptType = canReach ? "fly_converge" : "none";
    } else if (pos >= 3 && pos <= 6) {
      // 内野手のフライ/ライナー
      const dx = landing.position.x - fielderPos.x;
      const dy = landing.position.y - fielderPos.y;
      distanceToBall = Math.sqrt(dx * dx + dy * dy);
      ballArrival = landing.flightTime;
      timeToReach = reactionTime + distanceToBall / runSpeed;

      if (distanceToBall < 30) {
        // 内野付近のフライ/ライナー → 捕球試行
        targetPos = { x: landing.position.x, y: landing.position.y };
        action = "charge";

        const movableTime = Math.max(0, ballArrival - reactionTime);
        const movableDist = movableTime * runSpeed;
        const dist = distanceToBall || 1;
        const moved = Math.min(movableDist, dist);
        posAtLanding = {
          x: fielderPos.x + (dx / dist) * moved,
          y: fielderPos.y + (dy / dist) * moved,
        };
        distanceAtLanding = Math.sqrt(
          (posAtLanding.x - landing.position.x) ** 2 + (posAtLanding.y - landing.position.y) ** 2
        );
        canReach = distanceAtLanding < FLY_CATCH_RADIUS;
        interceptType = canReach ? "fly_converge" : "none";
      } else {
        // 打球が遠い → ベースカバー
        targetPos = { x: fielderPos.x, y: fielderPos.y };
        action = "cover_base";
        posAtLanding = { x: fielderPos.x, y: fielderPos.y };
        distanceAtLanding = distanceToBall;
        canReach = false;
        interceptType = "none";
      }
    } else {
      // P(1), C(2): 非ゴロ時の特殊処理
      // ゴロ時は上の分岐(204行目)で通常の経路射影ロジックが適用される
      const dx = landing.position.x - fielderPos.x;
      const dy = landing.position.y - fielderPos.y;
      distanceToBall = Math.sqrt(dx * dx + dy * dy);
      ballArrival = landing.flightTime;

      if (pos === 2) {
        // キャッチャー: 近距離フライ → 捕球試行、遠距離 → ホーム待機
        timeToReach = reactionTime + distanceToBall / runSpeed;
        if (distanceToBall < 20) {
          // 近距離フライ: ポップフライ専門訓練で素早く反応・全力疾走
          const catcherReaction = CATCHER_POPUP_REACTION;
          const catcherRunSpeed = CATCHER_POPUP_RUN_SPEED;
          targetPos = { x: landing.position.x, y: landing.position.y };
          action = "charge";
          const movableTime = Math.max(0, ballArrival - catcherReaction);
          const movableDist = movableTime * catcherRunSpeed;
          const dist = distanceToBall || 1;
          const moved = Math.min(movableDist, dist);
          posAtLanding = {
            x: fielderPos.x + (dx / dist) * moved,
            y: fielderPos.y + (dy / dist) * moved,
          };
          distanceAtLanding = Math.sqrt(
            (posAtLanding.x - landing.position.x) ** 2 + (posAtLanding.y - landing.position.y) ** 2
          );
          canReach = distanceAtLanding < CATCHER_POPUP_CATCH_RADIUS;
          interceptType = canReach ? "fly_converge" : "none";
        } else {
          // 遠距離フライ → ホーム待機（既存動作維持）
          canReach = false;
          targetPos = { x: fielderPos.x, y: fielderPos.y };
          action = "hold";
          posAtLanding = { x: fielderPos.x, y: fielderPos.y };
          distanceAtLanding = distanceToBall;
          interceptType = "none";
        }
      } else {
        // 投手: ゴロのライト方向(direction > 45)なら1Bカバー
        const isRightSide = landing.position.x > 0 && landing.isGroundBall;
        if (isRightSide) {
          // 1Bカバー
          const firstBase = { x: 19.4, y: 19.4 };
          timeToReach = reactionTime + Math.sqrt(
            (firstBase.x - fielderPos.x) ** 2 + (firstBase.y - fielderPos.y) ** 2
          ) / runSpeed;
          canReach = false;
          targetPos = firstBase;
          action = "cover_base";
          posAtLanding = firstBase;
          distanceAtLanding = Math.sqrt(
            (firstBase.x - landing.position.x) ** 2 + (firstBase.y - landing.position.y) ** 2
          );
          interceptType = "none";
        } else {
          // 投手: 近距離フライ(20m以内) → 捕球試行。それ以外はホーム前カバー
          if (distanceToBall < 20) {
            targetPos = { x: landing.position.x, y: landing.position.y };
            action = "charge";
            const movableTime = Math.max(0, ballArrival - reactionTime);
            const movableDist = movableTime * runSpeed;
            const dist = distanceToBall || 1;
            const moved = Math.min(movableDist, dist);
            posAtLanding = {
              x: fielderPos.x + (dx / dist) * moved,
              y: fielderPos.y + (dy / dist) * moved,
            };
            distanceAtLanding = Math.sqrt(
              (posAtLanding.x - landing.position.x) ** 2 + (posAtLanding.y - landing.position.y) ** 2
            );
            canReach = distanceAtLanding < FLY_CATCH_RADIUS;
            interceptType = canReach ? "fly_converge" : "none";
          } else {
            timeToReach = reactionTime + distanceToBall / runSpeed;
            canReach = false;
            targetPos = { x: fielderPos.x, y: fielderPos.y };
            action = "hold";
            posAtLanding = { x: fielderPos.x, y: fielderPos.y };
            distanceAtLanding = distanceToBall;
            interceptType = "none";
          }
        }
      }
    }

    entries.push({
      pos,
      timeToReach,
      ballArrivalTime: ballArrival,
      distanceToBall,
      canReach,
      speed: runSpeed,
      distanceAtLanding,
      posAtLanding,
      action,
      targetPos,
      interceptType,
      projectionDistance,
    });
  }

  // 打球タイプに応じた優先グループを決定
  let priorityGroup: FielderPosition[];
  if (battedBallType === "ground_ball") {
    priorityGroup = INFIELD_POSITIONS;
  } else if (battedBallType === "fly_ball" || battedBallType === "popup") {
    priorityGroup = OUTFIELD_POSITIONS;
  } else {
    // ライナーは全員対象
    priorityGroup = ALL_POSITIONS;
  }

  // フライ/ライナー: distanceAtLanding で canReach 再判定済み
  // ゴロ: 既存ロジック (timeToReach <= ballArrivalTime) で canReach 計算済み

  // 優先グループ内で canReach=true の野手を distanceAtLanding 昇順で並べる
  const reachable = entries
    .filter(e => priorityGroup.includes(e.pos) && e.canReach)
    .sort((a, b) => (a.distanceAtLanding ?? a.distanceToBall) - (b.distanceAtLanding ?? b.distanceToBall));

  // 全体でも distanceAtLanding 昇順
  const allSorted = [...entries].sort(
    (a, b) => (a.distanceAtLanding ?? a.distanceToBall) - (b.distanceAtLanding ?? b.distanceToBall)
  );

  // primary: 優先グループで最速到達（canReach優先、いなければ全員から最速）
  const primaryPos: FielderPosition | null =
    reachable[0]?.pos ?? allSorted[0]?.pos ?? null;
  // backup: 2番目
  const backupPos: FielderPosition | null =
    reachable[1]?.pos ?? allSorted.find(e => e.pos !== primaryPos)?.pos ?? null;

  // 1Bカバー: 1B(pos=3)がprimaryでない場合に割当
  const firstBaseCoverPos: FielderPosition | null =
    primaryPos !== 3 && fielderMap.has(3) ? 3 : null;

  // 外野ヒット時の中継位置: SS(6)または2B(4)を外野ヒット時のリレーに割当
  const relayPos: FielderPosition | null =
    isFlyOrLine && landing.distance >= 60
      ? ([6, 4] as FielderPosition[]).find(p => p !== primaryPos && fielderMap.has(p)) ?? null
      : null;

  // 守備責任テーブルによるassignment取得
  const runnersInfo = runners ?? { first: false, second: false, third: false };
  const outsInfo = outs ?? 0;
  const ballZone = getBallZone(
    Math.atan2(landing.position.x, landing.position.y) * 180 / Math.PI + 45
  );
  const dutyAssignments = primaryPos
    ? assignFielderDuties(primaryPos, ballZone, landing.isGroundBall, runnersInfo, outsInfo, landing.position)
    : null;

  // 結果Mapを構築
  const result = new Map<FielderPosition, FielderDecision>();

  for (const e of entries) {
    const player = fielderMap.get(e.pos)!;
    const skill = getFieldingSkill(player, e.pos);

    let role: FielderRole = "none";
    if (e.pos === primaryPos) {
      role = "primary";
    } else if (e.pos === backupPos) {
      role = "backup";
    } else if (e.pos === firstBaseCoverPos) {
      role = "cover_base";
    } else if (e.pos === relayPos) {
      role = "relay";
    }

    let finalAction = e.action;
    let finalTargetPos = e.targetPos;
    let finalDistanceAtLanding = e.distanceAtLanding;
    let finalPosAtLanding = e.posAtLanding;
    let finalRetrievalCandidate = e.pos === primaryPos; // primaryは常に回収候補

    // primary以外: assignmentでアクションを上書き
    if (e.pos !== primaryPos && dutyAssignments) {
      const assignment = dutyAssignments.get(e.pos);
      if (assignment) {
        finalAction = assignment.action;
        finalTargetPos = assignment.targetPos;
        finalRetrievalCandidate = assignment.retrievalCandidate;
        role = assignment.action === "cover_base" ? "cover_base"
          : assignment.action === "relay" ? "relay"
          : assignment.action === "backup" ? "backup"
          : "none";

        // 外野手(7-9)は回収候補なので、distanceAtLanding/posAtLanding は
        // 物理ベース(ボール方向)の値を維持。これにより回収時の距離計算が正確になる。
        // 内野手・P・Cはassignment先に向かった位置で再計算。
        if (e.pos < 7) {
          const reactionTime = 0.3 + (1 - skill.fielding / 100) * 0.3;
          const movableTime = Math.max(0, e.ballArrivalTime - reactionTime);
          const movableDist = movableTime * e.speed;
          const startPos = positions.get(e.pos)!;
          const dx = finalTargetPos.x - startPos.x;
          const dy = finalTargetPos.y - startPos.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const moved = Math.min(movableDist, d);
          finalPosAtLanding = {
            x: startPos.x + (dx / d) * moved,
            y: startPos.y + (dy / d) * moved,
          };
          finalDistanceAtLanding = Math.sqrt(
            (finalPosAtLanding.x - landing.position.x) ** 2 +
            (finalPosAtLanding.y - landing.position.y) ** 2
          );
        }
        // else: OF keeps original e.distanceAtLanding / e.posAtLanding
      }
    }

    result.set(e.pos, {
      position: e.pos,
      role,
      distanceToBall: e.distanceToBall,
      timeToReach: e.timeToReach,
      ballArrivalTime: e.ballArrivalTime,
      canReach: e.canReach,
      skill,
      speed: e.speed,
      distanceAtLanding: finalDistanceAtLanding,
      posAtLanding: finalPosAtLanding,
      action: finalAction,
      targetPos: finalTargetPos,
      retrievalCandidate: finalRetrievalCandidate,
      interceptType: e.interceptType,
      projectionDistance: e.projectionDistance,
    });
  }

  return result;
}

/** デフォルト守備配置を返す */
export function getDefaultAlignment(): DefensiveAlignment {
  return {
    positions: new Map(DEFAULT_FIELDER_POSITIONS),
  };
}

/**
 * 着地位置から長打タイプを判定
 * 守備AIがヒットと判定した後に呼ばれる
 * @param landing 打球着地情報
 * @param batterSpeed 打者走力 (1-100)
 * @param fenceDistance フェンス距離 (m)
 */
export function resolveHitTypeFromLanding(
  landing: BallLanding,
  batterSpeed: number,
  fenceDistance: number
): "single" | "double" | "triple" {
  const dist = landing.distance;
  const speedFactor = batterSpeed / 100;

  // フェンス際 (フェンス距離の90%以上): トリプル高確率
  if (dist >= fenceDistance * 0.90) {
    if (Math.random() < 0.70 + speedFactor * 0.15) return "triple";
    return "double";
  }

  // 外野深め (80m以上)
  if (dist >= 80) {
    const tripleRate = 0.05 + speedFactor * 0.08;
    if (Math.random() < tripleRate) return "triple";
    return "double";
  }

  // 外野中間 (60-80m)
  if (dist >= 60) {
    const doubleRate = 0.12 + speedFactor * 0.10;
    if (Math.random() < doubleRate) return "double";
    return "single";
  }

  // 外野浅め・内野付近 (< 60m): 常にシングル
  return "single";
}
