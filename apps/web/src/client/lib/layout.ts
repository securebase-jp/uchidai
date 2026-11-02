/**
 * 自動レイアウト：構成グラフ（Graph）だけから座標を決める。手で置いた固定の図は持たない。
 *
 * 三層（システム／業務／経営）を奥から手前へ重ねた台形の面に描き、
 * 各面の中は 社外 → 社内 → 人 の列に分け、システムの層は攻撃者からの距離（通信の線の段数）で
 * 列を細分する。同じ列の中は縦に積み、縦の並びは前の列の相手に近づける（重なりを避ける）。
 */
import type { Graph, GraphEdge, GraphNode, Layer, Side } from "./types.ts";

export type Placed = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: Layer;
  side: Side;
  col: number;
  row: number;
  depth: number;
};
export type Plane = {
  layer: Layer;
  top: number;
  bottom: number;
  topL: number;
  topR: number;
  botL: number;
  botR: number;
  points: string;
};
export type PlacedEdge = GraphEdge & { x1: number; y1: number; x2: number; y2: number };
export type Layout = {
  width: number;
  height: number;
  gutter: number;
  planes: Plane[];
  nodes: Record<string, Placed>;
  edges: PlacedEdge[];
  /** 社外／社内／人の区切り（システムの層、u 座標） */
  dividers: { layer: Layer; u: number; labelJa: string }[];
};

export const WIDTH = 1240;
export const HEIGHT = 780;
const GUTTER = 108;
const USABLE = WIDTH - GUTTER - 16;
const CX = GUTTER + USABLE / 2;

const PLANE_SPEC: Record<Layer, { top: number; bottom: number; topW: number; botW: number }> = {
  system: { top: 34, bottom: 322, topW: 0.76, botW: 0.86 },
  business: { top: 364, bottom: 484, topW: 0.86, botW: 0.91 },
  management: { top: 526, bottom: 704, topW: 0.91, botW: 0.985 },
};
const NODE_SIZE: Record<Layer, { w: number; h: number }> = {
  system: { w: 134, h: 50 },
  business: { w: 150, h: 50 },
  management: { w: 212, h: 58 },
};
const SIDE_ORDER: Record<Side, number> = { external: 0, internal: 1, person: 2 };

export function project(layer: Layer, u: number, v: number): { x: number; y: number } {
  const p = PLANE_SPEC[layer];
  const w = (p.topW + (p.botW - p.topW) * v) * USABLE;
  return { x: CX + (u - 0.5) * w, y: p.top + v * (p.bottom - p.top) };
}

function plane(layer: Layer): Plane {
  const p = PLANE_SPEC[layer];
  const tl = project(layer, 0, 0);
  const tr = project(layer, 1, 0);
  const bl = project(layer, 0, 1);
  const br = project(layer, 1, 1);
  return {
    layer,
    top: p.top,
    bottom: p.bottom,
    topL: tl.x,
    topR: tr.x,
    botL: bl.x,
    botR: br.x,
    points: `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`,
  };
}

