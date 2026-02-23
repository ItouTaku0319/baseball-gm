"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { AtBatLog } from "@/models/league";
import { getFenceDistance, estimateDistance } from "@/engine/simulation";

// ---- ユーティリティ ----

const resultNamesJa: Record<string, string> = {
  single: "ヒット",
  double: "ツーベース",
  triple: "スリーベース",
  homerun: "ホームラン",
  strikeout: "三振",
  walk: "四球",
  hitByPitch: "死球",
  groundout: "ゴロアウト",
  flyout: "フライアウト",
  lineout: "ライナーアウト",
  popout: "ポップアウト",
  doublePlay: "併殺打",
  sacrificeFly: "犠牲フライ",
  fieldersChoice: "フィルダースチョイス",
  infieldHit: "内野安打",
  error: "エラー出塁",
};

function resultColor(result: string): string {
  switch (result) {
    case "homerun": return "text-red-500 font-bold";
    case "triple": return "text-orange-400 font-semibold";
    case "double": return "text-orange-300";
    case "single": case "infieldHit": return "text-yellow-300";
    case "walk": return "text-blue-400";
    case "hitByPitch": return "text-cyan-400";
    case "error": return "text-purple-400";
    default: return "text-gray-400";
  }
}

function dotColor(result: string): string {
  switch (result) {
    case "homerun": return "#ef4444";
    case "double": case "triple": return "#fb923c";
    case "single": case "infieldHit": return "#eab308";
    case "walk": case "hitByPitch": return "#60a5fa";
    case "error": return "#a855f7";
    default: return "#6b7280";
  }
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ---- フィールド座標変換 ----

// direction: 0°=3B線(左), 45°=センター(上), 90°=1B線(右)
// SVG座標: homeX=150, homeY=280, センター=上方向
function toFieldSvg(distM: number, dirDeg: number): { x: number; y: number } {
  const scale = 1.8;
  const homeX = 150, homeY = 280;
  const angleRad = (135 - dirDeg) * Math.PI / 180;
  return {
    x: homeX + distM * scale * Math.cos(angleRad),
    y: homeY - distM * scale * Math.sin(angleRad),
  };
}

// ---- 守備デフォルト位置 ----

const FIELDER_DEFAULT_POS: Record<number, { dist: number; dir: number }> = {
  1: { dist: 16, dir: 45 },
  2: { dist: 2,  dir: 45 },
  3: { dist: 25, dir: 80 },
  4: { dist: 35, dir: 62 },
  5: { dist: 25, dir: 10 },
  6: { dist: 35, dir: 28 },
  7: { dist: 80, dir: 10 },
  8: { dist: 85, dir: 45 },
  9: { dist: 80, dir: 80 },
};

// ---- 走者進塁数 ----

function getRunnerAdvancement(result: string): number {
  switch (result) {
    case "homerun": return 4;
    case "triple": return 3;
    case "double": return 2;
    case "single":
    case "infieldHit":
    case "error":
    case "fieldersChoice": return 1;
    case "walk":
    case "hitByPitch": return 1;
    case "sacrificeFly": return 1;
    default: return 0;
  }
}

// ---- 塁座標 ----

const HOME_COORD = { x: 150, y: 280 };
const FIRST_COORD = toFieldSvg(27.431, 90);
const SECOND_COORD = toFieldSvg(27.431 * Math.SQRT2, 45);
const THIRD_COORD = toFieldSvg(27.431, 0);

const BASE_COORDS: Record<number, { x: number; y: number }> = {
  0: HOME_COORD,
  1: FIRST_COORD,
  2: SECOND_COORD,
  3: THIRD_COORD,
};

function getBasePathSegments(fromBase: number, toBase: number): { x: number; y: number }[] {
  const path = [BASE_COORDS[fromBase]];
  let current = fromBase;
  while (current !== toBase) {
    current = (current + 1) % 4;
    path.push(BASE_COORDS[current]);
  }
  return path;
}

function interpolateBasePath(segments: { x: number; y: number }[], t: number): { x: number; y: number } {
  if (segments.length < 2) return segments[0];
  const totalSegments = segments.length - 1;
  const segmentT = t * totalSegments;
  const segIdx = Math.min(Math.floor(segmentT), totalSegments - 1);
  const localT = segmentT - segIdx;
  return lerp(segments[segIdx], segments[segIdx + 1], localT);
}

// ---- ベジェ曲線 ----

function quadBezier(
  from: { x: number; y: number },
  via: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
  };
}

// ---- 物理定数 ----

const REACTION_TIME = 0.3;
const FIELDER_SPEED = 7.5;
const INFIELD_THROW_SPEED = 35;
const OUTFIELD_THROW_SPEED = 30;
const RUNNER_SPEED = 8.5;

function getBallFlightTime(exitVelocityKmh: number, launchAngleDeg: number): number {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const g = 9.8;
  const h = 1.2;
  const vy = v * Math.sin(theta);
  return (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
}

function getGroundBallTime(exitVelocityKmh: number, distM: number): number {
  const vGround = (exitVelocityKmh / 3.6) * 0.7;
  return vGround > 0 ? distM / vGround : 2.0;
}

function getDistanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) / 1.8;
}

// ---- イベントシーケンス ----

