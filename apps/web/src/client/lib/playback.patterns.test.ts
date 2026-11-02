/**
 * 台本（buildScript / sceneAt）が Verdict のすべての型で例外なく組めることを固定する。
 * 止められる／抑えられる／大丈夫ではない／確認中／入口なし／対象外、入口候補の複数経路、AI 経路、人のノード、復旧できる
 */
import { describe, expect, it } from "vitest";
import { buildScript, firedCount, sceneAt } from "./playback.ts";
import type { AttackPath, CompanyProfile, Graph, PathStep, StepState, Verdict } from "./types.ts";

const N = (
  id: string,
  layer: Graph["nodes"][number]["layer"],
  side: Graph["nodes"][number]["side"],
  role = id,
): Graph["nodes"][number] => ({ id, role, label: `ラベル ${id}`, layer, side });
const E = (from: string, to: string, kind: Graph["edges"][number]["kind"] = "network") => ({
  id: `${from}->${to}`,
  from,
  to,
  kind,
});

const graph: Graph = {
  nodes: [
    N("attacker", "system", "external"),
    N("vpn", "system", "internal", "entry.vpn"),
    N("rdp", "system", "internal", "entry.rdp"),
    N("vendor-remote", "system", "external", "entry.vendor_remote"),
    N("mail", "system", "external", "cloud.mail"),
    N("admin", "system", "internal"),
    N("server", "system", "internal"),
    N("backup", "system", "internal"),
    N("core", "system", "internal"),
    N("acct", "system", "person", "person.accounting"),
    { ...N("b1", "business", "internal", "business"), businessId: "b1" },
    { ...N("b2", "business", "internal", "business"), businessId: "b2" },
    N("impact.partner", "management", "external"),
    N("impact.legal", "management", "external"),
    N("impact.revenue", "management", "internal"),
    N("impact.money", "management", "internal"),
  ],
  edges: [
    E("attacker", "vpn"),
    E("attacker", "rdp"),
    E("attacker", "vendor-remote"),
    E("attacker", "mail"),
    E("vpn", "admin"),
    E("rdp", "admin"),
    E("admin", "server"),
    E("server", "backup"),
    E("server", "core"),
    E("vendor-remote", "core"),
    E("mail", "acct"),
    E("b1", "core", "depends"),
    E("b2", "server", "depends"),
    E("b1", "impact.partner", "impacts"),
    E("b1", "impact.revenue", "impacts"),
    E("core", "impact.legal", "impacts"),
    E("acct", "impact.money", "impacts"),
  ],
};
const profile = { businesses: [] } as unknown as CompanyProfile;

const step = (nodeId: string, state: StepState, extra: Partial<PathStep> = {}): PathStep => ({
  nodeId,
  role: graph.nodes.find((n) => n.id === nodeId)?.role ?? nodeId,
  tactic: "TA0001",
  mitigations: [],
  ineffective: [],
  source: "stated",
  state,
  evidence: "registered",
  reasonJa: "理由",
  ...extra,
});
const path = (id: string, steps: PathStep[], extra: Partial<AttackPath> = {}): AttackPath => ({
  id,
  source: "stated",
  reachedCore:
    steps[steps.length - 1]?.state !== "blocked" && steps.some((s) => s.nodeId === "core"),
  reachedAssetIds: steps.filter((s) => s.state === "breached").map((s) => s.nodeId),
  steps,
  ...extra,
});
const verdict = (
  result: Verdict["result"],
  paths: AttackPath[],
  impact: Partial<Verdict["impact"]> = {},
): Verdict => ({
  result,
  headlineJa: `見出し ${result}`,
  paths,
  contradictions: [],
  timeline: [],
  attackVersion: "20.0",
  impact: {
    stopped: [],
    downtimeDays: 0,
    personalDataReached: [],
    reportRequired: false,
    ...impact,
  },
});

/** 台本の不変条件：時刻順、最後は結論、場面は最後まで組める */
function checkScript(v: Verdict) {
  const s = buildScript(graph, v, profile, { techniqueLabel: (id) => `名 ${id}` });
  for (let i = 1; i < s.beats.length; i++)
    expect(s.beats[i]?.t).toBeGreaterThanOrEqual(s.beats[i - 1]?.t ?? 0);
  expect(s.beats[s.beats.length - 1]?.kind).toBe("conclude");
  expect(s.duration).toBeGreaterThan(s.beats[s.beats.length - 1]?.t ?? 0);
  const end = sceneAt(s, graph, s.beats.length);
  expect(end.concluded).toBe(true);
  for (let f = 0; f <= s.beats.length; f++) sceneAt(s, graph, f);
  expect(firedCount(s.beats, s.duration)).toBe(s.beats.length);
  expect(firedCount(s.beats, -1)).toBe(0);
  return { s, end };
}

