import type { Player } from "@/models/player";
import type { Team, TeamLineupConfig, RosterLevel, PitcherUsageConfig } from "@/models/team";
import { calcBreakingPower } from "./simulation";

/**
 * CPU用の自動配置ロジック
 * 打順・ローテーション・リリーフ役割を自動設定する
 */

/** 1軍選手のみ取得 */
export function getIchiGunPlayers(team: Team): Player[] {
  if (!team.rosterLevels) return team.roster;
  return team.roster.filter(
    (p) => !team.rosterLevels || team.rosterLevels[p.id] === "ichi_gun"
  );
}

/** 1軍の投手を取得 */
function getIchiGunPitchers(team: Team): Player[] {
  return getIchiGunPlayers(team).filter((p) => p.isPitcher);
}

/** 1軍の野手を取得 */
function getIchiGunBatters(team: Team): Player[] {
  return getIchiGunPlayers(team).filter((p) => !p.isPitcher);
}

/** 投手のスコアを算出 (高いほど優秀) */
function pitcherScore(p: Player): number {
  if (!p.pitching) return 0;
  const vel = ((p.pitching.velocity - 120) / 45) * 100;
  const brk = calcBreakingPower(p.pitching.pitches);
  return vel * 1.0 + p.pitching.control * 1.0 + brk * 0.8 + p.pitching.stamina * 0.5;
}

/** 先発向きスコア (スタミナ重視) */
function starterScore(p: Player): number {
  if (!p.pitching) return 0;
  return pitcherScore(p) + p.pitching.stamina * 1.5;
}

/** リリーフ向きスコア (球速・決め球重視) */
function relieverScore(p: Player): number {
  if (!p.pitching) return 0;
  const vel = ((p.pitching.velocity - 120) / 45) * 100;
  const brk = calcBreakingPower(p.pitching.pitches);
  return vel * 1.5 + brk * 1.2 + p.pitching.control * 0.8 + p.pitching.mentalToughness * 0.5;
}

/** 打者の打撃スコアを算出 */
function batterOffenseScore(p: Player): number {
  return p.batting.contact * 1.0 + p.batting.power * 1.2 + p.batting.speed * 0.5 + p.batting.eye * 0.8;
}

/** チームのlineupConfigを自動設定する */
export function autoConfigureLineup(team: Team): TeamLineupConfig {
  const pitchers = getIchiGunPitchers(team);
  const batters = getIchiGunBatters(team);

  // 先発ローテ: スタミナ重視で上位5-6人
  const starterCandidates = [...pitchers].sort((a, b) => starterScore(b) - starterScore(a));
  const rotationSize = Math.min(6, Math.max(1, starterCandidates.length));
  const rotation = starterCandidates.slice(0, rotationSize).map((p) => p.id);

  // リリーフ候補: ローテに入らない投手をリリーフスコア順
  const rotationSet = new Set(rotation);
  const relievers = pitchers
    .filter((p) => !rotationSet.has(p.id))
    .sort((a, b) => relieverScore(b) - relieverScore(a));

  // リリーフリスト (MAX 8)
  const relieverIds = relievers.slice(0, 8).map((p) => p.id);

  // 投手個別起用設定
  const pitcherUsages: Record<string, PitcherUsageConfig> = {};

  // 先発は全員 performance デフォルト
  for (const id of rotation) {
    pitcherUsages[id] = { starterPolicy: "performance" };
  }

  // リリーフはランク順にポリシー割当
  relieverIds.forEach((id, i) => {
    if (i === 0) {
      pitcherUsages[id] = { relieverPolicy: "closer", maxInnings: 1 };
    } else if (i <= 2) {
      pitcherUsages[id] = { relieverPolicy: "close_game", maxInnings: 1 };
    } else if (i <= 5) {
      pitcherUsages[id] = { relieverPolicy: "behind_ok", maxInnings: 1 };
    } else {
      pitcherUsages[id] = { relieverPolicy: "mop_up", maxInnings: 1 };
    }
  });

  // 打順
  const battingOrder = buildBattingOrder(batters);

  // 旧フィールドも互換のため設定
  const closerId = relieverIds.length > 0 ? relieverIds[0] : null;
  const setupIds = relieverIds.slice(1, 3);

  return {
    battingOrder,
    startingRotation: rotation,
    relieverIds,
    closerId,
    setupIds,
    rotationIndex: 0,
    pitcherUsages,
  };
}

