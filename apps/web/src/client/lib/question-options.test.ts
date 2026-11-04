import { describe, expect, it } from "vitest";
import type { QuestionOption } from "../../shared/api.ts";
import { optionsForIndustry } from "./question-options.ts";

// knowledge/questions.yaml の「現場」の選択肢（industries）と同じ
const site: QuestionOption[] = [
  { value: "factory", labelJa: "工場", industries: ["manufacturing", "other"] },
  {
    value: "warehouse",
    labelJa: "倉庫・物流拠点",
    industries: ["manufacturing", "wholesale_service", "other"],
  },
  {
    value: "construction_site",
    labelJa: "工事現場（現場事務所・仮設）",
    industries: ["construction"],
  },
  { value: "yard", labelJa: "資材置き場・倉庫", industries: ["construction"] },
  { value: "store", labelJa: "店舗・支店", industries: ["wholesale_service", "finance", "other"] },
  { value: "clinic", labelJa: "診療所・病院", industries: ["healthcare"] },
  { value: "care", labelJa: "介護・福祉施設", industries: ["healthcare"] },
  {
    value: "datacenter",
    labelJa: "データセンター・サーバルーム（自社運用）",
    industries: ["it"],
  },
  { value: "onsite_team", labelJa: "客先に常駐するチームがある", industries: ["it"] },
  { value: "office_only", labelJa: "事務所のみ" },
];

describe("optionsForIndustry（業種に合う現場だけを出す）", () => {
  const values = (industry: string | undefined) =>
    optionsForIndustry(site, industry).map((o) => o.value);
  it("製造業は工場・倉庫・事務所のみ。診療所や工事現場は出ない", () => {
    expect(values("manufacturing")).toEqual(["factory", "warehouse", "office_only"]);
  });
  it("建設業は工事現場・資材置き場・事務所のみ", () => {
    expect(values("construction")).toEqual(["construction_site", "yard", "office_only"]);
  });
  it("卸売・小売・サービスは倉庫・店舗・事務所のみ", () => {
    expect(values("wholesale_service")).toEqual(["warehouse", "store", "office_only"]);
  });
  it("医療・福祉は診療所・介護施設・事務所のみ。工場・店舗は出ない", () => {
    expect(values("healthcare")).toEqual(["clinic", "care", "office_only"]);
  });
  it("情報通信はデータセンター・客先常駐・事務所のみ。金融は店舗・支店と事務所のみ", () => {
    expect(values("it")).toEqual(["datacenter", "onsite_team", "office_only"]);
    expect(values("finance")).toEqual(["store", "office_only"]);
  });
  it("その他は工場・倉庫・店舗・事務所のみ。業種が未定なら絞らない", () => {
    expect(values("other")).toEqual(["factory", "warehouse", "store", "office_only"]);
    expect(values(undefined)).toHaveLength(10);
  });
  it("絞った結果が空になる業種は、絞らずに出す（選べなくなるのを防ぐ）", () => {
    expect(optionsForIndustry([site[5] as QuestionOption], "manufacturing")).toHaveLength(1);
  });
});
