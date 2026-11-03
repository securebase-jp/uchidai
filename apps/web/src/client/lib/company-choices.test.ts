import { describe, expect, it } from "vitest";
import {
  caseChoices,
  companyChoices,
  exampleLabelJa,
  isCurrentCompany,
} from "./company-choices.ts";

const examples = [
  {
    id: "demo-bussan",
    companyName: "デモ物産株式会社",
    patternLabelJa: "卸売・サービス（事務所型）",
    employees: 60,
    fictional: true,
  },
  {
    id: "demo-seiko",
    companyName: "デモ精工株式会社",
    patternLabelJa: "製造業（工場あり）",
    employees: 120,
    fictional: true,
  },
];

describe("companyChoices（上部バーの会社の選択肢）", () => {
  it("自社のカルテが保存されているときだけ先頭に出し、架空の会社は「架空：会社名（業種・人数）」", () => {
    const withOwn = companyChoices({ companyName: "テスト製作所" }, examples);
    expect(withOwn.map((c) => c.labelJa)).toEqual([
      "自社のカルテ（テスト製作所）",
      "架空：デモ物産株式会社（卸売・サービス（事務所型）・60 名）",
      "架空：デモ精工株式会社（製造業（工場あり）・120 名）",
    ]);
    const without = companyChoices(undefined, examples);
    expect(without.map((c) => c.kind)).toEqual(["example", "example"]);
  });
  it("人数が無い会社は業種だけ、架空でない会社には「架空：」を付けない", () => {
    expect(
      exampleLabelJa({
        id: "x",
        companyName: "X社",
        patternLabelJa: "医療・福祉",
        fictional: true,
      }),
    ).toBe("X社（医療・福祉）");
    const real = companyChoices(undefined, [
      { id: "x", companyName: "X社", patternLabelJa: "医療・福祉", fictional: false },
    ]);
    expect(real[0]?.labelJa).toBe("X社（医療・福祉）");
  });
  it("isCurrentCompany：自社は example 以外の出どころ、架空は ID の一致で見る", () => {
    const [own, bussan] = companyChoices({ companyName: "A" }, examples);
    if (!own || !bussan) throw new Error("選択肢が足りない");
    expect(isCurrentCompany(own, { id: "from-answers", source: "answers" })).toBe(true);
    expect(isCurrentCompany(own, { id: "demo-bussan", source: "example" })).toBe(false);
    expect(isCurrentCompany(bussan, { id: "demo-bussan", source: "example" })).toBe(true);
    expect(isCurrentCompany(bussan, { id: "demo-seiko", source: "example" })).toBe(false);
    expect(isCurrentCompany(bussan, undefined)).toBe(false);
  });
});

describe("caseChoices（上部バーの事例の選択肢）", () => {
  const recorded = [
    { caseId: "ipa-case-1", title: "VPN の事例", damageType: "ransomware" },
    { caseId: "ipa-case-5", title: "送金の事例", damageType: "bec" },
  ];
  it("先頭に「記事を貼る…」を置き、そのあとに記録済みの事例を被害の型と題名で並べる", () => {
    const list = caseChoices(recorded);
    expect(list.map((c) => c.labelJa)).toEqual([
      "記事を貼る…",
      "業務停止　VPN の事例",
      "なりすまし送金　送金の事例",
    ]);
    expect(list[0]?.kind).toBe("article");
    expect(list[1]).toMatchObject({ kind: "recorded", id: "ipa-case-1", damageJa: "業務停止" });
  });
  it("キーが無いサーバ（readAvailable === false）では「記事を貼る…」に注記を添える。不明・可なら添えない", () => {
    expect(caseChoices(recorded, false)[0]?.labelJa).toBe("記事を貼る…（Claude API のキーが必要）");
    expect(caseChoices(recorded, true)[0]?.labelJa).toBe("記事を貼る…");
    expect(caseChoices(recorded, undefined)[0]?.labelJa).toBe("記事を貼る…");
  });
  it("記録済みの事例が読み込めていなくても「記事を貼る…」は出る", () => {
    expect(caseChoices([]).map((c) => c.kind)).toEqual(["article"]);
  });
});