describe("buildScript：結論の全パターン", () => {
  it("大丈夫ではない（突破・未確認を含む、業務と経営に波及、日数あり）", () => {
    const v = verdict(
      "breached",
      [
        path("p1", [
          step("vpn", "breached", { technique: "T1190" }),
          step("admin", "unknown", { technique: "T1078" }),
          step("server", "breached", { technique: "T1021" }),
          step("backup", "breached", { technique: "T1490" }),
          step("core", "breached", { technique: "T1486" }),
        ]),
      ],
      {
        stopped: [{ businessId: "b1", name: "受注", days: 10, manualDays: 2 }],
        downtimeDays: 10,
        revenueImpactJpy: 100_000_000,
        reportRequired: true,
      },
    );
    const { s, end } = checkScript(v);
    expect(end.nodes.admin?.tagJa).toBe("未確認");
    expect(end.nodes.b1?.tagJa).toBe("停止");
    expect(end.nodes.b2?.tagJa).toBe("影響あり");
    expect(end.nodes["impact.legal"]?.tagJa).toBe("法律上の義務");
    expect(end.nodes["impact.revenue"]?.tagJa).toBe("売上が減る");
    expect(end.daysTo).toBe(10);
    expect(s.beats.some((b) => b.kind === "log" && b.text.includes("名 T1190"))).toBe(true);
    expect(s.beats.some((b) => b.kind === "log" && b.text.includes("結果不明"))).toBe(true);
  });
  it("止められる（途中の段階で止まる。業務・経営・日数の出来事は無い）", () => {
    const v = verdict("blocked", [
      path("p1", [step("vpn", "breached"), step("admin", "blocked")], { reachedCore: false }),
    ]);
    const { s, end } = checkScript(v);
    expect(end.walls).toEqual(["admin"]);
    expect(
      s.beats.filter((b) => b.kind === "fall" || b.kind === "hit" || b.kind === "days"),
    ).toEqual([]);
    expect(s.beats.some((b) => b.kind === "log" && b.text.includes("あきらめる"))).toBe(true);
  });
  it("抑えられる（復旧できる段階を通って到達。日数は短い）", () => {
    const v = verdict(
      "mitigated",
      [
        path("p1", [
          step("vpn", "breached"),
          step("server", "breached"),
          step("backup", "recoverable"),
          step("core", "breached"),
        ]),
      ],
      { stopped: [{ businessId: "b1", name: "受注", days: 2, manualDays: 2 }], downtimeDays: 2 },
    );
    const { s, end } = checkScript(v);
    expect(end.nodes.backup?.tone).toBe("green");
    expect(end.nodes.backup?.tagJa).toBe("復旧できる");
    expect(s.beats.some((b) => b.kind === "log" && b.text.includes("復旧できる"))).toBe(true);
    expect(end.daysTo).toBe(2);
  });
  it("確認中（未確認で終わり、到達しない）", () => {
    const v = verdict("pending", [
      path("p1", [step("vpn", "unknown"), step("admin", "unknown")], { reachedCore: false }),
    ]);
    const { end } = checkScript(v);
    expect(end.nodes.vpn?.tone).toBe("amber");
    expect(end.walls).toEqual([]);
    expect(end.daysTo).toBe(0);
  });
  it("入口なし・対象外（経路が無い）は結論だけ", () => {
    for (const r of ["no_entry", "out_of_scope"] as const) {
      const { s, end } = checkScript(verdict(r, []));
      expect(s.beats.map((b) => b.kind)).toEqual(["conclude"]);
      expect(s.primaryPathId).toBeUndefined();
      expect(Object.keys(end.nodes)).toEqual([]);
    }
  });
  it("入口候補の複数経路（記載なし）：すべて描かれ、再訪は短く、入口候補は破線の種類で区別", () => {
    const v = verdict(
      "breached",
      [
        path(
          "p1",
          [
            step("vpn", "breached", { source: "inferred" }),
            step("admin", "breached", { source: "inferred" }),
            step("core", "breached", { source: "inferred" }),
          ],
          { source: "inferred" },
        ),
        path(
          "p2",
          [
            step("rdp", "breached", { source: "candidate" }),
            step("admin", "breached", { source: "candidate" }),
            step("core", "breached", { source: "candidate" }),
          ],
          { source: "candidate" },
        ),
      ],
      { stopped: [{ businessId: "b1", name: "受注", days: 3, manualDays: 1 }], downtimeDays: 3 },
    );
    const { s } = checkScript(v);
    const traverses = s.beats.filter((b) => b.kind === "traverse");
    expect(traverses.map((b) => (b.kind === "traverse" ? b.to : ""))).toEqual([
      "vpn",
      "admin",
      "core",
      "rdp",
      "admin",
      "core",
    ]);
    // 2 本目の admin・core は再訪なので短い
    const revisit = traverses.filter((b) => b.kind === "traverse" && b.to === "admin");
    expect(revisit[1]?.kind === "traverse" && revisit[1].dur).toBeLessThan(
      revisit[0]?.kind === "traverse" ? revisit[0].dur : 0,
    );
    expect(s.segments.some((x) => x.source === "candidate")).toBe(true);
    expect(s.primaryPathId).toBe("p1");
  });
  it("AI 経路は記事の経路の後に、別枠の見出しつきで流れる。結論は変えない", () => {
    const v = verdict("blocked", [
      path("p1", [step("vpn", "blocked")], { reachedCore: false }),
      path(
        "ai1",
        [
          step("vendor-remote", "breached", { source: "ai", technique: "T1133" }),
          step("core", "breached", { source: "ai", technique: "T1486" }),
        ],
        { source: "ai" },
      ),
    ]);
    const { s, end } = checkScript(v);
    const logs = s.beats.filter((b) => b.kind === "log");
    const headIdx = logs.findIndex((b) => b.kind === "log" && b.text.includes("AI攻撃者"));
    expect(headIdx).toBeGreaterThan(0);
    expect(logs.slice(headIdx).every((b) => b.kind === "log" && b.ai)).toBe(true);
    expect(s.primaryPathId).toBe("p1");
    expect(end.logs.filter((l) => l.ai).length).toBeGreaterThan(1);
    expect(s.segments.find((x) => x.to === "vendor-remote")?.source).toBe("ai");
  });
  it("人のノード（人次第）と資金の流出：なりすまし送金", () => {
    const v = verdict(
      "breached",
      [
        path("p1", [
          step("mail", "breached", { technique: "T1078.004" }),
          step("acct", "human", { labelJa: "経理担当の判断" }),
          step("core", "breached"),
        ]),
      ],
      { moneyLossJpy: 5_000_000 },
    );
    const { s, end } = checkScript(v);
    expect(end.nodes.acct?.tagJa).toBe("人次第");
    expect(end.nodes.acct?.tone).toBe("amber");
    const t = s.beats.find((b) => b.kind === "traverse" && b.to === "acct");
    expect(t?.kind === "traverse" && t.dur).toBe(1200);
    expect(s.beats.some((b) => b.kind === "log" && b.text.includes("相手の判断待ち"))).toBe(true);
  });
  it("効かない対策の区間は回り込み、効いた対策の段階には盾が立つ", () => {
    const v = verdict("blocked", [
      path(
        "p1",
        [
          step("vpn", "breached", {
            mitigations: ["M1032", "M1051"],
            ineffective: [{ mitigation: "M1032", reasonJa: "認証の手前で素通り" }],
          }),
          step("admin", "blocked", { mitigations: ["M1026"] }),
        ],
        { reachedCore: false },
      ),
    ]);
    const s = buildScript(graph, v, profile, {
      applied: [
        { id: "vpn-mfa", labelJa: "多要素認証", mitigation: "M1032", patches: [] },
        { id: "admin-separate", labelJa: "管理者の分離", mitigation: "M1026", patches: [] },
      ],
    });
    const first = s.beats.find((b) => b.kind === "traverse");
    expect(first?.kind === "traverse" && first.curved).toBe(true);
    const end = sceneAt(s, graph, s.beats.length);
    expect(end.nodes.vpn?.ineffective[0]?.mitigation).toBe("M1032");
    expect(end.nodes.admin?.effective).toEqual(["M1026"]);
    const second = s.beats.filter((b) => b.kind === "traverse")[1];
    expect(second?.kind === "traverse" && second.blocked).toBe(true);
  });
  it("グラフに無いノードを指す段階は飛ばし、例外にしない", () => {
    const v = verdict("breached", [
      path("p1", [step("vpn", "breached"), step("ghost", "breached"), step("core", "breached")]),
    ]);
    const { s } = checkScript(v);
    expect(
      s.beats.filter((b) => b.kind === "arrive").map((b) => (b.kind === "arrive" ? b.nodeId : "")),
    ).toEqual(["vpn", "core"]);
  });
});
