import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { validateAiPath } from "./ai.ts";
import { classifyMitigations } from "./classify.ts";
import { evaluate, matchCaseSteps, rankTemplates, UNMAPPED_HEADLINE } from "./evaluate.ts";
import { buildGraph, profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { applyAnswer, applyMeasures, pendingControls } from "./measures.ts";
import type { Case, CaseStep, CompanyProfile, ProfileAnswers } from "./types.ts";

let knowledge: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  knowledge = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});
const measure = (id: string) => {
  const m = knowledge.measures.find((x) => x.id === id);
  if (!m) throw new Error(id);
  return m;
};

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
    { tactic: "TA0005", techniques: ["T1656"], source: "stated", quote: "社長になりすまし" },
  ],
};
const case2: Case = {
  title: "被害事例2",
  damageType: "data_breach",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [{ tactic: "TA0009", techniques: ["T1530"], source: "stated" }],
};

describe("被害事例1（業務停止）", () => {
  it("初期状態は「大丈夫ではない」。VPN 赤 → 管理者 黄 → サーバ 赤 → バックアップ 赤 → 生産管理に到達", () => {
    const v = evaluate(case1, demo, { knowledge });
    expect(v.result).toBe("breached");
    expect(v.paths).toHaveLength(1);
    const p = v.paths[0];
    expect(p?.reachedCore).toBe(true);
    expect(p?.steps.map((s) => [s.role, s.state])).toEqual([
      ["entry.vpn", "breached"],
      ["admin", "unknown"],
      ["server", "breached"],
      ["backup", "breached"],
      ["core", "breached"],
    ]);
    expect(p?.steps[0]?.source).toBe("stated");
    expect(p?.steps[0]?.quote).toBe("VPN装置の脆弱性");
    expect(p?.steps[0]?.evidence).toBe("vendor");
    expect(p?.steps[1]?.source).toBe("inferred");
    expect(p?.steps[3]?.source).toBe("stated");
    expect(v.impact.stopped.map((s) => s.name)).toContain("受注・生産管理");
    expect(v.impact.downtimeDays).toBe(10);
    expect(v.impact.revenueImpactJpy).toBe(100_000_000);
    expect(v.impact.reportRequired).toBe(true);
  });

  it("「VPN に多要素認証」を押しても止まらず、効かない理由が付く", () => {
    const v = evaluate(case1, applyMeasures(demo, [measure("vpn-mfa")]), { knowledge });
    expect(v.result).toBe("breached");
    const vpn = v.paths[0]?.steps[0];
    expect(vpn?.state).toBe("breached");
    expect(vpn?.ineffective.map((i) => i.mitigation)).toContain("M1032");
  });

  it("「VPN 装置の更新」で入口で止まる", () => {
    const v = evaluate(case1, applyMeasures(demo, [measure("vpn-update")]), { knowledge });
    expect(v.result).toBe("blocked");
    expect(v.paths[0]?.steps).toHaveLength(1);
    expect(v.paths[0]?.steps[0]?.state).toBe("blocked");
    expect(v.impact.stopped).toEqual([]);
  });

  it("「切り離したバックアップ」で被害は抑えられ、停止は 10 日から 2 日に", () => {
    const v = evaluate(case1, applyMeasures(demo, [measure("backup-isolated")]), { knowledge });
    expect(v.result).toBe("mitigated");
    expect(v.paths[0]?.steps.find((s) => s.role === "backup")?.state).toBe("recoverable");
    expect(v.impact.downtimeDays).toBe(2);
  });

  it("ベンダー回答で管理者権限の黄が赤に変わる", () => {
    expect(pendingControls(demo).map((p) => p.mitigation)).toEqual(
      expect.arrayContaining(["M1026", "M1040"]),
    );
    const answered = applyAnswer(
      applyAnswer(demo, {
        assetId: "admin",
        mitigation: "M1026",
        status: "absent",
        evidence: "vendor",
        answeredBy: "保守ベンダー",
      }),
      {
        assetId: "admin",
        mitigation: "M1040",
        status: "absent",
        evidence: "vendor",
        answeredBy: "保守ベンダー",
      },
    );
    const v = evaluate(case1, answered, { knowledge });
    const admin = v.paths[0]?.steps.find((s) => s.role === "admin");
    expect(admin?.state).toBe("breached");
    expect(admin?.evidence).toBe("vendor");
  });

  it("入口が不明なら、入口の候補をすべて展開する", () => {
    const unknownCase: Case = {
      ...case1,
      clarity: "unknown",
      steps: [{ tactic: "TA0040", techniques: ["T1486"], source: "stated" }],
    };
    const v = evaluate(unknownCase, demo, { knowledge });
    expect(v.paths.map((p) => p.steps[0]?.role)).toEqual([
      "entry.vpn",
      "pc",
      "entry.vendor_remote",
    ]);
    expect(v.paths.every((p) => p.source === "candidate")).toBe(true);
    expect(v.result).toBe("breached");
  });
});

