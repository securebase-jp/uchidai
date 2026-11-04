/**
 * 画面下の操作バー（デモモード）。一時停止／再開、前後の場面、場面の番号。
 * 録画に映らないよう、マウスが止まって 2 秒たつと隠す（一時停止中は出したまま）。
 * ?controls=0 では呼ばれない。開始前と終了後も呼ばない。
 */
import { useCallback, useEffect, useRef, useState } from "react";

const HIDE_AFTER_MS = 2000;
const WAKE_KEYS = new Set(["Space", "ArrowLeft", "ArrowRight", "Tab"]);

type Props = {
  paused: boolean;
  /** 1 始まりの場面番号と全体の数 */
  n: number;
  total: number;
  onPrev(): void;
  onNext(): void;
  onTogglePause(): void;
};

export function DemoControls({ paused, n, total, onPrev, onNext, onTogglePause }: Props) {
  const [awake, setAwake] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAwake(false), HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (WAKE_KEYS.has(e.code)) wake();
    };
    addEventListener("mousemove", wake);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("mousemove", wake);
      removeEventListener("keydown", onKey);
      clearTimeout(timer.current);
    };
  }, [wake]);

  // マウスで押したときはフォーカスを外す（そのあと Space を押すと、ボタンと全体のキー操作で二重に働くため）
  const click = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    fn();
    if (e.detail > 0) e.currentTarget.blur();
  };

  const visible = paused || awake;
  return (
    <>
      {paused && (
        <div className="demo-paused" aria-hidden="true">
          一時停止中
        </div>
      )}
      <div
        className={`demo-controls${visible ? " on" : ""}`}
        role="toolbar"
        aria-label="デモの操作"
      >
        <button type="button" onClick={click(onPrev)}>
          <span aria-hidden="true">◀</span> 前の場面
        </button>
        <button type="button" className="main" onClick={click(onTogglePause)}>
          <span aria-hidden="true">{paused ? "▶" : "‖"}</span> {paused ? "再開" : "一時停止"}
        </button>
        <button type="button" onClick={click(onNext)}>
          次の場面 <span aria-hidden="true">▶</span>
        </button>
        <span className="demo-controls-n mono">
          {n} / {total}
        </span>
      </div>
    </>
  );
}
