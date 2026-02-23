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
        <circle r={20} fill="none" stroke="#3b82f6" strokeWidth={2} strokeOpacity={0.6} />
      )}
      {/* 背景円 */}
      <circle
        r={17}
        fill={isSelected ? "#1e3a5f" : "#1e293b"}
        fillOpacity={isSelected ? 0.95 : 0.9}
        stroke={isSelected ? "#3b82f6" : "#475569"}
        strokeWidth={isSelected ? 2.5 : 1.5}
      />
      {/* ポジション略称 */}
      <text
        textAnchor="middle"
        y={-4}
        fontSize={8}
        fill="#94a3b8"
        fontWeight="bold"
      >
        {posLabel}
      </text>
      {/* 選手名 */}
      <text
        textAnchor="middle"
        y={7}
        fontSize={10}
        fill="#e2e8f0"
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
      <defs>
        {/* 芝グラデーション */}
        <radialGradient id="grass" cx="50%" cy="90%" r="70%">
          <stop offset="0%" stopColor="#2d8c4e" />
          <stop offset="100%" stopColor="#1a5c2a" />
        </radialGradient>
        {/* 内野ダートグラデーション */}
        <radialGradient id="dirt" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#c4a46c" />
          <stop offset="100%" stopColor="#8b7355" />
        </radialGradient>
        {/* マウンドグラデーション */}
        <radialGradient id="mound" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="#b89c6b" />
          <stop offset="100%" stopColor="#8b7355" />
        </radialGradient>
      </defs>

      {/* 1. 外野芝（扇形背景） */}
      <path
        d="M 150 290 L 10 100 A 180 180 0 0 1 290 100 Z"
        fill="url(#grass)"
      />

      {/* 2. ウォーニングトラック */}
      <path
        d="M 18 105 A 172 172 0 0 1 282 105"
        fill="none"
        stroke="#6b5b3a"
        strokeWidth={8}
        strokeOpacity={0.4}
      />

      {/* 3. フェンス（外壁） */}
      <path
        d="M 10 100 A 180 180 0 0 1 290 100"
        fill="none"
        stroke="#1a3a1a"
        strokeWidth={6}
      />

      {/* 4. 芝刈りパターン（薄い同心円弧） */}
      {[0.3, 0.5, 0.7].map((r, i) => (
        <path
          key={i}
          d={`M ${150 - 180 * r} ${290 - 190 * r} A ${180 * r} ${180 * r} 0 0 1 ${150 + 180 * r} ${290 - 190 * r}`}
          fill="none"
          stroke="#2d8c4e"
          strokeWidth={12}
          strokeOpacity={0.15}
        />
      ))}

      {/* 5. 内野土（ダイヤモンド周辺） */}
      <polygon
        points="150,165 225,215 150,280 75,215"
        fill="url(#dirt)"
      />

      {/* 6. ファウルライン（左） */}
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

      {/* 7. 内野ダイヤモンドライン */}
      <polygon
        points="150,165 220,210 150,270 80,210"
        fill="none"
        stroke="white"
        strokeWidth={1.5}
        strokeOpacity={0.8}
      />

      {/* 8. バッターボックス */}
      <rect x={138} y={259} width={6} height={16} fill="none" stroke="white" strokeWidth={0.8} strokeOpacity={0.5} />
      <rect x={156} y={259} width={6} height={16} fill="none" stroke="white" strokeWidth={0.8} strokeOpacity={0.5} />

      {/* 9. ベース（菱形） */}
      {/* ホームプレート（五角形） */}
      <polygon points="150,275 145,270 145,264 155,264 155,270" fill="white" opacity={0.95} />
      {/* 1B */}
      <polygon points="220,210 215,205 220,200 225,205" fill="white" opacity={0.95} />
      {/* 2B */}
      <polygon points="150,165 145,160 150,155 155,160" fill="white" opacity={0.95} />
      {/* 3B */}
      <polygon points="80,210 75,205 80,200 85,205" fill="white" opacity={0.95} />

      {/* 10. 投手マウンド */}
      <ellipse cx={150} cy={222} rx={10} ry={8} fill="url(#mound)" />
      <rect x={146} y={221} width={8} height={2} rx={1} fill="white" opacity={0.9} />

      {/* 11. 選手ノード */}
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
