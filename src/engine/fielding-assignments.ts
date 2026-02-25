import type { FielderAction } from "../models/league";

type FielderPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type BallZone = "left" | "center" | "right";

export interface FielderAssignment {
  action: FielderAction;
  targetPos: { x: number; y: number };
  retrievalCandidate: boolean;
}

const BASES = {
  home:   { x: 0, y: 0 },
  first:  { x: 19.4, y: 19.4 },
  second: { x: 0, y: 38.8 },
  third:  { x: -19.4, y: 19.4 },
};

/** 打球方向からゾーンを判定 (0=レフト線, 45=センター, 90=ライト線) */
export function getBallZone(direction: number): BallZone {
  if (direction < 30) return "left";
  if (direction > 60) return "right";
  return "center";
}

/** 2点間の距離 */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** 正規化ベクトル */
function normalize(dx: number, dy: number): { x: number; y: number } {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** カットオフ座標: 着地点とホームの間、着地点から30m手前 */
function calcCutoffPos(landingPos: { x: number; y: number }): { x: number; y: number } {
  const dx = BASES.home.x - landingPos.x;
  const dy = BASES.home.y - landingPos.y;
  const n = normalize(dx, dy);
  return {
    x: landingPos.x + n.x * 30,
    y: landingPos.y + n.y * 30,
  };
}

/** バックアップ座標: 塁の後方10m (着地方向の反対側) */
function calcBackupPos(
  base: { x: number; y: number },
  landingPos: { x: number; y: number }
): { x: number; y: number } {
  const dx = base.x - landingPos.x;
  const dy = base.y - landingPos.y;
  const n = normalize(dx, dy);
  return {
    x: base.x + n.x * 10,
    y: base.y + n.y * 10,
  };
}

/**
 * primary以外の全野手の行き先を決定
 * @param primaryPos 捕球担当のポジション番号
 * @param ballZone 打球ゾーン
 * @param isGroundBall ゴロかどうか
 * @param runners 走者状況
 * @param outs アウトカウント
 * @param landingPos 打球着地座標
 */
export function assignFielderDuties(
  primaryPos: FielderPosition,
  ballZone: BallZone,
  isGroundBall: boolean,
  runners: { first: boolean; second: boolean; third: boolean },
  outs: number,
  landingPos: { x: number; y: number }
): Map<FielderPosition, FielderAssignment> {
  const assignments = new Map<FielderPosition, FielderAssignment>();

  if (isGroundBall) {
    assignGroundBallDuties(assignments, primaryPos, ballZone, runners, outs, landingPos);
  } else {
    assignFlyBallDuties(assignments, primaryPos, ballZone, runners, outs, landingPos);
  }

  return assignments;
}

/** ゴロ時の全野手への割り当て */
function assignGroundBallDuties(
  assignments: Map<FielderPosition, FielderAssignment>,
  primaryPos: FielderPosition,
  _ballZone: BallZone,
  _runners: { first: boolean; second: boolean; third: boolean },
  _outs: number,
  landingPos: { x: number; y: number }
): void {
  const allPos: FielderPosition[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  for (const pos of allPos) {
    if (pos === primaryPos) continue;

    switch (pos) {
      case 2: // C: 常にホーム
        assignments.set(pos, {
          action: "hold",
          targetPos: BASES.home,
          retrievalCandidate: false,
        });
        break;

      case 1: // P: 1Bカバー(primaryが1Bの場合) or マウンド待機
        if (primaryPos === 3) {
          assignments.set(pos, {
            action: "cover_base",
            targetPos: BASES.first,
            retrievalCandidate: false,
          });
        } else {
          assignments.set(pos, {
            action: "hold",
            targetPos: { x: 0, y: 18.4 },
            retrievalCandidate: false,
          });
        }
        break;

      case 3: // 1B: 1Bで待つ
        assignments.set(pos, {
          action: "cover_base",
          targetPos: BASES.first,
          retrievalCandidate: false,
        });
        break;

      case 4: // 2B: 2Bカバー (primaryでない場合)
        assignments.set(pos, {
          action: "cover_base",
          targetPos: BASES.second,
          retrievalCandidate: false,
        });
        break;

      case 5: // 3B: 3Bに留まる
        assignments.set(pos, {
          action: "cover_base",
          targetPos: BASES.third,
          retrievalCandidate: false,
        });
        break;

      case 6: // SS: 2Bカバー (primaryでない場合)
        assignments.set(pos, {
          action: "cover_base",
          targetPos: BASES.second,
          retrievalCandidate: false,
        });
        break;

      case 9: // RF: 1B後方バックアップ
        assignments.set(pos, {
          action: "backup",
          targetPos: calcBackupPos(BASES.first, landingPos),
          retrievalCandidate: true, // ゴロが抜けた場合の回収候補
        });
        break;

      case 8: // CF: 2B後方バックアップ
        assignments.set(pos, {
          action: "backup",
          targetPos: calcBackupPos(BASES.second, landingPos),
          retrievalCandidate: true,
        });
        break;

      case 7: // LF: 3B方向バックアップ
        assignments.set(pos, {
          action: "backup",
          targetPos: calcBackupPos(BASES.third, landingPos),
          retrievalCandidate: true,
        });
        break;
    }
  }
}

/** フライ/ライナー時の全野手への割り当て */
function assignFlyBallDuties(
  assignments: Map<FielderPosition, FielderAssignment>,
  primaryPos: FielderPosition,
  ballZone: BallZone,
  runners: { first: boolean; second: boolean; third: boolean },
  _outs: number,
  landingPos: { x: number; y: number }
): void {
  const allPos: FielderPosition[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const outfieldPositions: FielderPosition[] = [7, 8, 9];

  for (const pos of allPos) {
    if (pos === primaryPos) continue;

    // 隣接外野手: バックアップ
    if (outfieldPositions.includes(pos)) {
      // primaryが外野手の場合、隣接OFはバックアップに向かう
      if (outfieldPositions.includes(primaryPos)) {
        assignments.set(pos, {
          action: "backup",
          targetPos: {
            x: landingPos.x + (pos === 7 ? -5 : pos === 9 ? 5 : 0),
            y: landingPos.y + 8,
          },
          retrievalCandidate: true,
        });
      } else {
        // primaryが内野手(内野フライ等)の場合: 外野手はポジション維持
        assignments.set(pos, {
          action: "hold",
          targetPos: getDefaultPos(pos),
          retrievalCandidate: true,
        });
      }
      continue;
    }

    switch (pos) {
      case 2: // C: 常にホーム
        assignments.set(pos, {
          action: "hold",
          targetPos: BASES.home,
          retrievalCandidate: false,
        });
        break;

      case 1: // P: ホームまたは3B方向バックアップ
        if (runners.third) {
          assignments.set(pos, {
            action: "backup",
            targetPos: { x: -5, y: 10 },
            retrievalCandidate: false,
          });
        } else {
          assignments.set(pos, {
            action: "hold",
            targetPos: { x: 0, y: 18.4 },
            retrievalCandidate: false,
          });
        }
        break;

      case 6: // SS: LF/CF方向フライ → カットオフ、RF方向 → 3Bカバー
        if (ballZone === "left" || ballZone === "center") {
          assignments.set(pos, {
            action: "relay",
            targetPos: calcCutoffPos(landingPos),
            retrievalCandidate: false,
          });
        } else {
          assignments.set(pos, {
            action: "cover_base",
            targetPos: BASES.third,
            retrievalCandidate: false,
          });
        }
        break;

      case 4: // 2B: RF方向フライ → カットオフ、それ以外 → 2Bカバー
        if (ballZone === "right") {
          assignments.set(pos, {
            action: "relay",
            targetPos: calcCutoffPos(landingPos),
            retrievalCandidate: false,
          });
        } else {
          assignments.set(pos, {
            action: "cover_base",
            targetPos: BASES.second,
            retrievalCandidate: false,
          });
        }
        break;

      case 3: // 1B: 1Bカバー
        assignments.set(pos, {
          action: "cover_base",
          targetPos: BASES.first,
          retrievalCandidate: false,
        });
        break;

      case 5: // 3B: 3Bカバー
        assignments.set(pos, {
          action: "cover_base",
          targetPos: BASES.third,
          retrievalCandidate: false,
        });
        break;
    }
  }
}

/** デフォルト守備位置 */
function getDefaultPos(pos: FielderPosition): { x: number; y: number } {
  const defaults: Record<FielderPosition, { x: number; y: number }> = {
    1: { x: 0,   y: 18.4 },
    2: { x: 0,   y: 1.0  },
    3: { x: 20,  y: 28   },
    4: { x: 10,  y: 36   },
    5: { x: -20, y: 28   },
    6: { x: -10, y: 36   },
    7: { x: -26, y: 62   },
    8: { x: 0,   y: 70   },
    9: { x: 26,  y: 62   },
  };
  return defaults[pos];
}
