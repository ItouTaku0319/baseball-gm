import type { GameState } from "@/models/game-state";
import type { Player } from "@/models/player";
import type { Team } from "@/models/team";

/**
 * 契約更改・加齢エンジン
 */

/** 全選手の年齢+1、contractYears-1 を処理する */
export function processContractRenewal(state: GameState): {
  state: GameState;
  retired: string[];   // 退団した選手名
  renewed: string[];   // 更新した選手名
} {
  const retired: string[] = [];
  const renewed: string[] = [];
  const newTeams = { ...state.teams };

  for (const [teamId, team] of Object.entries(newTeams)) {
    const isMyTeam = teamId === state.myTeamId;
    const newRoster: Player[] = [];
    const newLevels = { ...(team.rosterLevels || {}) };

    for (const player of team.roster) {
      const newAge = player.age + 1;
      const newContractYears = player.contractYears - 1;

      if (newContractYears <= 0) {
        // 契約切れ
        if (isMyTeam) {
          // 自チーム: 自動で1年契約更新 (簡易版)
          const renewedPlayer = {
            ...player,
            age: newAge,
            contractYears: 1,
            salary: Math.round(player.salary * 1.05),
          };
          newRoster.push(applyAging(renewedPlayer));
          renewed.push(player.name);
        } else {
          // CPUチーム: 35歳以上は退団、それ以外は自動更新
          if (newAge >= 35 && Math.random() < 0.6) {
            retired.push(player.name);
            delete newLevels[player.id];
            continue;
          }
          const renewedPlayer = {
            ...player,
            age: newAge,
            contractYears: 1 + Math.floor(Math.random() * 2),
            salary: Math.round(player.salary * (0.9 + Math.random() * 0.3)),
          };
          newRoster.push(applyAging(renewedPlayer));
        }
      } else {
        // 契約継続
        const updatedPlayer = {
          ...player,
          age: newAge,
          contractYears: newContractYears,
        };
        newRoster.push(applyAging(updatedPlayer));
      }
    }

    newTeams[teamId] = {
      ...team,
      roster: newRoster,
      rosterLevels: newLevels,
    };
  }

  return {
    state: { ...state, teams: newTeams, updatedAt: new Date().toISOString() },
    retired,
    renewed,
  };
}

/** 年齢に基づく成長/衰退を適用する */
function applyAging(player: Player): Player {
  const age = player.age;
  let newPlayer = { ...player };

  if (age <= 26) {
    // 若手: 成長
    newPlayer = applyGrowth(newPlayer);
  } else if (age >= 33) {
    // ベテラン: 衰退
    newPlayer = applyDecline(newPlayer);
  }
  // 27-32: 全盛期、変化なし

  return newPlayer;
}

/** 成長処理 */
function applyGrowth(player: Player): Player {
  const potentialMultiplier: Record<string, number> = {
    S: 4, A: 3, B: 2, C: 1, D: 0.5,
  };
  const mult = potentialMultiplier[player.potential.overall] ?? 1;
  const growthAmount = Math.round(mult * (1 + Math.random() * 2));

  const newBatting = { ...player.batting };
  // ランダムに2-3の能力を成長
  const batKeys: (keyof typeof newBatting)[] = ["contact", "power", "speed", "arm", "fielding", "catching", "eye"];
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    const key = batKeys[Math.floor(Math.random() * batKeys.length)];
    newBatting[key] = Math.min(100, newBatting[key] + growthAmount);
  }

  let newPitching = player.pitching;
  if (newPitching) {
    newPitching = { ...newPitching };
    const pitchGrowth = Math.round(mult * (1 + Math.random()));
    if (Math.random() < 0.5) {
      newPitching.control = Math.min(100, newPitching.control + pitchGrowth);
    }
    if (Math.random() < 0.3) {
      newPitching.velocity = Math.min(165, newPitching.velocity + Math.round(pitchGrowth * 0.5));
    }
    if (Math.random() < 0.4) {
      newPitching.stamina = Math.min(100, newPitching.stamina + pitchGrowth);
    }
  }

  return { ...player, batting: newBatting, pitching: newPitching };
}

/** 衰退処理 */
function applyDecline(player: Player): Player {
  const age = player.age;
  const declineAmount = Math.max(1, Math.round((age - 32) * 1.5 * (0.5 + Math.random())));

  const newBatting = { ...player.batting };
  const batKeys: (keyof typeof newBatting)[] = ["contact", "power", "speed", "arm", "fielding", "catching", "eye"];
  // 足から衰える
  newBatting.speed = Math.max(1, newBatting.speed - Math.round(declineAmount * 1.5));
  for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
    const key = batKeys[Math.floor(Math.random() * batKeys.length)];
    newBatting[key] = Math.max(1, newBatting[key] - declineAmount);
  }

  let newPitching = player.pitching;
  if (newPitching) {
    newPitching = { ...newPitching };
    if (Math.random() < 0.6) {
      newPitching.velocity = Math.max(120, newPitching.velocity - Math.round(declineAmount * 0.5));
    }
    if (Math.random() < 0.4) {
      newPitching.stamina = Math.max(1, newPitching.stamina - declineAmount);
    }
  }

  return { ...player, batting: newBatting, pitching: newPitching };
}
