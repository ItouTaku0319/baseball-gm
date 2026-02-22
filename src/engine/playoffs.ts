import type { GameState } from "@/models/game-state";
import type {
  PlayoffSeries,
  PlayoffSeriesType,
  ScheduleEntry,
  SeasonPhase,
} from "@/models/league";
import type { TeamRecord } from "@/models/team";
import { sortStandings } from "./season";
import { simulateGame } from "./simulation";
import { emptyBatterStats, emptyPitcherStats } from "@/models/player";

/**
 * ポストシーズンエンジン
 * CS 1stステージ → CS Finalステージ → 日本シリーズ
 */

/** リーグの順位表を取得 (上位3チーム) */
function getLeagueTop3(
  standings: Record<string, TeamRecord>,
  leagueTeamIds: string[]
): TeamRecord[] {
  const leagueStandings = Object.values(standings).filter((r) =>
    leagueTeamIds.includes(r.teamId)
  );
  return sortStandings(
    Object.fromEntries(leagueStandings.map((r) => [r.teamId, r]))
  ).slice(0, 3);
}

/** CS 1stステージを初期化 */
export function initClimaxFirst(state: GameState): GameState {
  const season = state.currentSeason;
  const central = season.leagues.find((l) => l.id === "central")!;
  const pacific = season.leagues.find((l) => l.id === "pacific")!;

  const centralTop3 = getLeagueTop3(season.standings, central.teams);
  const pacificTop3 = getLeagueTop3(season.standings, pacific.teams);

  const series: PlayoffSeries[] = [
    createSeries(
      "climax_first_central",
      centralTop3[1].teamId, // 2位 (上位)
      centralTop3[2].teamId, // 3位
      1,  // 2位に1勝アドバンテージ
      2,  // 3試合制 → 先に2勝
      3   // 最大3試合
    ),
    createSeries(
      "climax_first_pacific",
      pacificTop3[1].teamId,
      pacificTop3[2].teamId,
      1,
      2,
      3
    ),
  ];

  return {
    ...state,
    currentSeason: {
      ...season,
      phase: "climax_first",
      playoffs: [...(season.playoffs || []), ...series],
    },
    updatedAt: new Date().toISOString(),
  };
}

/** CS Finalステージを初期化 */
export function initClimaxFinal(state: GameState): GameState {
  const season = state.currentSeason;
  const central = season.leagues.find((l) => l.id === "central")!;
  const pacific = season.leagues.find((l) => l.id === "pacific")!;
  const playoffs = season.playoffs || [];

  const centralTop3 = getLeagueTop3(season.standings, central.teams);
  const pacificTop3 = getLeagueTop3(season.standings, pacific.teams);

  const csFirstCentral = playoffs.find((s) => s.type === "climax_first_central");
  const csFirstPacific = playoffs.find((s) => s.type === "climax_first_pacific");

  const centralChallengerTeam = csFirstCentral?.winnerId ?? centralTop3[1].teamId;
  const pacificChallengerTeam = csFirstPacific?.winnerId ?? pacificTop3[1].teamId;

  const newSeries: PlayoffSeries[] = [
    createSeries(
      "climax_final_central",
      centralTop3[0].teamId, // 1位 (上位)
      centralChallengerTeam,  // CS 1st勝者
      1,  // 1位に1勝アドバンテージ
      4,  // 6試合制 → 先に4勝
      6
    ),
    createSeries(
      "climax_final_pacific",
      pacificTop3[0].teamId,
      pacificChallengerTeam,
      1,
      4,
      6
    ),
  ];

  return {
    ...state,
    currentSeason: {
      ...season,
      phase: "climax_final",
      playoffs: [...playoffs, ...newSeries],
    },
    updatedAt: new Date().toISOString(),
  };
}

