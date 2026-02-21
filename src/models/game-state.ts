import type { Team } from "./team";
import type { Season } from "./league";

/** ゲーム全体の保存データ */
export interface GameState {
  id: string;
  /** プレイヤーが管理するチームのID */
  myTeamId: string;
  /** 全チームデータ */
  teams: Record<string, Team>;
  /** 現在のシーズン */
  currentSeason: Season;
  /** シーズン履歴 */
  seasonHistory: Season[];
  /** ゲーム作成日時 */
  createdAt: string;
  /** 最終更新日時 */
  updatedAt: string;
}
