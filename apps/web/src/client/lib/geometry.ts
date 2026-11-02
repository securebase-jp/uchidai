/** 線の形：SVG の経路と粒の軌道で同じ計算を使う */
import type { Placed } from "./layout.ts";

export type Curve = { d: string; at: (t: number) => { x: number; y: number }; length: number };

function clip(p: Placed, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (dx === 0 && dy === 0) return { x: p.x, y: p.y };
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : p.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : p.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: p.x + dx * s, y: p.y + dy * s };
}

/** a から b へ。curved なら盾を回り込むように弧を描く */
export function curveBetween(a: Placed, b: Placed, curved = false): Curve {
  const p1 = clip(a, b.x, b.y);
  const p2 = clip(b, a.x, a.y);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  if (!curved) {
    return {
      d: `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`,
      at: (t) => ({ x: p1.x + dx * t, y: p1.y + dy * t }),
      length: len,
    };
  }
  const nx = -dy / len;
  const ny = dx / len;
  const bulge = Math.min(64, len * 0.45);
  const cx = (p1.x + p2.x) / 2 + nx * -bulge;
  const cy = (p1.y + p2.y) / 2 + ny * -bulge;
  return {
    d: `M${p1.x} ${p1.y} Q${cx} ${cy} ${p2.x} ${p2.y}`,
    at: (t) => ({
      x: (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * cx + t * t * p2.x,
      y: (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * cy + t * t * p2.y,
    }),
    length: len * 1.15,
  };
}

export const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
