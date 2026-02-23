import { create } from "zustand";
import type { GameState } from "@/models/game-state";
import type { SaveMeta } from "@/db/database";
import {
  saveGameToDB,
  loadGameFromDB,
  listSaves,
  deleteSaveFromDB,
} from "@/db/save-load";
import {
  startSeason as startSeasonEngine,
  simulateNextGame,
  simulateDay as simulateDayEngine,
  simulateWeek as simulateWeekEngine,
  simulateToNextMyGame as simulateToNextMyGameEngine,
} from "@/engine/season-advancement";
import { autoConfigureLineup, autoAssignRosterLevels } from "@/engine/lineup";
import {
  simulatePlayoffGame,
  simulateAllPlayoffGames,
} from "@/engine/playoffs";

interface GameStore {
  /** 現在のゲーム状態 */
  game: GameState | null;
  /** セーブデータ一覧 */
  savedGames: SaveMeta[];

  /** ゲーム状態をセット */
  setGame: (game: GameState) => void;
  /** ゲームをIndexedDBに保存 */
  saveGame: () => Promise<void>;
  /** ゲームをIndexedDBから読み込み */
  loadGame: (id: string) => Promise<void>;
  /** セーブ一覧を読み込み */
  loadSavedGamesList: () => Promise<void>;
  /** セーブデータを削除 */
  deleteSave: (id: string) => Promise<void>;

  /** シーズンを開始 (preseason → regular_season) */
  startSeason: () => void;
  /** 次の1試合をシミュレーション */
  simNext: () => void;
  /** 1日分をシミュレーション */
  simDay: () => void;
  /** 1週間分をシミュレーション */
  simWeek: () => void;
  /** 自チームの次の試合まで進める */
  simToMyGame: () => void;
  /** ポストシーズン: 次の1試合 */
  simPlayoffGame: () => void;
  /** ポストシーズン: 全試合一括 */
  simAllPlayoffs: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  savedGames: [],

  setGame: (game) => set({ game }),

  saveGame: async () => {
    const { game } = get();
    if (!game) return;

    const updated = { ...game, updatedAt: new Date().toISOString() };
    set({ game: updated });
    try {
      await saveGameToDB(updated);
      await get().loadSavedGamesList();
    } catch (e) {
      console.error("セーブ失敗:", e);
    }
  },

  loadGame: async (id) => {
    try {
      const game = await loadGameFromDB(id);
      if (!game) return;

      // セーブ互換: lineupConfig / rosterLevels が未設定のチームを自動設定
      const newTeams = { ...game.teams };
      for (const [teamId, team] of Object.entries(newTeams)) {
        let updated = team;
        if (!updated.lineupConfig) {
          updated = { ...updated, lineupConfig: autoConfigureLineup(updated) };
        }
        if (!updated.rosterLevels) {
          // 旧25人セーブは全員1軍扱い
          const levels: Record<string, "ichi_gun" | "ni_gun"> = {};
          for (const p of updated.roster) {
            levels[p.id] = "ichi_gun";
          }
          updated = { ...updated, rosterLevels: levels };
        }
        if (updated !== team) newTeams[teamId] = updated;
      }
      // セーブ互換: 旧 SeasonPhase "playoffs" を "offseason" に変換
      let season = game.currentSeason;
      if ((season.phase as string) === "playoffs") {
        season = { ...season, phase: "offseason" };
      }
      set({ game: { ...game, teams: newTeams, currentSeason: season } });
    } catch (e) {
      console.error("ロード失敗:", e);
    }
  },

  loadSavedGamesList: async () => {
    try {
      const list = await listSaves();
      set({ savedGames: list });
    } catch (e) {
      console.error("セーブ一覧取得失敗:", e);
    }
  },

  deleteSave: async (id) => {
    try {
      await deleteSaveFromDB(id);
      await get().loadSavedGamesList();
    } catch (e) {
      console.error("削除失敗:", e);
    }
  },

  startSeason: () => {
    const { game } = get();
    if (!game) return;
    const newGame = startSeasonEngine(game);
    set({ game: newGame });
    get().saveGame().catch(console.error);
  },

  simNext: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateNextGame(game);
    set({ game: newGame });
    get().saveGame().catch(console.error);
  },

  simDay: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateDayEngine(game);
    set({ game: newGame });
    get().saveGame().catch(console.error);
  },

  simWeek: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateWeekEngine(game);
    set({ game: newGame });
    get().saveGame().catch(console.error);
  },

  simToMyGame: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateToNextMyGameEngine(game);
    set({ game: newGame });
    get().saveGame().catch(console.error);
  },

  simPlayoffGame: () => {
    const { game } = get();
    if (!game) return;
    const phase = game.currentSeason.phase;
    if (phase !== "climax_first" && phase !== "climax_final" && phase !== "japan_series") return;
    const newGame = simulatePlayoffGame(game);
    set({ game: newGame });
    get().saveGame().catch(console.error);
  },

  simAllPlayoffs: () => {
    const { game } = get();
    if (!game) return;
    const phase = game.currentSeason.phase;
    if (phase !== "climax_first" && phase !== "climax_final" && phase !== "japan_series") return;
    const newGame = simulateAllPlayoffGames(game);
    set({ game: newGame });
    get().saveGame().catch(console.error);
  },
}));
