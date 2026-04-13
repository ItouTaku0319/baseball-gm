/**
 * v2エンジン: NPB準拠の確率テーブル
 *
 * 全確率はリーグ平均を基準とし、選手スキルで調整する。
 * データソース: NPB 2019-2023平均、baseball-knowledge.md
 */

// ============================================================
// 打席結果の基本確率（リーグ平均、対PA比）
// ============================================================

/** 死球率 (NPB ~1.0%) */
export const HBP_RATE = 0.010;

/** 四球率 (NPB ~8.0%) */
export const BB_RATE = 0.080;

/**
 * 三振率ベース値 (0.305 = 30.5%)
 *
 * NPBリーグK%は18-22%だが、この値はskill=50（能力値中央）の
 * 打者vs投手を基準にしている。テストチーム(ability~65)では
 * 非線形skillCurveによりK%が19%前後に落ち着く。
 *
 * 計算例: contact=65 → skillCurve(65)*-0.14 ≈ -0.058
 *         velocity=143km/h → velNorm=0.51, pitcherKBonus ≈ +0.01〜+0.03
 *         → 実効K% ≈ 0.305 - 0.058 + 0.02 = 0.267
 *         ただし実ゲームでは対戦相手の投手能力分布により19-22%前後に収束
 */
export const K_RATE = 0.305;

// ============================================================
// 打球タイプ分布（対BIP比）
// ============================================================

/** ゴロ率 (NPB 42-48%, 中央45%) */
export const GB_RATE = 0.430;

/** フライ率 (NPB 30-38%) */
export const FB_RATE = 0.330;

/** ライナー率 (NPB 19-22%) */
export const LD_RATE = 0.200;

/** ポップフライ率 (IFFB% = PU/(FB+PU) ≈ 10%) */
export const PU_RATE = 0.040;

// ============================================================
// 打球タイプ別の結果確率
// ============================================================

/**
 * ゴロの結果分布
 * NPB: ゴロヒット率 ~.240、併殺率 ~.110（走者1塁時）
 */
export const GB_OUTCOMES = {
  out: 0.690,         // ゴロアウト
  single: 0.200,      // 単打（外野抜け）
  infieldHit: 0.030,  // 内野安打
  double: 0.020,      // 二塁打（ライン際抜け）
  error: 0.015,       // エラー出塁
  fieldersChoice: 0.025, // フィルダースチョイス
  doublePlay: 0.020,  // 併殺（基本値、走者状況で上書き）
} as const;

/**
 * ライナーの結果分布
 * NPB: ライナーヒット率 ~.680
 */
export const LD_OUTCOMES = {
  out: 0.275,       // ライナーアウト
  single: 0.425,    // 単打
  double: 0.235,    // 二塁打
  triple: 0.020,    // 三塁打
  homerun: 0.015,   // ライナー性HR
  error: 0.030,     // エラー
} as const;

/**
 * フライの結果分布
 */
export const FB_OUTCOMES = {
  out: 0.815,       // フライアウト
  homerun: 0.040,   // 本塁打ベース (スキル補正後 ~7-10%)
  double: 0.070,    // 二塁打（フェンス際）
  triple: 0.015,    // 三塁打（深いギャップ）
  single: 0.035,    // 単打（テキサスリーガー）
  sacFly: 0.015,    // 犠牲フライ（3塁走者時に上書き）
  error: 0.010,     // エラー
} as const;

/**
 * ポップフライの結果分布
 * ほぼ確実にアウト
 */
export const PU_OUTCOMES = {
  out: 0.975,
  error: 0.025,
} as const;

// ============================================================
// スキル影響の調整係数
// ============================================================

export const SKILL_SCALES = {
  // === 打席結果の大分類 ===
  /** ミート → 三振率 (非線形: ミート25→K%+12pt, ミート90→K%-10pt) */
  contactToK: -0.14,
  /** 球速 → 三振率 */
  velocityToK: 0.14,
  /** 変化球 → 三振率 (非線形) */
  breakingToK: 0.08,
  /** 制球 → 三振率 (制球良い = ゾーン内勝負 = K増) */
  controlToK: 0.04,
  /** 選球眼 → 四球率 (非線形: eye80→BB12%, eye20→BB5%) */
  eyeToBB: 0.06,
  /** 制球 → 四球率 (非線形) */
  controlToBB: -0.06,
  /** 制球 → 死球率 */
  controlToHBP: -0.006,

  // === BIP内の結果 ===
  /** パワー → HR/FB: powerToHRRate()で二次関数計算するため未使用 */
  powerToHRFB: 0.06,
  /** ミート → ゴロヒット率 */
  contactToGBHit: 0.05,
  /** ミート → ライナーヒット率 */
  contactToLDHit: 0.05,
  /** 走力 → 内野安打率 */
  speedToInfieldHit: 0.04,
  /** 制球 → BIPヒット率抑制 (非線形) */
  controlToHitRate: -0.03,
  /** 変化球 → BIPヒット率抑制 (非線形) */
  breakingToHitRate: -0.02,

  // === 打球タイプ分布 ===
  /** シンカー系 → ゴロ率増加 */
  sinkerToGB: 0.08,
  /** パワー → フライ率増加 */
  powerToFB: 0.04,
  /** ミート → ライナー率増加 */
  contactToLD: 0.03,

  // === その他 ===
  /** 守備力（チーム平均） → BABIP抑制 */
  fieldingToBABIP: -0.03,
  /** 走力 → 三塁打率 */
  speedToTriple: 0.02,
  /** パワー → 二塁打率 */
  powerToDouble: 0.03,
} as const;

// ============================================================
// 走者状況別の修正
// ============================================================

/** 走者1塁時のゴロ併殺確率 (通常アウトの一部が併殺に置換) */
export const DP_RATE_RUNNER_ON_FIRST = 0.12;

/** 走者3塁+2アウト未満のフライ → 犠牲フライ確率 */
export const SAC_FLY_RATE_RUNNER_ON_THIRD = 0.08;

// ============================================================
// 走者進塁確率
// ============================================================

/** 単打時: 2塁走者がホームに帰る基本確率 (NPB ~50-55%) */
export const RUNNER_2B_SCORE_ON_SINGLE_BASE = 0.20;
export const RUNNER_2B_SCORE_ON_SINGLE_SPEED_SCALE = 0.35;

/** 単打時: 1塁走者が3塁に進む基本確率 (NPB ~25%) */
export const RUNNER_1B_TO_3B_ON_SINGLE_BASE = 0.08;
export const RUNNER_1B_TO_3B_ON_SINGLE_SPEED_SCALE = 0.25;

/** 二塁打時: 1塁走者がホームに帰る基本確率 (NPB ~40%) */
export const RUNNER_1B_SCORE_ON_DOUBLE_BASE = 0.15;
export const RUNNER_1B_SCORE_ON_DOUBLE_SPEED_SCALE = 0.30;
