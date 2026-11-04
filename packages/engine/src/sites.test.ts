/**
 * 業種（建設業を含む）と現場の選択肢、現場の回答が足す業務。
 * 業種×現場の全組み合わせで構成グラフが作れ、業務の層が 5 以下で、業務が重複しないことを確かめる
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildGraph, MAX_BUSINESSES, patternIdOf, profileFromAnswers } from "./graph.ts";
import { type Knowledge, knowledgeDir, loadKnowledge } from "./knowledge.ts";
import { ProfileAnswers, Site } from "./types.ts";

let k: Knowledge;
beforeAll(() => {
  k = loadKnowledge();
});

const INDUSTRIES = ProfileAnswers.shape.industry.options;
const baseAnswers = (
  industry: ProfileAnswers["industry"],
  site: ProfileAnswers["site"],
  core: "onprem" | "cloud" = "onprem",
): ProfileAnswers => ({
  industry,
  site,
  hosting: { mail: "cloud", files: "onprem", core, web: "provider" },
  remoteAccess: ["vpn", "vendor_remote"],
  backup: "cloud_sync",
});
const make = (
  industry: ProfileAnswers["industry"],
  site: ProfileAnswers["site"],
  core: "onprem" | "cloud" = "onprem",
) => profileFromAnswers(baseAnswers(industry, site, core), k.patterns, "テスト", k.sites);

/** 開発者が決めた、業種ごとに出す現場（questions.yaml の industries） */
const SITES_BY_INDUSTRY: Record<string, string[]> = {
  manufacturing: ["factory", "warehouse", "office_only"],
  construction: ["construction_site", "yard", "office_only"],
  wholesale_service: ["warehouse", "store", "office_only"],
  healthcare: ["clinic", "care", "office_only"],
  it: ["datacenter", "onsite_team", "office_only"],
  finance: ["store", "office_only"],
  other: ["factory", "warehouse", "store", "office_only"],
};

describe("建設業の構成パターン", () => {
  const p = () => k.patterns.find((x) => x.id === "construction");
  it("中核システムと 4 つの業務を持ち、役割は役割の枠にある", () => {
    expect(p()?.core.labelJa).toBe("施工管理・原価管理システム");
    expect(p()?.businesses.map((b) => b.name)).toEqual([
      "見積・受注",
      "施工管理",
      "資材・調達",
      "請求・精算",
    ]);
    for (const b of p()?.businesses ?? [])
      for (const r of b.roles) expect(k.roles.some((x) => x.id === r)).toBe(true);
  });
  it("影響先と報告の扱い", () => {
    expect(p()?.impact.partnerJa).toBe("発注者（工期）と協力会社");
    expect(p()?.impact.reportJa).toBe("不正アクセスによる漏えいのおそれは件数にかかわらず報告");
  });
  it("すべての構成パターンの業務は 4 つ以下（現場の業務を足して 5 に収まる）", () => {
    for (const x of k.patterns) expect(x.businesses.length).toBeLessThanOrEqual(4);
  });
});

describe("業種の選択肢", () => {
  const questions = parseYaml(readFileSync(join(knowledgeDir, "questions.yaml"), "utf8")) as {
    questions: { id: string; options: { value: string; pattern?: string }[] }[];
  };
  const industry = questions.questions.find((q) => q.id === "industry")?.options ?? [];
  it("製造業と建設業が別の選択肢で、ProfileAnswers の業種と一致する", () => {
    expect(industry.map((o) => o.value).sort()).toEqual([...INDUSTRIES].sort());
    expect(industry.find((o) => o.value === "construction")?.pattern).toBe("construction");
  });
  it("patternIdOf が questions.yaml の pattern と同じ対応になる", () => {
    for (const o of industry)
      expect(patternIdOf(o.value as ProfileAnswers["industry"])).toBe(o.pattern);
  });
});

describe("現場の選択肢", () => {
  it("業種ごとに出す現場が決めた表のとおり（単一選択のまま）", () => {
    for (const [ind, expected] of Object.entries(SITES_BY_INDUSTRY)) {
      const shown = k.sites.filter((s) => !s.industries || s.industries.includes(ind));
      expect(
        shown.map((s) => s.value),
        ind,
      ).toEqual(expected);
    }
  });
  it("現場の値は 10 個で、すべてに選択肢がある。古い回答の値（工場・店舗・診療所・事務所のみ）も読める", () => {
    expect(Site.options).toHaveLength(10);
    expect(k.sites.map((s) => s.value).sort()).toEqual([...Site.options].sort());
    for (const old of ["factory", "store", "clinic", "office_only"])
      expect(Site.safeParse(old).success).toBe(true);
  });
  it("事務所のみは現場の業務を足さない。ほかはすべて持つ", () => {
    for (const s of k.sites)
      expect(s.siteBusiness === undefined, s.value).toBe(s.value === "office_only");
  });
});

