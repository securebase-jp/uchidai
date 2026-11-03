import { describe, expect, it } from "vitest";
import { reasonSentence } from "./conclusion.ts";
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
