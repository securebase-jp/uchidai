/**
 * 時刻つきの演出の層（暗転、字だけのオーバーレイ、札、壁）と、図への寄り（ズーム）、数え上げ。
 * どれも場面の経過秒数（elapsed）だけで見た目が決まる。一時停止すると止まり、場面を飛ばしても同じ絵になる。
 */
import { useEffect, useRef } from "react";
import type { Layer, LayerFlag, WallId } from "./schema.ts";

export type LayerFlags = Partial<Record<LayerFlag, boolean>>;

export const WALL_LABEL: Record<WallId, string> = {
  expert: "専門知識",
  advisor: "相談相手と予算",
  time: "時間",
};
const WALL_ORDER: WallId[] = ["expert", "advisor", "time"];

/** 層の表示時間：from 〜 to + 消える時間 */
function tailOf(l: Layer): number {
  if (l.kind === "dim") return l.fadeOut;
  if (l.kind === "text") return l.fade;
  if (l.kind === "badge") return 0.3;
  return 0;
}

function Wall({
  id,
  state,
  big,
}: {
  id: WallId;
  state: "hidden" | "rise" | "stand" | "crumble" | "fallen";
  big: boolean;
}) {
  if (state === "hidden") return <div className={`dl-wall ${big ? "big" : "strip"} hidden`} />;
  return (
    <div className={`dl-wall ${big ? "big" : "strip"} ${state}`} data-wall={id} data-state={state}>
      <span>{WALL_LABEL[id]}</span>
      {state === "fallen" && !big && <i aria-hidden="true">✓</i>}
    </div>
  );
}

function Walls({ layer, elapsed }: { layer: Extract<Layer, { kind: "walls" }>; elapsed: number }) {
  const stateOf = (w: WallId): "hidden" | "rise" | "stand" | "crumble" | "fallen" => {
    const crumbleAt = layer.crumble.find((c) => c.wall === w)?.at;
    if (crumbleAt !== undefined && elapsed >= crumbleAt)
      return elapsed < crumbleAt + 1 ? "crumble" : "fallen";
    if (layer.fallen.includes(w)) return "fallen";
    if (layer.standing.includes(w)) return "stand";
    const riseAt = layer.rise.find((r) => r.wall === w)?.at;
    if (riseAt !== undefined && elapsed >= riseAt) return elapsed < riseAt + 0.6 ? "rise" : "stand";
    return "hidden";
  };
  return (
    <div
      className={`dl-walls ${layer.size}`}
      role="img"
      aria-label="3 枚の壁：専門知識、相談相手と予算、時間"
    >
      {WALL_ORDER.map((w) => (
        <Wall key={w} id={w} state={stateOf(w)} big={layer.size === "big"} />
      ))}
    </div>
  );
}

export function LayerStack({
  layers,
  elapsed,
  flags,
}: {
  layers: Layer[];
  elapsed: number;
  flags: LayerFlags;
}) {
  return (
    <>
      {layers.map((l, i) => {
        if (l.when && !flags[l.when]) return null;
        if (l.kind === "zoom" || l.kind === "spot") return null;
        if (elapsed < l.from || elapsed >= l.to + tailOf(l)) return null;
        const out = elapsed >= l.to;
        const key = `${l.kind}-${i}`;
        if (l.kind === "dim")
          return (
            <div
              key={key}
              className={`dl-dim${out ? " out" : ""}`}
              style={
                {
                  "--dl-opacity": l.opacity,
                  "--dl-in": `${l.fadeIn}s`,
                  "--dl-out": `${l.fadeOut}s`,
                } as React.CSSProperties
              }
              aria-hidden="true"
            />
          );
        if (l.kind === "text")
          return (
            <div
              key={key}
              className={`dl-text pos-${l.pos} size-${l.size}${l.serif ? " serif" : ""}${out ? " out" : ""}`}
              style={{ "--dl-in": `${l.fade}s`, "--dl-out": `${l.fade}s` } as React.CSSProperties}
            >
              <span>{l.text}</span>
            </div>
          );
        if (l.kind === "badge")
          return (
            <div key={key} className={`dl-badge pos-${l.pos} ${l.tone}${out ? " out" : ""}`}>
              {l.text}
            </div>
          );
        return <Walls key={key} layer={l} elapsed={elapsed} />;
      })}
    </>
  );
}

/** いま有効な寄り（なければ undefined） */
export function activeZoom(
  layers: Layer[],
  elapsed: number,
  flags: LayerFlags,
): Extract<Layer, { kind: "zoom" }> | undefined {
  for (const l of layers)
    if (l.kind === "zoom" && elapsed >= l.from && elapsed < l.to && (!l.when || flags[l.when]))
      return l;
  return undefined;
}

const ZOOM_SELECTOR = ".stage-zoom";