/** 日本シリーズを初期化 */
export function initJapanSeries(state: GameState): GameState {
  const season = state.currentSeason;
  const playoffs = season.playoffs || [];

  const csFinalCentral = playoffs.find((s) => s.type === "climax_final_central");
  const csFinalPacific = playoffs.find((s) => s.type === "climax_final_pacific");

  const central = season.leagues.find((l) => l.id === "central")!;
  const pacific = season.leagues.find((l) => l.id === "pacific")!;
  const centralTop = getLeagueTop3(season.standings, central.teams)[0];
  const pacificTop = getLeagueTop3(season.standings, pacific.teams)[0];

  const centralChampion = csFinalCentral?.winnerId ?? centralTop.teamId;
  const pacificChampion = csFinalPacific?.winnerId ?? pacificTop.teamId;

  const series = createSeries(
    "japan_series",
    centralChampion,
    pacificChampion,
    0,  // アドバンテージなし
    4,  // 7試合制 → 先に4勝
    7
  );

  return {
    ...state,
    currentSeason: {
      ...season,
      phase: "japan_series",
      playoffs: [...playoffs, series],
    },
    updatedAt: new Date().toISOString(),
  };
}

/** ポストシーズンの次の1試合をシミュレート */
export function simulatePlayoffGame(state: GameState): GameState {
  const season = state.currentSeason;
  const playoffs = season.playoffs || [];
  const phase = season.phase;

  // 現在のフェーズに該当するアクティブなシリーズを見つける
  const activeSeriesTypes = getSeriesTypesForPhase(phase);
  const activeSeries = playoffs.find(
    (s) => activeSeriesTypes.includes(s.type) && !s.winnerId
  );

  if (!activeSeries) {
    // 現フェーズの全シリーズが完了 → 次のフェーズに進む
    return advancePlayoffPhase(state);
  }

  // まだ未試合のゲームを見つける
  const nextGameIndex = activeSeries.games.findIndex((g) => !g.result);
  if (nextGameIndex < 0) {
    return advancePlayoffPhase(state);
  }

  const gameEntry = activeSeries.games[nextGameIndex];
  const homeTeam = state.teams[gameEntry.homeTeamId];
  const awayTeam = state.teams[gameEntry.awayTeamId];
  const result = simulateGame(homeTeam, awayTeam);

  // 試合結果を更新
  const newGames = [...activeSeries.games];
  newGames[nextGameIndex] = { ...gameEntry, result };

  // 勝敗を更新
  let team1Wins = activeSeries.team1Wins;
  let team2Wins = activeSeries.team2Wins;
  if (result.homeScore > result.awayScore) {
    if (gameEntry.homeTeamId === activeSeries.team1Id) team1Wins++;
    else team2Wins++;
  } else if (result.awayScore > result.homeScore) {
    if (gameEntry.awayTeamId === activeSeries.team1Id) team1Wins++;
    else team2Wins++;
  }

  // 勝者判定
  let winnerId: string | null = null;
  if (team1Wins >= activeSeries.winsNeeded) winnerId = activeSeries.team1Id;
  else if (team2Wins >= activeSeries.winsNeeded) winnerId = activeSeries.team2Id;

  const updatedSeries: PlayoffSeries = {
    ...activeSeries,
    games: newGames,
    team1Wins,
    team2Wins,
    winnerId,
  };

  // 選手成績更新
  const newTeams = updatePlayoffPlayerStats(state.teams, result, season.year);

  // playoffs配列を更新
  const newPlayoffs = playoffs.map((s) =>
    s.id === activeSeries.id ? updatedSeries : s
  );

  return {
    ...state,
    teams: newTeams,
    currentSeason: {
      ...season,
      playoffs: newPlayoffs,
    },
    updatedAt: new Date().toISOString(),
  };
}

/** 現フェーズの全シリーズが完了 → 次のフェーズに遷移 */
function advancePlayoffPhase(state: GameState): GameState {
  const phase = state.currentSeason.phase;

  switch (phase) {
    case "climax_first":
      return initClimaxFinal(state);
    case "climax_final":
      return initJapanSeries(state);
    case "japan_series":
      return {
        ...state,
        currentSeason: {
          ...state.currentSeason,
          phase: "offseason",
        },
        updatedAt: new Date().toISOString(),
      };
    default:
      return state;
  }
}

