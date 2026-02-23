"use client";

import type { Position } from "@/models/player";
import { POSITION_NAMES } from "@/models/player";

export interface FieldPlayer {
  id: string;
  name: string;
  position: Position;
}

interface LineupFieldProps {
  players: FieldPlayer[];
  selectedId?: string | null;
  onPlayerClick?: (id: string) => void;
}

/** ポジションごとのSVG座標 */
const POSITION_COORDS: Record<Position, [number, number]> = {
  P:  [150, 230],
  C:  [150, 280],
  "1B": [220, 210],
  "2B": [180, 175],
  "3B": [80, 210],
  SS: [120, 190],
  LF: [55, 120],
  CF: [150, 80],
  RF: [245, 120],
};

/** 選手名を最大5文字に切り詰める */
function truncateName(name: string): string {
  if (name.length <= 5) return name;
  return name.slice(0, 5) + "…";
}

/** 個別ノード */
function PlayerNode({
  x,
  y,
  player,
  isSelected,
  onClick,
}: {
  x: number;
  y: number;
  player: FieldPlayer;
  isSelected: boolean;
  onClick: () => void;
}) {
  const posLabel = POSITION_NAMES[player.position];
  const displayName = truncateName(player.name);

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      {/* 選択時の青いリング */}
      {isSelected && (
        <circle r={18} fill="none" stroke="#3b82f6" strokeWidth={3} />
      )}
      {/* 背景円 */}
      <circle
        r={16}
        fill="white"
        fillOpacity={isSelected ? 0.95 : 0.8}
        stroke={isSelected ? "#3b82f6" : "#6b7280"}
        strokeWidth={isSelected ? 2 : 1}
      />
      {/* ポジション略称 */}
      <text
        textAnchor="middle"
        y={-4}
        fontSize={8}
        fill="#374151"
        fontWeight="bold"
      >
        {posLabel}
      </text>
      {/* 選手名 */}
      <text
        textAnchor="middle"
        y={6}
        fontSize={10}
        fill="#111827"
        fontWeight="500"
      >
        {displayName}
      </text>
    </g>
  );
}

/** パワプロ風フィールド俯瞰SVG */
export function LineupField({ players, selectedId, onPlayerClick }: LineupFieldProps) {
  const handleClick = (id: string) => {
    onPlayerClick?.(id);
  };

  return (
    <svg
      viewBox="0 0 300 300"
      className="w-full"
      style={{ userSelect: "none" }}
    >
      {/* 外野芝（扇形背景） */}
      <path
        d="M 150 290 L 10 100 A 180 180 0 0 1 290 100 Z"
        fill="#1a5c2a"
      />
      {/* 内野土（ダイヤモンド周辺） */}
      <polygon
        points="150,165 225,215 150,280 75,215"
        fill="#8b7355"
      />

      {/* ファウルライン（左） */}
      <line
        x1="150" y1="290"
        x2="10" y2="100"
        stroke="white"
        strokeWidth={1.5}
        strokeOpacity={0.7}
      />
      {/* ファウルライン（右） */}
      <line
        x1="150" y1="290"
        x2="290" y2="100"
        stroke="white"
        strokeWidth={1.5}
        strokeOpacity={0.7}
      />

      {/* 内野ダイヤモンドライン */}
      <polygon
        points="150,165 220,210 150,270 80,210"
        fill="none"
        stroke="white"
        strokeWidth={1.5}
        strokeOpacity={0.8}
      />

      {/* ベース（白い四角） */}
      {/* ホームプレート */}
      <rect x={145} y={265} width={10} height={10} fill="white" opacity={0.9} />
      {/* 1B */}
      <rect x={215} y={205} width={10} height={10} fill="white" opacity={0.9} />
      {/* 2B */}
      <rect x={145} y={160} width={10} height={10} fill="white" opacity={0.9} />
      {/* 3B */}
      <rect x={75} y={205} width={10} height={10} fill="white" opacity={0.9} />

      {/* 投手マウンド */}
      <circle cx={150} cy={222} r={8} fill="#9c8a6b" opacity={0.8} />
      <circle cx={150} cy={222} r={3} fill="#8b7355" />

      {/* 選手ノード */}
      {(Object.keys(POSITION_COORDS) as Position[]).map((pos) => {
        const player = players.find((p) => p.position === pos);
        if (!player) return null;
        const [x, y] = POSITION_COORDS[pos];
        return (
          <PlayerNode
            key={player.id}
            x={x}
            y={y}
            player={player}
            isSelected={selectedId === player.id}
            onClick={() => handleClick(player.id)}
          />
        );
      })}
    </svg>
  );
}
