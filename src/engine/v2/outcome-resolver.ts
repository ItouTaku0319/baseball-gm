/**
 * v2エンジン: 打席結果決定ロジック
 *
 * NPB準拠の確率テーブルをベースに、選手スキルで確率を調整して結果を決定する。
 * 物理シミュレーションは行わない — 結果を先に決める「トップダウン」方式。
 */

import type { Player, PitchRepertoire } from "@/models/player";
import {
  HBP_RATE, BB_RATE, K_RATE,
  GB_RATE, FB_RATE, LD_RATE, PU_RATE,
  GB_OUTCOMES, LD_OUTCOMES, FB_OUTCOMES, PU_OUTCOMES,
  SKILL_SCALES,
  DP_RATE_RUNNER_ON_FIRST, SAC_FLY_RATE_RUNNER_ON_THIRD,
} from "./outcome-tables";

// ============================================================
// 型定義
// ============================================================

export type BattedBallType = "ground_ball" | "line_drive" | "fly_ball" | "popup";

export type PAResult =
  | "strikeout" | "walk" | "hit_by_pitch"
  | "single" | "double" | "triple" | "homerun"
  | "groundout" | "flyout" | "lineout" | "popout"
  | "double_play" | "fielders_choice" | "sac_fly"
  | "infield_hit" | "error";

export interface PAOutcome {
  result: PAResult;
  battedBallType: BattedBallType | null;
  /** 打点（走者状況から後で計算） */
  rbis: number;
}

/** 走者状況 */
export interface RunnerState {
  first: boolean;
  second: boolean;
  third: boolean;
}

/** 打席コンテキスト */
export interface PAContext {
  batter: Player;
  pitcher: Player;
  /** 投手の実効能力（疲労込み） */
  pitcherFatigue?: number; // 0-1, 0=フレッシュ, 1=完全疲労
  runners: RunnerState;
  outs: number;
  /** 守備側チームの平均守備力 (0-100) */
  teamFielding?: number;
}

// ============================================================
// ユーティリティ
// ============================================================

/** 0-1のクランプ */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** スキル値(0-100)を中央50基準の偏差に変換 (-0.5 ~ +0.5) */
function skillDelta(value: number): number {
  return (value - 50) / 100;
}

/**
 * 非線形スキルカーブ: 極端な能力値ほど効果が増幅される
 * exponent < 1.0 で中間値の変化を大きく、極端値をさらに強く
 * 例: skillCurve(95, 0.7) = 0.854, skillCurve(50, 0.7) = 0
 */
function skillCurve(value: number, exponent: number = 0.7): number {
  const delta = (value - 50) / 50; // -1.0 ~ +1.0
  const sign = Math.sign(delta);
  return sign * Math.pow(Math.abs(delta), exponent);
}

/**
 * パワー→HR確率: 急勾配の累乗関数で強打者のHRを大幅増
 * P15→~1%, P50→~4%, P65→~7%, P80→~14%, P95→~30%
 */
/**
 * パワー→HR/FB率: 急勾配の累乗関数
 * P15→0.8%, P50→3.3%, P65→6.5%, P80→13%, P95→27%
 */
function powerToHRRate(power: number): number {
  return 0.003 + Math.pow(power / 100, 5.0) * 0.24;
}

