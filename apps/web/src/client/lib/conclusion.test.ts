import { describe, expect, it } from "vitest";
import { impactTiles, reasonSentence, stageStrip } from "./conclusion.ts";
import type { Graph, PathStep, Verdict } from "./types.ts";

const step = (nodeId: string, extra: Partial<PathStep> = {}): PathStep => ({
  nodeId,
  role: nodeId,
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
    { id: "core", role: "core", label: "生産管理システム", layer: "system", side: "internal" },
  ],
  edges: [],
};
const verdict = (result: Verdict["result"], steps: PathStep[]): Verdict => ({
  result,
  headlineJa: "",
  contradictions: [],
  timeline: [],
  attackVersion: "20.0",
  impact: { stopped: [], downtimeDays: 0, personalDataReached: [], reportRequired: false },
  paths: [
    {
      id: "p",
      source: "stated",
      reachedCore: result === "breached",
      reachedAssetIds: [],
      steps,
    },
  ],
});
const techniques = { T1190: "公開アプリケーションの悪用" };
describe("reasonSentence（結論の理由の一文）", () => {
  it("突破：入口（手法名）から到達先まで", () => {
    const v = verdict("breached", [
      step("vpn", { technique: "T1190", role: "entry.vpn" }),
      step("admin", { state: "unknown" }),
      step("core"),
    ]);
    expect(reasonSentence(v, graph, techniques)).toBe(
      "VPN装置（公開アプリケーションの悪用）から入られ、生産管理システムまで届きます",
    );
  });
  it("止まる：止まった場所と理由", () => {
    const v = verdict("blocked", [
      step("vpn", { state: "blocked", reasonJa: "更新の運用があり、該当しない" }),
    ]);
    expect(reasonSentence(v, graph)).toBe("VPN装置で止まります（更新の運用があり、該当しない）");
  });
  it("抑えられる：復旧できる段階を添える", () => {
    const v = verdict("mitigated", [step("vpn"), step("backup", { state: "recoverable" })]);
    expect(reasonSentence(v, graph)).toBe("VPN装置から入られますが、バックアップは復旧できます");
  });
  it("確認中：未確認の段階を並べる", () => {
    const v = verdict("pending", [step("vpn"), step("admin", { state: "unknown" })]);
    expect(reasonSentence(v, graph)).toBe("VPN装置から入られ、管理者アカウントの段階が未確認です");
  });
  it("前提や枝の段階は数えない。経路が無ければ空", () => {
    const v = verdict("breached", [
      step("admin", { precondition: true }),
      step("vpn"),
      step("backup", { branch: true }),
      step("core"),
    ]);
    expect(reasonSentence(v, graph)).toBe("VPN装置から入られ、生産管理システムまで届きます");
    expect(reasonSentence(verdict("no_entry", []), graph)).toBe("");
  });
});

describe("impactTiles（結論カードの数字タイル）", () => {
  const yenJa = (n: number | undefined) => `¥${n}`;
  const withImpact = (result: Verdict["result"], impact: Partial<Verdict["impact"]>): Verdict => ({
    ...verdict(result, []),
    impact: {
      stopped: [],
      downtimeDays: 0,
      personalDataReached: [],
      reportRequired: false,
      ...impact,
    },
  });
  it("停止・売上影響・取引先・報告義務の 4 枚。停止は最長の業務の名前を添える", () => {
    const v = withImpact("breached", {
      downtimeDays: 10,
      stopped: [
        { businessId: "a", name: "出荷", days: 4, manualDays: 2 },
        { businessId: "b", name: "受注・生産管理", days: 10, manualDays: 2 },
      ],
      revenueImpactJpy: 100_000_000,
      partnerImpactDay: 3,
      reportRequired: true,
      personalDataReached: [
        { assetId: "x", descriptionJa: "", count: 1200, over1000: true, sensitive: true },
      ],
    });
    const t = impactTiles(v, yenJa);
    expect(t.map((x) => [x.label, x.value])).toEqual([
      ["停止", "10日"],
      ["売上影響", "¥100000000"],
      ["取引先", "3日目"],
      ["報告義務", "あり"],
    ]);
    expect(t[0]?.sub).toBe("受注・生産管理");
    expect(t[3]?.sub).toBe("要配慮・1,200件");
    expect(t.every((x) => x.hot)).toBe(true);
  });
  it("何も起きない結論は「なし」を弱く出す。なりすまし送金は流出額のタイルが増える", () => {
    const none = impactTiles(withImpact("blocked", {}), yenJa);
    expect(none.map((x) => x.value)).toEqual(["なし", "なし", "なし", "なし"]);
    expect(none.some((x) => x.hot)).toBe(false);
    const bec = impactTiles(withImpact("breached", { moneyLossJpy: 3_000_000 }), yenJa);
    expect(bec.map((x) => x.label)).toEqual(["停止", "売上影響", "流出", "取引先", "報告義務"]);
  });
  it("件数が分からない報告対象は「1,000人超」。入口なし・対象外はタイルを出さない", () => {
    const v = withImpact("breached", {
      reportRequired: true,
      personalDataReached: [{ assetId: "x", descriptionJa: "", over1000: true, sensitive: false }],
    });
    expect(impactTiles(v, yenJa).at(-1)?.sub).toBe("1,000人超");
    expect(impactTiles(withImpact("no_entry", {}), yenJa)).toEqual([]);
    expect(impactTiles(withImpact("out_of_scope", {}), yenJa)).toEqual([]);
  });
});

describe("stageStrip（段階の帯）", () => {
  it("本線の段階を並べ、突破は型紙の言葉を持つ。前提・枝・同じ構成要素の続きは数えない", () => {
    const v = verdict("breached", [
      step("vpn", { breachedLabelJa: "侵入される" }),
      step("admin", { precondition: true }),
      step("admin"),
      step("admin", { state: "unknown" }),
      step("backup", { branch: true }),
      step("core", { breachedLabelJa: "暗号化される" }),
    ]);
    const strip = stageStrip(v, graph);
    expect(strip.map((s) => [s.label, s.state, s.beyond])).toEqual([
      ["VPN装置", "breached", false],
      ["管理者アカウント", "breached", false],
      ["生産管理システム", "breached", false],
    ]);
    expect(strip[2]?.breachedLabelJa).toBe("暗号化される");
  });
  it("止まった段階より先は beyond（薄く出す）", () => {
    const v = verdict("blocked", [
      step("vpn", { state: "blocked" }),
      step("admin", { state: "breached" }),
      step("core", { state: "breached" }),
    ]);
    expect(stageStrip(v, graph).map((s) => s.beyond)).toEqual([false, true, true]);
    expect(stageStrip({ ...v, paths: [] }, graph)).toEqual([]);
  });
});
