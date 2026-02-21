import type { Player } from "@/models/player";
import type { Team } from "@/models/team";

/**
 * トレードシステム
 * 選手の交換を管理する
 */

/** トレード提案 */
export interface TradeProposal {
  /** 提案するチームのID */
  fromTeamId: string;
  /** 提案先のチームのID */
  toTeamId: string;
  /** 提案チームが放出する選手のID */
  playersOffered: string[];
  /** 提案先チームに要求する選手のID */
  playersRequested: string[];
}

/** 選手の価値を算出 (トレード交渉の判断基準) */
export function evaluatePlayerValue(player: Player): number {
  let value = 0;

  if (player.isPitcher && player.pitching) {
    value =
      player.pitching.velocity * 1.2 +
      player.pitching.control * 1.0 +
      player.pitching.breaking * 1.1 +
      player.pitching.stamina * 0.5 +
      player.pitching.mentalToughness * 0.3;
  } else {
    value =
      player.batting.contact * 1.0 +
      player.batting.power * 1.2 +
      player.batting.speed * 0.6 +
      player.batting.fielding * 0.4 +
      player.batting.eye * 0.8;
  }

  // 年齢による補正 (若いほど価値が高い)
  if (player.age <= 25) value *= 1.3;
  else if (player.age <= 30) value *= 1.0;
  else if (player.age <= 33) value *= 0.7;
  else value *= 0.4;

  // ポテンシャルによる補正
  const potentialMultiplier: Record<string, number> = {
    S: 1.5,
    A: 1.3,
    B: 1.1,
    C: 1.0,
    D: 0.9,
  };
  value *= potentialMultiplier[player.potential.overall] ?? 1.0;

  return Math.round(value);
}

/** CPUがトレードを受け入れるか判定する */
export function evaluateTradeForCPU(
  proposal: TradeProposal,
  teams: Record<string, Team>
): boolean {
  const toTeam = teams[proposal.toTeamId];
  if (!toTeam) return false;

  // 提案側が出す選手の合計価値
  const offeredValue = proposal.playersOffered.reduce((sum, id) => {
    const player = toTeam.roster.find((p) => p.id === id) ??
      teams[proposal.fromTeamId]?.roster.find((p) => p.id === id);
    // 提案側が出す選手は fromTeam のロスターにいる
    const fromPlayer = teams[proposal.fromTeamId]?.roster.find((p) => p.id === id);
    return sum + (fromPlayer ? evaluatePlayerValue(fromPlayer) : 0);
  }, 0);

  // 要求された選手の合計価値
  const requestedValue = proposal.playersRequested.reduce((sum, id) => {
    const player = toTeam.roster.find((p) => p.id === id);
    return sum + (player ? evaluatePlayerValue(player) : 0);
  }, 0);

  // 提案側の価値が要求側の90%以上ならOK (CPUは少し甘め)
  return offeredValue >= requestedValue * 0.9;
}

/** トレードを実行する (ロスターの選手を入れ替え) */
export function executeTrade(
  proposal: TradeProposal,
  teams: Record<string, Team>
): Record<string, Team> {
  const fromTeam = { ...teams[proposal.fromTeamId] };
  const toTeam = { ...teams[proposal.toTeamId] };

  const offeredPlayers = fromTeam.roster.filter((p) =>
    proposal.playersOffered.includes(p.id)
  );
  const requestedPlayers = toTeam.roster.filter((p) =>
    proposal.playersRequested.includes(p.id)
  );

  fromTeam.roster = [
    ...fromTeam.roster.filter((p) => !proposal.playersOffered.includes(p.id)),
    ...requestedPlayers,
  ];
  toTeam.roster = [
    ...toTeam.roster.filter((p) => !proposal.playersRequested.includes(p.id)),
    ...offeredPlayers,
  ];

  return {
    ...teams,
    [fromTeam.id]: fromTeam,
    [toTeam.id]: toTeam,
  };
}