describe("型紙の「突破されたときの言葉」", () => {
  it("事例1：型紙の breachedJa / breachedDoneJa が経路の各段階に載る（バックアップは「暗号化される」）", () => {
    const v = evaluate(case1, demo, { knowledge });
    const steps = v.paths[0]?.steps ?? [];
    expect(steps.map((s) => [s.stageId, s.breachedLabelJa, s.breachedDoneJa])).toEqual([
      ["entry", "侵入される", "侵入されました"],
      ["credentials", "奪われる", "奪われました"],
      ["lateral", "侵入される", "侵入されました"],
      ["recovery", "暗号化される", "暗号化されました"],
      ["encrypt", "暗号化される", "暗号化されました"],
    ]);
  });
  it("事例5：乗っ取り・なりすまし・経理担当・送金の言葉が載り、前提の段階にも付く", () => {
    const v = evaluate(case5, demo, { knowledge });
    const words = Object.fromEntries(
      (v.paths[0]?.steps ?? []).map((s) => [s.stageId, s.breachedLabelJa]),
    );
    expect(words).toEqual({
      leak: "流出している",
      takeover: "乗っ取られる",
      impersonate: "悪用される",
      human: "だまされる",
      money: "起きる",
    });
  });
  it("AI が見つけた経路（型紙にない段階）には付けない", () => {
    const graph = buildGraph(demo, knowledge.roles);
    const r = validateAiPath(
      {
        steps: [
          { role: "entry.vendor_remote", technique: "T1199", reasonJa: "x" },
          { role: "core", technique: "T1486", reasonJa: "y" },
        ],
      },
      graph,
      demo,
      knowledge,
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      for (const s of r.path.steps) {
        expect(s.breachedLabelJa).toBeUndefined();
        expect(s.breachedDoneJa).toBeUndefined();
      }
  });
});

describe("被害事例5（なりすまし送金）", () => {
  it("初期状態は「大丈夫ではない」。穴は社長のアカウント、経理担当は人次第", () => {
    const v = evaluate(case5, demo, { knowledge });
    expect(v.result).toBe("breached");
    const steps = v.paths[0]?.steps ?? [];
    expect(steps.map((s) => s.state)).toEqual([
      "breached",
      "breached",
      "breached",
      "human",
      "breached",
    ]);
    expect(steps[0]?.precondition).toBe(true);
    expect(steps[2]?.technique).toBe("T1684.001");
    expect(steps[2]?.ineffective.map((i) => i.mitigation)).toContain("M1054");
    expect(steps[3]?.technique).toBeUndefined();
  });
  it("「社長にも多要素認証」で止まる", () => {
    expect(evaluate(case5, applyMeasures(demo, [measure("exec-mfa")]), { knowledge }).result).toBe(
      "blocked",
    );
  });
  it("「送金時の折り返し確認ルール」で止まる", () => {
    const v = evaluate(case5, applyMeasures(demo, [measure("transfer-callback")]), { knowledge });
    expect(v.result).toBe("blocked");
    expect(v.paths[0]?.steps.at(-1)?.role).toBe("person.accounting");
  });
});

describe("被害事例2（情報漏えい）", () => {
  it("公開リンクの禁止と棚卸しがあるので「止められます」", () => {
    const v = evaluate(case2, demo, { knowledge });
    expect(v.result).toBe("blocked");
    expect(v.paths[0]?.steps[0]?.state).toBe("blocked");
  });
});

describe("AI攻撃者の経路", () => {
  it("保守ベンダーの遠隔接続 → 生産管理 の経路は検証を通り、各段階が赤", () => {
    const graph = buildGraph(demo, knowledge.roles);
    const r = validateAiPath(
      {
        steps: [
          {
            role: "entry.vendor_remote",
            technique: "T1199",
            reasonJa: "ベンダー共通パスワードの常時接続",
          },
          { role: "core", technique: "T1486", reasonJa: "生産管理を直接暗号化" },
        ],
      },
      graph,
      demo,
      knowledge,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path.source).toBe("ai");
      expect(r.path.reachedCore).toBe(true);
      expect(r.path.steps.map((s) => s.state)).toEqual(["breached", "breached"]);
    }
  });
  it("存在しない手法、無い役割、つながりのない経路は破棄する", () => {
    const graph = buildGraph(demo, knowledge.roles);
    const bad = validateAiPath(
      {
        steps: [
          { role: "entry.rdp", technique: "T9999", reasonJa: "x" },
          { role: "cloud.storage", technique: "T1530", reasonJa: "y" },
        ],
      },
      graph,
      demo,
      knowledge,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reasons.length).toBeGreaterThanOrEqual(2);
    const gap = validateAiPath(
      {
        steps: [
          { role: "cloud.storage", technique: "T1530", reasonJa: "x" },
          { role: "core", technique: "T1486", reasonJa: "y" },
        ],
      },
      graph,
      demo,
      knowledge,
    );
    expect(gap.ok).toBe(false);
  });
  it("対策を適用すると AI 経路も止まる", () => {
    const hardened = applyMeasures(demo, [measure("vendor-remote-harden")]);
    const r = validateAiPath(
      {
        steps: [
          { role: "entry.vendor_remote", technique: "T1133", reasonJa: "x" },
          { role: "core", technique: "T1486", reasonJa: "y" },
        ],
      },
      buildGraph(hardened, knowledge.roles),
      hardened,
      knowledge,
    );
    expect(r.ok && r.path.steps[0]?.state).toBe("blocked");
  });
});

