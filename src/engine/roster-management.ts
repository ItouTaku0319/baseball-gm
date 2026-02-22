import type { Team } from "@/models/team";
import type { RosterLevel } from "@/models/team";
import { ICHI_GUN_MAX, ROSTER_MAX } from "@/models/team";

/**
 * ロスター管理エンジン
 * 1軍/2軍の昇格・降格、ロスター検証
 */

/** 1軍の人数を取得 */
export function getIchiGunCount(team: Team): number {
  if (!team.rosterLevels) return team.roster.length;
  return Object.values(team.rosterLevels).filter((l) => l === "ichi_gun").length;
}

/** 2軍の人数を取得 */
export function getNiGunCount(team: Team): number {
  if (!team.rosterLevels) return 0;
  return Object.values(team.rosterLevels).filter((l) => l === "ni_gun").length;
}

/** 選手を1軍に昇格させる */
export function promotePlayer(
  team: Team,
  playerId: string
): { team: Team; error?: string } {
  if (!team.rosterLevels) {
    return { team, error: "ロスターレベルが未設定です" };
  }

  const currentLevel = team.rosterLevels[playerId];
  if (!currentLevel) return { team, error: "選手が見つかりません" };
  if (currentLevel === "ichi_gun") return { team, error: "既に1軍です" };

  const ichiGunCount = getIchiGunCount(team);
  if (ichiGunCount >= ICHI_GUN_MAX) {
    return { team, error: `1軍は${ICHI_GUN_MAX}人が上限です` };
  }

  return {
    team: {
      ...team,
      rosterLevels: {
        ...team.rosterLevels,
        [playerId]: "ichi_gun" as RosterLevel,
      },
    },
  };
}

/** 選手を2軍に降格させる */
export function demotePlayer(
  team: Team,
  playerId: string
): { team: Team; error?: string } {
  if (!team.rosterLevels) {
    return { team, error: "ロスターレベルが未設定です" };
  }

  const currentLevel = team.rosterLevels[playerId];
  if (!currentLevel) return { team, error: "選手が見つかりません" };
  if (currentLevel === "ni_gun") return { team, error: "既に2軍です" };

  return {
    team: {
      ...team,
      rosterLevels: {
        ...team.rosterLevels,
        [playerId]: "ni_gun" as RosterLevel,
      },
    },
  };
}

/** ロスターの整合性を検証 */
export function validateRoster(team: Team): string[] {
  const errors: string[] = [];

  if (team.roster.length > ROSTER_MAX) {
    errors.push(`ロスターが${ROSTER_MAX}人を超えています (${team.roster.length}人)`);
  }

  if (team.rosterLevels) {
    const ichiGun = getIchiGunCount(team);
    if (ichiGun > ICHI_GUN_MAX) {
      errors.push(`1軍が${ICHI_GUN_MAX}人を超えています (${ichiGun}人)`);
    }

    // 全選手にレベルが設定されているか確認
    for (const p of team.roster) {
      if (!team.rosterLevels[p.id]) {
        errors.push(`${p.name}のロスターレベルが未設定です`);
      }
    }
  }

  return errors;
}