/** 重み付きランダム選択 */
function weightedRandom<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [key, weight] of entries) {
    r -= weight;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** 投手の球種からシンカー系の強さを算出 (0-1) */
function getSinkerStrength(pitches: PitchRepertoire[] | undefined): number {
  if (!pitches) return 0;
  let maxLevel = 0;
  for (const p of pitches) {
    if (p.type === "sinker" || p.type === "shoot") {
      maxLevel = Math.max(maxLevel, p.level);
    }
  }
  return maxLevel / 7; // level 1-7 → 0.14-1.0
}

/** 変化球の総合力 (0-100スケール) */
function calcBreakingPower(pitches: PitchRepertoire[] | undefined): number {
  if (!pitches || pitches.length === 0) return 30;
  const total = pitches.reduce((sum, p) => sum + p.level * p.level, 0);
  return Math.min(100, (total / 245) * 130);
}

// ============================================================
// メインロジック
// ============================================================

/**
 * 1打席の結果を決定する
 */
export function resolvePlateAppearance(ctx: PAContext): PAOutcome {
  const { batter, pitcher, runners, outs } = ctx;
  const bat = batter.batting;
  const pit = pitcher.pitching;
  if (!pit) throw new Error("resolvePlateAppearance: pitcher must have pitching abilities");
  const fatigue = ctx.pitcherFatigue ?? 0;

  // 実効能力値（疲労込み）
  const effVelocity = pit.velocity * (1 - fatigue * 0.25);
  const effControl = pit.control * (1 - fatigue * 0.5);
  const breakingPower = calcBreakingPower(pit.pitches);

  // ======== Step 1: 打席結果の大分類 ========

  // 死球率
  const hbpRate = clamp01(
    HBP_RATE + skillDelta(effControl) * SKILL_SCALES.controlToHBP
  );

  // 四球率（投手側のBB%寄与をキャップ: 最大-0.04 = 4%ポイント削減）
  const pitcherBBBonus = Math.max(-0.04,
    skillCurve(effControl) * SKILL_SCALES.controlToBB
  );
  const bbRate = clamp01(
    BB_RATE
    + skillCurve(bat.eye) * SKILL_SCALES.eyeToBB
    + pitcherBBBonus
  );

  // 三振率（非線形: 低ミートほど三振率が急激に上がる）
  // generateVelocityは常に120-165km/hを返す。疲労で120未満になる場合はクランプ。
  // 143km/hが中央値(0.51)になるよう正規化
  const velNorm = Math.max(0, Math.min(1, (effVelocity - 120) / 45));

  // 投手側のK%寄与をキャップ（最大+0.06 = 6%ポイント）して極端なERA低下を防ぐ
  const pitcherKBonus = Math.min(0.06,
    (velNorm - 0.5) * SKILL_SCALES.velocityToK
    + skillCurve(breakingPower) * SKILL_SCALES.breakingToK
    + skillDelta(effControl) * SKILL_SCALES.controlToK
  );

  const kRate = clamp01(
    K_RATE
    + skillCurve(bat.contact) * SKILL_SCALES.contactToK     // 非線形: ミート低い→K%急上昇
    + pitcherKBonus
  );

  // 正規化（合計が1を超えないように）
  const totalPreBIP = hbpRate + bbRate + kRate;
  const bipRate = Math.max(0.30, 1 - totalPreBIP); // 最低30%はインプレー

  // 乱数で大分類を決定
  const roll = Math.random();
  if (roll < hbpRate) {
    return { result: "hit_by_pitch", battedBallType: null, rbis: 0 };
  }
  if (roll < hbpRate + bbRate) {
    return { result: "walk", battedBallType: null, rbis: 0 };
  }
  if (roll < hbpRate + bbRate + kRate) {
    return { result: "strikeout", battedBallType: null, rbis: 0 };
  }

  // ======== Step 2: 打球タイプ ========
  const sinkerStr = getSinkerStrength(pit.pitches);
  const gbAdj = sinkerStr * SKILL_SCALES.sinkerToGB
    + skillDelta(bat.power) * (-0.02); // パワーヒッターはゴロ少なめ
  const fbAdj = skillDelta(bat.power) * SKILL_SCALES.powerToFB;
  const ldAdj = skillDelta(bat.contact) * SKILL_SCALES.contactToLD;

  let gb = clamp01(GB_RATE + gbAdj);
  let fb = clamp01(FB_RATE + fbAdj);
  let ld = clamp01(LD_RATE + ldAdj);
  let pu = clamp01(PU_RATE); // 明示的なポップフライ率

  // 正規化
  const bipTotal = gb + fb + ld + pu;
  gb /= bipTotal; fb /= bipTotal; ld /= bipTotal; pu /= bipTotal;

  const typeRoll = Math.random();
  let battedBallType: BattedBallType;
  if (typeRoll < gb) battedBallType = "ground_ball";
  else if (typeRoll < gb + fb) battedBallType = "fly_ball";
  else if (typeRoll < gb + fb + ld) battedBallType = "line_drive";
  else battedBallType = "popup";

  // ======== Step 3: 打球結果 ========
  const result = resolveInPlayResult(battedBallType, ctx, effControl, breakingPower);
  return { result, battedBallType, rbis: 0 };
}

/**
 * インプレー打球の結果を決定
 */
function resolveInPlayResult(
  type: BattedBallType,
  ctx: PAContext,
  effControl: number,
  breakingPower: number,
): PAResult {
  const { batter, runners, outs } = ctx;
  const bat = batter.batting;
  const teamFielding = ctx.teamFielding ?? 50;

  // 案B: DIPS方式 — 投手のBIP影響を除外（K%とBB%のみで差を表現）
  const pitcherHitSuppression = 0;

  switch (type) {
    case "ground_ball": {
      // ゴロ結果テーブルをスキルで調整
      const hitBonus = skillDelta(bat.contact) * SKILL_SCALES.contactToGBHit;
      const speedBonus = skillDelta(bat.speed) * SKILL_SCALES.speedToInfieldHit;
      const defPenalty = skillDelta(teamFielding) * SKILL_SCALES.fieldingToBABIP;

      let weights = { ...GB_OUTCOMES } as Record<string, number>;
      weights.single = clamp01(weights.single + hitBonus + defPenalty + pitcherHitSuppression);
      weights.infieldHit = clamp01(weights.infieldHit + speedBonus);
      weights.out = clamp01(1 - weights.single - weights.infieldHit
        - weights.double - weights.error - weights.fieldersChoice - weights.doublePlay);

      // 走者1塁時: アウトの一部を併殺に置換
      if (runners.first && outs < 2) {
        const dpRate = DP_RATE_RUNNER_ON_FIRST;
        weights.doublePlay = dpRate;
        weights.out = Math.max(0, weights.out - dpRate + GB_OUTCOMES.doublePlay);
      }

      // 走者あり+アウトの一部をFCに
      if (runners.first || runners.second) {
        weights.fieldersChoice = Math.max(weights.fieldersChoice, 0.03);
      }

      const choice = weightedRandom(weights);
      const resultMap: Record<string, PAResult> = {
        out: "groundout",
        single: "single",
        infieldHit: "infield_hit",
        double: "double",
        error: "error",
        fieldersChoice: "fielders_choice",
        doublePlay: "double_play",
      };
      return resultMap[choice] ?? "groundout";
    }

    case "line_drive": {
      const hitBonus = skillDelta(bat.contact) * SKILL_SCALES.contactToLDHit;
      const defPenalty = skillDelta(teamFielding) * SKILL_SCALES.fieldingToBABIP;
      const powerBonus = skillDelta(bat.power) * SKILL_SCALES.powerToDouble;
      const speedBonus = skillDelta(bat.speed) * SKILL_SCALES.speedToTriple;

      let weights = { ...LD_OUTCOMES } as Record<string, number>;
      weights.single = clamp01(weights.single + hitBonus + defPenalty + pitcherHitSuppression);
      weights.double = clamp01(weights.double + powerBonus * 0.5);
      weights.triple = clamp01(weights.triple + speedBonus * 0.3);
      weights.out = clamp01(1 - weights.single - weights.double
        - weights.triple - weights.homerun - weights.error);

      const choice = weightedRandom(weights);
      const resultMap: Record<string, PAResult> = {
        out: "lineout",
        single: "single",
        double: "double",
        triple: "triple",
        homerun: "homerun",
        error: "error",
      };
      return resultMap[choice] ?? "lineout";
    }

    case "fly_ball": {
      const defPenalty = skillDelta(teamFielding) * SKILL_SCALES.fieldingToBABIP;

      let weights = { ...FB_OUTCOMES } as Record<string, number>;
      // HR率は累乗関数で計算（パワーの影響を非線形に）
      weights.homerun = clamp01(powerToHRRate(bat.power));
      weights.double = clamp01(weights.double + skillDelta(bat.power) * 0.02);
      weights.single = clamp01(weights.single + defPenalty + pitcherHitSuppression);

      // 3塁走者+2アウト未満: フライアウトの一部を犠牲フライに
      if (runners.third && outs < 2) {
        weights.sacFly = SAC_FLY_RATE_RUNNER_ON_THIRD;
      } else {
        weights.sacFly = 0;
      }

      weights.out = clamp01(1 - weights.homerun - weights.double
        - weights.triple - weights.single - weights.sacFly - weights.error);

      const choice = weightedRandom(weights);
      const resultMap: Record<string, PAResult> = {
        out: "flyout",
        homerun: "homerun",
        double: "double",
        triple: "triple",
        single: "single",
        sacFly: "sac_fly",
        error: "error",
      };
      return resultMap[choice] ?? "flyout";
    }

    case "popup": {
      const weights = { ...PU_OUTCOMES } as Record<string, number>;
      const choice = weightedRandom(weights);
      return choice === "error" ? "error" : "popout";
    }

    default:
      return "flyout";
  }
}