type PlayEventType =
  | "ball_fly"
  | "ball_ground"
  | "ball_hr"
  | "fielder_run"
  | "throw"
  | "catch"
  | "runner_advance"
  | "batter_run"
  | "tag_base"
  | "error_bobble";

interface PlayEvent {
  type: PlayEventType;
  startTime: number;
  duration: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  entityId: string;
  meta?: {
    via?: { x: number; y: number };
    result?: "out" | "safe";
  };
}

function makeFlyVia(
  from: { x: number; y: number },
  to: { x: number; y: number },
  launchAngle: number
): { x: number; y: number } {
  const mid = lerp(from, to, 0.5);
  const heightOffset = Math.min(100, (launchAngle / 45) * 80);
  return { x: mid.x, y: mid.y - heightOffset };
}

function fielderSvgPos(pos: number): { x: number; y: number } {
  const coord = FIELDER_DEFAULT_POS[pos];
  if (!coord) return HOME_COORD;
  return toFieldSvg(coord.dist, coord.dir);
}

function runnerBasePath(
  basesBeforePlay: [boolean, boolean, boolean] | null,
  baseIdx: number,
  advance: number
): { x: number; y: number }[] {
  const baseNum = baseIdx + 1;
  const targetBase = Math.min(baseNum + advance, 4) % 4; // 4→0(home)
  return getBasePathSegments(baseNum, targetBase === 0 ? 0 : targetBase);
}

function runnerTravelTime(segments: { x: number; y: number }[]): number {
  let dist = 0;
  for (let i = 0; i + 1 < segments.length; i++) {
    dist += getDistanceBetween(segments[i], segments[i + 1]);
  }
  return dist / RUNNER_SPEED;
}

/** fromBase → toBase を塁間ごとに分割したイベント列を events に追加し、終了時刻を返す。
 * fromBase === toBase の場合は一周（4セグメント）として扱う。 */
function addSegmentedRunEvents(
  events: PlayEvent[],
  type: "batter_run" | "runner_advance",
  entityPrefix: string,
  fromBase: number,
  toBase: number,
  startTime: number,
): number {
  // 移動するセグメント数を計算（一周の場合は4）
  const totalSegs = fromBase === toBase
    ? 4
    : (toBase - fromBase + 4) % 4;
  let current = fromBase;
  let t = startTime;
  for (let segIdx = 0; segIdx < totalSegs; segIdx++) {
    const next = (current + 1) % 4;
    const segFrom = BASE_COORDS[current];
    const segTo = BASE_COORDS[next];
    const segTime = runnerTravelTime([segFrom, segTo]);
    events.push({
      type,
      startTime: t,
      duration: segTime,
      from: segFrom,
      to: segTo,
      entityId: `${entityPrefix}_seg${segIdx}`,
    });
    t += segTime;
    current = next;
  }
  return t;
}

