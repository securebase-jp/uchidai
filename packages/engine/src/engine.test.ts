import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { validateAiPath } from "./ai.ts";
import { classifyMitigations } from "./classify.ts";
import { evaluate, matchCaseSteps } from "./evaluate.ts";
import { buildGraph, profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { applyAnswer, applyMeasures, pendingControls } from "./measures.ts";
import type { Case, CaseStep, CompanyProfile } from "./types.ts";

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
