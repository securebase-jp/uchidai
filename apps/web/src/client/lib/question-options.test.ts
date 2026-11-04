import { describe, expect, it } from "vitest";
import type { QuestionOption } from "../../shared/api.ts";
import { optionsForIndustry } from "./question-options.ts";

const site: QuestionOption[] = [
  {
    value: "factory",
    labelJa: "工場・倉庫",
    industries: ["manufacturing", "wholesale_service", "other"],
  },
  { value: "store", labelJa: "店舗", industries: ["wholesale_service", "finance", "other"] },
  { value: "clinic", labelJa: "診療所・施設", industries: ["healthcare"] },
  { value: "office_only", labelJa: "事務所のみ" },
];

describe("optionsForIndustry（業種に合う現場だけを出す）", () => {
  const values = (industry: string | undefined) =>
    optionsForIndustry(site, industry).map((o) => o.value);
  it("製造・建設に診療所は出ない。工場と事務所だけ", () => {
    expect(values("manufacturing")).toEqual(["factory", "office_only"]);
  });
  it("医療・福祉は診療所と事務所。工場・店舗は出ない", () => {
    expect(values("healthcare")).toEqual(["clinic", "office_only"]);
  });
  it("卸売・サービスは工場（倉庫）、店舗、事務所。診療所は出ない", () => {
    expect(values("wholesale_service")).toEqual(["factory", "store", "office_only"]);
  });
  it("情報通信は事務所のみ。金融は店舗と事務所", () => {
    expect(values("it")).toEqual(["office_only"]);
    expect(values("finance")).toEqual(["store", "office_only"]);
  });
  it("その他はすべての現場。業種が未定なら絞らない", () => {
    expect(values("other")).toEqual(["factory", "store", "office_only"]);
    expect(values(undefined)).toEqual(["factory", "store", "clinic", "office_only"]);
  });
  it("絞った結果が空になる業種は、絞らずに出す（選べなくなるのを防ぐ）", () => {
    expect(optionsForIndustry([site[2] as QuestionOption], "manufacturing")).toHaveLength(1);
  });
});
