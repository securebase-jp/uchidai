import { describe, expect, it } from "vitest";
import { depthsFromAttacker, layoutGraph, overlaps } from "./layout.ts";
import type { Graph } from "./types.ts";

const node = (
  id: string,
  layer: "system" | "business" | "management",
  side: "internal" | "external" | "person",
  role = id,
) => ({
  id,
  role,
  label: id,
  layer,
  side,
});
const edge = (from: string, to: string, kind: "network" | "depends" | "impacts" = "network") => ({
  id: `${from}->${to}`,
  from,
  to,
  kind,
});

const demo: Graph = {
  nodes: [
    node("attacker", "system", "external", "attacker"),
    node("vpn", "system", "internal"),
    node("vendor", "system", "external"),
    node("pc", "system", "internal"),
    node("admin", "system", "internal"),
    node("server", "system", "internal"),
    node("core", "system", "internal"),
    node("files", "system", "internal"),
    node("backup", "system", "internal"),
    node("mail", "system", "external"),
    node("exec", "system", "person"),
    node("acct", "system", "person"),
    node("b1", "business", "internal", "business"),
    node("b2", "business", "internal", "business"),
    node("b3", "business", "internal", "business"),
    node("impact.partner", "management", "external"),
    node("impact.legal", "management", "external"),
    node("impact.money", "management", "internal"),
    node("impact.revenue", "management", "internal"),
  ],
  edges: [
    edge("attacker", "vpn"),
    edge("attacker", "vendor"),
    edge("attacker", "mail"),
    edge("vpn", "pc"),
    edge("vpn", "admin"),
    edge("vpn", "server"),
    edge("pc", "admin"),
    edge("admin", "server"),
    edge("server", "core"),
    edge("server", "files"),
    edge("server", "backup"),
    edge("vendor", "core"),
    edge("mail", "acct"),
    edge("mail", "exec"),
    edge("b1", "core", "depends"),
    edge("b2", "files", "depends"),
    edge("b1", "impact.partner", "impacts"),
    edge("b1", "impact.revenue", "impacts"),
    edge("acct", "impact.money", "impacts"),
  ],
};

describe("layoutGraph", () => {
  const layout = layoutGraph(demo);
  it("すべてのノードに座標を与え、重ならない", () => {
    const placed = Object.values(layout.nodes);
    expect(placed.length).toBe(demo.nodes.length);
    for (const a of placed)
      for (const b of placed)
        if (a.id < b.id) expect(overlaps(a, b), `${a.id} と ${b.id} が重なる`).toBe(false);
  });
  it("三層を奥（上）から手前（下）に並べる", () => {
    const y = (id: string) => layout.nodes[id]?.y ?? Number.NaN;
    expect(y("vpn")).toBeLessThan(y("b1"));
    expect(y("b1")).toBeLessThan(y("impact.partner"));
  });
  it("社外 → 社内 → 人 の順に左から置き、攻撃者が最も左", () => {
    const x = (id: string) => layout.nodes[id]?.x ?? Number.NaN;
    expect(x("attacker")).toBeLessThan(x("vpn"));
    expect(x("vendor")).toBeLessThan(x("vpn"));
    expect(x("vpn")).toBeLessThan(x("server"));
    expect(x("server")).toBeLessThan(x("core"));
    expect(x("core")).toBeLessThan(x("exec"));
    expect(x("acct")).toBeGreaterThan(x("backup"));
  });
  it("経営が 4 つのときは資金の流出と売上影響を同じ列に縦に並べる", () => {
    const money = layout.nodes["impact.money"];
    const revenue = layout.nodes["impact.revenue"];
    expect(money?.col).toBe(revenue?.col);
    expect(money?.y).not.toBeCloseTo(revenue?.y ?? -1, 3);
    expect(layout.nodes["impact.partner"]?.x).toBeLessThan(money?.x ?? -1);
  });
  it("線の端はノードの縁で止まる", () => {
    const e = layout.edges.find((x) => x.id === "attacker->vpn");
    const a = layout.nodes.attacker;
    expect(e && a && Math.abs(e.x1 - a.x) <= a.w / 2 + 0.01).toBe(true);
  });
  it("攻撃者からの距離を数える", () => {
    const d = depthsFromAttacker(demo);
    expect(d.get("attacker")).toBe(0);
    expect(d.get("vpn")).toBe(1);
    expect(d.get("server")).toBe(2);
    expect(d.get("core")).toBe(3);
    expect(d.get("backup")).toBe(3);
  });
});