describe("知見なし AI の対策の振り分け", () => {
  it("多要素認証は効かない、更新は効く、ユーザー訓練は経路の外", () => {
    const v = evaluate(case1, demo, { knowledge });
    const c = classifyMitigations(["M1032", "M1051", "M1017", "M1053"], v, knowledge.labels);
    expect(c.ineffective.map((x) => x.mitigation)).toEqual(["M1032"]);
    expect(c.effective.map((x) => x.mitigation)).toEqual(["M1051", "M1053"]);
    expect(c.outside.map((x) => x.mitigation)).toEqual(["M1017"]);
  });
});

describe("5問からの構成グラフ", () => {
  it("クラウドだけで VPN を持たない会社に業務停止を当てると「入口なし」", () => {
    const p = profileFromAnswers(
      {
        industry: "it",
        site: "office_only",
        hosting: { mail: "cloud", files: "cloud", core: "cloud", web: "provider" },
        remoteAccess: ["cloud_only"],
        backup: "cloud_sync",
      },
      knowledge.patterns,
    );
    const g = buildGraph(p, knowledge.roles);
    expect(g.nodes.some((n) => n.role === "entry.vpn")).toBe(false);
    expect(g.nodes.filter((n) => n.layer === "business").length).toBeLessThanOrEqual(5);
    const web = { ...p, assets: p.assets.filter((a) => a.role !== "entry.web" && a.role !== "pc") };
    expect(evaluate(case1, web, { knowledge }).result).toBe("no_entry");
    expect(evaluate(case5, p, { knowledge }).result).toBe("pending");
  });
  it("製造業・VPN あり・保守ベンダー接続ありなら、入口が中核に直接つながる", () => {
    const p = profileFromAnswers(
      {
        industry: "manufacturing",
        site: "factory",
        hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
        remoteAccess: ["vpn", "vendor_remote"],
        backup: "unknown",
      },
      knowledge.patterns,
    );
    const g = buildGraph(p, knowledge.roles);
    expect(g.edges.some((e) => e.from === "vendor-remote" && e.to === "core")).toBe(true);
    const v = evaluate(case1, p, { knowledge });
    expect(v.result).toBe("pending");
  });
});

