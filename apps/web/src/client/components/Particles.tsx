/**
 * 光の粒：自前の requestAnimationFrame。平時は水色（お金の流れは緑）が静かに流れ、
 * 攻撃が通った線は赤い粒に変わり、乗っ取られた先では流れが消える。
 */
import { useEffect, useRef } from "react";
import type { Clock } from "../hooks/useClock.ts";
import { curveBetween, easeInOut } from "../lib/geometry.ts";
import type { Layout } from "../lib/layout.ts";
import type { Scene, Script } from "../lib/playback.ts";

type Props = {
  layout: Layout;
  scene: Scene;
  script: Script;
  clock: Clock;
  reduced: boolean;
  hidden?: Set<string>;
};

const COLORS = {
  cyan: [86, 214, 242],
  cash: [64, 221, 154],
  red: [255, 58, 79],
} as const;
const rgba = (c: readonly [number, number, number], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function Particles({ layout, scene, script, clock, reduced, hidden }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || reduced) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const dirOf = new Map<string, { from: string; to: string }>();
    for (const s of script.segments) dirOf.set(s.edgeId, { from: s.from, to: s.to });
    for (const b of script.beats)
      if (b.kind === "fall") dirOf.set(b.edgeId, { from: b.from, to: b.to });
    const curves = new Map<string, ReturnType<typeof curveBetween>>();
    const curveOf = (edgeId: string, from: string, to: string, curved: boolean) => {
      const k = `${edgeId}|${from}|${to}|${curved ? 1 : 0}`;
      let c = curves.get(k);
      if (!c) {
        const a = layout.nodes[from];
        const b = layout.nodes[to];
        if (!a || !b) return undefined;
        c = curveBetween(a, b, curved);
        curves.set(k, c);
      }
      return c;
    };
    const curvedEdges = new Set(
      script.beats
        .filter((b) => b.kind === "traverse" && b.curved)
        .map((b) => (b as { edgeId: string }).edgeId),
    );
    const moneyEdge = (to: string) => to === "impact.revenue" || to === "impact.money";
    const seeds = new Map<string, number>();
    const seed = (id: string) => {
      let s = seeds.get(id);
      if (s === undefined) {
        s = (id.split("").reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7) % 1000) / 1000;
        seeds.set(id, s);
      }
      return s;
    };

    const draw = (now: number) => {
      const sc = sceneRef.current;
      const hid = hiddenRef.current;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const sx = w / layout.width;
      const sy = h / layout.height;
      ctx.save();
      ctx.scale(sx, sy);
      const wall = performance.now() / 1000;

      for (const e of layout.edges) {
        if (hid?.has(e.from) || hid?.has(e.to)) continue;
        const st = sc.edges[e.id] ?? "calm";
        if (st === "dead") continue;
        const dir = dirOf.get(e.id);
        const from = st === "attack" || st === "fallen" ? (dir?.from ?? e.from) : e.from;
        const to = st === "attack" || st === "fallen" ? (dir?.to ?? e.to) : e.to;
        const c = curveOf(e.id, from, to, st === "attack" && curvedEdges.has(e.id));
        if (!c) continue;
        const attack = st === "attack" || st === "fallen";
        const n = attack ? 6 : e.kind === "network" ? 3 : 2;
        const speed = attack ? 150 : 34;
        const color = attack
          ? COLORS.red
          : moneyEdge(e.to) || moneyEdge(e.from)
            ? COLORS.cash
            : COLORS.cyan;
        const r = attack ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const t = ((wall * speed) / c.length + seed(e.id) + i / n) % 1;
          const p = c.at(t);
          ctx.beginPath();
          ctx.fillStyle = rgba(color, attack ? 0.95 : 0.8);
          ctx.shadowColor = rgba(color, 0.9);
          ctx.shadowBlur = attack ? 10 : 6;
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 進行中の先頭：赤い光が線の上を進む（止まる段階では壁の手前で止まる）
      for (const b of script.beats) {
        if (b.kind !== "traverse" && b.kind !== "fall") continue;
        if (now < b.t || now > b.t + b.dur + 250) continue;
        const k = Math.min(1, (now - b.t) / b.dur);
        const prog = easeInOut(k) * (b.kind === "traverse" && b.blocked ? 0.9 : 1);
        const c = curveOf(b.edgeId, b.from, b.to, b.kind === "traverse" && b.curved);
        if (!c) continue;
        const head = c.at(prog);
        const fade = now > b.t + b.dur ? 1 - (now - b.t - b.dur) / 250 : 1;
        for (let i = 0; i < 6; i++) {
          const tt = Math.max(0, prog - i * 0.035);
          const p = c.at(tt);
          ctx.beginPath();
          ctx.fillStyle = rgba(COLORS.red, (0.9 - i * 0.14) * fade);
          ctx.shadowColor = rgba(COLORS.red, 1);
          ctx.shadowBlur = 14;
          ctx.arc(p.x, p.y, (b.kind === "fall" ? 4 : 6) - i * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.fillStyle = rgba([255, 230, 230], fade);
        ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    const unsub = clock.subscribe(draw);
    return () => {
      unsub();
      ro.disconnect();
    };
  }, [layout, script, clock, reduced]);

  if (reduced) return null;
  return <canvas ref={ref} className="particles" />;
}
