import { describe, expect, it } from "vitest";
import { buildScript, firedCount, sceneAt } from "./playback.ts";
import type { CompanyProfile, Graph, Verdict } from "./types.ts";

const graph: Graph = {
  nodes: [
    { id: "attacker", role: "attacker", label: "攻撃者", layer: "system", side: "external" },
    { id: "vpn", role: "entry.vpn", label: "VPN装置", layer: "system", side: "internal" },
    { id: "admin", role: "admin", label: "管理者", layer: "system", side: "internal" },
    { id: "core", role: "core", label: "生産管理", layer: "system", side: "internal" },
    {
      id: "b1",
      role: "business",
      label: "受注",
      layer: "business",
      side: "internal",
      businessId: "b1",
    },
    {
      id: "impact.partner",
      role: "impact.partner",
      label: "取引先",
      layer: "management",
      side: "external",
    },
    {
      id: "impact.revenue",
      role: "impact.revenue",
      label: "売上",
      layer: "management",
      side: "internal",
    },
  ],
  edges: [
    { id: "attacker->vpn", from: "attacker", to: "vpn", kind: "network" },
    { id: "vpn->admin", from: "vpn", to: "admin", kind: "network" },
    { id: "admin->core", from: "admin", to: "core", kind: "network" },
    { id: "b1->core", from: "b1", to: "core", kind: "depends" },
    { id: "b1->impact.partner", from: "b1", to: "impact.partner", kind: "impacts" },
    { id: "b1->impact.revenue", from: "b1", to: "impact.revenue", kind: "impacts" },
  ],
};
const profile = {
  businesses: [{ id: "b1", name: "受注", assetIds: ["core"], manualDays: 2, recoveryDays: 10 }],
} as unknown as CompanyProfile;
const step = (
  nodeId: string,
  state: Verdict["paths"][0]["steps"][0]["state"],
  extra: Partial<Verdict["paths"][0]["steps"][0]> = {},
) => ({
  nodeId,
  role: nodeId,
  tactic: "TA0001",
  mitigations: [],
  ineffective: [],
  source: "stated" as const,
  state,
  evidence: "registered" as const,
  reasonJa: "",
  ...extra,
});
const breached: Verdict = {
  result: "breached",
  headlineJa: "",
  contradictions: [],
  timeline: [],
  attackVersion: "20.0",
  impact: {
    stopped: [{ businessId: "b1", name: "受注", days: 10, manualDays: 2 }],
    downtimeDays: 10,
    revenueImpactJpy: 1,
    personalDataReached: [],
    reportRequired: false,
  },
  paths: [
    {
      id: "p",
      source: "stated",
      reachedCore: true,
      reachedAssetIds: ["core"],
      steps: [
        step("vpn", "breached", {
          technique: "T1190",
          ineffective: [{ mitigation: "M1032", reasonJa: "認証の手前で素通り" }],
        }),
        step("admin", "unknown"),
        step("core", "breached"),
      ],
    },
  ],
};