describe("型紙に対応づけられない記事は判定しない（誤って安心させない）", () => {
  // 読解で手法がすべて型紙外として破棄され、戦術だけが残った記事（Web サイト改ざんなど）
  const tacticsOnly: Case = {
    title: "Web サイト改ざん（検証用）",
    damageType: "data_breach",
    clarity: "partial",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: [], source: "stated" },
      { tactic: "TA0010", techniques: [], source: "stated" },
    ],
  };
  it("手法がどれも型紙に対応づけられないなら、止められますと答えず対象外にする", () => {
    const v = evaluate(tacticsOnly, demo, { knowledge });
    expect(v.result).toBe("out_of_scope");
    expect(v.paths).toEqual([]);
    expect(v.headlineJa).toContain("判定できません");
  });
  it("入口が不明（clarity: unknown）な記事は、仕様どおり入口の候補を展開する", () => {
    const v = evaluate({ ...tacticsOnly, damageType: "ransomware", clarity: "unknown" }, demo, {
      knowledge,
    });
    expect(v.result).not.toBe("out_of_scope");
    expect(v.paths.length).toBeGreaterThan(0);
  });
  it("手法が 1 つでも対応づけられれば判定する（事例 2）", () => {
    expect(evaluate(case2, demo, { knowledge }).result).toBe("blocked");
  });
});

