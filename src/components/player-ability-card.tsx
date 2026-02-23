"use client";

import type { Player, PitchRepertoire } from "@/models/player";
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

/** 選手能力カード（ツールチップやフィルタ表示用） */
export function PlayerAbilityCard({ player }: { player: Player }) {
  const posJa = POSITION_NAMES[player.position];
  const throwJa = THROW_HAND_NAMES[player.throwHand];
  const batJa = BAT_SIDE_NAMES[player.batSide];

  if (player.isPitcher && player.pitching) {
    return (
      <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-blue-400 font-bold text-lg">{player.name}</span>
          <span className="text-gray-400 text-sm">{posJa} {player.age}歳 {throwJa}投</span>
          <span className={`text-sm ${potentialColor(player.potential.overall)}`}>潜在{player.potential.overall}</span>
        </div>
        <div className="grid grid-cols-4 gap-3 text-sm mb-2">
          <div><span className="text-gray-400">球速 </span><VelocityCell val={player.pitching.velocity} /></div>
          <div><span className="text-gray-400">制球 </span><AbilityCell val={player.pitching.control} /></div>
          <div><span className="text-gray-400">スタ </span><AbilityCell val={player.pitching.stamina} /></div>
          <div><span className="text-gray-400">精神 </span><AbilityCell val={player.pitching.mentalToughness} /></div>
        </div>
        <div className="text-sm">
          <span className="text-gray-400 mr-2">球種:</span>
          <PitchList pitches={player.pitching.pitches} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-blue-400 font-bold text-lg">{player.name}</span>
        <span className="text-gray-400 text-sm">{posJa} {player.age}歳 {batJa}打{throwJa}投</span>
        <span className={`text-sm ${potentialColor(player.potential.overall)}`}>潜在{player.potential.overall}</span>
      </div>
      <div className="grid grid-cols-7 gap-3 text-sm">
        <div><span className="text-gray-400">ミ </span><AbilityCell val={player.batting.contact} /></div>
        <div><span className="text-gray-400">パ </span><AbilityCell val={player.batting.power} /></div>
        <div><span className="text-gray-400">走 </span><AbilityCell val={player.batting.speed} /></div>
        <div><span className="text-gray-400">眼 </span><AbilityCell val={player.batting.eye} /></div>
        <div><span className="text-gray-400">肩 </span><AbilityCell val={player.batting.arm ?? 50} /></div>
        <div><span className="text-gray-400">守 </span><AbilityCell val={player.batting.fielding} /></div>
        <div><span className="text-gray-400">捕 </span><AbilityCell val={player.batting.catching} /></div>
      </div>
    </div>
  );
}
