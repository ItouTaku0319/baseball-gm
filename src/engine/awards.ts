import type { GameState, AwardEntry, SeasonAwards } from "@/models/game-state";
import type { Player } from "@/models/player";
import type { Team } from "@/models/team";

/**
 * 表彰計算エンジン
 * NPB準拠のシーズンタイトルを計算する
 */

interface PlayerWithTeam {
  player: Player;
  teamId: string;
  leagueId: string;
}

function formatIP(outs: number): string {
  const full = Math.floor(outs / 3);
  const remainder = outs % 3;
  return remainder === 0 ? `${full}` : `${full}.${remainder}`;
}

/** シーズンの表彰を計算する */
export function calculateAwards(state: GameState): SeasonAwards {
  const year = state.currentSeason.year;
  const leagues = state.currentSeason.leagues;

  const teamLeagueMap = new Map<string, string>();
  for (const league of leagues) {
    for (const teamId of league.teams) {
      teamLeagueMap.set(teamId, league.id);
    }
  }

  // チームの試合数を取得
  const teamGames = new Map<string, number>();
  for (const [teamId, record] of Object.entries(state.currentSeason.standings)) {
    teamGames.set(teamId, record.wins + record.losses + record.draws);
  }

  // 全選手を収集
  const allPlayers: PlayerWithTeam[] = [];
  for (const [teamId, team] of Object.entries(state.teams)) {
    for (const player of team.roster) {
      allPlayers.push({
        player,
        teamId,
        leagueId: teamLeagueMap.get(teamId) || "",
      });
    }
  }

  const centralAwards = calculateLeagueAwards(
    allPlayers.filter((p) => p.leagueId === "central"),
    year,
    teamGames
  );
  const pacificAwards = calculateLeagueAwards(
    allPlayers.filter((p) => p.leagueId === "pacific"),
    year,
    teamGames
  );

  // 日本シリーズMVP
  let japanSeriesMvp: AwardEntry | undefined;
  const playoffs = state.currentSeason.playoffs;
  if (playoffs) {
    const js = playoffs.find((s) => s.type === "japan_series");
    if (js?.winnerId) {
      // 勝利チームの最も活躍した打者をMVPに
      const winnerTeam = state.teams[js.winnerId];
      if (winnerTeam) {
        const batters = winnerTeam.roster.filter((p) => !p.isPitcher);
        const bestBatter = batters.reduce((best, p) => {
          const s = p.careerBattingStats[year];
          if (!s) return best;
          const score = s.hits + s.homeRuns * 3 + s.rbi * 2;
          const bestS = best?.careerBattingStats[year];
          const bestScore = bestS ? bestS.hits + bestS.homeRuns * 3 + bestS.rbi * 2 : -1;
          return score > bestScore ? p : best;
        }, null as Player | null);

        if (bestBatter) {
          const s = bestBatter.careerBattingStats[year];
          japanSeriesMvp = {
            title: "日本シリーズMVP",
            playerId: bestBatter.id,
            playerName: bestBatter.name,
            teamId: js.winnerId,
            value: s ? `${s.hits}安打 ${s.homeRuns}本塁打 ${s.rbi}打点` : "",
          };
        }
      }
    }
  }

  return {
    year,
    central: centralAwards,
    pacific: pacificAwards,
    japanSeriesMvp,
  };
}

