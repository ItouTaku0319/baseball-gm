"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Player } from "@/models/player";
import { PlayerAbilityCard } from "./player-ability-card";

interface TooltipState {
  playerId: string | null;
  x: number;
  y: number;
  visible: boolean;
}

/** ツールチップの状態管理フック */
export function usePlayerTooltip(playerMap: Map<string, Player>) {
  const [tooltip, setTooltip] = useState<TooltipState>({
    playerId: null,
    x: 0,
    y: 0,
    visible: false,
  });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback((playerId: string, x: number, y: number) => {
    setTooltip({ playerId, x, y, visible: true });
  }, []);

  const hideTooltip = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleMouseEnter = useCallback(
    (playerId: string, e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      showTooltip(playerId, e.clientX - rect.left, e.clientY - rect.top);
    },
    [showTooltip]
  );

  const handleMouseLeave = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  const handleTouchStart = useCallback(
    (playerId: string, e: React.TouchEvent) => {
      const touch = e.touches[0];
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      longPressTimer.current = setTimeout(() => {
        showTooltip(playerId, touch.clientX - rect.left, touch.clientY - rect.top);
      }, 500);
    },
    [showTooltip]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!tooltip.visible) {
        // 長押し待ち中に動いたらキャンセル
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        return;
      }
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!el) return;
      const cell = (el as HTMLElement).closest("[data-player-id]") as HTMLElement | null;
      if (cell) {
        const newPlayerId = cell.dataset.playerId;
        if (newPlayerId && newPlayerId !== tooltip.playerId) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            setTooltip({
              playerId: newPlayerId,
              x: touch.clientX - rect.left,
              y: touch.clientY - rect.top,
              visible: true,
            });
          }
        }
      }
      e.preventDefault();
    },
    [tooltip.visible, tooltip.playerId]
  );

  const handleTouchEnd = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const player = tooltip.playerId ? playerMap.get(tooltip.playerId) ?? null : null;

  return {
    containerRef,
    tooltip,
    player,
    handleMouseEnter,
    handleMouseLeave,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}

/** 選手名セルをラップするトリガー（td要素の中身） */
export function PlayerTooltipTrigger({
  playerId,
  name,
  className,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
  onTouchEnd,
}: {
  playerId: string;
  name: string;
  className?: string;
  onMouseEnter: (playerId: string, e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onTouchStart: (playerId: string, e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}) {
  return (
    <td
      className={className}
      data-player-id={playerId}
      onMouseEnter={(e) => onMouseEnter(playerId, e)}
      onMouseLeave={onMouseLeave}
      onTouchStart={(e) => onTouchStart(playerId, e)}
      onTouchEnd={onTouchEnd}
    >
      <span className="cursor-help border-b border-dotted border-gray-500">
        {name}
      </span>
    </td>
  );
}

/** ツールチップ本体（テーブルコンテナ内にabsolute配置） */
export function PlayerTooltipOverlay({
  player,
  x,
  y,
  visible,
  containerRef,
}: {
  player: Player | null;
  x: number;
  y: number;
  visible: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!visible || !player) return null;

  // 表示位置の計算: コンテナの幅・高さに応じて反転
  const container = containerRef.current;
  const containerWidth = container?.offsetWidth ?? 800;
  const containerHeight = container?.offsetHeight ?? 600;

  // カード幅は約450px, 高さは約150px想定
  const cardWidth = 450;
  const cardHeight = 160;

  let left = x + 12;
  let top = y - 8;

  // 右端からはみ出す場合は左側に表示
  if (left + cardWidth > containerWidth) {
    left = x - cardWidth - 12;
    if (left < 0) left = 8;
  }
  // 下端からはみ出す場合は上側に表示
  if (top + cardHeight > containerHeight) {
    top = y - cardHeight;
    if (top < 0) top = 8;
  }

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{ left, top }}
    >
      <div className="pointer-events-none shadow-xl shadow-black/50 rounded-lg">
        <PlayerAbilityCard player={player} />
      </div>
    </div>
  );
}
