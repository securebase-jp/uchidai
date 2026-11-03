import { describe, expect, it } from "vitest";
import { nextMoves, reasonSentence } from "./conclusion.ts";
import type { Graph, MeasureDef, PathStep, Verdict } from "./types.ts";

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
const m = (id: string, mitigation: string, role: string): MeasureDef => ({
  id,
  labelJa: id,
  mitigation,
  patches: [{ role, mitigation, status: "present" }],
});

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

describe("nextMoves（この段階に効く対策の上位）", () => {
  const v = verdict("breached", [
    step("vpn", {
      role: "entry.vpn",
      mitigations: ["M1051"],
      ineffective: [{ mitigation: "M1032", reasonJa: "認証を回避する" }],
      labelJa: "入口から侵入",
    }),
    step("admin", {
      state: "unknown",
      mitigations: ["M1040", "M1026"],
      labelJa: "管理者権限を奪う",
    }),
    step("backup", { mitigations: ["M1053"], labelJa: "バックアップを消す" }),
  ]);
  const measures = [
    m("backup-isolated", "M1053", "backup"),
    m("admin-separate", "M1026", "admin"),
    m("vpn-mfa", "M1032", "entry.vpn"),
    m("vpn-update", "M1051", "entry.vpn"),
    m("edr", "M1040", "admin"),
    m("exec-mfa", "M1032", "cloud.mail_account.exec"),
  ];
  it("早い段階で効く順、同じ段階なら対策の並び順。効かない対策と経路の外は除く", () => {
    expect(nextMoves(measures, v, []).map((x) => x.measure.id)).toEqual([
      "vpn-update",
      "admin-separate",
      "edr",
    ]);
    expect(nextMoves(measures, v, [])[0]?.stageJa).toBe("入口から侵入");
  });
  it("適用中の対策は除き、件数の上限を守る", () => {
    expect(nextMoves(measures, v, ["vpn-update"], 2).map((x) => x.measure.id)).toEqual([
      "admin-separate",
      "edr",
    ]);
  });
  it("止まった段階の対策は勧めない", () => {
    const stopped = verdict("blocked", [
      step("vpn", { role: "entry.vpn", state: "blocked", mitigations: ["M1051"] }),
    ]);
    expect(nextMoves(measures, stopped, [])).toEqual([]);
  });
});