function buildPlayEvents(log: AtBatLog): PlayEvent[] {
  const events: PlayEvent[] = [];

  if (log.direction === null || log.exitVelocity === null) return events;

  const home = HOME_COORD;
  const firstBase = FIRST_COORD;
  const secondBase = SECOND_COORD;

  const fielderPos = log.fielderPosition ?? 8;
  const effectiveFielderPos = fielderPos >= 7 ? fielderPos : fielderPos;
  const fielderDefault = fielderSvgPos(effectiveFielderPos);

  const dist = log.estimatedDistance ?? estimateDistance(log.exitVelocity, log.launchAngle ?? 15);
  const landPos = toFieldSvg(dist, log.direction);
  const launchAngle = log.launchAngle ?? 15;
  const exitVelocity = log.exitVelocity;

  const advance = getRunnerAdvancement(log.result);
  const basesBeforePlay = log.basesBeforePlay;

  switch (log.result) {
    case "groundout": {
      const groundTime = getGroundBallTime(exitVelocity, dist);
      events.push({
        type: "ball_ground",
        startTime: 0,
        duration: groundTime,
        from: home,
        to: landPos,
        entityId: "ball",
      });
      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }
      const catchTime = Math.max(groundTime, REACTION_TIME + fielderRunTime);
      events.push({
        type: "catch",
        startTime: catchTime,
        duration: 0.3,
        from: landPos,
        to: landPos,
        entityId: `fielder_${effectiveFielderPos}`,
      });
      const throwDist = getDistanceBetween(landPos, firstBase);
      const throwTime = throwDist / INFIELD_THROW_SPEED;
      events.push({
        type: "throw",
        startTime: catchTime + 0.2,
        duration: throwTime,
        from: landPos,
        to: firstBase,
        entityId: "ball",
      });
      events.push({
        type: "tag_base",
        startTime: catchTime + 0.2 + throwTime,
        duration: 0.4,
        from: firstBase,
        to: firstBase,
        entityId: "base_1",
        meta: { result: "out" },
      });
      break;
    }

    case "doublePlay": {
      const groundTime = getGroundBallTime(exitVelocity, dist);
      events.push({
        type: "ball_ground",
        startTime: 0,
        duration: groundTime,
        from: home,
        to: landPos,
        entityId: "ball",
      });
      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }
      const catchTime = Math.max(groundTime, REACTION_TIME + fielderRunTime);
      events.push({
        type: "catch",
        startTime: catchTime,
        duration: 0.25,
        from: landPos,
        to: landPos,
        entityId: `fielder_${effectiveFielderPos}`,
      });
      // throw to 2B (SS or 2B)
      const throwDist1 = getDistanceBetween(landPos, secondBase);
      const throwTime1 = throwDist1 / INFIELD_THROW_SPEED;
      events.push({
        type: "throw",
        startTime: catchTime + 0.15,
        duration: throwTime1,
        from: landPos,
        to: secondBase,
        entityId: "ball",
      });
      events.push({
        type: "tag_base",
        startTime: catchTime + 0.15 + throwTime1,
        duration: 0.3,
        from: secondBase,
        to: secondBase,
        entityId: "base_2",
        meta: { result: "out" },
      });
      // throw to 1B
      const throwDist2 = getDistanceBetween(secondBase, firstBase);
      const throwTime2 = throwDist2 / INFIELD_THROW_SPEED;
      const throw2Start = catchTime + 0.15 + throwTime1 + 0.15;
      events.push({
        type: "throw",
        startTime: throw2Start,
        duration: throwTime2,
        from: secondBase,
        to: firstBase,
        entityId: "ball",
      });
      events.push({
        type: "tag_base",
        startTime: throw2Start + throwTime2,
        duration: 0.4,
        from: firstBase,
        to: firstBase,
        entityId: "base_1",
        meta: { result: "out" },
      });
      // 打者走者
      const batterSegs = getBasePathSegments(0, 1);
      const batterTime = runnerTravelTime(batterSegs);
      events.push({
        type: "batter_run",
        startTime: groundTime + 0.1,
        duration: batterTime,
        from: home,
        to: firstBase,
        entityId: "batter",
        meta: { via: undefined },
      });
      break;
    }

    case "flyout":
    case "popout":
    case "lineout": {
      const flightTime = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
      const via = makeFlyVia(home, landPos, launchAngle);
      events.push({
        type: "ball_fly",
        startTime: 0,
        duration: flightTime,
        from: home,
        to: landPos,
        entityId: "ball",
        meta: { via },
      });
      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }
      events.push({
        type: "catch",
        startTime: flightTime,
        duration: 0.3,
        from: landPos,
        to: landPos,
        entityId: `fielder_${effectiveFielderPos}`,
      });
      break;
    }

    case "sacrificeFly": {
      const flightTime = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
      const via = makeFlyVia(home, landPos, launchAngle);
      events.push({
        type: "ball_fly",
        startTime: 0,
        duration: flightTime,
        from: home,
        to: landPos,
        entityId: "ball",
        meta: { via },
      });
      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }
      events.push({
        type: "catch",
        startTime: flightTime,
        duration: 0.3,
        from: landPos,
        to: landPos,
        entityId: `fielder_${effectiveFielderPos}`,
      });
      // 3Bランナーのタッチアップ
      if (basesBeforePlay && basesBeforePlay[2]) {
        const tagupSegs = getBasePathSegments(3, 0);
        const tagupTime = runnerTravelTime(tagupSegs);
        events.push({
          type: "runner_advance",
          startTime: flightTime + 0.1,
          duration: tagupTime,
          from: THIRD_COORD,
          to: HOME_COORD,
          entityId: "runner_3B",
        });
        // 外野→ホームへの送球（間に合わない想定）
        const throwDist = getDistanceBetween(landPos, HOME_COORD);
        const throwTime = throwDist / OUTFIELD_THROW_SPEED;
        events.push({
          type: "throw",
          startTime: flightTime + 0.5,
          duration: throwTime,
          from: landPos,
          to: HOME_COORD,
          entityId: "ball",
        });
      }
      break;
    }

    case "homerun": {
      const flightTime = getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
      const fenceDist = getFenceDistance(log.direction);
      const hrLandPos = toFieldSvg(fenceDist + 10, log.direction);
      const via = makeFlyVia(home, hrLandPos, Math.max(launchAngle, 30));
      // 大きな弧にするためにvia点をさらに高くする
      via.y = Math.min(via.y, home.y - 100);
      events.push({
        type: "ball_hr",
        startTime: 0,
        duration: flightTime,
        from: home,
        to: hrLandPos,
        entityId: "ball",
        meta: { via },
      });
      // 打者走者（ホーム一周）
      addSegmentedRunEvents(events, "batter_run", "batter", 0, 0, 0.3);
      // 走者進塁（塁上の全走者がホームへ）
      if (basesBeforePlay) {
        basesBeforePlay.forEach((occupied, baseIdx) => {
          if (!occupied) return;
          const baseNum = baseIdx + 1;
          addSegmentedRunEvents(events, "runner_advance", `runner_base${baseNum}`, baseNum, 0, 0.3);
        });
      }
      break;
    }

    case "single":
    case "double":
    case "triple": {
      const isFly = launchAngle > 10 && log.battedBallType !== "grounder";
      const flightOrRollTime = isFly
        ? getBallFlightTime(exitVelocity, Math.max(launchAngle, 5))
        : getGroundBallTime(exitVelocity, dist);
      const via = isFly ? makeFlyVia(home, landPos, launchAngle) : undefined;

      events.push({
        type: isFly ? "ball_fly" : "ball_ground",
        startTime: 0,
        duration: flightOrRollTime,
        from: home,
        to: landPos,
        entityId: "ball",
        meta: via ? { via } : undefined,
      });

      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }

      // 打者走者（塁間ごとに分割）
      addSegmentedRunEvents(events, "batter_run", "batter", 0, advance, Math.max(0.1, flightOrRollTime * 0.3));

      // 前走者の進塁（塁間ごとに分割）
      if (basesBeforePlay) {
        basesBeforePlay.forEach((occupied, baseIdx) => {
          if (!occupied) return;
          const baseNum = baseIdx + 1;
          const newBase = Math.min(baseNum + advance, 4) % 4;
          addSegmentedRunEvents(events, "runner_advance", `runner_base${baseNum}`, baseNum, newBase, Math.max(0.1, flightOrRollTime * 0.3));
        });
      }
      break;
    }

    case "infieldHit": {
      const groundTime = getGroundBallTime(exitVelocity, dist);
      events.push({
        type: "ball_ground",
        startTime: 0,
        duration: groundTime,
        from: home,
        to: landPos,
        entityId: "ball",
      });
      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }
      const catchTime = Math.max(groundTime, REACTION_TIME + fielderRunTime);
      // 遅れた送球（間に合わない）
      const throwDist = getDistanceBetween(landPos, firstBase);
      const throwTime = throwDist / (INFIELD_THROW_SPEED * 0.6); // 遅め
      events.push({
        type: "throw",
        startTime: catchTime + 0.35,
        duration: throwTime,
        from: landPos,
        to: firstBase,
        entityId: "ball",
      });
      events.push({
        type: "tag_base",
        startTime: catchTime + 0.35 + throwTime,
        duration: 0.4,
        from: firstBase,
        to: firstBase,
        entityId: "base_1",
        meta: { result: "safe" },
      });
      // 打者走者（速め）
      const batterSegs = getBasePathSegments(0, 1);
      const batterTime = runnerTravelTime(batterSegs) * 0.85;
      events.push({
        type: "batter_run",
        startTime: groundTime * 0.2,
        duration: batterTime,
        from: home,
        to: firstBase,
        entityId: "batter",
      });
      break;
    }

    case "error": {
      const isGrounder = log.battedBallType === "grounder" || launchAngle < 10;
      const arrivalTime = isGrounder
        ? getGroundBallTime(exitVelocity, dist)
        : getBallFlightTime(exitVelocity, Math.max(launchAngle, 5));
      const via = !isGrounder ? makeFlyVia(home, landPos, launchAngle) : undefined;
      events.push({
        type: isGrounder ? "ball_ground" : "ball_fly",
        startTime: 0,
        duration: arrivalTime,
        from: home,
        to: landPos,
        entityId: "ball",
        meta: via ? { via } : undefined,
      });
      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }
      const reachTime = Math.max(arrivalTime, REACTION_TIME + fielderRunTime);
      // エラー：ボールが跳ねる
      const bobbleTo = { x: landPos.x + 10, y: landPos.y + 8 };
      events.push({
        type: "error_bobble",
        startTime: reachTime,
        duration: 0.4,
        from: landPos,
        to: bobbleTo,
        entityId: "ball",
      });
      // 打者走者
      const batterSegs = getBasePathSegments(0, 1);
      const batterTime = runnerTravelTime(batterSegs);
      events.push({
        type: "batter_run",
        startTime: arrivalTime * 0.3,
        duration: batterTime,
        from: home,
        to: firstBase,
        entityId: "batter",
      });
      events.push({
        type: "tag_base",
        startTime: arrivalTime * 0.3 + batterTime,
        duration: 0.4,
        from: firstBase,
        to: firstBase,
        entityId: "base_1",
        meta: { result: "safe" },
      });
      break;
    }

    case "fieldersChoice": {
      const groundTime = getGroundBallTime(exitVelocity, dist);
      events.push({
        type: "ball_ground",
        startTime: 0,
        duration: groundTime,
        from: home,
        to: landPos,
        entityId: "ball",
      });
      const fielderRunDist = getDistanceBetween(fielderDefault, landPos);
      const fielderRunTime = fielderRunDist / FIELDER_SPEED;
      if (fielderRunDist > 3) {
        events.push({
          type: "fielder_run",
          startTime: REACTION_TIME,
          duration: fielderRunTime,
          from: fielderDefault,
          to: landPos,
          entityId: `fielder_${effectiveFielderPos}`,
        });
      }
      const catchTime = Math.max(groundTime, REACTION_TIME + fielderRunTime);
      // 2Bへ送球してアウト
      const throwDist = getDistanceBetween(landPos, secondBase);
      const throwTime = throwDist / INFIELD_THROW_SPEED;
      events.push({
        type: "throw",
        startTime: catchTime + 0.15,
        duration: throwTime,
        from: landPos,
        to: secondBase,
        entityId: "ball",
      });
      events.push({
        type: "tag_base",
        startTime: catchTime + 0.15 + throwTime,
        duration: 0.4,
        from: secondBase,
        to: secondBase,
        entityId: "base_2",
        meta: { result: "out" },
      });
      // 打者走者は1Bセーフ
      const batterSegs = getBasePathSegments(0, 1);
      const batterTime = runnerTravelTime(batterSegs);
      events.push({
        type: "batter_run",
        startTime: groundTime * 0.3,
        duration: batterTime,
        from: home,
        to: firstBase,
        entityId: "batter",
      });
      events.push({
        type: "tag_base",
        startTime: groundTime * 0.3 + batterTime,
        duration: 0.4,
        from: firstBase,
        to: firstBase,
        entityId: "base_1",
        meta: { result: "safe" },
      });
      break;
    }

    default:
      break;
  }

  return events;
}

