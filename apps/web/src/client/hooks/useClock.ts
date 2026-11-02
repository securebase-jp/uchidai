/**
 * 再生時計：requestAnimationFrame で進む時刻と、起きた出来事の数（fired）だけを React に流す。
 * 連続的な値（粒、計器）は timeRef と subscribe で読む。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firedCount } from "../lib/playback.ts";

export type Clock = {
  timeRef: { current: number };
  fired: number;
  playing: boolean;
  speed: number;
  ended: boolean;
  rewinding: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  restart(): void;
  toEnd(): void;
  setSpeed(v: number): void;
  /** 時間を巻き戻してから cb を呼ぶ（対策の再判定に使う） */
  rewindThen(cb: () => void): void;
  subscribe(fn: (now: number) => void): () => void;
};

export function useClock(
  beatTimes: number[],
  duration: number,
  options: { reduced: boolean; autoplay: boolean; speed?: number },
  /** 台本の識別子。変わると最初から再生する（同じ時刻列の台本でも区別する） */
  resetKey: unknown = undefined,
): Clock {
  const timeRef = useRef(0);
  const [fired, setFired] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(options.speed ?? 1);
  const [rewinding, setRewinding] = useState(false);
  const listeners = useRef(new Set<(now: number) => void>());
  const rewindRef = useRef<{ from: number; start: number; cb: () => void } | undefined>(undefined);
  const beatsRef = useRef<{ times: number[]; duration: number }>({ times: beatTimes, duration });
  beatsRef.current = { times: beatTimes, duration };
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const emit = useCallback(() => {
    const now = timeRef.current;
    const f = firedCount(
      beatsRef.current.times.map((t) => ({ t })),
      now,
    );
    setFired((prev) => (prev === f ? prev : f));
    for (const fn of listeners.current) fn(now);
  }, []);

  // 台本が変わったら最初から
  const key = resetKey ?? beatTimes.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: key は台本の識別子
  useEffect(() => {
    if (rewindRef.current) return;
    timeRef.current = options.reduced ? duration : 0;
    anchor.current = undefined;
    setPlaying(options.autoplay && !options.reduced);
    emit();
  }, [key, options.reduced]);

  // 壁時計に固定して進める（フレームが落ちても再生時刻がずれない）
  const anchor = useRef<{ wall: number; time: number; speed: number } | undefined>(undefined);
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      const rw = rewindRef.current;
      if (rw) {
        anchor.current = undefined;
        const k = Math.min(1, (ts - rw.start) / 700);
        timeRef.current = rw.from * (1 - k * k);
        if (k >= 1) {
          rewindRef.current = undefined;
          timeRef.current = 0;
          setRewinding(false);
          rw.cb();
        }
        emit();
      } else if (playingRef.current) {
        const d = beatsRef.current.duration;
        const a = anchor.current;
        if (!a || a.speed !== speedRef.current) {
          anchor.current = { wall: ts, time: timeRef.current, speed: speedRef.current };
        } else {
          timeRef.current = Math.min(d, a.time + (ts - a.wall) * a.speed);
        }
        if (timeRef.current >= d) setPlaying(false);
        emit();
      } else {
        anchor.current = undefined;
        for (const fn of listeners.current) fn(timeRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [emit]);

  const play = useCallback(() => {
    if (timeRef.current >= beatsRef.current.duration) timeRef.current = 0;
    anchor.current = undefined;
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);
  const restart = useCallback(() => {
    timeRef.current = 0;
    anchor.current = undefined;
    setPlaying(true);
    emit();
  }, [emit]);
  const toEnd = useCallback(() => {
    timeRef.current = beatsRef.current.duration;
    setPlaying(false);
    emit();
  }, [emit]);
  const setSpeed = useCallback((v: number) => setSpeedState(v), []);
  const rewindThen = useCallback(
    (cb: () => void) => {
      if (options.reduced || timeRef.current <= 0) {
        cb();
        return;
      }
      setPlaying(false);
      setRewinding(true);
      rewindRef.current = { from: timeRef.current, start: performance.now(), cb };
    },
    [options.reduced],
  );
  const subscribe = useCallback((fn: (now: number) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const ended = fired >= beatTimes.length && beatTimes.length > 0 && !playing;
  return useMemo(
    () => ({
      timeRef,
      fired,
      playing,
      speed,
      ended,
      rewinding,
      play,
      pause,
      toggle,
      restart,
      toEnd,
      setSpeed,
      rewindThen,
      subscribe,
    }),
    [
      fired,
      playing,
      speed,
      ended,
      rewinding,
      play,
      pause,
      toggle,
      restart,
      toEnd,
      setSpeed,
      rewindThen,
      subscribe,
    ],
  );
}
