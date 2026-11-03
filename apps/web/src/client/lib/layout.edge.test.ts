/** 自動レイアウトの端：業務 0 件、経営 0 件、業務が上限を超える、システムの層が多い、攻撃者が無い */
import { describe, expect, it } from "vitest";
import { layoutGraph, overlaps } from "./layout.ts";
import type { Graph } from "./types.ts";

const node = (
  id: string,
  layer: "system" | "business" | "management",
  side: "internal" | "external" | "person",
  role = id,
) => ({ id, role, label: id, layer, side });
const edge = (from: string, to: string, kind: "network" | "depends" | "impacts" = "network") => ({
  id: `${from}->${to}`,
  from,
  to,
  kind,
});

function noOverlap(graph: Graph) {
  const layout = layoutGraph(graph);
  const placed = Object.values(layout.nodes);
  for (const a of placed)
    for (const b of placed)
      if (a.id < b.id) expect(overlaps(a, b), `${a.id} と ${b.id} が重なる`).toBe(false);
  for (const p of placed) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y), p.id).toBe(true);
    expect(p.x - p.w / 2).toBeGreaterThanOrEqual(0);
    expect(p.x + p.w / 2).toBeLessThanOrEqual(layout.width);
    expect(p.y + p.h / 2).toBeLessThanOrEqual(layout.height);
  }
  return layout;
}

