import type { GameState } from "@/models/game-state";
import type { Player } from "@/models/player";
import type { Team } from "@/models/team";

/**
 * 春季キャンプエンジン
 * ポテンシャルに基づく成長/衰退の適用
 */

export interface CampReport {
  improvements: { playerName: string; detail: string }[];
  declines: { playerName: string; detail: string }[];
}

/** 春季キャンプを実行し、能力変化を適用する */
export function runSpringCamp(state: GameState): {
  state: GameState;
  reports: Record<string, CampReport>;
} {
  const reports: Record<string, CampReport> = {};
  const newTeams = { ...state.teams };

  for (const [teamId, team] of Object.entries(newTeams)) {
    const report: CampReport = { improvements: [], declines: [] };
    const newRoster = team.roster.map((player) => {
      const result = applyCampTraining(player);
      if (result.improved.length > 0) {
        report.improvements.push({
          playerName: player.name,
          detail: result.improved.join("、"),
        });
      }
      if (result.declined.length > 0) {
        report.declines.push({
          playerName: player.name,
          detail: result.declined.join("、"),
        });
      }
      return result.player;
    });

    newTeams[teamId] = { ...team, roster: newRoster };
    reports[teamId] = report;
  }

  return {
    state: { ...state, teams: newTeams, updatedAt: new Date().toISOString() },
    reports,
  };
}

/** 個別選手のキャンプ訓練結果 */
function applyCampTraining(player: Player): {
  player: Player;
  improved: string[];
  declined: string[];
} {
  const improved: string[] = [];
  const declined: string[] = [];

  const potentialGrowth: Record<string, number> = {
    S: 5, A: 3, B: 2, C: 1, D: 0,
  };
  const maxGrowth = potentialGrowth[player.potential.overall] ?? 1;

  // 若手は成長しやすい
  const ageFactor = player.age <= 24 ? 1.5 : player.age <= 28 ? 1.0 : player.age <= 32 ? 0.3 : 0;
  // ベテラン衰退
  const declineFactor = player.age >= 34 ? 1.5 : player.age >= 32 ? 0.5 : 0;

  const newBatting = { ...player.batting };
  let newPitching = player.pitching ? { ...player.pitching } : null;

  if (ageFactor > 0 && maxGrowth > 0) {
    // 打撃能力の成長
    const batKeys: { key: keyof typeof newBatting; label: string }[] = [
      { key: "contact", label: "ミート" },
      { key: "power", label: "パワー" },
      { key: "speed", label: "走力" },
      { key: "fielding", label: "守備力" },
      { key: "eye", label: "選球眼" },
    ];

    for (const { key, label } of batKeys) {
      if (Math.random() < 0.25 * ageFactor) {
        const amount = Math.round((1 + Math.random() * maxGrowth) * ageFactor);
        if (amount > 0) {
          newBatting[key] = Math.min(100, newBatting[key] + amount);
          improved.push(`${label}+${amount}`);
        }
      }
    }

    // 投手能力の成長
    if (newPitching) {
      if (Math.random() < 0.3 * ageFactor) {
        const amount = Math.round((1 + Math.random() * maxGrowth) * ageFactor * 0.5);
        if (amount > 0) {
          newPitching.control = Math.min(100, newPitching.control + amount);
          improved.push(`制球+${amount}`);
        }
      }
      if (Math.random() < 0.15 * ageFactor) {
        const amount = Math.max(1, Math.round(Math.random() * 2));
        newPitching.velocity = Math.min(165, newPitching.velocity + amount);
        improved.push(`球速+${amount}`);
      }
    }
  }

  if (declineFactor > 0) {
    const amount = Math.round((1 + Math.random() * 2) * declineFactor);
    if (Math.random() < 0.5) {
      newBatting.speed = Math.max(1, newBatting.speed - amount);
      declined.push(`走力-${amount}`);
    }
    if (Math.random() < 0.3) {
      newBatting.contact = Math.max(1, newBatting.contact - Math.round(amount * 0.5));
      declined.push(`ミート-${Math.round(amount * 0.5)}`);
    }
    if (newPitching && Math.random() < 0.4) {
      const velDec = Math.max(1, Math.round(amount * 0.5));
      newPitching.velocity = Math.max(120, newPitching.velocity - velDec);
      declined.push(`球速-${velDec}`);
    }
  }

  return {
    player: { ...player, batting: newBatting, pitching: newPitching },
    improved,
    declined,
  };
}
