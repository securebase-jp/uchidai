/**
 * デモモードから再生時計を動かすための橋。
 * 画面（Staff / Exec）は useDemoBridge(clock) を一行呼ぶだけで、デモモードが「結論まで進める」「速さ」を操作できる。
 */
import { useEffect } from "react";
import type { Clock } from "../hooks/useClock.ts";

let current: Clock | undefined;

export function useDemoBridge(clock: Clock | undefined): void {
  useEffect(() => {
    current = clock;
    return () => {
      if (current === clock) current = undefined;
    };
  }, [clock]);
}

export function demoClock(): Clock | undefined {
  return current;
}

/** 時計が現れるまで待ってから操作する（画面の切り替え直後に備える） */
export function withDemoClock(fn: (clock: Clock) => void, timeoutMs = 4000): void {
  const start = performance.now();
  const tick = () => {
    const c = current;
    if (c) {
      fn(c);
      return;
    }
    if (performance.now() - start < timeoutMs) setTimeout(tick, 100);
  };
  tick();
}
