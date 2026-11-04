import { formatJpy, measureCost } from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import { costCells, costJpyOf, measureColumns, measureRow } from "./measure-table.ts";
import type { Graph, MeasureDef, PathStep, Verdict } from "./types.ts";

const step = (nodeId: string, role: string, extra: Partial<PathStep> = {}): PathStep => ({
  nodeId,
  role,
  tactic: "TA0001",
  mitigations: [],
  ineffective: [],
  source: "stated",
  state: "breached",
  evidence: "registered",
  reasonJa: "",
  ...extra,
});
const graph: Graph = {
  nodes: [
    { id: "vpn", role: "entry.vpn", label: "VPN装置", layer: "system", side: "internal" },
    { id: "admin", role: "admin", label: "管理者アカウント", layer: "system", side: "internal" },
    { id: "backup", role: "backup", label: "バックアップ", layer: "system", side: "internal" },
  ],
  edges: [],
};
const verdict = (steps: PathStep[], more: PathStep[][] = []): Verdict => ({
  result: "breached",
  headlineJa: "",
  contradictions: [],
  timeline: [],
  attackVersion: "20.0",
  impact: { stopped: [], downtimeDays: 0, personalDataReached: [], reportRequired: false },
  paths: [steps, ...more].map((s, i) => ({
    id: `p${i}`,
    source: "stated" as const,
    reachedCore: true,
    reachedAssetIds: [],
    steps: s,
  })),
});
const m = (id: string, mitigation: string, role: string): MeasureDef => ({
  id,
  labelJa: id,
  mitigation,
  patches: [{ role, mitigation, status: "present" }],
});

describe("measureColumns / measureRow（対策 × 段階の表）", () => {
  const v = verdict([
    step("vpn", "entry.vpn", {
      stageId: "entry",
      mitigations: ["M1051"],
      ineffective: [{ mitigation: "M1032", reasonJa: "認証を回避するため" }],
    }),
    step("admin", "admin", { stageId: "credentials", mitigations: ["M1026"] }),
    step("admin", "admin", { stageId: "exfil", branch: true, mitigations: ["M1057"] }),
    step("backup", "backup", { stageId: "recovery", precondition: true }),
  ]);
  it("列は本線の段階。枝・前提の段階は、効く対策があるときだけ列にする", () => {
    expect(measureColumns(v, graph, []).map((c) => c.label)).toEqual([
      "VPN装置",
      "管理者アカウント",
    ]);
    const cols = measureColumns(v, graph, [m("dlp", "M1057", "admin")]);
    expect(cols.map((c) => c.key)).toEqual(["entry", "credentials", "exfil"]);
  });
  it("効く段階は ●、効かない段階は × と理由、関係しなければ空", () => {
    const cols = measureColumns(v, graph, []);
    expect(measureRow(m("vpn-update", "M1051", "entry.vpn"), v, cols)).toEqual([
      { kind: "effective" },
      undefined,
    ]);
    expect(measureRow(m("vpn-mfa", "M1032", "entry.vpn"), v, cols)).toEqual([
      { kind: "ineffective", reasonJa: "認証を回避するため" },
      undefined,
    ]);
    expect(measureRow(m("other", "UD-01", "person.accounting"), v, cols)).toEqual([
      undefined,
      undefined,
    ]);
  });
  it("経路が複数でも同じ段階は 1 列。別の要素に当たるときは段階の見出しを列名にする", () => {
    const rdp = [step("rdp", "entry.rdp", { stageId: "entry", labelJa: "入口から侵入" })];
    const multi = verdict([step("vpn", "entry.vpn", { stageId: "entry" })], [rdp]);
    const cols = measureColumns(multi, graph, []);
    expect(cols).toHaveLength(1);
    expect(cols[0]?.label).toBe("入口から侵入");
  });
});

describe("costJpyOf / costCells（費用の棒）", () => {
  it("engine の formatJpy の書式から金額を読む。単価だけ・見積もり待ち・社内ルールは金額なし", () => {
    expect(costJpyOf(`${formatJpy(1_584_000)}／年（13,200 円 × 120 台）`)).toBe(1_584_000);
    expect(costJpyOf(formatJpy(3_000_000))).toBe(3_000_000);
    expect(costJpyOf(formatJpy(5_280))).toBe(5_280);
    expect(costJpyOf("約 1.2 億円")).toBe(120_000_000);
    expect(costJpyOf("13,200 円 ／ 台・年（台数未登録のため合計は未算出）")).toBeUndefined();
    expect(costJpyOf("ベンダーの見積もり待ち")).toBeUndefined();
    expect(costJpyOf("社内ルール（外部費用なし）")).toBeUndefined();
  });
  it("最大を 1 とした長さ。見積もり待ちと社内ルールは札", () => {
    const cells = costCells({
      edr: "約 158.4 万円／年（13,200 円 × 120 台）",
      small: "約 31.7 万円／年",
      vpn: "ベンダーの見積もり待ち",
      rule: "社内ルール（外部費用なし）",
    });
    expect(cells.edr).toEqual({ kind: "bar", ratio: 1, textJa: "約 158.4 万円／年" });
    expect(cells.small?.kind === "bar" && cells.small.ratio).toBeCloseTo(0.2, 1);
    expect(cells.vpn?.kind).toBe("quote");
    expect(cells.rule?.kind).toBe("internal");
  });
  it("実際の対策の費用（measureCost）も読める", async () => {
    const { loadKnowledge } = await import("@uchidai/engine");
    const k = loadKnowledge();
    const profile = { ...k.patterns[0], employees: 120 } as never;
    const edr = k.measures.find((x) => x.id === "edr");
    expect(edr).toBeDefined();
    const cost = measureCost(edr as MeasureDef, profile, k);
    expect(costJpyOf(cost.costJa)).toBe(cost.costJpy);
  });
});