function getTotalDuration(events: PlayEvent[]): number {
  if (events.length === 0) return 3;
  return Math.max(...events.map(e => e.startTime + e.duration)) + 0.5;
}

// ---- イベントから現在位置を計算 ----

interface EntityState {
  pos: { x: number; y: number };
  visible: boolean;
}

function getEntityState(events: PlayEvent[], entityId: string, currentTime: number): EntityState | null {
  // 当該エンティティの最新イベントを探す
  const relevant = events.filter(e => e.entityId === entityId);
  if (relevant.length === 0) return null;

  // currentTime に有効なイベントを見つける
  let active: PlayEvent | null = null;
  let lastBefore: PlayEvent | null = null;
  for (const e of relevant) {
    if (currentTime >= e.startTime && currentTime <= e.startTime + e.duration) {
      active = e;
      break;
    }
    if (currentTime > e.startTime + e.duration) {
      lastBefore = e;
    }
  }

  if (active) {
    const t = (currentTime - active.startTime) / Math.max(active.duration, 0.001);
    const ct = clampNum(t, 0, 1);

    let pos: { x: number; y: number };
    if (active.meta?.via && (active.type === "ball_fly" || active.type === "ball_hr")) {
      pos = quadBezier(active.from, active.meta.via, active.to, ct);
    } else if (active.type === "error_bobble") {
      // 跳ね: 上へ行って戻る放物線
      const bx = lerp(active.from, active.to, ct).x;
      const by = lerp(active.from, active.to, ct).y - Math.sin(ct * Math.PI) * 15;
      pos = { x: bx, y: by };
    } else if (active.type === "batter_run") {
      // 単一セグメント（from→to）
      pos = lerp(active.from, active.to, ct);
    } else if (active.type === "runner_advance") {
      pos = lerp(active.from, active.to, ct);
    } else {
      pos = lerp(active.from, active.to, ct);
    }
    return { pos, visible: true };
  }

  if (lastBefore) {
    return { pos: lastBefore.to, visible: true };
  }

  // まだ開始前のイベントのfromを返す
  const first = relevant[0];
  if (currentTime < first.startTime) {
    return { pos: first.from, visible: true };
  }

  return null;
}

