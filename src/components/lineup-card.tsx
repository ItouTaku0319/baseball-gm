"use client";

import type { Player, BatterSeasonStats } from "@/models/player";
import { POSITION_NAMES, BAT_SIDE_NAMES, THROW_HAND_NAMES } from "@/models/player";
import { TrajectoryIcon, abilityGrade, gradeColor } from "@/components/player-ability-card";

export interface LineupCardProps {
  /** 打順番号 (1-9) */
  order: number;
  player: Player;
  /** 今季打撃成績 (optional) */
  seasonStats?: BatterSeasonStats;
  /** 選択状態 */
  selected?: boolean;
  /** カードクリック */
  onClick?: () => void;
  /** ↑ボタンクリック */
  onMoveUp?: () => void;
  /** ↓ボタンクリック */
  onMoveDown?: () => void;
  /** ↑ボタン無効 */
  disableUp?: boolean;
  /** ↓ボタン無効 */
  disableDown?: boolean;
}

function ColoredAbility({ label, val }: { label: string; val: number }) {
  const grade = abilityGrade(val);
  return (
    <span className="whitespace-nowrap">
      <span className="text-gray-400">{label}</span>
      <span className={gradeColor(grade)}>{val}</span>
    </span>
  );
}

function fmtAvg(val: number): string {
  if (val >= 1) return val.toFixed(3);
  return val.toFixed(3).slice(1);
}

export function LineupCard({
  order,
  player,
  seasonStats,
  selected = false,
  onClick,
  onMoveUp,
  onMoveDown,
  disableUp = false,
  disableDown = false,
}: LineupCardProps) {
  const posJa = POSITION_NAMES[player.position];
  const batJa = BAT_SIDE_NAMES[player.batSide];
  const throwJa = THROW_HAND_NAMES[player.throwHand];

  const avg =
    seasonStats && seasonStats.atBats > 0
      ? seasonStats.hits / seasonStats.atBats
      : null;
  const obp =
    seasonStats &&
    seasonStats.atBats + seasonStats.walks + seasonStats.hitByPitch + seasonStats.sacrificeFlies > 0
      ? (seasonStats.hits + seasonStats.walks + seasonStats.hitByPitch) /
        (seasonStats.atBats + seasonStats.walks + seasonStats.hitByPitch + seasonStats.sacrificeFlies)
      : null;
  const slg =
    seasonStats && seasonStats.atBats > 0
      ? (seasonStats.hits -
          seasonStats.doubles -
          seasonStats.triples -
          seasonStats.homeRuns +
          seasonStats.doubles * 2 +
          seasonStats.triples * 3 +
          seasonStats.homeRuns * 4) /
        seasonStats.atBats
      : null;
  const ops = obp != null && slg != null ? obp + slg : null;

  const borderClass = selected
    ? "border-blue-500 bg-gray-700"
    : "border-gray-700 bg-gray-800";

  return (
    <div
      className={`flex items-stretch border rounded-lg overflow-hidden cursor-pointer transition-colors hover:bg-gray-700 ${borderClass}`}
      onClick={onClick}
    >
      {/* 打順番号 */}
      <div className="flex items-center justify-center w-10 shrink-0 text-2xl font-bold tabular-nums text-gray-300 select-none">
        {order}
      </div>

      {/* 選手情報 */}
      <div className="flex-1 px-3 py-2 min-w-0">
        {/* 1行目: 選手名・ポジション・年齢・打投 */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-bold text-white">{player.name}</span>
          <span className="text-gray-400 text-xs whitespace-nowrap">
            {posJa}&nbsp;{player.age}歳&nbsp;{batJa}打{throwJa}投
          </span>
        </div>

        {/* 2行目: 能力値 */}
        <div className="flex items-center gap-3 text-xs tabular-nums mb-1 flex-wrap">
          <span className="whitespace-nowrap flex items-center gap-0.5">
            <span className="text-gray-400">弾</span>
            <TrajectoryIcon value={player.batting.trajectory} />
            <span className="text-gray-100">{player.batting.trajectory}</span>
          </span>
          <ColoredAbility label="ミ" val={player.batting.contact} />
          <ColoredAbility label="パ" val={player.batting.power} />
          <ColoredAbility label="走" val={player.batting.speed} />
          <ColoredAbility label="眼" val={player.batting.eye} />
        </div>

        {/* 3行目: 今季成績 */}
        {seasonStats && seasonStats.atBats > 0 && avg != null && ops != null && (
          <div className="flex items-center gap-3 text-xs tabular-nums text-gray-300 flex-wrap">
            <span>
              <span className="text-gray-400">打率&nbsp;</span>
              {fmtAvg(avg)}
            </span>
            <span>
              <span className="text-gray-400">HR&nbsp;</span>
              {seasonStats.homeRuns}
            </span>
            <span>
              <span className="text-gray-400">打点&nbsp;</span>
              {seasonStats.rbi}
            </span>
            <span>
              <span className="text-gray-400">OPS&nbsp;</span>
              {fmtAvg(ops)}
            </span>
          </div>
        )}
      </div>

      {/* ↑↓ボタン */}
      <div
        className="flex flex-col justify-center shrink-0 px-1 gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="w-7 h-7 flex items-center justify-center rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-300 text-xs leading-none"
          onClick={onMoveUp}
          disabled={disableUp}
          aria-label="上へ"
        >
          ▲
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-300 text-xs leading-none"
          onClick={onMoveDown}
          disabled={disableDown}
          aria-label="下へ"
        >
          ▼
        </button>
      </div>
    </div>
  );
}