describe("matchCaseSteps は手法が一致する段階を先に割り当てる", () => {
  const ransomware = () => knowledge.templates.find((t) => t.id === "ransomware");
  it("手法の無い TA0040 の段階が「バックアップを消す」に取られず、暗号化の段階が正しく当たる", () => {
    const template = ransomware();
    if (!template) throw new Error("型紙 ransomware がない");
    const steps: CaseStep[] = [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
      { tactic: "TA0040", techniques: ["T1486"], source: "stated", quote: "暗号化" },
      { tactic: "TA0040", techniques: [], source: "stated", quote: "リークサイトで公開" },
    ];
    const m = matchCaseSteps(template, steps, knowledge);
    expect(m.get("encrypt")?.technique).toBe("T1486");
    expect(m.get("encrypt")?.quote).toBe("暗号化");
    // 手法の無い段階は、残った同じ戦術の段階（バックアップを消す）に戦術だけで当たる
    expect(m.get("recovery")?.technique).toBeUndefined();
    expect(m.get("recovery")?.quote).toBe("リークサイトで公開");
  });
  it("accepts に足した手法（T1133、T1485、T1570）が型紙の段階に対応づく", () => {
    const template = ransomware();
    if (!template) throw new Error("型紙 ransomware がない");
    const steps: CaseStep[] = [
      { tactic: "TA0001", techniques: ["T1133"], source: "stated" },
      { tactic: "TA0008", techniques: ["T1570"], source: "inferred" },
      { tactic: "TA0040", techniques: ["T1485"], source: "stated" },
      { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    ];
    const m = matchCaseSteps(template, steps, knowledge);
    expect(m.get("entry")?.technique).toBe("T1133");
    expect(m.get("lateral")?.technique).toBe("T1570");
    expect(m.get("recovery")?.technique).toBe("T1485");
    expect(m.get("encrypt")?.technique).toBe("T1486");
  });
});

// ---------------------------------------------------------------------------
// P5：被害の型ごとに複数の型紙（Web サイトへの侵入、社内への侵入と持ち出し、取引先を装う偽の請求、二重恐喝の枝）
// ---------------------------------------------------------------------------
const withAsset = (p: CompanyProfile, a: CompanyProfile["assets"][number]): CompanyProfile => ({
  ...structuredClone(p),
  assets: [...structuredClone(p.assets), a],
});
const setControl = (
  p: CompanyProfile,
  assetId: string,
  mitigation: string,
  status: "present" | "absent" | "unknown",
): CompanyProfile => {
  const next = structuredClone(p);
  const a = next.assets.find((x) => x.id === assetId);
  if (!a) throw new Error(assetId);
  a.controls = [
    ...a.controls.filter((c) => c.mitigation !== mitigation),
    {
      mitigation,
      status,
      evidence: status === "unknown" ? "none" : "registered",
    },
  ];
  return next;
};

describe("型紙の選択（被害の型ごとに複数）", () => {
  it("選んだ型紙の id と labelJa が Verdict に載る", () => {
    const v = evaluate(case1, demo, { knowledge });
    expect(v.templateId).toBe("ransomware");
    expect(v.templateLabelJa).toBe("業務停止（ランサムウェア）");
    expect(evaluate(case2, demo, { knowledge }).templateId).toBe("data_breach");
    expect(evaluate(case5, demo, { knowledge }).templateId).toBe("bec");
  });
  it("記事の段階が最も多く対応づいた型紙を選び、同数なら手法の一致、さらに同数なら priority", () => {
    const ranked = rankTemplates(case5, knowledge).map((m) => m.template.id);
    expect(ranked[0]).toBe("bec");
    const veltra: Case = {
      title: "乗っ取りのないなりすまし",
      damageType: "bec",
      clarity: "clear",
      suspiciousInstructions: [],
      steps: [
        { tactic: "TA0005", techniques: ["T1684.001", "T1684.002"], source: "stated" },
        { tactic: "TA0002", techniques: ["T1204"], source: "stated" },
        { tactic: "TA0040", techniques: ["T1657"], source: "stated" },
      ],
    };
    const r = rankTemplates(veltra, knowledge);
    expect(r[0]?.template.id).toBe("bec-invoice");
    expect(r[0]?.stageMatches).toBe(r[1]?.stageMatches);
    expect(r[0]?.techniqueMatches).toBe(r[1]?.techniqueMatches);
    expect(r[0]?.template.priority).toBeGreaterThan(r[1]?.template.priority ?? 0);
  });
  it("入口が不明で当てはまりが同じ型紙が複数なら、型紙ごとの入口候補を全部出し、経路 ID に型紙 ID が入る", () => {
    const v = evaluate(
      {
        title: "x",
        damageType: "data_breach",
        clarity: "unknown",
        suspiciousInstructions: [],
        steps: [
          { tactic: "TA0001", techniques: [], source: "unknown" },
          { tactic: "TA0010", techniques: [], source: "stated" },
        ],
      },
      demo,
      { knowledge },
    );
    const templates = new Set(v.paths.map((p) => p.templateId));
    expect(templates).toEqual(new Set(["data_breach", "data-breach-intrusion"]));
    expect(v.paths.every((p) => p.id.startsWith(`${p.templateId}:`))).toBe(true);
    expect(v.templateId).toBeUndefined();
    expect(v.result).toBe("breached");
  });
  it("どの型紙にも対応づけられなければ従来どおり対象外", () => {
    const v = evaluate(
      {
        title: "x",
        damageType: "data_breach",
        clarity: "clear",
        suspiciousInstructions: [],
        steps: [{ tactic: "TA0040", techniques: ["T1499"], source: "stated" }],
      },
      demo,
      { knowledge },
    );
    expect(v.result).toBe("out_of_scope");
    expect(v.headlineJa).toBe(UNMAPPED_HEADLINE);
  });
});

describe("型紙 data-breach-web（Web サイトへの侵入・改ざん）", () => {
  const curtain: Case = {
    title: "通販サイトの決済アプリ改ざん",
    damageType: "data_breach",
    clarity: "clear",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
      { tactic: "TA0003", techniques: ["T1505.003"], source: "stated" },
      { tactic: "TA0009", techniques: ["T1056.003"], source: "inferred" },
      { tactic: "TA0010", techniques: ["T1041"], source: "stated" },
    ],
  };
  const web = (controls: CompanyProfile["assets"][number]["controls"]) =>
    withAsset(demo, {
      id: "web",
      kind: "system",
      role: "entry.web",
      label: "ホームページ（レンタルサーバ）",
      side: "external",
      controls,
      attrs: {},
      attrEvidence: {},
    });
  it("デモの旧キャンペーンサイト（廃止済み）は入口にせず、入口なし", () => {
    const v = evaluate(curtain, demo, { knowledge });
    expect(v.templateId).toBe("data-breach-web");
    expect(v.result).toBe("no_entry");
  });
  it("更新のないホームページがあれば、全段階がホームページの上で進んで漏えいに至る", () => {
    const v = evaluate(
      curtain,
      web([{ mitigation: "M1051", status: "absent", evidence: "registered" }]),
      {
        knowledge,
      },
    );
    expect(v.result).toBe("breached");
    expect(v.paths).toHaveLength(1);
    expect(v.paths[0]?.steps.map((s) => [s.nodeId, s.technique ?? null, s.state])).toEqual([
      ["web", "T1190", "breached"],
      ["web", "T1056.003", "unknown"],
      ["web", "T1041", "breached"],
      ["web", null, "breached"],
    ]);
    expect(v.paths[0]?.steps[0]?.ineffective.map((i) => i.mitigation)).toContain("M1032");
  });
  it("更新管理があれば入口で止まり、改ざん検知があれば被害を抑えられる", () => {
    const updated = web([{ mitigation: "M1051", status: "present", evidence: "registered" }]);
    expect(evaluate(curtain, updated, { knowledge }).result).toBe("blocked");
    const detected = web([
      { mitigation: "M1051", status: "absent", evidence: "registered" },
      { mitigation: "M1047", status: "present", evidence: "registered" },
    ]);
    const v = evaluate(curtain, detected, { knowledge });
    expect(v.result).toBe("mitigated");
    expect(v.paths[0]?.steps[1]?.state).toBe("recoverable");
  });
  it("管理画面の正規アカウントでの侵入（T1078）は多要素認証で止まり、更新は効かない", () => {
    const creds: Case = {
      ...curtain,
      steps: [
        { tactic: "TA0001", techniques: ["T1078"], source: "stated" },
        ...curtain.steps.slice(2),
      ],
    };
    const mfa = web([
      { mitigation: "M1051", status: "absent", evidence: "registered" },
      { mitigation: "M1032", status: "present", evidence: "registered" },
    ]);
    const v = evaluate(creds, mfa, { knowledge });
    expect(v.result).toBe("blocked");
    expect(v.paths[0]?.steps[0]?.ineffective.map((i) => i.mitigation)).toContain("M1051");
  });
});