describe("現場の回答が足す業務（業種×現場の全組み合わせ）", () => {
  const cases = INDUSTRIES.flatMap((i) => Site.options.map((s) => [i, s] as const));
  it.each(cases)("%s × %s：例外なく作れ、業務は 5 以下で重複しない", (industry, site) => {
    for (const core of ["onprem", "cloud"] as const) {
      const p = make(industry, site, core);
      const names = p.businesses.map((b) => b.name);
      const ids = p.businesses.map((b) => b.id);
      expect(p.businesses.length).toBeGreaterThan(0);
      expect(p.businesses.length).toBeLessThanOrEqual(MAX_BUSINESSES);
      expect(new Set(names).size).toBe(names.length);
      expect(new Set(ids).size).toBe(ids.length);
      const g = buildGraph(p, k.roles);
      expect(g.nodes.filter((n) => n.layer === "business").length).toBeLessThanOrEqual(5);
      for (const b of p.businesses) expect(b.assetIds.length).toBeGreaterThan(0);
    }
  });

  it("製造業×工場、医療×診療所、事務所型×事務所のみは、現場の業務を足す前と同じ業務になる", () => {
    for (const [ind, site, pat] of [
      ["manufacturing", "factory", "manufacturing"],
      ["healthcare", "clinic", "healthcare"],
      ["it", "office_only", "office"],
    ] as const) {
      const withSite = make(ind, site).businesses;
      const without = profileFromAnswers(baseAnswers(ind, site), k.patterns, "t").businesses;
      expect(withSite, `${ind} × ${site}`).toEqual(without);
      expect(patternIdOf(ind)).toBe(pat);
    }
  });

  it("建設業×工事現場は「施工管理」を「現場の施工管理」に置き換え、現場事務所の PC でも止まる", () => {
    const p = make("construction", "construction_site");
    expect(p.businesses.map((b) => b.name)).toEqual([
      "見積・受注",
      "現場の施工管理",
      "資材・調達",
      "請求・精算",
    ]);
    const biz = p.businesses.find((b) => b.id === "biz-construction");
    expect(biz?.assetIds).toEqual(expect.arrayContaining(["core", "pc"]));
    const g = buildGraph(p, k.roles);
    expect(g.nodes.some((n) => n.label === "現場の施工管理" && n.layer === "business")).toBe(true);
  });

  it("医療×介護・福祉施設は「診療」を「介護・ケア」に置き換える（診療と二重にならない）", () => {
    const names = make("healthcare", "care").businesses.map((b) => b.name);
    expect(names).toContain("介護・ケア");
    expect(names).not.toContain("診療");
    expect(names).toHaveLength(4);
  });

  it("置き換えるものが無い現場は、業務を 1 つ足す（5 つ目）", () => {
    const yard = make("construction", "yard").businesses;
    expect(yard).toHaveLength(5);
    expect(yard.at(-1)?.name).toBe("置き場の資材管理");
    expect(make("manufacturing", "warehouse").businesses.at(-1)?.name).toBe("倉庫・物流");
    expect(make("finance", "store").businesses.at(-1)?.name).toBe("店頭・窓口");
  });

  it("情報通信×データセンターは中核がクラウドでも業務が消えない。客先常駐は PC に依存する", () => {
    const dc = make("it", "datacenter", "cloud").businesses.find(
      (b) => b.name === "自社サーバの運用",
    );
    expect(dc?.assetIds).toEqual(["core"]);
    expect(make("it", "datacenter").businesses.at(-1)?.assetIds.sort()).toEqual(["core", "server"]);
    const team = make("it", "onsite_team").businesses.at(-1);
    expect(team?.name).toBe("客先常駐の対応");
    expect(team?.assetIds).toEqual(["pc"]);
  });

  it("事務所のみは、現場の選択肢を渡しても渡さなくても同じ業務（足さない）", () => {
    for (const ind of INDUSTRIES) {
      const withSites = make(ind, "office_only").businesses;
      const without = profileFromAnswers(
        baseAnswers(ind, "office_only"),
        k.patterns,
        "t",
      ).businesses;
      expect(withSites, ind).toEqual(without);
    }
  });

  it("現場の選択肢を渡さなければ、現場の業務は足さない（従来の呼び方）", () => {
    const p = profileFromAnswers(baseAnswers("construction", "yard"), k.patterns);
    expect(p.businesses).toHaveLength(4);
  });
});