describe("layoutGraph の端", () => {
  it("業務も経営も無いグラフ（システムだけ）", () => {
    const g: Graph = {
      nodes: [node("attacker", "system", "external"), node("vpn", "system", "internal")],
      edges: [edge("attacker", "vpn")],
    };
    const l = noOverlap(g);
    expect(Object.keys(l.nodes)).toEqual(["attacker", "vpn"]);
    expect(l.planes.length).toBe(3);
  });
  it("空のグラフでも例外にしない", () => {
    const l = layoutGraph({ nodes: [], edges: [] });
    expect(l.nodes).toEqual({});
    expect(l.edges).toEqual([]);
    expect(l.dividers).toEqual([]);
  });
  it("業務が 5 件を超えると 6 件目以降は置かず、その線も描かない", () => {
    const biz = Array.from({ length: 7 }, (_, i) => `b${i}`);
    const g: Graph = {
      nodes: [
        node("attacker", "system", "external"),
        node("core", "system", "internal"),
        ...biz.map((b) => ({ ...node(b, "business", "internal", "business"), businessId: b })),
      ],
      edges: [edge("attacker", "core"), ...biz.map((b) => edge(b, "core", "depends"))],
    };
    const l = noOverlap(g);
    expect(biz.filter((b) => l.nodes[b]).length).toBe(5);
    expect(l.edges.filter((e) => e.kind === "depends").length).toBe(5);
  });
  it("一つの資産に複数の業務が依存し、経営が社外だけ・社内だけでも置ける", () => {
    const g: Graph = {
      nodes: [
        node("attacker", "system", "external"),
        node("core", "system", "internal"),
        { ...node("b1", "business", "internal", "business"), businessId: "b1" },
        { ...node("b2", "business", "internal", "business"), businessId: "b2" },
        node("impact.partner", "management", "external"),
        node("impact.legal", "management", "external"),
      ],
      edges: [
        edge("attacker", "core"),
        edge("b1", "core", "depends"),
        edge("b2", "core", "depends"),
        edge("b1", "impact.partner", "impacts"),
        edge("b2", "impact.legal", "impacts"),
      ],
    };
    noOverlap(g);
    const g2: Graph = {
      nodes: [
        node("attacker", "system", "external"),
        node("core", "system", "internal"),
        node("impact.revenue", "management", "internal"),
        node("impact.money", "management", "internal"),
      ],
      edges: [edge("attacker", "core")],
    };
    const l2 = noOverlap(g2);
    expect(l2.nodes["impact.revenue"]?.col).toBe(l2.nodes["impact.money"]?.col);
  });
  it("システムの層に 12 のノードがあっても重ならない（仕様の上限 8 を超えた場合）", () => {
    const internals = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const g: Graph = {
      nodes: [
        node("attacker", "system", "external"),
        node("vpn", "system", "internal", "entry.vpn"),
        node("rdp", "system", "internal", "entry.rdp"),
        ...internals.map((s) => node(s, "system", "internal")),
        node("exec", "system", "person"),
      ],
      edges: [
        edge("attacker", "vpn"),
        edge("attacker", "rdp"),
        ...internals.map((s) => edge("vpn", s)),
      ],
    };
    noOverlap(g);
  });
  it("列が多いときだけ箱の幅を縮め（下限 110px）、それでも重ならない", () => {
    // 社外に距離の違う列を 5 本（各 2 ノード）＋ 攻撃者 ＋ 社内 2 列 ＋ 人 ＝ 9 列
    const pairs = Array.from({ length: 5 }, (_, i) => [`a${i + 1}`, `b${i + 1}`] as const);
    const chain = (ids: readonly (readonly [string, string])[]) => [
      ...ids.flatMap(([a, b]) => [node(a, "system", "external"), node(b, "system", "external")]),
    ];
    const links = (ids: readonly (readonly [string, string])[]) =>
      ids.flatMap(([a, b], i) => {
        const prev = ids[i - 1];
        return prev
          ? [edge(prev[0], a), edge(prev[1], b)]
          : [edge("attacker", a), edge("attacker", b)];
      });
    const tail = (last: string) => [
      node("vpn", "system", "internal", "entry.vpn"),
      node("core", "system", "internal"),
      node("exec", "system", "person"),
      edge(last, "vpn"),
      edge("vpn", "core"),
    ];
    const g: Graph = {
      nodes: [
        node("attacker", "system", "external"),
        ...chain(pairs),
        ...tail("a5").filter((x) => "layer" in x),
      ],
      edges: [...links(pairs), ...tail("a5").filter((x) => "from" in x)],
    } as Graph;
    const l = noOverlap(g);
    const widths = new Set(Object.values(l.nodes).map((p) => p.w));
    expect(widths.size).toBe(1);
    const w = [...widths][0] ?? 0;
    expect(w).toBeGreaterThanOrEqual(110);
    expect(w).toBeLessThan(134);
    // 7 列までは 134px のまま
    const short = pairs.slice(0, 3);
    const l7 = layoutGraph({
      nodes: [
        node("attacker", "system", "external"),
        ...chain(short),
        ...tail("a3").filter((x) => "layer" in x),
      ],
      edges: [...links(short), ...tail("a3").filter((x) => "from" in x)],
    } as Graph);
    expect(new Set(Object.values(l7.nodes).map((p) => p.w))).toEqual(new Set([134]));
  });
  it("列が 6 本以下なら一人ぼっちの列も合流させない", () => {
    // 攻撃者 / 社外 a1 / 社外 a2（1 つ）/ 社内 vpn / 社内 core / 人 ＝ 6 列
    const g: Graph = {
      nodes: [
        node("attacker", "system", "external"),
        node("a1", "system", "external"),
        node("a1b", "system", "external"),
        node("a2", "system", "external"),
        node("vpn", "system", "internal", "entry.vpn"),
        node("core", "system", "internal"),
        node("exec", "system", "person"),
      ],
      edges: [
        edge("attacker", "a1"),
        edge("attacker", "a1b"),
        edge("a1", "a2"),
        edge("a2", "vpn"),
        edge("vpn", "core"),
      ],
    };
    const l = noOverlap(g);
    expect(new Set(Object.values(l.nodes).map((p) => p.col)).size).toBe(6);
    expect(l.nodes.a2?.col).not.toBe(l.nodes.a1?.col);
  });
  it("攻撃者ノードが無いグラフ（5問の途中など）でも置ける", () => {
    const g: Graph = {
      nodes: [node("core", "system", "internal"), node("pc", "system", "internal")],
      edges: [edge("pc", "core")],
    };
    const l = noOverlap(g);
    expect(l.nodes.core?.depth).toBe(l.nodes.pc?.depth);
  });
});