/** フェーズに該当するシリーズタイプ */
function getSeriesTypesForPhase(phase: SeasonPhase): PlayoffSeriesType[] {
  switch (phase) {
    case "climax_first":
      return ["climax_first_central", "climax_first_pacific"];
    case "climax_final":
      return ["climax_final_central", "climax_final_pacific"];
    case "japan_series":
      return ["japan_series"];
    default:
      return [];
  }
}

/** シリーズを作成するヘルパー */
function createSeries(
  type: PlayoffSeriesType,
  team1Id: string,
  team2Id: string,
  team1Advantage: number,
  winsNeeded: number,
  maxGames: number
): PlayoffSeries {
  const games: ScheduleEntry[] = [];
  for (let i = 0; i < maxGames; i++) {
    // ホーム/アウェイを交互に (team1がホーム開始)
    const isTeam1Home = i % 2 === 0;
    games.push({
      id: crypto.randomUUID(),
      homeTeamId: isTeam1Home ? team1Id : team2Id,
      awayTeamId: isTeam1Home ? team2Id : team1Id,
      result: null,
    });
  }

  return {
    id: crypto.randomUUID(),
    type,
    team1Id,
    team2Id,
    team1Advantage,
    games,
    team1Wins: team1Advantage,
    team2Wins: 0,
    winsNeeded,
    winnerId: null,
  };
}

/** ポストシーズンの選手成績を更新する */
function updatePlayoffPlayerStats(
  teams: Record<string, import("@/models/team").Team>,
  result: import("@/models/league").GameResult,
  year: number
): Record<string, import("@/models/team").Team> {
  const playerTeamMap = new Map<string, string>();
  for (const [teamId, team] of Object.entries(teams)) {
    for (const player of team.roster) {
      playerTeamMap.set(player.id, teamId);
    }
  }

  const teamUpdates = new Map<
    string,
    Map<string, {
      batting?: import("@/models/league").PlayerGameStats;
      pitching?: import("@/models/league").PitcherGameLog;
    }>
  >();

  for (const ps of result.playerStats) {
    const teamId = playerTeamMap.get(ps.playerId);
    if (!teamId) continue;
    if (!teamUpdates.has(teamId)) teamUpdates.set(teamId, new Map());
    const m = teamUpdates.get(teamId)!;
    if (!m.has(ps.playerId)) m.set(ps.playerId, {});
    m.get(ps.playerId)!.batting = ps;
  }
  for (const pl of result.pitcherStats) {
    const teamId = playerTeamMap.get(pl.playerId);
    if (!teamId) continue;
    if (!teamUpdates.has(teamId)) teamUpdates.set(teamId, new Map());
    const m = teamUpdates.get(teamId)!;
    if (!m.has(pl.playerId)) m.set(pl.playerId, {});
    m.get(pl.playerId)!.pitching = pl;
  }

  const newTeams = { ...teams };
  for (const [teamId, playerUpdates] of teamUpdates) {
    const team = teams[teamId];
    const newRoster = team.roster.map((player) => {
      const update = playerUpdates.get(player.id);
      if (!update) return player;
      let newPlayer = { ...player };

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
              stolenBases: existing.stolenBases + (bs.stolenBases || 0),
              caughtStealing: existing.caughtStealing + (bs.caughtStealing || 0),
              errors: existing.errors,
            },
          },
        };
      }
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

/** 全ポストシーズンを一括シミュレーション (ダッシュボードから使用) */
export function simulateAllPlayoffGames(state: GameState): GameState {
  let current = state;
  const postseasonPhases: SeasonPhase[] = ["climax_first", "climax_final", "japan_series"];

  while (postseasonPhases.includes(current.currentSeason.phase)) {
    const prev = current;
    current = simulatePlayoffGame(current);
    if (current === prev) break; // 変化なし = 完了
  }

  return current;
}

/** 現フェーズのアクティブシリーズ一覧を取得 */
export function getActivePlayoffSeries(state: GameState): PlayoffSeries[] {
  const season = state.currentSeason;
  if (!season.playoffs) return [];
  const types = getSeriesTypesForPhase(season.phase);
  return season.playoffs.filter((s) => types.includes(s.type));
}
