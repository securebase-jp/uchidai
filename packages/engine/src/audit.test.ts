/**
 * 監査で足した境界のテスト：根拠の優先順位と矛盾、未確認・人次第は止めない、結論の決め方、
 * 入口不明時の候補展開、線に沿った経路、役割に資産が複数、バックアップなし、out_of_scope、AI 経路の 4 点検証
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { validateAiPath } from "./ai.ts";
import { decideResult, evaluate, profileContradictions, walkStages } from "./evaluate.ts";
import { adjacent, buildGraph, connected, profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge, loadProfile, type Rule, repoRoot } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { evaluateRule, resolveControl } from "./rules.ts";
import type {
  Asset,
  AttackPath,
  Case,
  CompanyProfile,
  Contradiction,
  ProfileAnswers,
} from "./types.ts";

let knowledge: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  knowledge = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

const case1: Case = {
  title: "被害事例1",
  damageType: "ransomware",
  clarity: "partial",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1190"], source: "stated", quote: "VPN装置の脆弱性" },
    { tactic: "TA0040", techniques: ["T1490"], source: "stated", quote: "バックアップも暗号化" },
    { tactic: "TA0040", techniques: ["T1486"], source: "stated", quote: "暗号化" },
  ],
};
const case5: Case = {
  title: "被害事例5",
  damageType: "bec",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0043", techniques: ["T1589.001"], source: "stated" },
    { tactic: "TA0001", techniques: ["T1078.004"], source: "stated" },
    { tactic: "TA0005", techniques: ["T1656"], source: "stated" },
  ],
};

function asset(partial: Partial<Asset> & { id: string; role: string }): Asset {
  return {
    kind: "device",
    label: partial.id,
    controls: [],
    attrs: {},
    attrEvidence: {},
    ...partial,
  };
}
function clone(p: CompanyProfile): CompanyProfile {
  return structuredClone(p);
}
function setControls(
  p: CompanyProfile,
  assetId: string,
  controls: Asset["controls"],
): CompanyProfile {
  const next = clone(p);
  const a = next.assets.find((x) => x.id === assetId);
  if (!a) throw new Error(assetId);
  a.controls = controls;
  return next;
}
const states = (p: AttackPath | undefined) => (p?.steps ?? []).map((s) => `${s.nodeId}:${s.state}`);

describe("根拠の優先順位と矛盾", () => {
  it("同じ緩和策の重複登録が食い違えば矛盾を 1 件だけ出し、悪い方（なし）で判定する", () => {
    const a = asset({
      id: "vpn",
      role: "entry.vpn",
      controls: [
        { mitigation: "M1051", status: "present", evidence: "registered" },
        { mitigation: "M1051", status: "absent", evidence: "vendor" },
      ],
    });
    const contradictions: Contradiction[] = [];
    const r = resolveControl(a, "M1051", contradictions);
    expect(r).toMatchObject({ status: "absent", evidence: "vendor" });
    resolveControl(a, "M1051", contradictions);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.messageJa).toContain("悪い方");
  });
  it("外部確認が担当者登録より強い：登録「なし」・外部「あり」なら悪い方の「なし」だが根拠は矛盾として残る", () => {
    const a = asset({
      id: "vpn",
      role: "entry.vpn",
      controls: [
        { mitigation: "M1042", status: "absent", evidence: "registered" },
        { mitigation: "M1042", status: "present", evidence: "external" },
      ],
    });
    const contradictions: Contradiction[] = [];
    expect(resolveControl(a, "M1042", contradictions)?.status).toBe("absent");
    expect(contradictions[0]?.external).toContain("外部確認");
  });
  it("未確認と確定の組み合わせは矛盾ではなく、確定の方を採る", () => {
    const a = asset({
      id: "admin",
      role: "admin",
      controls: [
        { mitigation: "M1026", status: "unknown", evidence: "none" },
        { mitigation: "M1026", status: "present", evidence: "vendor" },
      ],
    });
    const contradictions: Contradiction[] = [];
    expect(resolveControl(a, "M1026", contradictions)).toMatchObject({
      status: "present",
      evidence: "vendor",
    });
    expect(contradictions).toEqual([]);
  });
  it("M1042 非公開の登録があっても外部確認で露出していれば公開ありとして判定し、矛盾に出す", () => {
    const p = setControls(demo, "vpn", [
      { mitigation: "M1042", status: "present", evidence: "registered" },
      { mitigation: "M1051", status: "absent", evidence: "vendor" },
    ]);
    const v = evaluate(case1, p, { knowledge });
    expect(v.result).toBe("breached");
    expect(v.paths[0]?.steps[0]?.state).toBe("breached");
    expect(v.contradictions).toHaveLength(1);
    expect(v.contradictions[0]).toMatchObject({ assetId: "vpn", external: "外部確認：公開あり" });
  });
  it("評価で同じ緩和策を何度参照しても矛盾は重複しない", () => {
    const p = setControls(demo, "server", [
      { mitigation: "M1030", status: "present", evidence: "registered" },
      { mitigation: "M1030", status: "absent", evidence: "vendor" },
      { mitigation: "M1035", status: "absent", evidence: "registered" },
    ]);
    const v = evaluate(case1, p, { knowledge });
    expect(v.contradictions.filter((c) => c.assetId === "server")).toHaveLength(1);
    expect(v.paths[0]?.steps.find((s) => s.role === "server")).toMatchObject({
      state: "breached",
      evidence: "vendor",
    });
  });
});

describe("未確認と人次第は止めない（評価関数の保証）", () => {
  const permissive: Rule = {
    id: "test.permissive",
    role: "admin",
    techniques: ["T1003"],
    materialsJa: "",
    mitigations: ["M1026"],
    ineffective: [],
    outcomes: [{ state: "blocked", reasonJa: "いつも止まる（誤ったルール）" }],
  };
  it("条件なしの blocked は未確認に落ちる", () => {
    const r = evaluateRule(permissive, asset({ id: "admin", role: "admin" }));
    expect(r.state).toBe("unknown");
    expect(r.evidence).toBe("none");
    expect(r.reasonJa).toContain("未確認");
  });
  it("not だけの条件（根拠なし）で止まる判定も未確認に落ちる", () => {
    const rule: Rule = {
      ...permissive,
      outcomes: [
        {
          state: "blocked",
          when: { not: { control: { mitigation: "M1026", status: "absent" } } },
          reasonJa: "なしでなければ止まる",
        },
        { state: "breached", reasonJa: "x" },
      ],
    };
    expect(evaluateRule(rule, asset({ id: "admin", role: "admin" })).state).toBe("unknown");
    const present = asset({
      id: "admin",
      role: "admin",
      controls: [{ mitigation: "M1026", status: "present", evidence: "vendor" }],
    });
    expect(evaluateRule(rule, present).state).toBe("unknown");
  });
  it("根拠のある present なら blocked のまま", () => {
    const rule: Rule = {
      ...permissive,
      outcomes: [
        {
          state: "blocked",
          when: { control: { mitigation: "M1026", status: "present" } },
          reasonJa: "ok",
        },
        { state: "breached", reasonJa: "x" },
      ],
    };
    const a = asset({
      id: "admin",
      role: "admin",
      controls: [{ mitigation: "M1026", status: "present", evidence: "vendor" }],
    });
    expect(evaluateRule(rule, a)).toMatchObject({ state: "blocked", evidence: "vendor" });
  });
  it("未確認（黄）と人次第（黄）の段階は経路を止めず先へ進む", () => {
    const v = evaluate(case1, demo, { knowledge });
    expect(v.paths[0]?.steps.map((s) => s.state)).toContain("unknown");
    expect(v.paths[0]?.reachedCore).toBe(true);
    const v5 = evaluate(case5, demo, { knowledge });
    const human = v5.paths[0]?.steps.findIndex((s) => s.state === "human") ?? -1;
    expect(human).toBeGreaterThan(-1);
    expect(v5.paths[0]?.steps.length).toBeGreaterThan(human + 1);
  });
});

describe("バックアップの判定", () => {
  it("切り離し＋復旧テスト済みは「復旧できる」で止めず、停止日数だけ短くなる", () => {
    const v = evaluate(
      case1,
      applyMeasures(demo, [knowledge.measures.find((m) => m.id === "backup-isolated") as never]),
      { knowledge },
    );
    expect(v.result).toBe("mitigated");
    expect(v.paths[0]?.reachedCore).toBe(true);
    expect(v.impact.downtimeDays).toBe(2);
  });
  it("属性だけ切り離しでも M1053 が「なし」なら復旧できる扱いにしない", () => {
    const p = clone(demo);
    const b = p.assets.find((a) => a.id === "backup");
    if (!b) throw new Error();
    b.controls = [{ mitigation: "M1053", status: "absent", evidence: "registered" }];
    b.attrs = { isolated: true, restoreTested: true };
    b.attrEvidence = { isolated: "registered", restoreTested: "registered" };
    const v = evaluate(case1, p, { knowledge });
    expect(v.result).toBe("breached");
    expect(v.paths[0]?.steps.find((s) => s.role === "backup")?.state).toBe("breached");
  });
  it("バックアップの資産がなければ段階を飛ばし、中核へ到達して breached", () => {
    const p = clone(demo);
    p.assets = p.assets.filter((a) => a.id !== "backup");
    const v = evaluate(case1, p, { knowledge });
    expect(v.result).toBe("breached");
    expect(v.paths[0]?.steps.map((s) => s.role)).toEqual(["entry.vpn", "admin", "server", "core"]);
  });
});

describe("結論の決め方", () => {
  const allUnknown = (): CompanyProfile => {
    let p = setControls(demo, "vpn", [
      { mitigation: "M1051", status: "unknown", evidence: "none" },
      { mitigation: "M1032", status: "unknown", evidence: "none" },
    ]);
    p = setControls(p, "server", [
      { mitigation: "M1030", status: "unknown", evidence: "none" },
      { mitigation: "M1035", status: "unknown", evidence: "none" },
    ]);
    p = setControls(p, "backup", [{ mitigation: "M1053", status: "unknown", evidence: "none" }]);
    const vpn = p.assets.find((a) => a.id === "vpn");
    if (vpn) vpn.attrs = { exposed: true };
    const backup = p.assets.find((a) => a.id === "backup");
    if (backup) backup.attrs = {};
    return p;
  };
  it("判定の材料がある段階がすべて未確認なら pending", () => {
    const v = evaluate(case1, allUnknown(), { knowledge });
    expect(v.result).toBe("pending");
    expect(
      v.paths[0]?.steps
        .filter((s) => s.mitigations.length > 0)
        .every((s) => s.state === "unknown" || s.role === "core"),
    ).toBe(true);
  });
  it("一つでも赤（または人次第）があれば pending ではなく breached", () => {
    const p = setControls(allUnknown(), "server", [
      { mitigation: "M1030", status: "absent", evidence: "registered" },
      { mitigation: "M1035", status: "absent", evidence: "registered" },
    ]);
    expect(evaluate(case1, p, { knowledge }).result).toBe("breached");
    const human: AttackPath = {
      id: "x",
      source: "inferred",
      reachedCore: true,
      reachedAssetIds: [],
      steps: [
        {
          nodeId: "a",
          role: "pc",
          tactic: "TA0001",
          technique: "T1566",
          mitigations: ["M1040"],
          ineffective: [],
          source: "inferred",
          state: "human",
          evidence: "registered",
          reasonJa: "",
        },
        {
          nodeId: "b",
          role: "admin",
          tactic: "TA0006",
          technique: "T1003",
          mitigations: ["M1026"],
          ineffective: [],
          source: "inferred",
          state: "unknown",
          evidence: "none",
          reasonJa: "",
        },
        {
          nodeId: "c",
          role: "core",
          tactic: "TA0040",
          technique: "T1486",
          mitigations: [],
          ineffective: [],
          source: "inferred",
          state: "breached",
          evidence: "none",
          reasonJa: "",
        },
      ],
    };
    expect(decideResult([human])).toBe("breached");
  });
  it("全経路が止まれば blocked、到達した経路が復旧できる段階を含めば mitigated", () => {
    expect(
      decideResult([
        { id: "x", source: "inferred", reachedCore: false, reachedAssetIds: [], steps: [] },
      ]),
    ).toBe("blocked");
    const rec: AttackPath = {
      id: "y",
      source: "inferred",
      reachedCore: true,
      reachedAssetIds: [],
      steps: [
        {
          nodeId: "a",
          role: "entry.vpn",
          tactic: "TA0001",
          technique: "T1190",
          mitigations: ["M1051"],
          ineffective: [],
          source: "stated",
          state: "breached",
          evidence: "vendor",
          reasonJa: "",
        },
        {
          nodeId: "b",
          role: "backup",
          tactic: "TA0040",
          technique: "T1490",
          mitigations: ["M1053"],
          ineffective: [],
          source: "inferred",
          state: "recoverable",
          evidence: "registered",
          reasonJa: "",
        },
        {
          nodeId: "c",
          role: "core",
          tactic: "TA0040",
          technique: "T1486",
          mitigations: [],
          ineffective: [],
          source: "inferred",
          state: "breached",
          evidence: "none",
          reasonJa: "",
        },
      ],
    };
    expect(decideResult([rec])).toBe("mitigated");
  });
  it("out_of_scope は経路を作らず対象外の見出しを出す", () => {
    const v = evaluate({ ...case1, damageType: "out_of_scope" }, demo, { knowledge });
    expect(v.result).toBe("out_of_scope");
    expect(v.paths).toEqual([]);
    expect(v.headlineJa).toContain("対象外");
  });
});

describe("入口が不明なとき", () => {
  it("clarity: unknown なら入口の記載があっても候補を展開し、記事の根拠文は入口に付けない", () => {
    const v = evaluate({ ...case1, clarity: "unknown" }, demo, { knowledge });
    expect(v.paths.length).toBeGreaterThan(1);
    expect(
      v.paths.every((p) => p.source === "candidate" && p.steps[0]?.source === "candidate"),
    ).toBe(true);
    expect(v.paths[0]?.steps[0]?.quote).toBeUndefined();
    // 入口以外で記載のある段階は stated のまま
    expect(v.paths[0]?.steps.find((s) => s.role === "backup")?.source).toBe("stated");
  });
  it("記事の手法がどの入口の役割にも当たらなければ候補を展開する", () => {
    const p = clone(demo);
    p.assets = p.assets.filter((a) => a.id !== "vendor-remote");
    const c: Case = {
      ...case1,
      steps: [
        { tactic: "TA0001", techniques: ["T1199"], source: "stated" },
        ...case1.steps.slice(1),
      ],
    };
    const v = evaluate(c, p, { knowledge });
    expect(v.paths.map((x) => x.steps[0]?.role)).toEqual(["entry.vpn", "pc"]);
    expect(v.paths.every((x) => x.source === "candidate")).toBe(true);
  });
  it("入口候補の並びは警察庁統計の件数順で、出典と件数を持つ", () => {
    const { candidates, sourceJa, surveyJa } = knowledge.entryCandidates;
    expect(sourceJa).toContain("警察庁");
    expect(surveyJa).toContain("92");
    expect(candidates.map((c) => c.stat?.count)).toEqual([61, 19, 2, undefined, undefined]);
    expect(candidates.slice(3).every((c) => c.noteJa?.includes("要確認"))).toBe(true);
  });
});

describe("線に沿った経路", () => {
  it("保守ベンダーの遠隔接続は中核へ直接つながるので、管理者・サーバを飛ばして 2 段階になる", () => {
    const v = evaluate({ ...case1, clarity: "unknown" }, demo, { knowledge });
    const vendor = v.paths.find((p) => p.steps[0]?.role === "entry.vendor_remote");
    expect(states(vendor)).toEqual(["vendor-remote:breached", "core:breached"]);
    expect(vendor?.reachedCore).toBe(true);
  });
  it("連続する段階のノードは必ず線でつながっている", () => {
    const g = buildGraph(demo, knowledge.roles);
    const v = evaluate({ ...case1, clarity: "unknown" }, demo, { knowledge, graph: g });
    for (const p of v.paths) {
      expect(adjacent(g, "attacker", p.steps[0]?.nodeId ?? "")).toBe(true);
      for (let i = 1; i < p.steps.length; i++)
        expect(connected(g, p.steps[i - 1]?.nodeId ?? "", p.steps[i]?.nodeId ?? "")).toBe(true);
    }
  });
  it("事業者側のホームページは社内へつながらないので入口にならず、社内のホームページはつながる", () => {
    const hosted = clone(demo);
    hosted.assets.push(
      asset({
        id: "web",
        role: "entry.web",
        kind: "system",
        side: "external",
        label: "ホームページ（事業者）",
      }),
    );
    const v = evaluate({ ...case1, clarity: "unknown" }, hosted, { knowledge });
    expect(v.paths.some((p) => p.steps[0]?.role === "entry.web")).toBe(false);
    const onprem = clone(demo);
    onprem.assets.push(
      asset({
        id: "web",
        role: "entry.web",
        kind: "system",
        side: "internal",
        label: "ホームページ（社内）",
        controls: [{ mitigation: "M1051", status: "absent", evidence: "registered" }],
      }),
    );
    const g = buildGraph(onprem, knowledge.roles);
    expect(adjacent(g, "web", "admin")).toBe(true);
    const v2 = evaluate({ ...case1, clarity: "unknown" }, onprem, { knowledge, graph: g });
    expect(v2.paths.some((p) => p.steps[0]?.role === "entry.web")).toBe(true);
  });
  it("入口はあるが終点まで線がつながらなければ no_entry", () => {
    const p = clone(demo);
    p.assets = p.assets.filter(
      (a) => !["vendor-remote", "pc", "admin", "server", "backup"].includes(a.id),
    );
    expect(evaluate(case1, p, { knowledge }).result).toBe("no_entry");
  });
});

describe("役割に資産が複数あるとき", () => {
  it("入口が 2 台なら経路が 2 本になり、ID が重ならない", () => {
    const p = clone(demo);
    const vpn = p.assets.find((a) => a.id === "vpn");
    if (!vpn) throw new Error();
    p.assets.push({ ...structuredClone(vpn), id: "vpn-2", label: "VPN装置（第2拠点）" });
    const v = evaluate(case1, p, { knowledge });
    expect(v.paths.map((x) => x.steps[0]?.nodeId)).toEqual(["vpn", "vpn-2"]);
    expect(new Set(v.paths.map((x) => x.id)).size).toBe(2);
    expect(v.paths[0]?.source).toBe("stated");
    expect(v.paths[1]?.source).toBe("candidate");
  });
  it("途中の役割が 2 台なら分岐し、それぞれ別の経路として評価する", () => {
    const p = clone(demo);
    const server = p.assets.find((a) => a.id === "server");
    if (!server) throw new Error();
    p.assets.push({
      ...structuredClone(server),
      id: "server-2",
      label: "業務サーバ区画（分離済み）",
      controls: [
        { mitigation: "M1030", status: "present", evidence: "registered" },
        { mitigation: "M1035", status: "present", evidence: "registered" },
      ],
    });
    const v = evaluate(case1, p, { knowledge });
    expect(v.paths).toHaveLength(2);
    expect(v.paths.map((x) => x.id)).toEqual(["ransomware:vpn", "ransomware:vpn#2"]);
    expect(v.paths[0]?.reachedCore).toBe(true);
    expect(states(v.paths[1])).toEqual(["vpn:breached", "admin:unknown", "server-2:blocked"]);
    expect(v.result).toBe("breached");
  });
  it("walkStages は終点に到達できる列だけを返す", () => {
    const g = buildGraph(demo, knowledge.roles);
    const t = knowledge.templates.find((x) => x.id === "ransomware");
    const storage = g.nodes.find((n) => n.id === "cloud-storage");
    if (!t || !storage) throw new Error();
    expect(walkStages(t, g, storage)).toEqual([]);
  });
});

describe("AI 経路の 4 点検証", () => {
  it("役割の既定ルール（到達）は型紙の典型手法にだけ使い、中核 × T1190 のような経路は破棄する", () => {
    const g = buildGraph(demo, knowledge.roles);
    const r = validateAiPath(
      {
        steps: [
          { role: "entry.vendor_remote", technique: "T1133", reasonJa: "x" },
          { role: "core", technique: "T1190", reasonJa: "y" },
        ],
      },
      g,
      demo,
      knowledge,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons[0]).toContain("判定ルールがない");
    const ok = validateAiPath(
      {
        steps: [
          { role: "entry.vendor_remote", technique: "T1133", reasonJa: "x" },
          { role: "core", technique: "T1486", reasonJa: "y" },
        ],
      },
      g,
      demo,
      knowledge,
    );
    expect(ok.ok).toBe(true);
  });
  it("最初の役割が攻撃者とつながっていなければ破棄する（直接エッジのみ）", () => {
    const g = buildGraph(demo, knowledge.roles);
    const r = validateAiPath(
      {
        steps: [
          { role: "admin", technique: "T1003", reasonJa: "x" },
          { role: "core", technique: "T1486", reasonJa: "y" },
        ],
      },
      g,
      demo,
      knowledge,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => x.includes("attacker"))).toBe(true);
  });
  it("廃止 ID は置き換え、同じノードで続く段階は許す", () => {
    const g = buildGraph(demo, knowledge.roles);
    const r = validateAiPath(
      {
        steps: [
          { role: "cloud.mail_account.exec", technique: "T1078.004", reasonJa: "x" },
          { role: "cloud.mail_account.exec", technique: "T1656", reasonJa: "y" },
        ],
      },
      g,
      demo,
      knowledge,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path.steps[1]?.technique).toBe("T1684.001");
  });
  it("矛盾のある資産を通る AI 経路でも矛盾は重複しない", () => {
    const p = setControls(demo, "vendor-remote", [
      { mitigation: "M1032", status: "present", evidence: "registered" },
      { mitigation: "M1032", status: "absent", evidence: "vendor" },
      { mitigation: "UD-02", status: "absent", evidence: "registered" },
      { mitigation: "M1035", status: "absent", evidence: "registered" },
    ]);
    const r = validateAiPath(
      {
        steps: [
          { role: "entry.vendor_remote", technique: "T1133", reasonJa: "x" },
          { role: "core", technique: "T1486", reasonJa: "y" },
        ],
      },
      buildGraph(p, knowledge.roles),
      p,
      knowledge,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contradictions).toHaveLength(1);
      expect(r.path.steps[0]?.state).toBe("breached");
    }
  });
});

describe("保守ベンダーの遠隔接続のルール", () => {
  const vendor = (controls: Asset["controls"]) =>
    evaluateRule(
      knowledge.rules.find((r) => r.id === "vendor_remote.entry") as Rule,
      asset({ id: "vr", role: "entry.vendor_remote", controls }),
    );
  it("多要素認証なしが確定していれば、運用が未確認でも赤", () => {
    expect(vendor([{ mitigation: "M1032", status: "absent", evidence: "registered" }]).state).toBe(
      "breached",
    );
  });
  it("多要素認証も運用も未確認なら黄", () => {
    expect(vendor([]).state).toBe("unknown");
    expect(vendor([{ mitigation: "M1032", status: "present", evidence: "registered" }]).state).toBe(
      "unknown",
    );
  });
  it("多要素認証があり、必要時のみ有効化か接続元限定があれば緑", () => {
    expect(
      vendor([
        { mitigation: "M1032", status: "present", evidence: "registered" },
        { mitigation: "M1035", status: "present", evidence: "vendor" },
      ]),
    ).toMatchObject({ state: "blocked", evidence: "vendor" });
  });
});

describe("5問からの構成", () => {
  it("中核が社内でも接続方法が「なし」なら入口がなく no_entry", () => {
    const answers: ProfileAnswers = {
      industry: "manufacturing",
      site: "factory",
      hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
      remoteAccess: ["cloud_only"],
      backup: "none",
    };
    const p = profileFromAnswers(answers, knowledge.patterns);
    const noPhishing = { ...p, assets: p.assets.filter((a) => a.role !== "pc") };
    expect(evaluate(case1, noPhishing, { knowledge }).result).toBe("no_entry");
    expect(p.assets.some((a) => a.role === "backup")).toBe(false);
  });
});

describe("廃止済みの資産が外部に残っている矛盾（カルテの属性から再現する）", () => {
  const decommissioned = (attrs: Asset["attrs"], attrEvidence: Asset["attrEvidence"]): Asset =>
    asset({
      id: "campaign-site",
      role: "entry.web",
      kind: "system",
      label: "旧キャンペーンサイト（廃止済み）",
      attrs: { decommissioned: true, hostname: "campaign2019.demo-seiko.example", ...attrs },
      attrEvidence: { decommissioned: "registered", hostname: "registered", ...attrEvidence },
    });
  const withCampaign = (a: Asset): CompanyProfile => ({
    ...clone(demo),
    assets: [...demo.assets.filter((x) => x.id !== "campaign-site"), a],
  });

  it("externallySeen: true（根拠 external）なら矛盾を 1 件出し、外部確認の記録が無くても判定のたびに再現する", () => {
    const p = withCampaign(
      decommissioned(
        {
          externallySeen: true,
          externallySeenAt: "2026-11-02T07:00:00Z",
          lastCertExpiry: "2019-07-30T23:59:59Z",
        },
        { externallySeen: "external", externallySeenAt: "external", lastCertExpiry: "external" },
      ),
    );
    const found = profileContradictions(p);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      assetId: "campaign-site",
      messageJa: "カルテで廃止済みだが、外部にホスト名が残っている可能性",
    });
    expect(found[0]?.external).toContain("campaign2019.demo-seiko.example");
    expect(found[0]?.external).toContain("2026-11-02");
    expect(found[0]?.external).toContain("2019-07-30");
    expect(found[0]?.registered).toContain("廃止済み");
    const v = evaluate(case1, p, { knowledge });
    expect(v.contradictions.filter((c) => c.assetId === "campaign-site")).toHaveLength(1);
    // 廃止済みの資産は入口に数えない（従来どおり）
    expect(v.paths.some((x) => x.steps.some((s) => s.nodeId.includes("campaign")))).toBe(false);
  });
  it("externallySeen: false なら出ない", () => {
    const p = withCampaign(
      decommissioned(
        { externallySeen: false, externallySeenAt: "2026-11-02T07:00:00Z" },
        { externallySeen: "external", externallySeenAt: "external" },
      ),
    );
    expect(profileContradictions(p)).toEqual([]);
    expect(evaluate(case1, p, { knowledge }).contradictions).toEqual([]);
  });
  it("根拠が external でなければ（担当者が手で付けた値）出ない", () => {
    const p = withCampaign(
      decommissioned({ externallySeen: true }, { externallySeen: "registered" }),
    );
    expect(profileContradictions(p)).toEqual([]);
  });
  it("廃止済みでない資産に externallySeen があっても出ない", () => {
    const p = withCampaign(
      asset({
        id: "campaign-site",
        role: "entry.web",
        attrs: { externallySeen: true },
        attrEvidence: { externallySeen: "external" },
      }),
    );
    expect(profileContradictions(p)).toEqual([]);
  });
  it("対象外の事例でもカルテの矛盾は結論に載る", () => {
    const p = withCampaign(
      decommissioned({ externallySeen: true }, { externallySeen: "external" }),
    );
    const v = evaluate({ ...case1, damageType: "out_of_scope" }, p, { knowledge });
    expect(v.result).toBe("out_of_scope");
    expect(v.contradictions).toHaveLength(1);
  });
});
