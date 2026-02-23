"use client";

import type { Player, PitchRepertoire, BatterSeasonStats, PitcherSeasonStats } from "@/models/player";
import {
  PITCH_TYPE_NAMES,
  POSITION_NAMES,
  THROW_HAND_NAMES,
  BAT_SIDE_NAMES,
} from "@/models/player";

/** 能力値(1-100)のグレード文字を返す */
export function abilityGrade(val: number): string {
  if (val >= 90) return "S";
  if (val >= 80) return "A";
  if (val >= 70) return "B";
  if (val >= 60) return "C";
  if (val >= 50) return "D";
  if (val >= 40) return "E";
  if (val >= 30) return "F";
  return "G";
}

export function gradeColor(grade: string): string {
  switch (grade) {
    case "S": return "text-red-500 font-bold";
    case "A": return "text-red-400";
    case "B": return "text-orange-400";
    case "C": return "text-yellow-400";
    case "D": return "text-lime-400";
    case "E": return "text-green-500";
    case "F": return "text-blue-400";
    default:  return "text-gray-500";
  }
}

export function velocityGrade(v: number): string {
  if (v >= 155) return "S";
  if (v >= 150) return "A";
  if (v >= 145) return "B";
  if (v >= 140) return "C";
  if (v >= 135) return "D";
  if (v >= 130) return "E";
  if (v >= 125) return "F";
  return "G";
}

export function potentialColor(grade: string): string {
  switch (grade) {
    case "S": return "text-red-500 font-bold";
    case "A": return "text-red-400";
    case "B": return "text-orange-400";
    case "C": return "text-yellow-400";
    case "D": return "text-lime-400";
    default:  return "text-gray-500";
  }
}

export function AbilityCell({ val }: { val: number }) {
  const grade = abilityGrade(val);
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-gray-100">{val}</span>
      <span className={`text-xs ${gradeColor(grade)}`}>{grade}</span>
    </span>
  );
}

export function VelocityCell({ val }: { val: number }) {
  const grade = velocityGrade(val);
  return <span className={gradeColor(grade)}>{val}km</span>;
}

function pitchLevelColor(level: number): string {
  if (level >= 6) return "text-red-400 font-bold";
  if (level >= 5) return "text-orange-400";
  if (level >= 4) return "text-yellow-400";
  if (level >= 3) return "text-lime-400";
  if (level >= 2) return "text-cyan-400";
  return "text-cyan-300";
}

/** 弾道の色 (パワプロ風: 1=白, 2=青, 3=橙, 4=赤) */
const TRAJECTORY_COLORS = ["#d1d5db", "#60a5fa", "#f59e0b", "#ef4444"];
const TRAJECTORY_TEXT_CLASSES = ["text-gray-300", "text-blue-400", "text-amber-400", "text-red-400"];

/** 弾道テキストのTailwindクラスを返す */
export function trajectoryTextClass(value: number): string {
  return TRAJECTORY_TEXT_CLASSES[Math.min(Math.max(value - 1, 0), 3)];
}