function calculateLeagueAwards(
  players: PlayerWithTeam[],
  year: number,
  teamGames: Map<string, number>
): AwardEntry[] {
  const awards: AwardEntry[] = [];

  const batters = players.filter((p) => !p.player.isPitcher);
  const pitcherPlayers = players.filter((p) => p.player.isPitcher);

  // 規定打席
  const qualifiedBatters = batters.filter((p) => {
    const s = p.player.careerBattingStats[year];
    if (!s) return false;
    const g = teamGames.get(p.teamId) || 0;
    const pa = s.atBats + s.walks;
    return pa >= Math.floor(g * 3.1);
  });

  // 規定投球回
  const qualifiedPitchers = pitcherPlayers.filter((p) => {
    const s = p.player.careerPitchingStats[year];
    if (!s) return false;
    const g = teamGames.get(p.teamId) || 0;
    return s.inningsPitched >= g * 3;
  });

  // ── 打者タイトル ──
  const addBatterAward = (
    title: string,
    pool: PlayerWithTeam[],
    getValue: (p: PlayerWithTeam) => number,
    format: (p: PlayerWithTeam) => string,
    ascending = false
  ) => {
    if (pool.length === 0) return;
    const sorted = [...pool].sort((a, b) =>
      ascending ? getValue(a) - getValue(b) : getValue(b) - getValue(a)
    );
    const best = sorted[0];
    awards.push({
      title,
      playerId: best.player.id,
      playerName: best.player.name,
      teamId: best.teamId,
      value: format(best),
    });
  };

  // MVP (最高WAR的な指標 - 簡易版)
  addBatterAward(
    "MVP",
    batters,
    (p) => {
      const s = p.player.careerBattingStats[year];
      if (!s) return 0;
      return s.hits * 1 + s.homeRuns * 4 + s.rbi * 2 + s.stolenBases * 1.5 + s.walks * 0.5;
    },
    (p) => {
      const s = p.player.careerBattingStats[year]!;
      return `${s.hits}安 ${s.homeRuns}本 ${s.rbi}打点`;
    }
  );

  // 首位打者
  addBatterAward(
    "首位打者",
    qualifiedBatters,
    (p) => {
      const s = p.player.careerBattingStats[year]!;
      return s.hits / s.atBats;
    },
    (p) => {
      const s = p.player.careerBattingStats[year]!;
      return (s.hits / s.atBats).toFixed(3).replace(/^0/, "");
    }
  );

  // 本塁打王
  addBatterAward(
    "本塁打王",
    batters,
    (p) => p.player.careerBattingStats[year]?.homeRuns ?? 0,
    (p) => `${p.player.careerBattingStats[year]?.homeRuns ?? 0}本`
  );

  // 打点王
  addBatterAward(
    "打点王",
    batters,
    (p) => p.player.careerBattingStats[year]?.rbi ?? 0,
    (p) => `${p.player.careerBattingStats[year]?.rbi ?? 0}打点`
  );

  // 盗塁王
  addBatterAward(
    "盗塁王",
    batters,
    (p) => p.player.careerBattingStats[year]?.stolenBases ?? 0,
    (p) => `${p.player.careerBattingStats[year]?.stolenBases ?? 0}盗塁`
  );

  // 最多安打
  addBatterAward(
    "最多安打",
    batters,
    (p) => p.player.careerBattingStats[year]?.hits ?? 0,
    (p) => `${p.player.careerBattingStats[year]?.hits ?? 0}安打`
  );

  // ── 投手タイトル ──
  const addPitcherAward = (
    title: string,
    pool: PlayerWithTeam[],
    getValue: (p: PlayerWithTeam) => number,
    format: (p: PlayerWithTeam) => string,
    ascending = false
  ) => {
    if (pool.length === 0) return;
    const sorted = [...pool].sort((a, b) =>
      ascending ? getValue(a) - getValue(b) : getValue(b) - getValue(a)
    );
    const best = sorted[0];
    awards.push({
      title,
      playerId: best.player.id,
      playerName: best.player.name,
      teamId: best.teamId,
      value: format(best),
    });
  };

  // 最優秀防御率
  addPitcherAward(
    "最優秀防御率",
    qualifiedPitchers,
    (p) => {
      const s = p.player.careerPitchingStats[year]!;
      const ip = s.inningsPitched / 3;
      return ip > 0 ? (s.earnedRuns / ip) * 9 : 99;
    },
    (p) => {
      const s = p.player.careerPitchingStats[year]!;
      const ip = s.inningsPitched / 3;
      return ((s.earnedRuns / ip) * 9).toFixed(2);
    },
    true
  );

  // 最多勝
  addPitcherAward(
    "最多勝",
    pitcherPlayers,
    (p) => p.player.careerPitchingStats[year]?.wins ?? 0,
    (p) => `${p.player.careerPitchingStats[year]?.wins ?? 0}勝`
  );

  // 最高勝率
  addPitcherAward(
    "最高勝率",
    qualifiedPitchers.filter((p) => {
      const s = p.player.careerPitchingStats[year];
      return s && s.wins + s.losses >= 10;
    }),
    (p) => {
      const s = p.player.careerPitchingStats[year]!;
      return s.wins / (s.wins + s.losses);
    },
    (p) => {
      const s = p.player.careerPitchingStats[year]!;
      return (s.wins / (s.wins + s.losses)).toFixed(3).replace(/^0/, "");
    }
  );

  // 最多奪三振
  addPitcherAward(
    "最多奪三振",
    pitcherPlayers,
    (p) => p.player.careerPitchingStats[year]?.strikeouts ?? 0,
    (p) => `${p.player.careerPitchingStats[year]?.strikeouts ?? 0}奪三振`
  );

  // 最多セーブ
  addPitcherAward(
    "最多セーブ",
    pitcherPlayers,
    (p) => p.player.careerPitchingStats[year]?.saves ?? 0,
    (p) => `${p.player.careerPitchingStats[year]?.saves ?? 0}セーブ`
  );

  return awards;
}
