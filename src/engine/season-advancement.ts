import type { GameState } from "@/models/game-state";
import type { GameResult, PlayerGameStats, PitcherGameLog } from "@/models/league";
import type { Team } from "@/models/team";
import type { TeamRecord } from "@/models/team";
import { emptyBatterStats, emptyPitcherStats } from "@/models/player";
import { simulateGame } from "./simulation";

/**
 * シーズン進行エンジン
 *
 * 純粋関数で GameState を受け取り、新しい GameState を返す。
 */

/** シーズンを開始する (preseason → regular_season) */
export function startSeason(state: GameState): GameState {
  if (state.currentSeason.phase !== "preseason") return state;
  return {
    ...state,
    currentSeason: {
      ...state.currentSeason,
      phase: "regular_season",
    },
    updatedAt: new Date().toISOString(),
  };
}

/** 次の1試合をシミュレーションする */
export function simulateNextGame(state: GameState): GameState {
  const season = state.currentSeason;
  if (season.phase !== "regular_season") return state;
  if (season.currentGameIndex >= season.schedule.length) return state;

  const entry = season.schedule[season.currentGameIndex];
  const homeTeam = state.teams[entry.homeTeamId];
  const awayTeam = state.teams[entry.awayTeamId];

  const result = simulateGame(homeTeam, awayTeam);

  // スケジュール更新
  const newSchedule = [...season.schedule];
  newSchedule[season.currentGameIndex] = { ...entry, result };

  // 順位表更新
  const newStandings = updateStandings(
    season.standings,
    entry.homeTeamId,
    entry.awayTeamId,
    result
  );

  // 選手成績更新
  const newTeams = updatePlayerStats(state.teams, result, season.year);

  const newIndex = season.currentGameIndex + 1;
  const isSeasonOver = newIndex >= season.schedule.length;

  return {
    ...state,
    teams: newTeams,
    currentSeason: {
      ...season,
      schedule: newSchedule,
      standings: newStandings,
      currentGameIndex: newIndex,
      phase: isSeasonOver ? "offseason" : season.phase,
    },
    updatedAt: new Date().toISOString(),
  };
}

/** N試合をまとめてシミュレーションする */
export function simulateGames(state: GameState, count: number): GameState {
  let current = state;
  for (let i = 0; i < count; i++) {
    if (current.currentSeason.phase !== "regular_season") break;
    if (current.currentSeason.currentGameIndex >= current.currentSeason.schedule.length) break;
    current = simulateNextGame(current);
  }
  return current;
}

/** 自チームの次の試合まで進める */
export function simulateToNextMyGame(state: GameState): GameState {
  let current = state;
  const myTeamId = state.myTeamId;

  while (current.currentSeason.phase === "regular_season") {
    const idx = current.currentSeason.currentGameIndex;
    if (idx >= current.currentSeason.schedule.length) break;

    const entry = current.currentSeason.schedule[idx];
    // 自チームの試合ならここで停止（シミュレーションせずに返す）
    if (entry.homeTeamId === myTeamId || entry.awayTeamId === myTeamId) {
      break;
    }

    current = simulateNextGame(current);
  }
  return current;
}

/** 1日分 (6試合) をシミュレーションする */
export function simulateDay(state: GameState): GameState {
  const gamesPerDay = Math.floor(Object.keys(state.teams).length / 2);
  return simulateGames(state, gamesPerDay);
}

/** 1週間分 (42試合) をシミュレーションする */
export function simulateWeek(state: GameState): GameState {
  const gamesPerDay = Math.floor(Object.keys(state.teams).length / 2);
  return simulateGames(state, gamesPerDay * 7);
}

/** 順位表を更新する */
function updateStandings(
  standings: Record<string, TeamRecord>,
  homeTeamId: string,
  awayTeamId: string,
  result: GameResult
): Record<string, TeamRecord> {
  const newStandings = { ...standings };

  if (result.homeScore > result.awayScore) {
    newStandings[homeTeamId] = {
      ...newStandings[homeTeamId],
      wins: newStandings[homeTeamId].wins + 1,
    };
    newStandings[awayTeamId] = {
      ...newStandings[awayTeamId],
      losses: newStandings[awayTeamId].losses + 1,
    };
  } else if (result.awayScore > result.homeScore) {
    newStandings[awayTeamId] = {
      ...newStandings[awayTeamId],
      wins: newStandings[awayTeamId].wins + 1,
    };
    newStandings[homeTeamId] = {
      ...newStandings[homeTeamId],
      losses: newStandings[homeTeamId].losses + 1,
    };
  } else {
    // 引き分け (12回で同点)
    newStandings[homeTeamId] = {
      ...newStandings[homeTeamId],
      draws: newStandings[homeTeamId].draws + 1,
    };
    newStandings[awayTeamId] = {
      ...newStandings[awayTeamId],
      draws: newStandings[awayTeamId].draws + 1,
    };
  }

  return newStandings;
}