/** 図（.stage-zoom）をノードに寄せる。ノードが無い（別の画面にいる）ときは何もしない */
export function applyZoom(target: string | undefined, scale = 1): boolean {
  const el = document.querySelector<HTMLElement>(ZOOM_SELECTOR);
  if (!el) return false;
  if (!target) {
    el.style.transform = "";
    return true;
  }
  const svg = el.querySelector<SVGSVGElement>("svg.diagram");
  const node = el.querySelector<SVGGraphicsElement>(
    `g[data-node="${CSS.escape(target)}"] rect.box`,
  );
  if (!svg || !node) return false;
  const vb = svg.viewBox.baseVal;
  if (!vb.width) return false;
  const k = svg.clientWidth / vb.width;
  const bb = node.getBBox();
  const cx = (bb.x + bb.width / 2) * k;
  const cy = (bb.y + bb.height / 2) * k;
  const w = el.clientWidth;
  const h = el.clientHeight;
  // 拡大した図が枠からはみ出して空白を見せないよう、移動量を枠に収める
  const clamp = (v: number, size: number) => Math.min(0, Math.max(size - size * scale, v));
  const tx = clamp(w / 2 - scale * cx, w);
  const ty = clamp(h / 2 - scale * cy, h);
  el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale})`;
  return true;
}

/** 層の zoom を画面に反映する。図が現れるのを待つ（画面の切り替え直後に備えて数回試す） */
export function useZoomLayer(layers: Layer[], elapsed: number, flags: LayerFlags): void {
  const z = activeZoom(layers, elapsed, flags);
  const key = z ? `${z.target}@${z.scale}` : "";
  const last = useRef("");
  useEffect(() => {
    if (key === last.current) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const ok = applyZoom(z?.target, z?.scale);
      if (ok) last.current = key;
      else if (tries++ < 30) timer = setTimeout(run, 100);
    };
    run();
    return () => clearTimeout(timer);
  }, [key, z]);
  // 場面が変わって層が無くなったら、寄せたままにしない
  useEffect(
    () => () => {
      applyZoom(undefined);
      last.current = "";
    },
    [],
  );
}

/** いま有効な、画面の要素への寄り（なければ undefined） */
export function activeSpot(
  layers: Layer[],
  elapsed: number,
  flags: LayerFlags,
): Extract<Layer, { kind: "spot" }> | undefined {
  for (const l of layers)
    if (l.kind === "spot" && elapsed >= l.from && elapsed < l.to && (!l.when || flags[l.when]))
      return l;
  return undefined;
}

const SPOT_TRANSITION = "transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1)";

/**
 * container を拡大し、target の (x, 中心) を画面の (50%, y) に持ってくる。target が無ければ寄りを戻す。
 * 寄せている途中でも正しく測れるよう、いま効いている変形（行列）から変形前の位置を逆算する（transform-origin は 0 0）
 */
export function applySpot(
  container: string,
  target: string | undefined,
  scale = 1,
  y = 0.45,
  animate = true,
  x = 0.5,
): boolean {
  const c = document.querySelector<HTMLElement>(container);
  if (!c) return false;
  c.style.transition = animate ? SPOT_TRANSITION : "none";
  if (!target) {
    c.style.transform = "";
    return true;
  }
  const t = c.querySelector<HTMLElement>(target);
  if (!t) return false;
  const rc = c.getBoundingClientRect();
  const rt = t.getBoundingClientRect();
  if (rt.width === 0 || rc.width === 0) return false;
  const m = new DOMMatrixReadOnly(
    getComputedStyle(c).transform === "none" ? undefined : getComputedStyle(c).transform,
  );
  const s0 = m.a || 1;
  const ox = rc.left - m.e;
  const oy = rc.top - m.f;
  const lx = (rt.left + rt.width * x - rc.left) / s0;
  const ly = (rt.top + rt.height / 2 - rc.top) / s0;
  const tx = innerWidth / 2 - ox - scale * lx;
  const ty = innerHeight * y - oy - scale * ly;
  c.style.transformOrigin = "0 0";
  c.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale})`;
  return true;
}

/** 層の spot を画面に反映する。要素が現れるのを待つ（数回試す）。寄りが終わったら戻す */
export function useSpotLayer(layers: Layer[], elapsed: number, flags: LayerFlags): void {
  const z = activeSpot(layers, elapsed, flags);
  const key = z ? `${z.container}|${z.target}@${z.scale}/${z.y}/${z.x}` : "";
  const last = useRef<{ key: string; container?: string }>({ key: "" });
  useEffect(() => {
    if (key === last.current.key) return;
    const prev = last.current.container;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (!z) {
        if (prev) applySpot(prev, undefined);
        last.current = { key };
        return;
      }
      if (prev && prev !== z.container) applySpot(prev, undefined);
      const ok = applySpot(z.container, z.target, z.scale, z.y, true, z.x);
      if (ok) last.current = { key, container: z.container };
      else if (tries++ < 30) timer = setTimeout(run, 100);
    };
    run();
    return () => clearTimeout(timer);
  }, [key, z]);
  // 場面が変わって層が無くなったら、寄せたままにしない
  useEffect(
    () => () => {
      const c = last.current.container;
      if (c) applySpot(c, undefined, 1, 0.45, false);
      last.current = { key: "" };
    },
    [],
  );
}

/** セレクタに合う要素から、text を含むものの nth 番目（絵コンテの click / fill / tap の対象） */
export function pick(selector: string, nth = 0, text?: string): Element | undefined {
  const all = [...document.querySelectorAll(selector)].filter(
    (e) => text === undefined || (e.textContent ?? "").includes(text),
  );
  return all[nth];
}

/** 0 から value まで数え上げた値（from 秒から dur 秒かけて。後半を遅くする） */
export function countUp(value: number, elapsed: number, from: number, dur: number): number {
  if (elapsed <= from) return 0;
  const k = Math.min(1, (elapsed - from) / dur);
  const eased = 1 - (1 - k) ** 3;
  return Math.round(value * eased);
}

/** 押した場所に輪を出す（画面の操作を見せる）。動きを減らす設定では出さない */
export function showTap(el: Element): void {
  const set = document.documentElement.dataset.reduced;
  if (set === "true") return;
  const r = el.getBoundingClientRect();
  // 波紋は 2 重（内側の濃い輪と、遅れて広がる外側の輪）。1080p の動画でも目に入る大きさにする
  for (const cls of ["dl-tap", "dl-tap outer"]) {
    const ring = document.createElement("div");
    ring.className = cls;
    ring.style.left = `${r.left + r.width / 2}px`;
    ring.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 1100);
  }
}
