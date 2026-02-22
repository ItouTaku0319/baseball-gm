import { create } from "zustand";
import type { GameState } from "@/models/game-state";
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

/**
 * ゲーム全体の状態管理
 * localStorage に保存してセーブ/ロード機能を実現する
 */

interface GameStore {
  /** 現在のゲーム状態 */
  game: GameState | null;
  /** セーブデータ一覧 */
  savedGames: { id: string; name: string; updatedAt: string }[];

  /** ゲーム状態をセット */
  setGame: (game: GameState) => void;
  /** ゲームをlocalStorageに保存 */
  saveGame: () => void;
  /** ゲームをlocalStorageから読み込み */
  loadGame: (id: string) => void;
  /** セーブ一覧を読み込み */
  loadSavedGamesList: () => void;
  /** セーブデータを削除 */
  deleteSave: (id: string) => void;

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

const SAVE_PREFIX = "baseball-gm-save-";
const SAVE_LIST_KEY = "baseball-gm-saves";

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  savedGames: [],

  setGame: (game) => set({ game }),

  saveGame: () => {
    const { game } = get();
    if (!game) return;

    const updated = { ...game, updatedAt: new Date().toISOString() };
    localStorage.setItem(SAVE_PREFIX + game.id, JSON.stringify(updated));

    // セーブ一覧を更新
    const list = JSON.parse(localStorage.getItem(SAVE_LIST_KEY) || "[]");
    const existing = list.findIndex((s: { id: string }) => s.id === game.id);
    const entry = {
      id: game.id,
      name: `シーズン ${updated.currentSeason.year}`,
      updatedAt: updated.updatedAt,
    };
    if (existing >= 0) {
      list[existing] = entry;
    } else {
      list.push(entry);
    }
    localStorage.setItem(SAVE_LIST_KEY, JSON.stringify(list));

    set({ game: updated });
    get().loadSavedGamesList();
  },

  loadGame: (id) => {
    const data = localStorage.getItem(SAVE_PREFIX + id);
    if (data) {
      const game: GameState = JSON.parse(data);
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
      // セーブ互換: 旧 SeasonPhase "playoffs" を "climax_first" に変換
      let season = game.currentSeason;
      if ((season.phase as string) === "playoffs") {
        season = { ...season, phase: "offseason" };
      }
      set({ game: { ...game, teams: newTeams, currentSeason: season } });
    }
  },

  loadSavedGamesList: () => {
    const list = JSON.parse(localStorage.getItem(SAVE_LIST_KEY) || "[]");
    set({ savedGames: list });
  },

  deleteSave: (id) => {
    localStorage.removeItem(SAVE_PREFIX + id);
    const list = JSON.parse(localStorage.getItem(SAVE_LIST_KEY) || "[]");
    const filtered = list.filter((s: { id: string }) => s.id !== id);
    localStorage.setItem(SAVE_LIST_KEY, JSON.stringify(filtered));
    set({ savedGames: filtered });
  },

  startSeason: () => {
    const { game } = get();
    if (!game) return;
    const newGame = startSeasonEngine(game);
    set({ game: newGame });
    get().saveGame();
  },

  simNext: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateNextGame(game);
    set({ game: newGame });
    get().saveGame();
  },

  simDay: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateDayEngine(game);
    set({ game: newGame });
    get().saveGame();
  },

  simWeek: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateWeekEngine(game);
    set({ game: newGame });
    get().saveGame();
  },

  simToMyGame: () => {
    const { game } = get();
    if (!game || game.currentSeason.phase !== "regular_season") return;
    const newGame = simulateToNextMyGameEngine(game);
    set({ game: newGame });
    get().saveGame();
  },

  simPlayoffGame: () => {
    const { game } = get();
    if (!game) return;
    const phase = game.currentSeason.phase;
    if (phase !== "climax_first" && phase !== "climax_final" && phase !== "japan_series") return;
    const newGame = simulatePlayoffGame(game);
    set({ game: newGame });
    get().saveGame();
  },

  simAllPlayoffs: () => {
    const { game } = get();
    if (!game) return;
    const phase = game.currentSeason.phase;
    if (phase !== "climax_first" && phase !== "climax_final" && phase !== "japan_series") return;
    const newGame = simulateAllPlayoffGames(game);
    set({ game: newGame });
    get().saveGame();
  },
}));