/** 選手の成績を更新する */
function updatePlayerStats(
  teams: Record<string, Team>,
  result: GameResult,
  year: number
): Record<string, Team> {
  // playerIdからチームIDへのルックアップを構築
  const playerTeamMap = new Map<string, string>();
  for (const [teamId, team] of Object.entries(teams)) {
    for (const player of team.roster) {
      playerTeamMap.set(player.id, teamId);
    }
  }

  // チームごとの更新をバッチで処理
  const teamUpdates = new Map<string, Map<string, { batting?: PlayerGameStats; pitching?: PitcherGameLog }>>();

  // 打撃成績を集約
  for (const ps of result.playerStats) {
    const teamId = playerTeamMap.get(ps.playerId);
    if (!teamId) continue;
    if (!teamUpdates.has(teamId)) teamUpdates.set(teamId, new Map());
    const teamMap = teamUpdates.get(teamId)!;
    if (!teamMap.has(ps.playerId)) teamMap.set(ps.playerId, {});
    teamMap.get(ps.playerId)!.batting = ps;
  }

  // 投手成績を集約
  for (const pl of result.pitcherStats) {
    const teamId = playerTeamMap.get(pl.playerId);
    if (!teamId) continue;
    if (!teamUpdates.has(teamId)) teamUpdates.set(teamId, new Map());
    const teamMap = teamUpdates.get(teamId)!;
    if (!teamMap.has(pl.playerId)) teamMap.set(pl.playerId, {});
    teamMap.get(pl.playerId)!.pitching = pl;
  }

  // 更新がないチームはそのまま返す
  const newTeams = { ...teams };

  for (const [teamId, playerUpdates] of teamUpdates) {
    const team = teams[teamId];
    const newRoster = team.roster.map((player) => {
      const update = playerUpdates.get(player.id);
      if (!update) return player;

      let newPlayer = { ...player };

      // 打撃成績の更新
      if (update.batting) {
        const bs = update.batting;
        const existing = player.careerBattingStats[year] || emptyBatterStats();
        newPlayer = {
          ...newPlayer,
          careerBattingStats: {
            ...player.careerBattingStats,
            [year]: {
              games: existing.games + 1,
              atBats: existing.atBats + bs.atBats,
              hits: existing.hits + bs.hits,
              doubles: existing.doubles + bs.doubles,
              triples: existing.triples + bs.triples,
              homeRuns: existing.homeRuns + bs.homeRuns,
              rbi: existing.rbi + bs.rbi,
              runs: existing.runs + bs.runs,
              walks: existing.walks + bs.walks,
              strikeouts: existing.strikeouts + bs.strikeouts,
              stolenBases: existing.stolenBases,
              caughtStealing: existing.caughtStealing,
              errors: existing.errors,
            },
          },
        };
      }

      // 投手成績の更新
      if (update.pitching) {
        const pl = update.pitching;
        const existing = player.careerPitchingStats[year] || emptyPitcherStats();
        const isWinner = result.winningPitcherId === player.id;
        const isLoser = result.losingPitcherId === player.id;
        const isSave = result.savePitcherId === player.id;
        newPlayer = {
          ...newPlayer,
          careerPitchingStats: {
            ...player.careerPitchingStats,
            [year]: {
              games: existing.games + 1,
              gamesStarted: existing.gamesStarted + 1,
              wins: existing.wins + (isWinner ? 1 : 0),
              losses: existing.losses + (isLoser ? 1 : 0),
              saves: existing.saves + (isSave ? 1 : 0),
              holds: existing.holds,
              inningsPitched: existing.inningsPitched + pl.inningsPitched,
              hits: existing.hits + pl.hits,
              earnedRuns: existing.earnedRuns + pl.earnedRuns,
              walks: existing.walks + pl.walks,
              strikeouts: existing.strikeouts + pl.strikeouts,
              homeRunsAllowed: existing.homeRunsAllowed + pl.homeRunsAllowed,
            },
          },
        };
      }

      return newPlayer;
    });

    newTeams[teamId] = { ...team, roster: newRoster };
  }

  return newTeams;
}