describe("buildScript", () => {
  it("侵入はゆっくり、業務への連鎖は速く、最後に結論", () => {
    const s = buildScript(graph, breached, profile);
    const traverses = s.beats.filter((b) => b.kind === "traverse");
    expect(traverses.map((b) => (b.kind === "traverse" ? b.to : ""))).toEqual([
      "vpn",
      "admin",
      "core",
    ]);
    for (const b of traverses)
      if (b.kind === "traverse") expect(b.dur).toBeGreaterThanOrEqual(1000);
    const falls = s.beats.filter((b) => b.kind === "fall");
    expect(falls.length).toBe(3);
    for (const b of falls) if (b.kind === "fall") expect(b.dur).toBeLessThanOrEqual(600);
    expect(s.beats[s.beats.length - 1]?.kind).toBe("conclude");
    expect(s.duration).toBeGreaterThan(5000);
  });
  it("止まる業務が無い結論（情報漏えいなど）は、業務に連鎖せず「影響あり」も出さない。報告の義務は出る", () => {
    const noStop: Verdict = {
      ...breached,
      impact: {
        stopped: [],
        downtimeDays: 0,
        personalDataReached: [],
        reportRequired: true,
      },
    };
    const s = buildScript(graph, noStop, profile);
    expect(s.beats.some((b) => b.kind === "hit" && b.layer === "business")).toBe(false);
    expect(s.beats.some((b) => b.kind === "flash" && b.layer === "business")).toBe(false);
    expect(s.beats.filter((b) => b.kind === "fall").length).toBe(0);
    expect(s.beats[s.beats.length - 1]?.kind).toBe("conclude");
  });
  it("効かない対策を適用すると、その区間は回り込み、理由がログに出る", () => {
    const s = buildScript(graph, breached, profile, {
      applied: [{ id: "vpn-mfa", labelJa: "VPN に多要素認証", mitigation: "M1032", patches: [] }],
    });
    const first = s.beats.find((b) => b.kind === "traverse");
    expect(first?.kind === "traverse" && first.curved).toBe(true);
    const arrive = s.beats.find((b) => b.kind === "arrive");
    expect(arrive?.kind === "arrive" && arrive.ineffective[0]?.mitigation).toBe("M1032");
    expect(s.beats.some((b) => b.kind === "log" && b.text.includes("素通り"))).toBe(true);
  });
  it("枝の段階（持ち出しなど）へ向かう区間は branch の印が付き、止まっても本線は進む", () => {
    const withBranch: Verdict = {
      ...breached,
      paths: [
        {
          ...breached.paths[0],
          steps: [
            step("vpn", "breached", { technique: "T1190" }),
            // 管理者で持ち出し（枝）が止まる → 本線は中核へ進む
            step("admin", "blocked", { branch: true, labelJa: "持ち出し" }),
            step("core", "breached"),
          ],
        } as Verdict["paths"][0],
      ],
    };
    const s = buildScript(graph, withBranch, profile);
    expect(s.segments.map((x) => [x.to, x.branch ?? false])).toEqual([
      ["vpn", false],
      ["admin", true],
      ["core", false],
    ]);
    const traverses = s.beats.filter((b) => b.kind === "traverse");
    expect(traverses.map((b) => (b.kind === "traverse" ? (b.branch ?? false) : null))).toEqual([
      false,
      true,
      false,
    ]);
    expect(
      s.beats.some((b) => b.kind === "log" && b.text.includes("枝：止まっても本線は進む")),
    ).toBe(true);
    // 本線は中核まで進み、結論に至る
    const scene = sceneAt(s, graph, s.beats.length);
    expect(scene.nodes.core?.state).toBe("breached");
    expect(scene.concluded).toBe(true);
  });
  it("止まる段階で経路が終わり、壁が立つ", () => {
    const blocked: Verdict = {
      ...breached,
      result: "blocked",
      impact: { ...breached.impact, stopped: [], downtimeDays: 0 },
      paths: [
        {
          ...breached.paths[0],
          reachedCore: false,
          reachedAssetIds: [],
          steps: [step("vpn", "blocked")],
        } as Verdict["paths"][0],
      ],
    };
    const s = buildScript(graph, blocked, profile);
    expect(s.beats.filter((b) => b.kind === "fall").length).toBe(0);
    const scene = sceneAt(s, graph, s.beats.length);
    expect(scene.walls).toEqual(["vpn"]);
    expect(scene.nodes.vpn?.tagJa).toBe("止まる");
    expect(scene.concluded).toBe(true);
  });
  const worded: Verdict = {
    ...breached,
    paths: [
      {
        ...breached.paths[0],
        steps: [
          step("vpn", "breached"),
          step("admin", "unknown", { breachedLabelJa: "奪われる" }),
          step("core", "breached", {
            breachedLabelJa: "暗号化される",
            breachedDoneJa: "暗号化されました",
          }),
        ],
      } as Verdict["paths"][0],
    ],
  };
  it("型紙の「突破されたときの言葉」があれば札はそれ、無ければ「突破される」", () => {
    const s = buildScript(graph, worded, profile);
    const arrive = s.beats.filter((b) => b.kind === "arrive");
    expect(arrive.at(-1)).toMatchObject({
      nodeId: "core",
      breachedLabelJa: "暗号化される",
      breachedDoneJa: "暗号化されました",
    });
    const end = sceneAt(s, graph, s.beats.length);
    expect(end.nodes.vpn?.tagJa).toBe("突破される");
    expect(end.nodes.admin?.tagJa).toBe("未確認");
    expect(end.nodes.core?.tagJa).toBe("暗号化される");
  });
  it("言葉を持たない経路（AI）が突破済みの資産をもう一度通っても、先に付いた言葉は残る", () => {
    const first = worded.paths[0] as Verdict["paths"][0];
    const twice: Verdict = {
      ...worded,
      paths: [
        first,
        {
          ...first,
          id: "ai",
          source: "ai",
          steps: [step("vpn", "breached"), step("admin", "breached"), step("core", "breached")],
        } as Verdict["paths"][0],
      ],
    };
    const s = buildScript(graph, twice, profile);
    const end = sceneAt(s, graph, s.beats.length);
    expect(end.nodes.core?.tagJa).toBe("暗号化される");
    expect(end.nodes.admin?.tagJa).toBe("突破される");
  });
  it("場面は起きた出来事の数だけで決まり、途中では結論が出ない", () => {
    const s = buildScript(graph, breached, profile);
    const mid = firedCount(s.beats, s.duration / 2);
    const scene = sceneAt(s, graph, mid);
    expect(scene.concluded).toBe(false);
    expect(scene.nodes.vpn?.state).toBe("breached");
    const end = sceneAt(s, graph, s.beats.length);
    expect(end.nodes.b1?.tagJa).toBe("停止");
    expect(end.nodes["impact.revenue"]?.tone).toBe("red");
    expect(end.edges["vpn->admin"]).toBe("attack");
    expect(end.daysTo).toBe(10);
  });
});