describe("型紙 data-breach-intrusion（社内への侵入・持ち出し）", () => {
  const intrusion: Case = {
    title: "社内サーバから個人情報を持ち出し",
    damageType: "data_breach",
    clarity: "clear",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
      { tactic: "TA0009", techniques: ["T1005"], source: "inferred" },
      { tactic: "TA0010", techniques: ["T1048"], source: "stated" },
    ],
  };
  it("デモでは VPN から入って中核とファイルサーバの両方に到達し、報告義務が生じる", () => {
    const v = evaluate(intrusion, demo, { knowledge });
    expect(v.templateId).toBe("data-breach-intrusion");
    expect(v.result).toBe("breached");
    expect(v.paths.map((p) => p.steps.at(-1)?.nodeId).sort()).toEqual(["core", "file-server"]);
    const p = v.paths[0];
    expect(p?.steps.map((s) => [s.stageId, s.nodeId, s.state])).toEqual([
      ["entry", "vpn", "breached"],
      ["credentials", "admin", "unknown"],
      ["lateral", "server", "breached"],
      ["collect", "server", "unknown"],
      ["exfil", "server", "unknown"],
      ["leak", "core", "breached"],
    ]);
    expect(v.impact.reportRequired).toBe(true);
    expect(v.impact.personalDataReached.map((d) => d.assetId)).toContain("core");
  });
  it("持ち出しの検知・遮断（DLP）があれば持ち出しで止まり、無いと確定すれば赤", () => {
    const dlp = setControl(demo, "server", "M1057", "present");
    const v = evaluate(intrusion, dlp, { knowledge });
    expect(v.result).toBe("blocked");
    expect(v.paths[0]?.steps.at(-1)).toMatchObject({ stageId: "exfil", state: "blocked" });
    const none = setControl(
      setControl(demo, "server", "M1057", "absent"),
      "server",
      "M1031",
      "absent",
    );
    expect(
      evaluate(intrusion, none, { knowledge }).paths[0]?.steps.find((s) => s.stageId === "exfil")
        ?.state,
    ).toBe("breached");
  });
  it("アクセス権の最小化と監査が揃っても収集は止まらず黄、片方でも無ければ赤", () => {
    const both = setControl(
      setControl(demo, "server", "M1022", "present"),
      "server",
      "M1047",
      "present",
    );
    const collect = (p: CompanyProfile) =>
      evaluate(intrusion, p, { knowledge }).paths[0]?.steps.find((s) => s.stageId === "collect");
    expect(collect(both)?.state).toBe("unknown");
    expect(collect(both)?.reasonJa).toContain("抑えられる");
    expect(collect(setControl(demo, "server", "M1022", "absent"))?.state).toBe("breached");
  });
});