// ---- アニメーションフック ----

function usePlayAnimation(totalDuration: number) {
  const [currentTime, setCurrentTime] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const animRef = useRef<number | null>(null);
  const startRef = useRef(0);

  const play = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setPlaying(true);
    setCurrentTime(0);
    startRef.current = performance.now();
    const animate = (now: number) => {
      const elapsed = ((now - startRef.current) / 1000) * speed;
      if (elapsed >= totalDuration) {
        setCurrentTime(totalDuration);
        setPlaying(false);
        return;
      }
      setCurrentTime(elapsed);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
  }, [totalDuration, speed]);

  useEffect(() => {
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  return { currentTime, totalDuration, playing, play, speed, setSpeed };
}

// ---- フィールドビュー ----

interface AnimatedFieldViewProps {
  log: AtBatLog;
  events: PlayEvent[];
  currentTime: number;
  playing: boolean;
}

function AnimatedFieldView({ log, events, currentTime, playing }: AnimatedFieldViewProps) {
  const fencePoints = Array.from({ length: 19 }, (_, i) => {
    const deg = i * 5;
    const dist = getFenceDistance(deg);
    return toFieldSvg(dist, deg);
  });
  const fencePath = fencePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const home = HOME_COORD;
  const first = FIRST_COORD;
  const second = SECOND_COORD;
  const third = THIRD_COORD;
  const diamondPath = `M ${home.x} ${home.y} L ${first.x.toFixed(1)} ${first.y.toFixed(1)} L ${second.x.toFixed(1)} ${second.y.toFixed(1)} L ${third.x.toFixed(1)} ${third.y.toFixed(1)} Z`;

  // 打球の静的落下地点
  let dot: { x: number; y: number } | null = null;
  if (log.direction !== null && log.estimatedDistance != null && log.estimatedDistance > 0) {
    dot = toFieldSvg(log.estimatedDistance, log.direction);
  }

  const isAnimating = playing || currentTime >= 0;
  const advance = getRunnerAdvancement(log.result);

  // ボール位置
  const ballState = isAnimating ? getEntityState(events, "ball", currentTime) : null;

  // tag_base エフェクト表示
  const tagEvents = events.filter(e => e.type === "tag_base");
  const activeTagEvents = tagEvents.filter(
    e => currentTime >= e.startTime && currentTime <= e.startTime + e.duration
  );

  // catch エフェクト表示
  const catchEvents = events.filter(e => e.type === "catch");
  const activeCatchEvents = catchEvents.filter(
    e => currentTime >= e.startTime && currentTime <= e.startTime + e.duration
  );

  // 守備走者の位置
  const fielderStates: Record<number, { x: number; y: number }> = {};
  Object.keys(FIELDER_DEFAULT_POS).forEach(posStr => {
    const pos = Number(posStr);
    const defaultP = toFieldSvg(FIELDER_DEFAULT_POS[pos].dist, FIELDER_DEFAULT_POS[pos].dir);
    if (isAnimating) {
      const state = getEntityState(events, `fielder_${pos}`, currentTime);
      fielderStates[pos] = state ? state.pos : defaultP;
    } else {
      fielderStates[pos] = defaultP;
    }
  });

  // 走者の位置（basesBeforePlay から）
  const runnerPositions: { pos: { x: number; y: number }; baseIdx: number }[] = [];
  if (log.basesBeforePlay) {
    log.basesBeforePlay.forEach((occupied, baseIdx) => {
      if (!occupied) return;
      const baseNum = baseIdx + 1;
      if (isAnimating && advance > 0) {
        // セグメント分割されたイベントを探す
        let found = false;
        for (let i = 0; i < 4; i++) {
          const state = getEntityState(events, `runner_base${baseNum}_seg${i}`, currentTime);
          if (state) {
            runnerPositions.push({ pos: state.pos, baseIdx });
            found = true;
            break;
          }
        }
        if (!found) {
          // 単一イベントのフォールバック
          const state = getEntityState(events, `runner_base${baseNum}`, currentTime);
          if (state) {
            runnerPositions.push({ pos: state.pos, baseIdx });
            found = true;
          }
        }
        if (!found) {
          runnerPositions.push({ pos: BASE_COORDS[baseNum], baseIdx });
        }
        return;
      }
      runnerPositions.push({ pos: BASE_COORDS[baseNum], baseIdx });
    });
  }

  // 打者走者（セグメント分割されたイベントから現在位置を探す）
  let batterPos: { x: number; y: number } | null = null;
  if (isAnimating && advance > 0) {
    for (let i = 0; i < 4; i++) {
      const state = getEntityState(events, `batter_seg${i}`, currentTime);
      if (state) {
        batterPos = state.pos;
        break;
      }
    }
    // 単一イベントのフォールバック
    if (!batterPos) {
      const state = getEntityState(events, "batter", currentTime);
      if (state) batterPos = state.pos;
    }
  }

  const outsBeforePlay = log.outsBeforePlay ?? null;

  return (
    <svg viewBox="0 0 300 300" className="w-full bg-gray-900 rounded border border-gray-700">
      <rect x="0" y="0" width="300" height="300" fill="#111827" />
      <path d={fencePath + ` L ${home.x} ${home.y} Z`} fill="#14532d" opacity="0.5" />
      <path d={diamondPath} fill="#92400e" opacity="0.4" />
      <path d={fencePath} fill="none" stroke="#6b7280" strokeWidth="1.5" />
      <path d={diamondPath} fill="none" stroke="#9ca3af" strokeWidth="1" />
      {[home, first, second, third].map((p, i) => (
        <rect key={i} x={p.x - 3} y={p.y - 3} width="6" height="6" fill="#e5e7eb" transform={`rotate(45 ${p.x} ${p.y})`} />
      ))}

      {/* 守備選手 */}
      {Object.entries(FIELDER_DEFAULT_POS).map(([posStr]) => {
        const pos = Number(posStr);
        const isActive = pos === log.fielderPosition;
        const displayP = fielderStates[pos] ?? toFieldSvg(FIELDER_DEFAULT_POS[pos].dist, FIELDER_DEFAULT_POS[pos].dir);
        return (
          <g key={pos}>
            <circle cx={displayP.x} cy={displayP.y} r={4} fill={isActive ? "#f97316" : "#374151"} stroke="#9ca3af" strokeWidth="0.8" />
            <text x={displayP.x} y={displayP.y + 1} textAnchor="middle" fill="white" fontSize="5" dominantBaseline="middle">{pos}</text>
          </g>
        );
      })}

      {/* 走者 */}
      {runnerPositions.map(({ pos, baseIdx }) => (
        <circle key={baseIdx} cx={pos.x} cy={pos.y} r={3.5} fill="#22c55e" stroke="white" strokeWidth="0.8" />
      ))}

      {/* 打者走者 */}
      {batterPos && (
        <circle cx={batterPos.x} cy={batterPos.y} r={3.5} fill="#3b82f6" stroke="white" strokeWidth="0.8" />
      )}

      {/* 打球落下地点（静的） */}
      {dot && !isAnimating && (
        <>
          <line x1={home.x} y1={home.y} x2={dot.x} y2={dot.y} stroke={dotColor(log.result)} strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
          <circle cx={dot.x} cy={dot.y} r="5" fill={dotColor(log.result)} opacity="0.9" />
          <circle cx={dot.x} cy={dot.y} r="5" fill="none" stroke="white" strokeWidth="0.8" opacity="0.5" />
        </>
      )}

      {/* ボール（アニメーション中） */}
      {ballState && isAnimating && (
        <circle cx={ballState.pos.x} cy={ballState.pos.y} r={2.5} fill="white" stroke="#ef4444" strokeWidth="0.8" />
      )}

      {/* catch エフェクト（パルス円） */}
      {activeCatchEvents.map((e, i) => {
        const t = (currentTime - e.startTime) / Math.max(e.duration, 0.001);
        const r = 6 + t * 6;
        const opacity = 1 - t;
        return (
          <circle key={i} cx={e.from.x} cy={e.from.y} r={r} fill="none" stroke="#facc15" strokeWidth="1.5" opacity={opacity} />
        );
      })}

      {/* tag_base エフェクト */}
      {activeTagEvents.map((e, i) => {
        const isOut = e.meta?.result === "out";
        return isOut ? (
          <g key={i}>
            <line x1={e.from.x - 5} y1={e.from.y - 5} x2={e.from.x + 5} y2={e.from.y + 5} stroke="#ef4444" strokeWidth="2" />
            <line x1={e.from.x + 5} y1={e.from.y - 5} x2={e.from.x - 5} y2={e.from.y + 5} stroke="#ef4444" strokeWidth="2" />
          </g>
        ) : (
          <circle key={i} cx={e.from.x} cy={e.from.y} r={7} fill="none" stroke="#22c55e" strokeWidth="2" opacity={0.8} />
        );
      })}

      {/* アウトカウント表示 */}
      {outsBeforePlay !== null && (
        <g>
          <text x="10" y="12" fill="#9ca3af" fontSize="7">アウト</text>
          {[0, 1, 2].map(i => (
            <circle key={i} cx={10 + i * 10} cy={20} r={3.5} fill={i < outsBeforePlay ? "#6b7280" : "none"} stroke="#9ca3af" strokeWidth="1" />
          ))}
        </g>
      )}
    </svg>
  );
}

// ---- サイドビュー（軌道・横から） ----

function computeTrajectoryPoints(
  exitVelocityKmh: number,
  launchAngleDeg: number,
  numPoints: number = 30
): { x: number; y: number }[] {
  const v = exitVelocityKmh / 3.6;
  const theta = launchAngleDeg * Math.PI / 180;
  const g = 9.8;
  const h = 1.2;
  const vx = v * Math.cos(theta);
  const vy = v * Math.sin(theta);
  const dragFactor = 0.87;

  const disc = vy * vy + 2 * g * h;
  if (disc < 0) return [{ x: 0, y: h }];
  const tFlight = (vy + Math.sqrt(disc)) / g;

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = (i / numPoints) * tFlight;
    points.push({
      x: vx * t * dragFactor,
      y: h + vy * t - 0.5 * g * t * t,
    });
  }
  return points;
}

