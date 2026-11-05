/**
 * 見えるカーソル（録画用の演出。製品の画面は変えない）。
 * 絵コンテの場面に cursor: true があるとき、次に押す操作（click / fill / tap）の少し前に、押す場所へ動く。
 * 押した瞬間は少し縮み、波紋（layers.tsx の showTap）が出る。最後の操作のあと少しして消える。
 */
import { useEffect, useState } from "react";
import { pick } from "./layers.tsx";
import type { DemoAction, StoryboardScene } from "./schema.ts";

/** 押す何秒前に動き始めるか（動きそのものは CSS で 0.45 秒） */
const LEAD = 0.6;
/** 最後の操作のあと、何秒で消すか */
const LINGER = 0.6;

type PointerAction = Extract<DemoAction, { do: "click" | "fill" | "tap" }>;
const isPointer = (a: DemoAction): a is PointerAction =>
  a.do === "click" || a.do === "fill" || a.do === "tap";

/** いま向かうべき操作：これから LEAD 秒以内に押すもの。無ければ直前に押したもの */
export function cursorTarget(actions: DemoAction[], elapsed: number): PointerAction | undefined {
  const ps = actions.filter(isPointer);
  const next = ps.find((a) => a.at >= elapsed && a.at - elapsed <= LEAD);
  if (next) return next;
  const done = ps.filter((a) => a.at < elapsed);
  return done[done.length - 1];
}

export function DemoCursor({ scene, elapsed }: { scene: StoryboardScene; elapsed: number }) {
  const ps = scene.actions.filter(isPointer);
  const first = ps[0];
  const last = ps[ps.length - 1];
  const visible =
    scene.cursor &&
    first !== undefined &&
    last !== undefined &&
    elapsed >= first.at - LEAD - 0.4 &&
    elapsed < last.at + LINGER;
  const target = visible ? cursorTarget(scene.actions, elapsed) : undefined;
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: innerWidth * 0.62,
    y: innerHeight * 0.78,
  });
  const key = target ? `${target.at}:${target.target}:${target.nth ?? 0}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: 向かう先（key）が変わったときだけ測り直す
  useEffect(() => {
    if (!target) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const el = pick(target.target, target.nth, "text" in target ? target.text : undefined);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0) {
        // 矢印の先が、要素の中央より少し左上に来るように
        setPos({ x: r.left + r.width / 2 - Math.min(20, r.width / 6), y: r.top + r.height / 2 });
      } else if (tries++ < 10) timer = setTimeout(run, 60);
    };
    run();
    return () => clearTimeout(timer);
  }, [key]);
  if (!visible) return null;
  const pressing = ps.some((a) => elapsed >= a.at && elapsed < a.at + 0.18);
  return (
    <div
      className={`dl-cursor${pressing ? " press" : ""}`}
      style={{ transform: `translate(${pos.x.toFixed(0)}px, ${pos.y.toFixed(0)}px)` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width="40" height="40" role="presentation">
        <path
          d="M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.6 20.3 L10.7 13.6 L17 13.6 Z"
          fill="#fff"
          stroke="#0b1220"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
