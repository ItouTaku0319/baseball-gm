import { useState, useCallback, useEffect, useRef } from "react";

// ---- 拡張アニメーションhook ----
// 一時停止・速度変更・シーク対応

export interface PlayAnimationState {
  currentTime: number;   // シミュレーション時間(秒) -1=未開始
  playing: boolean;
  speed: number;         // 0.25 | 0.5 | 1 | 2
  duration: number;      // 総時間
}

export interface PlayAnimationActions {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (speed: number) => void;
  seek: (time: number) => void;
  reset: () => void;
}

export function usePlayAnimation(duration: number): PlayAnimationState & PlayAnimationActions {
  const [currentTime, setCurrentTime] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);

  const animRef = useRef<number | null>(null);
  const prevTimestampRef = useRef(0);
  const simTimeRef = useRef(0);
  const speedRef = useRef(speed);
  const durationRef = useRef(duration);

  // Refs を最新値に同期
  speedRef.current = speed;
  durationRef.current = duration;

  const stopAnimation = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const startAnimation = useCallback(() => {
    stopAnimation();
    prevTimestampRef.current = 0;

    const animate = (now: number) => {
      if (prevTimestampRef.current === 0) {
        prevTimestampRef.current = now;
        animRef.current = requestAnimationFrame(animate);
        return;
      }
      const dt = (now - prevTimestampRef.current) / 1000;
      prevTimestampRef.current = now;

      const newTime = simTimeRef.current + dt * speedRef.current;
      if (newTime >= durationRef.current) {
        simTimeRef.current = durationRef.current;
        setCurrentTime(durationRef.current);
        setPlaying(false);
        animRef.current = null;
        return;
      }
      simTimeRef.current = newTime;
      setCurrentTime(newTime);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
  }, [stopAnimation]);

  const play = useCallback(() => {
    if (durationRef.current <= 0) return;
    // 終端なら先頭に戻して再生
    if (simTimeRef.current >= durationRef.current || simTimeRef.current < 0) {
      simTimeRef.current = 0;
      setCurrentTime(0);
    }
    setPlaying(true);
    startAnimation();
  }, [startAnimation]);

  const pause = useCallback(() => {
    stopAnimation();
    setPlaying(false);
  }, [stopAnimation]);

  const togglePlay = useCallback(() => {
    if (playing) {
      pause();
    } else {
      play();
    }
  }, [playing, play, pause]);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
  }, []);

  const seek = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, durationRef.current));
    simTimeRef.current = clamped;
    setCurrentTime(clamped);
  }, []);

  const reset = useCallback(() => {
    stopAnimation();
    simTimeRef.current = -1;
    setCurrentTime(-1);
    setPlaying(false);
  }, [stopAnimation]);

  // duration変更時にリセット
  useEffect(() => {
    stopAnimation();
    simTimeRef.current = -1;
    setCurrentTime(-1);
    setPlaying(false);
  }, [duration, stopAnimation]);

  // クリーンアップ
  useEffect(() => {
    return () => stopAnimation();
  }, [stopAnimation]);

  return {
    currentTime,
    playing,
    speed,
    duration,
    play,
    pause,
    togglePlay,
    setSpeed,
    seek,
    reset,
  };
}
