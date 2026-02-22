import type { Player } from "@/models/player";
import type { TeamRecord } from "@/models/team";
import { generateDraftClass } from "./player-generator";
import { calcBreakingPower } from "./simulation";

/**
 * ドラフトシステム
 * 成績の悪いチームから順に指名権を持つ (ウェーバー方式)
 */

/** ドラフト候補リスト */
export interface DraftState {
  /** ドラフト候補の選手リスト */
  prospects: Player[];
  /** 指名順 (チームIDの配列) */
  pickOrder: string[];
  /** 各チームの指名結果 */
  picks: DraftPick[];
  /** 現在の指名順インデックス */
  currentPickIndex: number;
  /** ドラフトのラウンド数 */
  totalRounds: number;
}

export interface DraftPick {
  round: number;
  pickNumber: number;
  teamId: string;
  playerId: string;
}

/** ドラフトを初期化する */
export function initDraft(
  standings: TeamRecord[],
  rounds: number = 5,
  prospectsPerRound: number = 10
): DraftState {
  // 成績の悪い順にソート (ウェーバー方式)
  const sorted = [...standings].sort((a, b) => {
    const aPct = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0.5;
    const bPct = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0.5;
    return aPct - bPct;
  });

  const pickOrder = sorted.map((r) => r.teamId);
  const totalProspects = pickOrder.length * rounds + prospectsPerRound;
  const prospects = generateDraftClass(totalProspects);

  return {
    prospects,
    pickOrder,
    picks: [],
    currentPickIndex: 0,
    totalRounds: rounds,
  };
}

/** 現在の指名チームIDを取得 */
export function getCurrentPickTeam(draft: DraftState): string | null {
  const totalPicks = draft.pickOrder.length * draft.totalRounds;
  if (draft.currentPickIndex >= totalPicks) return null;
  return draft.pickOrder[draft.currentPickIndex % draft.pickOrder.length];
}

/** 指名を実行する */
export function makePick(
  draft: DraftState,
  playerId: string
): DraftState {
  const teamId = getCurrentPickTeam(draft);
  if (!teamId) return draft;

  const round = Math.floor(draft.currentPickIndex / draft.pickOrder.length) + 1;
  const pick: DraftPick = {
    round,
    pickNumber: draft.currentPickIndex + 1,
    teamId,
    playerId,
  };

  return {
    ...draft,
    picks: [...draft.picks, pick],
    prospects: draft.prospects.filter((p) => p.id !== playerId),
    currentPickIndex: draft.currentPickIndex + 1,
  };
}

/** CPUチームの自動指名 (能力値の高い順) */
export function autoPickForCPU(draft: DraftState): DraftState {
  if (draft.prospects.length === 0) return draft;

  // 最も能力値の高い選手を選ぶ
  const best = [...draft.prospects].sort((a, b) => {
    const aScore = a.isPitcher
      ? (((a.pitching?.velocity ?? 120) - 120) / 45) * 100 + (a.pitching?.control ?? 0) + calcBreakingPower(a.pitching?.pitches ?? [])
      : a.batting.contact + a.batting.power + a.batting.speed + a.batting.eye * 0.5;
    const bScore = b.isPitcher
      ? (((b.pitching?.velocity ?? 120) - 120) / 45) * 100 + (b.pitching?.control ?? 0) + calcBreakingPower(b.pitching?.pitches ?? [])
      : b.batting.contact + b.batting.power + b.batting.speed + b.batting.eye * 0.5;
    return bScore - aScore;
  })[0];

  return makePick(draft, best.id);
}