/** 9人の打順を自動構成する */
function buildBattingOrder(batters: Player[]): string[] {
  if (batters.length === 0) return [];

  // ポジション別に優先選手を選ぶ
  const sorted = [...batters].sort((a, b) => batterOffenseScore(b) - batterOffenseScore(a));
  const selected = sorted.slice(0, 9);

  if (selected.length < 9) return selected.map((p) => p.id);

  // 打順の特性で並び替え
  // 1番: 出塁率・足
  // 2番: ミート・選球眼
  // 3番: バランス型
  // 4番: パワー最強
  // 5番: パワー2番目
  // 6-9番: 残り

  const pool = [...selected];

  const pick = (scoreFn: (p: Player) => number): Player => {
    pool.sort((a, b) => scoreFn(b) - scoreFn(a));
    return pool.splice(0, 1)[0];
  };

  const order: Player[] = [];

  // 4番: 最強パワーヒッター
  order[3] = pick((p) => p.batting.power * 2.0 + p.batting.contact * 0.5);
  // 1番: 出塁・足
  order[0] = pick((p) => p.batting.speed * 1.5 + p.batting.eye * 1.2 + p.batting.contact * 0.8);
  // 3番: バランス型
  order[2] = pick((p) => p.batting.contact * 1.0 + p.batting.power * 1.5 + p.batting.eye * 0.5);
  // 5番: パワー
  order[4] = pick((p) => p.batting.power * 1.5 + p.batting.contact * 0.8);
  // 2番: ミート・選球眼
  order[1] = pick((p) => p.batting.contact * 1.5 + p.batting.eye * 1.0 + p.batting.speed * 0.5);
  // 6-9番: 残りを打力順
  pool.sort((a, b) => batterOffenseScore(b) - batterOffenseScore(a));
  order[5] = pool[0];
  order[6] = pool[1];
  order[7] = pool[2];
  order[8] = pool[3];

  return order.map((p) => p.id);
}

/** ロスターレベルの自動割り当て (1軍/2軍) */
export function autoAssignRosterLevels(team: Team): Record<string, RosterLevel> {
  const levels: Record<string, RosterLevel> = {};
  const pitchers = team.roster.filter((p) => p.isPitcher);
  const batters = team.roster.filter((p) => !p.isPitcher);

  // 投手: 上位12人を1軍
  const sortedPitchers = [...pitchers].sort((a, b) => pitcherScore(b) - pitcherScore(a));
  sortedPitchers.forEach((p, i) => {
    levels[p.id] = i < 12 ? "ichi_gun" : "ni_gun";
  });

  // 野手: 各守備位置から最低1人を1軍に確保 + 残りを打力順で埋める
  const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
  const guaranteedIds = new Set<string>();

  // Step 1: 各ポジションのベスト1人を確保
  for (const pos of FIELD_POSITIONS) {
    const candidates = batters.filter((p) => p.position === pos);
    if (candidates.length === 0) continue;
    const best = [...candidates].sort((a, b) => batterOffenseScore(b) - batterOffenseScore(a))[0];
    guaranteedIds.add(best.id);
  }

  // Step 2: 残り枠を打力順で埋める
  const remaining = batters
    .filter((p) => !guaranteedIds.has(p.id))
    .sort((a, b) => batterOffenseScore(b) - batterOffenseScore(a));
  const remainingSlots = Math.max(0, 16 - guaranteedIds.size);
  const additionalIds = new Set(remaining.slice(0, remainingSlots).map((p) => p.id));

  // Step 3: レベル割り当て
  for (const p of batters) {
    levels[p.id] = guaranteedIds.has(p.id) || additionalIds.has(p.id) ? "ichi_gun" : "ni_gun";
  }

  return levels;
}