/** 弾道アイコン (角度の異なる矢印) */
export function TrajectoryIcon({ value }: { value: number }) {
  // 弾道1=ほぼ水平(10°), 2=やや上(25°), 3=上向き(45°), 4=急角度(65°)
  const angles = [10, 25, 45, 65];
  const angle = angles[Math.min(value - 1, 3)];
  const color = TRAJECTORY_COLORS[Math.min(value - 1, 3)];
  const rad = (angle * Math.PI) / 180;
  const len = 14;
  const x2 = 4 + len * Math.cos(rad);
  const y2 = 16 - len * Math.sin(rad);
  const headLen = 5;
  const headAngle = 0.5;
  const hx1 = x2 - headLen * Math.cos(rad - headAngle);
  const hy1 = y2 + headLen * Math.sin(rad - headAngle);
  const hx2 = x2 - headLen * Math.cos(rad + headAngle);
  const hy2 = y2 + headLen * Math.sin(rad + headAngle);
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" className="inline-block align-middle">
      <line x1={4} y1={16} x2={x2} y2={y2} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <polyline points={`${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PitchList({ pitches }: { pitches: PitchRepertoire[] }) {
  if (pitches.length === 0) return <span className="text-gray-600">-</span>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {pitches.map((p) => (
        <span key={p.type} className="whitespace-nowrap">
          <span className="text-gray-400">{PITCH_TYPE_NAMES[p.type]}</span>
          <span className={`ml-0.5 ${pitchLevelColor(p.level)}`}>{p.level}</span>
        </span>
      ))}
    </div>
  );
}

/** 打率・OPS用フォーマット (先頭0を省略) */
function fmtAvg(val: number): string {
  if (val >= 1) return val.toFixed(3);
  return val.toFixed(3).slice(1); // ".XXX"
}

/** ERA・WHIP用フォーマット */
function fmtDecimal(val: number): string {
  return val.toFixed(2);
}

function BatterSeasonRow({ stats }: { stats: BatterSeasonStats }) {
  const avg = stats.atBats > 0 ? stats.hits / stats.atBats : 0;
  const obp = (stats.atBats + stats.walks + stats.hitByPitch + stats.sacrificeFlies) > 0
    ? (stats.hits + stats.walks + stats.hitByPitch) / (stats.atBats + stats.walks + stats.hitByPitch + stats.sacrificeFlies)
    : 0;
  const slg = stats.atBats > 0
    ? (stats.hits - stats.doubles - stats.triples - stats.homeRuns + stats.doubles * 2 + stats.triples * 3 + stats.homeRuns * 4) / stats.atBats
    : 0;
  const ops = obp + slg;

  return (
    <div className="flex items-center gap-3 text-xs tabular-nums font-mono flex-wrap">
      <span>
        <span className="text-gray-400">打率 </span>
        <span className="text-gray-100">{fmtAvg(avg)}</span>
      </span>
      <span>
        <span className="text-gray-400">HR </span>
        <span className="text-gray-100">{stats.homeRuns}</span>
      </span>
      <span>
        <span className="text-gray-400">打点 </span>
        <span className="text-gray-100">{stats.rbi}</span>
      </span>
      <span>
        <span className="text-gray-400">OPS </span>
        <span className="text-gray-100">{fmtAvg(ops)}</span>
      </span>
    </div>
  );
}

function PitcherSeasonRow({ stats }: { stats: PitcherSeasonStats }) {
  const innings = stats.inningsPitched / 3;
  const era = innings > 0 ? (stats.earnedRuns / innings) * 9 : 0;
  const whip = innings > 0 ? (stats.hits + stats.walks) / innings : 0;

  return (
    <div className="flex items-center gap-3 text-xs tabular-nums font-mono flex-wrap">
      <span>
        <span className="text-gray-400">ERA </span>
        <span className="text-gray-100">{fmtDecimal(era)}</span>
      </span>
      <span>
        <span className="text-gray-100">{stats.wins}W-{stats.losses}L</span>
      </span>
      <span>
        <span className="text-gray-400">K </span>
        <span className="text-gray-100">{stats.strikeouts}</span>
      </span>
      <span>
        <span className="text-gray-400">WHIP </span>
        <span className="text-gray-100">{fmtDecimal(whip)}</span>
      </span>
    </div>
  );
}

interface PlayerAbilityCardProps {
  player: Player;
  seasonYear?: number;
  teamColor?: string;
}

/** 選手能力カード（ツールチップやフィルタ表示用） */
export function PlayerAbilityCard({ player, seasonYear, teamColor }: PlayerAbilityCardProps) {
  const posJa = POSITION_NAMES[player.position];
  const throwJa = THROW_HAND_NAMES[player.throwHand];
  const batJa = BAT_SIDE_NAMES[player.batSide];

  const batterStats = seasonYear != null ? player.careerBattingStats[seasonYear] : undefined;
  const pitcherStats = seasonYear != null ? player.careerPitchingStats[seasonYear] : undefined;

  if (player.isPitcher && player.pitching) {
    return (
      <div className="bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden">
        {teamColor && <div className="h-1 rounded-t-lg" style={{ backgroundColor: teamColor }} />}
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="text-blue-400 font-bold text-lg mr-2">{player.name}</span>
              <span className="text-gray-400 text-sm">{posJa} {player.age}歳 {throwJa}投</span>
            </div>
            <span className={`text-sm ${potentialColor(player.potential.overall)}`}>潜在{player.potential.overall}</span>
          </div>
          <div className="grid grid-cols-4 gap-3 text-sm mb-2">
            <div><span className="text-gray-400">球速 </span><VelocityCell val={player.pitching.velocity} /></div>
            <div><span className="text-gray-400">制球 </span><AbilityCell val={player.pitching.control} /></div>
            <div><span className="text-gray-400">スタ </span><AbilityCell val={player.pitching.stamina} /></div>
            <div><span className="text-gray-400">精神 </span><AbilityCell val={player.pitching.mentalToughness} /></div>
          </div>
          <div className="text-sm mb-0">
            <span className="text-gray-400 mr-2">球種:</span>
            <PitchList pitches={player.pitching.pitches} />
          </div>
          {pitcherStats && pitcherStats.games > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-600">
              <span className="text-gray-400 text-xs mr-2">今季</span>
              <PitcherSeasonRow stats={pitcherStats} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden">
      {teamColor && <div className="h-1 rounded-t-lg" style={{ backgroundColor: teamColor }} />}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <span className="text-blue-400 font-bold text-lg mr-2">{player.name}</span>
            <span className="text-gray-400 text-sm">{posJa} {player.age}歳 {batJa}打{throwJa}投</span>
          </div>
          <span className={`text-sm ${potentialColor(player.potential.overall)}`}>潜在{player.potential.overall}</span>
        </div>
        <div className="grid grid-cols-4 gap-x-3 gap-y-2 text-sm mb-0">
          <div>
            <span className="text-gray-400">弾 </span>
            <TrajectoryIcon value={player.batting.trajectory ?? 2} />
            <span className={`ml-0.5 ${trajectoryTextClass(player.batting.trajectory ?? 2)}`}>{player.batting.trajectory ?? 2}</span>
          </div>
          <div><span className="text-gray-400">ミ </span><AbilityCell val={player.batting.contact} /></div>
          <div><span className="text-gray-400">パ </span><AbilityCell val={player.batting.power} /></div>
          <div><span className="text-gray-400">走 </span><AbilityCell val={player.batting.speed} /></div>
          <div><span className="text-gray-400">眼 </span><AbilityCell val={player.batting.eye} /></div>
          <div><span className="text-gray-400">肩 </span><AbilityCell val={player.batting.arm ?? 50} /></div>
          <div><span className="text-gray-400">守 </span><AbilityCell val={player.batting.fielding} /></div>
          <div><span className="text-gray-400">捕 </span><AbilityCell val={player.batting.catching} /></div>
        </div>
        {batterStats && batterStats.atBats > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-600">
            <span className="text-gray-400 text-xs mr-2">今季</span>
            <BatterSeasonRow stats={batterStats} />
          </div>
        )}
      </div>
    </div>
  );
}
