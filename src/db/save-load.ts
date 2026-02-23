import { db } from "./database";
import type { SaveMeta, SaveScheduleDay } from "./database";
import type { GameState } from "@/models/game-state";
import {
  extractMeta,
  extractCore,
  extractTeams,
  extractScheduleDays,
  getChangedScheduleDays,
  extractAtBatLogs,
  rebuildGameState,
} from "./helpers";

/** 前回保存時のgameIndexを追跡 */
const lastSavedGameIndex = new Map<string, number>();

/**
 * ゲーム状態をDBに保存
 * 差分更新: スケジュールは変更された日のみ、atBatLogsは新規のみ
 */
export async function saveGameToDB(game: GameState): Promise<void> {
  const gameId = game.id;

  // 1. Meta
  await db.saveMeta.put(extractMeta(game));

  // 2. Core (teams, schedule除外)
  await db.saveCore.put(extractCore(game));

  // 3. Teams (12チーム全部)
  await db.saveTeams.bulkPut(extractTeams(game));

  // 4. Schedule (差分更新)
  const lastIndex = lastSavedGameIndex.get(gameId) ?? 0;
  const currentIndex = game.currentSeason.currentGameIndex;

  if (lastIndex === 0) {
    // 初回保存: 全日程を保存
    const allDays = extractScheduleDays(gameId, game.currentSeason);
    if (allDays.length > 0) {
      await db.scheduleDays.bulkPut(allDays);
    }
    // seasonHistoryも保存
    for (const season of game.seasonHistory) {
      const histDays = extractScheduleDays(gameId, season);
      if (histDays.length > 0) {
        await db.scheduleDays.bulkPut(histDays);
      }
    }
  } else {
    // 差分保存: 変更された日のみ
    const changedDays = getChangedScheduleDays(gameId, game.currentSeason, lastIndex);
    if (changedDays.length > 0) {
      await db.scheduleDays.bulkPut(changedDays);
    }
  }

  // 5. AtBatLogs (新規のみ)
  const newAtBatLogs = extractAtBatLogs(
    gameId,
    game.currentSeason.schedule.slice(lastIndex)
  );
  if (newAtBatLogs.length > 0) {
    await db.atBatLogs.bulkPut(newAtBatLogs);
  }

  // 保存位置を更新
  lastSavedGameIndex.set(gameId, currentIndex);
}

/**
 * ゲーム状態をDBから読み込み
 */
export async function loadGameFromDB(gameId: string): Promise<GameState | null> {
  // 1. Core
  const core = await db.saveCore.get(gameId);
  if (!core) return null;

  // 2. Teams
  const teams = await db.saveTeams.where("gameId").equals(gameId).toArray();
  if (teams.length === 0) return null;

  // 3. 現シーズンのスケジュール
  const currentYear = core.currentSeason.year;
  const currentScheduleDays = await db.scheduleDays
    .where("[gameId+seasonYear]")
    .equals([gameId, currentYear])
    .toArray();

  // 4. seasonHistoryの各シーズンのスケジュール
  const historyScheduleDays = new Map<number, SaveScheduleDay[]>();
  for (const sh of core.seasonHistory) {
    const days = await db.scheduleDays
      .where("[gameId+seasonYear]")
      .equals([gameId, sh.year])
      .toArray();
    historyScheduleDays.set(sh.year, days);
  }

  // 5. AtBatLogs
  const atBatLogRecords = await db.atBatLogs
    .where("gameId")
    .equals(gameId)
    .toArray();

  // 6. 再構築
  const gameState = rebuildGameState(core, teams, currentScheduleDays, historyScheduleDays, atBatLogRecords);

  // 保存位置を設定（次回からの差分更新用）
  lastSavedGameIndex.set(gameId, gameState.currentSeason.currentGameIndex);

  return gameState;
}

/**
 * セーブ一覧を取得
 */
export async function listSaves(): Promise<SaveMeta[]> {
  return db.saveMeta.toArray();
}

/**
 * セーブデータを削除
 */
export async function deleteSaveFromDB(gameId: string): Promise<void> {
  await db.transaction("rw", [db.saveMeta, db.saveCore, db.saveTeams, db.scheduleDays, db.atBatLogs], async () => {
    await db.saveMeta.delete(gameId);
    await db.saveCore.delete(gameId);
    await db.saveTeams.where("gameId").equals(gameId).delete();
    await db.scheduleDays.where("gameId").equals(gameId).delete();
    await db.atBatLogs.where("gameId").equals(gameId).delete();
  });
  lastSavedGameIndex.delete(gameId);
}

/**
 * localStorageからIndexedDBへマイグレーション
 */
export async function migrateFromLocalStorage(): Promise<void> {
  const MIGRATION_FLAG = "baseball-gm-migrated-to-idb";
  const SAVE_LIST_KEY = "baseball-gm-saves";
  const SAVE_PREFIX = "baseball-gm-save-";

  if (localStorage.getItem(MIGRATION_FLAG)) return;

  const listJson = localStorage.getItem(SAVE_LIST_KEY);
  if (!listJson) {
    localStorage.setItem(MIGRATION_FLAG, "1");
    return;
  }

  const list: { id: string; name: string; updatedAt: string }[] = JSON.parse(listJson);
  if (list.length === 0) {
    localStorage.setItem(MIGRATION_FLAG, "1");
    return;
  }

  for (const entry of list) {
    try {
      const dataJson = localStorage.getItem(SAVE_PREFIX + entry.id);
      if (!dataJson) continue;

      const game: GameState = JSON.parse(dataJson);
      await saveGameToDB(game);

      localStorage.removeItem(SAVE_PREFIX + entry.id);
    } catch (e) {
      console.error(`マイグレーション失敗 (${entry.id}):`, e);
    }
  }

  localStorage.removeItem(SAVE_LIST_KEY);
  localStorage.setItem(MIGRATION_FLAG, "1");
}