describe("型紙 bec-invoice（取引先を装う偽の請求メール）", () => {
  const veltra: Case = {
    title: "代表者を装った送金指示",
    damageType: "bec",
    clarity: "clear",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0005", techniques: ["T1684.001", "T1684.002"], source: "stated" },
      { tactic: "TA0002", techniques: ["T1204"], source: "stated" },
      { tactic: "TA0040", techniques: ["T1657"], source: "stated" },
    ],
  };
  it("デモの経理担当は研修のみで人次第なので「大丈夫ではない」。社長アカウントの段階は無い", () => {
    const v = evaluate(veltra, demo, { knowledge });
    expect(v.templateId).toBe("bec-invoice");
    expect(v.result).toBe("breached");
    const steps = v.paths[0]?.steps ?? [];
    expect(steps.map((s) => [s.role, s.state])).toEqual([
      ["person.accounting", "breached"],
      ["person.accounting", "human"],
      ["person.accounting", "human"],
      ["impact.money", "breached"],
    ]);
    expect(steps[0]?.precondition).toBe(true);
    expect(steps[1]?.ineffective.map((i) => i.mitigation)).toContain("M1054");
    expect(steps.some((s) => s.role === "cloud.mail_account.exec")).toBe(false);
    expect(v.impact.moneyLossJpy).toBe(5_000_000);
  });
  it("「送金時の折り返し確認ルール」で止まる。社長の多要素認証では止まらない", () => {
    expect(
      evaluate(veltra, applyMeasures(demo, [measure("transfer-callback")]), { knowledge }).result,
    ).toBe("blocked");
    expect(evaluate(veltra, applyMeasures(demo, [measure("exec-mfa")]), { knowledge }).result).toBe(
      "breached",
    );
  });
  it("乗っ取りの段階が記事にある事例 5 は従来の型紙 bec のまま", () => {
    expect(evaluate(case5, demo, { knowledge }).templateId).toBe("bec");
  });
});

describe("ransomware の持ち出しの枝（二重恐喝）と VPN の認証情報での侵入", () => {
  const nihonkai: Case = {
    ...case1,
    title: "リークサイトに取引情報",
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
      { tactic: "TA0010", techniques: ["T1567"], source: "stated", quote: "リークサイトで公開" },
      { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    ],
  };
  it("記事に持ち出しがあれば、サーバの段階の後に持ち出しの段階が入る。無い記事（事例 1）では入らない", () => {
    const v = evaluate(nihonkai, demo, { knowledge });
    expect(v.paths[0]?.steps.map((s) => s.stageId)).toEqual([
      "entry",
      "credentials",
      "lateral",
      "exfil",
      "recovery",
      "encrypt",
    ]);
    expect(v.paths[0]?.steps[3]).toMatchObject({
      nodeId: "server",
      technique: "T1567",
      state: "unknown",
    });
    expect(
      evaluate(case1, demo, { knowledge }).paths[0]?.steps.map((s) => s.stageId),
    ).not.toContain("exfil");
  });
  it("持ち出しが止まっても暗号化の本線は進む（枝）", () => {
    const v = evaluate(nihonkai, setControl(demo, "server", "M1057", "present"), { knowledge });
    expect(v.paths[0]?.steps.find((s) => s.stageId === "exfil")?.state).toBe("blocked");
    expect(v.paths[0]?.reachedCore).toBe(true);
    expect(v.result).toBe("breached");
  });
  it("VPN への認証情報での侵入（T1133）は、多要素認証があれば止まり、無ければ更新していても赤", () => {
    const creds: Case = {
      ...case1,
      steps: [
        {
          tactic: "TA0001",
          techniques: ["T1133", "T1078"],
          source: "stated",
          quote: "VPN装置の脆弱性",
        },
        ...case1.steps.slice(1),
      ],
    };
    const v = evaluate(creds, demo, { knowledge });
    const vpn = v.paths.find((p) => p.steps[0]?.nodeId === "vpn")?.steps[0];
    expect(vpn).toMatchObject({ technique: "T1133", state: "breached", source: "stated" });
    expect(vpn?.ruleId).toBe("ransomware.entry.vpn-credentials");
    const mfa = evaluate(creds, applyMeasures(demo, [measure("vpn-mfa")]), { knowledge });
    expect(mfa.paths.find((p) => p.steps[0]?.nodeId === "vpn")?.steps[0]?.state).toBe("blocked");
    const updated = evaluate(creds, applyMeasures(demo, [measure("vpn-update")]), { knowledge });
    expect(updated.paths.find((p) => p.steps[0]?.nodeId === "vpn")?.steps[0]?.state).toBe(
      "breached",
    );
  });
});

