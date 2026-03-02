"use client";

import type { PlayAnimationState, PlayAnimationActions } from "./use-play-animation";

const SPEED_OPTIONS = [0.25, 0.5, 1, 2] as const;

interface PlayControlsProps {
  state: PlayAnimationState;
  actions: PlayAnimationActions;
}

export function PlayControls({ state, actions }: PlayControlsProps) {
  const { currentTime, playing, speed, duration } = state;
  const { togglePlay, seek, setSpeed, play: playAction } = actions;

  const displayTime = Math.max(0, currentTime);
  const progress = duration > 0 ? displayTime / duration : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
      {/* 先頭に戻る */}
      <button
        onClick={() => { seek(0); }}
        className="text-gray-400 hover:text-white transition-colors text-sm"
        title="先頭に戻る"
      >
        ⏮
      </button>

      {/* 再生/一時停止 */}
      <button
        onClick={() => {
          if (currentTime < 0) {
            playAction();
          } else {
            togglePlay();
          }
        }}
        className="w-8 h-8 flex items-center justify-center bg-blue-600 hover:bg-blue-500 rounded-full transition-colors text-sm"
        title={playing ? "一時停止" : "再生"}
      >
        {playing ? "⏸" : "▶"}
      </button>

      {/* シークバー */}
      <input
        type="range"
        min={0}
        max={duration}
        step={0.01}
        value={displayTime}
        onChange={e => seek(Number(e.target.value))}
        className="flex-1 accent-blue-500 h-1.5 cursor-pointer"
      />

      {/* 経過時間 / 総時間 */}
      <span
        className="text-xs text-gray-400 font-mono tabular-nums min-w-[80px] text-right"
      >
        {displayTime.toFixed(1)}s / {duration.toFixed(1)}s
      </span>

      {/* 速度切替 */}
      <div className="flex gap-1">
        {SPEED_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
              speed === s
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