/** 攻撃者からの距離（通信の線を何本たどるか）。届かないノードは最奥 */
export function depthsFromAttacker(graph: Graph): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== "network") continue;
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const depth = new Map<string, number>();
  const start = graph.nodes.find((n) => n.role === "attacker")?.id;
  if (start) {
    depth.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift() as string;
      for (const next of adj.get(cur) ?? []) {
        if (depth.has(next)) continue;
        depth.set(next, (depth.get(cur) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  const max = Math.max(0, ...depth.values()) + 1;
  for (const n of graph.nodes) if (n.layer === "system" && !depth.has(n.id)) depth.set(n.id, max);
  // 業務が依存する社内の資産（中核システムなど）は、近道の線があっても最も奥の列に置く
  const internal = graph.nodes.filter((n) => n.layer === "system" && n.side === "internal");
  const deepest = Math.max(0, ...internal.map((n) => depth.get(n.id) ?? 0));
  const dependedOn = new Set(graph.edges.filter((e) => e.kind === "depends").map((e) => e.to));
  for (const n of internal) if (dependedOn.has(n.id)) depth.set(n.id, deepest);
  return depth;
}

type Column = { side: Side; depth: number; nodes: GraphNode[] };

/** 一列に積める上限。超えた列は同じ距離のまま隣に分ける（仕様の上限 8 を超える構成でも重ねない） */
const MAX_ROWS = 5;

function systemColumns(graph: Graph, depth: Map<string, number>): Column[] {
  const nodes = graph.nodes.filter((n) => n.layer === "system");
  const key = (n: GraphNode) =>
    n.side === "person" ? "person" : `${n.side}:${depth.get(n.id) ?? 0}`;
  const map = new Map<string, Column>();
  for (const n of nodes) {
    const k = key(n);
    const col = map.get(k) ?? {
      side: n.side,
      depth: n.side === "person" ? 0 : (depth.get(n.id) ?? 0),
      nodes: [],
    };
    col.nodes.push(n);
    map.set(k, col);
  }
  return [...map.values()]
    .sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || a.depth - b.depth)
    .flatMap((col) => {
      if (col.nodes.length <= MAX_ROWS) return [col];
      const parts: Column[] = [];
      for (let i = 0; i < col.nodes.length; i += MAX_ROWS)
        parts.push({ ...col, nodes: col.nodes.slice(i, i + MAX_ROWS) });
      return parts;
    });
}

/** 縦の並び：前の列につながる相手の行の平均に近づける（線の交差と重なりを減らす） */
function orderRows(columns: Column[], graph: Graph): void {
  const rowOf = new Map<string, number>();
  for (const col of columns) {
    if (col.nodes.length > 1 && rowOf.size > 0) {
      const score = (n: GraphNode) => {
        const rows = graph.edges
          .filter((e) => e.kind === "network" && (e.from === n.id || e.to === n.id))
          .map((e) => rowOf.get(e.from === n.id ? e.to : e.from))
          .filter((r): r is number => r !== undefined);
        return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0.5;
      };
      col.nodes.sort((a, b) => score(a) - score(b));
    }
    col.nodes.forEach((n, i) => {
      rowOf.set(n.id, col.nodes.length === 1 ? 0.5 : i / (col.nodes.length - 1));
    });
  }
}

function rowV(i: number, rows: number): number {
  if (rows === 1) return 0.5;
  const span = rows <= 2 ? 0.46 : rows === 3 ? 0.7 : 0.8;
  return 0.5 - span / 2 + (span * i) / (rows - 1);
}

function clipToRect(p: Placed, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (dx === 0 && dy === 0) return { x: p.x, y: p.y };
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : p.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : p.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: p.x + dx * s, y: p.y + dy * s };
}

export function layoutGraph(graph: Graph): Layout {
  const depth = depthsFromAttacker(graph);
  const nodes: Record<string, Placed> = {};
  const place = (n: GraphNode, u: number, v: number, col: number, row: number, rows: number) => {
    const size = NODE_SIZE[n.layer];
    const h = n.layer === "system" && rows >= 5 ? 42 : size.h;
    const { x, y } = project(n.layer, u, v);
    nodes[n.id] = {
      id: n.id,
      x,
      y,
      w: size.w,
      h,
      layer: n.layer,
      side: n.side,
      col,
      row,
      depth: depth.get(n.id) ?? 0,
    };
  };

  // システムの層：社外（距離順）→ 社内（距離順）→ 人
  const cols = systemColumns(graph, depth);
  orderRows(cols, graph);
  const n = cols.length;
  cols.forEach((col, ci) => {
    const u = (ci + 0.5) / n;
    col.nodes.forEach((node, ri) => {
      place(node, u, rowV(ri, col.nodes.length), ci, ri, col.nodes.length);
    });
  });
  const dividers: Layout["dividers"] = [];
  const firstInternal = cols.findIndex((c) => c.side === "internal");
  const firstPerson = cols.findIndex((c) => c.side === "person");
  if (firstInternal > 0) dividers.push({ layer: "system", u: firstInternal / n, labelJa: "社内" });
  if (firstPerson > 0) dividers.push({ layer: "system", u: firstPerson / n, labelJa: "人" });

  // 業務の層：一列（上限 5）
  const biz = graph.nodes.filter((x) => x.layer === "business").slice(0, 5);
  biz.forEach((node, i) => {
    place(node, (i + 0.5) / biz.length, 0.5, i, 0, 1);
  });

  // 経営の層：社外は一つずつ列に、社内（資金の流出・売上影響）は同じ列に縦に並べる
  const mgmt = graph.nodes.filter((x) => x.layer === "management");
  const ext = mgmt.filter((x) => x.side !== "internal");
  const int = mgmt.filter((x) => x.side === "internal");
  const mcols: GraphNode[][] = [...ext.map((x) => [x]), ...(int.length ? [int] : [])];
  mcols.forEach((group, ci) => {
    const u = (ci + 0.5) / mcols.length;
    group.forEach((node, ri) => {
      place(node, u, group.length === 1 ? 0.5 : 0.28 + 0.44 * ri, ci, ri, group.length);
    });
  });

  const edges: PlacedEdge[] = graph.edges.flatMap((e) => {
    const a = nodes[e.from];
    const b = nodes[e.to];
    if (!a || !b) return [];
    const p1 = clipToRect(a, b.x, b.y);
    const p2 = clipToRect(b, a.x, a.y);
    return [{ ...e, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }];
  });

  return {
    width: WIDTH,
    height: HEIGHT,
    gutter: GUTTER,
    planes: (["system", "business", "management"] as Layer[]).map(plane),
    nodes,
    edges,
    dividers,
  };
}

/** 2 つの矩形が重なるか（テストと検証用） */
export function overlaps(a: Placed, b: Placed, margin = 4): boolean {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + margin
  );
}
