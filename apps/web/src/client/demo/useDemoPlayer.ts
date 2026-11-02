/**
 * デモの進行：場面を順に進め、時刻つきの操作を実行し、音声があれば同期して鳴らす。
 * 時刻は壁時計に固定する（フレームが落ちても原稿とずれない）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DemoScene } from "./data.ts";
import type { DemoAction } from "./schema.ts";

export type DemoPlayer = {
  scene: DemoScene | undefined;
  index: number;
  elapsed: number;
  seconds: number;
  paused: boolean;
  started: boolean;
  finished: boolean;
  audioBlocked: boolean;
  start(index?: number): void;
  togglePause(): void;
  next(): void;
  prev(): void;
  goto(index: number): void;
};

export type DemoHandlers = {
  onEnter(scene: DemoScene): void;
  onAction(action: DemoAction, scene: DemoScene): void;
  onFinish(): void;
};

export function useDemoPlayer(scenes: DemoScene[], handlers: DemoHandlers): DemoPlayer {
  const [index, setIndex] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioSeconds, setAudioSeconds] = useState<Record<number, number>>({});

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const indexRef = useRef(index);
  indexRef.current = index;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const elapsedRef = useRef(0);
  const anchor = useRef<{ wall: number; elapsed: number } | undefined>(undefined);
  const firedRef = useRef(new Set<number>());
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);

  const scene = index >= 0 ? scenes[index] : undefined;
  const seconds = scene ? (audioSeconds[scene.n] ?? scene.seconds) : 0;
  const secondsRef = useRef(seconds);
  secondsRef.current = seconds;

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    audioRef.current = undefined;
  }, []);

  const enter = useCallback(
    (i: number) => {
      const s = scenesRef.current[i];
      stopAudio();
      if (!s) {
        setIndex(-1);
        setFinished(true);
        handlersRef.current.onFinish();
        return;
      }
      firedRef.current = new Set();
      elapsedRef.current = 0;
      anchor.current = undefined;
      setElapsed(0);
      setFinished(false);
      setIndex(i);
      handlersRef.current.onEnter(s);
      if (s.audioUrl) {
        const a = new Audio(s.audioUrl);
        a.preload = "auto";
        a.addEventListener("loadedmetadata", () => {
          if (Number.isFinite(a.duration) && a.duration > 0)
            setAudioSeconds((m) => (m[s.n] === a.duration ? m : { ...m, [s.n]: a.duration }));
        });
        audioRef.current = a;
        if (!pausedRef.current)
          a.play()
            .then(() => setAudioBlocked(false))
            .catch(() => setAudioBlocked(true));
      }
    },
    [stopAudio],
  );

  // 壁時計で進める
  useEffect(() => {
    if (index < 0) return;
    let raf = 0;
    const loop = (ts: number) => {
      if (!pausedRef.current) {
        const a = anchor.current;
        if (!a) anchor.current = { wall: ts, elapsed: elapsedRef.current };
        else elapsedRef.current = a.elapsed + (ts - a.wall) / 1000;
        const s = scenesRef.current[indexRef.current];
        if (s) {
          s.board.actions.forEach((act, k) => {
            if (!firedRef.current.has(k) && act.at <= elapsedRef.current) {
              firedRef.current.add(k);
              handlersRef.current.onAction(act, s);
            }
          });
        }
        const rounded = Math.floor(elapsedRef.current * 10) / 10;
        setElapsed((prev) => (prev === rounded ? prev : rounded));
        if (elapsedRef.current >= secondsRef.current) {
          enter(indexRef.current + 1);
          return;
        }
      } else {
        anchor.current = undefined;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [index, enter]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const start = useCallback(
    (i = 0) => {
      setPaused(false);
      enter(Math.max(0, Math.min(i, scenesRef.current.length - 1)));
    },
    [enter],
  );
  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      const a = audioRef.current;
      if (a) {
        if (next) a.pause();
        else {
          a.currentTime = elapsedRef.current;
          a.play().catch(() => setAudioBlocked(true));
        }
      }
      return next;
    });
  }, []);
  const goto = useCallback(
    (i: number) => {
      if (i < 0) return;
      enter(i);
    },
    [enter],
  );
  const next = useCallback(() => enter(indexRef.current + 1), [enter]);
  const prev = useCallback(() => enter(Math.max(0, indexRef.current - 1)), [enter]);

  return useMemo(
    () => ({
      scene,
      index,
      elapsed,
      seconds,
      paused,
      started: index >= 0 || finished,
      finished,
      audioBlocked,
      start,
      togglePause,
      next,
      prev,
      goto,
    }),
    [
      scene,
      index,
      elapsed,
      seconds,
      paused,
      finished,
      audioBlocked,
      start,
      togglePause,
      next,
      prev,
      goto,
    ],
  );
}