describe("枝の段階と結論、AI 経路の到達と廃止済み資産（A4 監査）", () => {
  const nihonkai: Case = {
    ...case1,
    title: "リークサイトに取引情報",
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
      { tactic: "TA0010", techniques: ["T1567"], source: "stated", quote: "リークサイトで公開" },
      { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    ],
  };
  const answers: ProfileAnswers = {
    industry: "manufacturing",
    site: "factory",
    hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
    remoteAccess: ["vpn"],
    backup: "unknown",
  };
  it("本線が全部未確認なら、枝（持ち出し）だけが赤でも結論は「確認中」のまま（枝は結論の材料にしない）", () => {
    let p = profileFromAnswers(answers, knowledge.patterns);
    p = setControl(p, "server", "M1057", "absent");
    p = setControl(p, "server", "M1031", "absent");
    const v = evaluate(nihonkai, p, { knowledge });
    const exfil = v.paths[0]?.steps.find((s) => s.stageId === "exfil");
    expect(exfil).toMatchObject({ state: "breached", branch: true });
    expect(v.paths[0]?.steps.filter((s) => s.branch).map((s) => s.stageId)).toEqual(["exfil"]);
    expect(v.result).toBe("pending");
  });
  it("AI 経路は廃止済みの資産を通れない", () => {
    const graph = buildGraph(demo, knowledge.roles);
    const r = validateAiPath(
      {
        steps: [
          { role: "entry.web", technique: "T1190", reasonJa: "旧サイトから" },
          { role: "entry.web", technique: "T1056.003", reasonJa: "改ざん" },
        ],
      },
      graph,
      demo,
      knowledge,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join("\n")).toContain("廃止済み");
  });
  it("AI 経路の到達は terminalRoles で絞れる（目標が中核なら、ホームページで終わる経路は到達にしない）", () => {
    const withWeb = setControl(
      {
        ...demo,
        assets: [
          ...demo.assets,
          {
            id: "www",
            kind: "system" as const,
            role: "entry.web",
            label: "公開ホームページ",
            side: "internal" as const,
            controls: [],
            attrs: {},
            attrEvidence: {},
          },
        ],
      },
      "www",
      "M1051",
      "absent",
    );
    const graph = buildGraph(withWeb, knowledge.roles);
    const candidate = {
      steps: [
        { role: "entry.web", technique: "T1190", reasonJa: "脆弱性" },
        { role: "entry.web", technique: "T1056.003", reasonJa: "改ざん" },
      ],
    };
    const all = validateAiPath(candidate, graph, withWeb, knowledge);
    expect(all.ok && all.path.reachedCore).toBe(true);
    const coreOnly = validateAiPath(candidate, graph, withWeb, knowledge, "ai", {
      terminalRoles: new Set(["core"]),
    });
    expect(coreOnly.ok && coreOnly.path.reachedCore).toBe(false);
  });
});