interface SideViewProps {
  log: AtBatLog;
  currentTime: number;
  events: PlayEvent[];
}

function SideView({ log, currentTime, events }: SideViewProps) {
  if (log.exitVelocity === null || log.launchAngle === null || log.launchAngle <= 0) {
    return (
      <svg viewBox="0 0 350 180" className="w-full bg-gray-900 rounded border border-gray-700">
        <text x="175" y="95" textAnchor="middle" fill="#6b7280" fontSize="12">軌道データなし</text>
      </svg>
    );
  }

  const points = computeTrajectoryPoints(log.exitVelocity, log.launchAngle);
  const totalDist = log.estimatedDistance ?? estimateDistance(log.exitVelocity, log.launchAngle);
  const maxY = Math.max(...points.map(p => p.y));

  const svgW = 350, svgH = 180;
  const padLeft = 30, padBottom = 25, padTop = 20, padRight = 20;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const xMax = totalDist + 15;
  const yMax = maxY + 5;

  const toSvgCoord = (x: number, y: number) => ({
    sx: padLeft + (x / xMax) * plotW,
    sy: padTop + plotH - (y / yMax) * plotH,
  });

  const pathD = points.map((p, i) => {
    const { sx, sy } = toSvgCoord(p.x, p.y);
    return `${i === 0 ? "M" : "L"} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  }).join(" ");

  const fenceDist = log.direction !== null ? getFenceDistance(log.direction) : 100;
  const fenceH = 4;
  const { sx: fenceSx } = toSvgCoord(fenceDist, 0);
  const { sy: fenceTopSy } = toSvgCoord(fenceDist, fenceH);
  const { sy: fenceBottomSy } = toSvgCoord(fenceDist, 0);

  const peakIdx = points.reduce((best, p, i) => (p.y > points[best].y ? i : best), 0);
  const peak = points[peakIdx];
  const { sx: peakSx, sy: peakSy } = toSvgCoord(peak.x, peak.y);

  const { sx: landSx } = toSvgCoord(totalDist, 0);
  const { sy: groundSy } = toSvgCoord(0, 0);

  const color = dotColor(log.result);

  const xLabels: number[] = [];
  for (let x = 0; x <= xMax; x += 50) xLabels.push(x);

  // ボールのサイドビュー位置（ball_fly/ball_hr イベント中のみ）
  let sideBallPos: { sx: number; sy: number } | null = null;
  if (currentTime >= 0) {
    const ballEvents = events.filter(e =>
      (e.type === "ball_fly" || e.type === "ball_hr") && e.entityId === "ball"
    );
    for (const e of ballEvents) {
      if (currentTime >= e.startTime && currentTime <= e.startTime + e.duration) {
        const t = (currentTime - e.startTime) / Math.max(e.duration, 0.001);
        const tFlight = getBallFlightTime(log.exitVelocity, Math.max(log.launchAngle, 5));
        const physT = t * tFlight;
        const ptIdx = Math.min(Math.floor(t * points.length), points.length - 1);
        const pt = points[ptIdx];
        const { sx, sy } = toSvgCoord(pt.x, pt.y);
        sideBallPos = { sx, sy };
        break;
      }
    }
  }

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full bg-gray-900 rounded border border-gray-700">
      {xLabels.map(x => {
        const { sx } = toSvgCoord(x, 0);
        return <line key={x} x1={sx} y1={padTop} x2={sx} y2={groundSy} stroke="#374151" strokeWidth="0.5" />;
      })}
      <line x1={padLeft} y1={groundSy} x2={svgW - padRight} y2={groundSy} stroke="#6b7280" strokeWidth="1" />
      {fenceSx >= padLeft && fenceSx <= svgW - padRight && (
        <line x1={fenceSx} y1={fenceTopSy} x2={fenceSx} y2={fenceBottomSy} stroke="#f59e0b" strokeWidth="2" />
      )}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" opacity={currentTime >= 0 ? 0.35 : 1} />
      <circle cx={peakSx} cy={peakSy} r="3" fill={color} opacity={currentTime >= 0 ? 0.35 : 1} />
      <text x={peakSx} y={peakSy - 6} textAnchor="middle" fill="#d1d5db" fontSize="8">
        {peak.y.toFixed(1)}m
      </text>
      <circle cx={landSx} cy={groundSy} r="4" fill={color} opacity={currentTime >= 0 ? 0.35 : 1} />
      {xLabels.map(x => {
        const { sx } = toSvgCoord(x, 0);
        return (
          <text key={x} x={sx} y={groundSy + 12} textAnchor="middle" fill="#9ca3af" fontSize="8">{x}</text>
        );
      })}
      <text x={padLeft - 5} y={padTop + 5} textAnchor="end" fill="#9ca3af" fontSize="8">{yMax.toFixed(0)}m</text>
      <text x={padLeft - 5} y={groundSy + 3} textAnchor="end" fill="#9ca3af" fontSize="8">0</text>
      <text x={landSx} y={groundSy - 6} textAnchor="middle" fill="#d1d5db" fontSize="9" fontWeight="bold">
        {totalDist.toFixed(0)}m
      </text>
      {sideBallPos && (
        <circle cx={sideBallPos.sx} cy={sideBallPos.sy} r={3.5} fill="white" stroke="#ef4444" strokeWidth="1" />
      )}
    </svg>
  );
}

// ---- ポップアップコンテナ ----

export interface BattedBallPopupProps {
  log: AtBatLog;
  batterName: string;
  pitcherName: string;
  onClose: () => void;
}

export function BattedBallPopup({ log, batterName, pitcherName, onClose }: BattedBallPopupProps) {
  const events = buildPlayEvents(log);
  const totalDuration = getTotalDuration(events);
  const { currentTime, playing, play, speed, setSpeed } = usePlayAnimation(totalDuration);

  const hasFieldData = log.direction !== null && log.estimatedDistance != null && log.estimatedDistance > 0;
  const canAnimate = hasFieldData && events.length > 0;

  // ポップアップ表示時に自動1回再生
  useEffect(() => {
    if (canAnimate) {
      const timer = setTimeout(() => play(), 300);
      return () => clearTimeout(timer);
    }
  // play は useCallback で安定しているが、依存に含めないとESLintが警告するため含める
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAnimate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl border border-gray-600" onClick={e => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <span className="text-blue-400 font-bold">{batterName}</span>
            <span className="text-gray-400 mx-2">vs</span>
            <span className="text-gray-300">{pitcherName}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 打球データグリッド */}
        <div className="grid grid-cols-5 gap-3 mb-4 text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">結果</div>
            <div className={`font-bold text-xs ${resultColor(log.result)}`}>{resultNamesJa[log.result] ?? log.result}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">打球速度</div>
            <div className="text-white">{log.exitVelocity != null ? `${log.exitVelocity.toFixed(1)}km/h` : "-"}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">打球角度</div>
            <div className="text-white">{log.launchAngle != null ? `${log.launchAngle.toFixed(1)}°` : "-"}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">方向</div>
            <div className="text-white">{log.direction != null ? `${log.direction.toFixed(1)}°` : "-"}</div>
          </div>
          <div className="bg-gray-700/50 rounded p-2 text-center">
            <div className="text-gray-400 text-xs mb-1">飛距離</div>
            <div className="text-white font-bold">{log.estimatedDistance != null ? `${Math.round(log.estimatedDistance)}m` : "-"}</div>
          </div>
        </div>

        {/* SVGビュー */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-gray-400 text-xs mb-1 text-center">フィールドビュー</div>
            <AnimatedFieldView log={log} events={events} currentTime={currentTime} playing={playing} />
          </div>
          <div>
            <div className="text-gray-400 text-xs mb-1 text-center">軌道（横から）</div>
            <SideView log={log} currentTime={currentTime} events={events} />
          </div>
        </div>

        {/* 再生コントロール */}
        {canAnimate && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              onClick={play}
              disabled={playing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
            >
              {playing ? "再生中..." : "▶ リプレー"}
            </button>
            <div className="flex gap-1 text-xs">
              {([0.5, 1, 2] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2 py-1 rounded transition-colors ${speed === s ? "bg-gray-500 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
