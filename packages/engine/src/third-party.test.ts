/**
 * 被害を受けた側（victim。knowledge/victims.yaml）：委託先・取引先・提供元で起きた事故を、御社の設備が入口になったかのように書かない（C4）。
 * ソフトウェアの供給網の事故（対象外）には、確認できることを案内する（S-005）
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate, SUPPLY_CHAIN_HEADLINE, thirdPartyHeadline } from "./evaluate.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot, VictimDef } from "./knowledge.ts";
import { buildOnePager, effectiveMeasures } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

let k: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

const vpnCase = (victim?: string, extra: Partial<Case> = {}): Case => ({
  title: "再委託先の VPN 機器から侵入された",
  damageType: "ransomware",
  clarity: "partial",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1190"], source: "stated", entryKind: "vpn" },
    { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
  ],
  ...(victim ? { victim } : {}),
  ...extra,
});

describe("victims.yaml の宣言", () => {
  it("self（記事の会社そのもの）と、第三者（vendor、provider、group）がある", () => {
    const ids = k.victims.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["self", "vendor", "provider", "group"]));
    expect(k.victims.find((v) => v.id === "self")?.thirdParty).toBe(false);
    for (const v of k.victims.filter((x) => x.thirdParty)) {
      expect(v.checksJa.length).toBeGreaterThan(0);
      expect(v.reportNoteJa).toMatch(/確認が必要/);
      for (const id of v.measureIds) expect(k.measures.some((m) => m.id === id)).toBe(true);
    }
  });
});

describe("グループ会社（group。TRIAL-I-004）：子会社・孫会社の事故", () => {
  it("vendor の分類基準から「グループ会社」を外し、group の側に置く", () => {
    expect(k.victims.find((v) => v.id === "vendor")?.readingHintJa).not.toMatch(/グループ会社/);
    expect(k.victims.find((v) => v.id === "group")?.readingHintJa).toMatch(/子会社・孫会社/);
  });
  it("見出しは第三者の事故として書き、確認することは子会社への確認・親会社の報告と開示・接続の有無の 3 点", () => {
    const v = evaluate(vpnCase("group"), demo, { knowledge: k });
    expect(v.headlineJa).toMatch(
      /^これはグループ会社（子会社・孫会社）で起きた事故です。御社が同じ立場なら、/,
    );
    expect(v.thirdParty?.id).toBe("group");
    expect(v.thirdParty?.checksJa).toHaveLength(3);
    expect(v.thirdParty?.checksJa.join("\n")).toMatch(
      /グループ会社（子会社・孫会社）に、事故の範囲/,
    );
    expect(v.thirdParty?.checksJa.join("\n")).toMatch(/報告・開示（個人情報保護委員会、適時開示）/);
    expect(v.thirdParty?.checksJa.join("\n")).toMatch(/ネットワーク・認証基盤の接続の有無/);
  });
  it("一枚の先頭は、「御社の設備が入口になったのではありません」でなく「子会社と御社の接続の有無は、この公表からは分かりません」", () => {
    const g = buildOnePager(evaluate(vpnCase("group"), demo, { knowledge: k }), demo, k);
    expect(g.whatHappensJa[0]).toBe(
      "これはグループ会社（子会社・孫会社）で起きた事故です。子会社と御社の接続の有無は、この公表からは分かりません。",
    );
    expect(g.whatHappensJa.join("")).not.toContain("御社の設備が入口になったのではありません");
    // 委託先は従来どおり
    const v = buildOnePager(evaluate(vpnCase("vendor"), demo, { knowledge: k }), demo, k);
    expect(v.whatHappensJa[0]).toBe(
      "これは委託先・取引先で起きた事故です。御社の設備が入口になったのではありません。",
    );
  });
});

describe("省略・self は従来どおり（記録済みの事例が変わらない）", () => {
  it("victim が無い／self の結論・見出し・一枚は同じで、thirdParty は付かない", () => {
    const a = evaluate(vpnCase(), demo, { knowledge: k });
    const b = evaluate(vpnCase("self"), demo, { knowledge: k });
    expect(b).toEqual(a);
    expect(a.thirdParty).toBeUndefined();
    expect(a.headlineJa).toBe("うちの会社は、大丈夫ではありませんでした");
  });
});

describe("第三者の事故：御社の設備が入口になったとは書かない", () => {
  it("見出しは「これは委託先・取引先で起きた事故です。御社が同じ立場なら、…」。判定そのものは変わらない", () => {
    const self = evaluate(vpnCase(), demo, { knowledge: k });
    const v = evaluate(vpnCase("vendor"), demo, { knowledge: k });
    expect(v.result).toBe(self.result);
    expect(v.paths).toEqual(self.paths);
    expect(v.headlineJa).toBe(thirdPartyHeadline("委託先・取引先", v.result));
    expect(v.headlineJa).toMatch(/^これは委託先・取引先で起きた事故です。御社が同じ立場なら、/);
    expect(v.thirdParty?.labelJa).toBe("委託先・取引先");
    expect(v.thirdParty?.checksJa).toHaveLength(3);
  });
  it("一枚（テンプレート文）：「御社の設備が入口になったのではありません」と、御社が確認すること、報告は「確認が必要」", () => {
    const v = evaluate(vpnCase("vendor"), demo, { knowledge: k });
    const text = buildOnePager(v, demo, k).whatHappensJa;
    const joined = text.join("\n");
    expect(text[0]).toBe(
      "これは委託先・取引先で起きた事故です。御社の設備が入口になったのではありません。",
    );
    expect(joined).toContain("御社が同じ立場なら、攻撃は次の順に進むと見込まれます");
    expect(joined).not.toContain("攻撃は次の順に進みます：");
    expect(joined).toMatch(/御社が確認すること：委託先・取引先に、事故の範囲/);
    expect(joined).toMatch(
      /委託元の御社にも、個人情報保護委員会への報告や本人への通知が必要になることがあります。確認が必要です/,
    );
    expect(joined).not.toMatch(/T\d{4}/);
    // 出典：委託先の監督（自社の事故には載せない）
    expect(buildOnePager(v, demo, k).sources.join("\n")).toContain("3-4-4 委託先の監督");
    expect(
      buildOnePager(evaluate(vpnCase(), demo, { knowledge: k }), demo, k).sources.join("\n"),
    ).not.toContain("3-4-4");
  });
  it("対策の一覧に、委託先管理の助言（判定に使わない）が付く。ボタンには出ない対策（patches が空）", () => {
    const v = evaluate(vpnCase("vendor"), demo, { knowledge: k });
    const ids = effectiveMeasures(v, k.measures, demo).map((e) => e.measure.id);
    expect(ids).toEqual(
      expect.arrayContaining(["vendor-incident-contact", "vendor-contract-review"]),
    );
    const advice = k.measures.filter((m) => m.mitigation === "UD-04");
    expect(advice.length).toBeGreaterThanOrEqual(4);
    for (const m of advice) expect(m.patches).toEqual([]);
    // 費用は出典のある単価を作らない（社内作業）
    for (const m of advice) {
      const c = k.costs.measures.find((x) => x.measureId === m.id);
      expect(c?.basis === "internal" || c?.basis === "quote").toBe(true);
    }
    // 自社の事故なら、助言は付かない
    const self = evaluate(vpnCase(), demo, { knowledge: k });
    expect(
      effectiveMeasures(self, k.measures, demo).some((e) => e.measure.mitigation === "UD-04"),
    ).toBe(false);
  });
  it("自社の事故で、記事の入口の資産がカルテに無いときは、これまでどおり「入口なし（未登録）」（見出しは書き換えない）", () => {
    const rdp = vpnCase(undefined, {
      steps: [
        { tactic: "TA0001", techniques: ["T1133"], source: "stated", entryKind: "rdp" },
        { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
      ],
    });
    const v = evaluate(rdp, demo, { knowledge: k });
    expect(v.result).toBe("no_entry");
    expect(v.headlineJa).toMatch(/リモートデスクトップ/);
  });
  it("第三者の事故（TRIAL-I-007）：記事の入口の資産がカルテに無くても「入口なし」にせず、第三者の事故の見出しと確認することを出す", () => {
    const rdp = vpnCase("provider", {
      steps: [
        { tactic: "TA0001", techniques: ["T1133"], source: "stated", entryKind: "rdp" },
        { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
      ],
    });
    const v = evaluate(rdp, demo, { knowledge: k });
    expect(v.result).not.toBe("no_entry");
    expect(v.headlineJa).toMatch(
      /^これはクラウド・ソフトウェアの提供元で起きた事故です。御社が同じ立場なら、/,
    );
    expect(v.thirdParty?.id).toBe("provider");
    expect(v.paths.length).toBeGreaterThan(0);
    expect(v.paths.every((p) => p.statedEntry?.kindId === "rdp")).toBe(true);
  });
  it("対象外（out_of_scope）には付けない", () => {
    const v = evaluate({ ...vpnCase("vendor"), damageType: "out_of_scope", steps: [] }, demo, {
      knowledge: k,
    });
    expect(v.result).toBe("out_of_scope");
    expect(v.thirdParty).toBeUndefined();
  });
  it("拡張性：victims に 1 件足すだけで、その呼び名の第三者の事故として書ける", () => {
    const withVictim: Knowledge = {
      ...k,
      victims: [
        ...k.victims,
        VictimDef.parse({
          id: "parent",
          labelJa: "親会社",
          thirdParty: true,
          readingHintJa: "テスト用",
          checksJa: ["{label}に確認する"],
        }),
      ],
    };
    const v = evaluate(vpnCase("parent"), demo, { knowledge: withVictim });
    expect(v.headlineJa).toMatch(/^これは親会社で起きた事故です/);
    expect(v.thirdParty?.checksJa).toEqual(["親会社に確認する"]);
  });
});

describe("S-005：ソフトウェアの供給網の事故（対象外）は、確認できることを案内する", () => {
  const supply = (url?: string): Case => ({
    title: "エディタの配布サイトが改ざんされた",
    damageType: "out_of_scope",
    clarity: "clear",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1195.002"], source: "stated" },
      { tactic: "TA0042", techniques: ["T1608"], source: "stated" },
    ],
    ...(url ? { url } : {}),
  });
  it("判定は出さず（out_of_scope）、型紙を使わず、出典と該当期間の確認を案内する", () => {
    const v = evaluate(supply("https://example.com/news/1"), demo, { knowledge: k });
    expect(v.result).toBe("out_of_scope");
    expect(v.headlineJa).toBe(SUPPLY_CHAIN_HEADLINE);
    expect(v.paths).toEqual([]);
    expect(v.templateId).toBeUndefined();
    const g = v.guidanceJa?.join("\n") ?? "";
    expect(g).toMatch(/取得・更新・利用した端末/);
    expect(g).toMatch(/署名やハッシュの確認/);
    expect(g).toContain("出典：https://example.com/news/1");
    expect(buildOnePager(v, demo, k).whatHappensJa).toEqual(v.guidanceJa);
  });
  it("供給網でない対象外（DDoS など）には案内を付けない", () => {
    const v = evaluate(
      { ...supply(), steps: [{ tactic: "TA0040", techniques: ["T1498"], source: "stated" }] },
      demo,
      { knowledge: k },
    );
    // 供給網の案内は付かない（共通の案内だけ）
    expect(v.guidanceJa?.join("")).not.toMatch(/供給網|配布元/);
    expect(v.headlineJa).toBe("この事故は攻撃経路で判定できないため、対象外です");
  });
  it("型紙のある被害の種類の事例で T1195.002 を受け入れる判定は変えない", () => {
    const v = evaluate(
      {
        ...supply(),
        damageType: "ransomware",
        steps: [
          { tactic: "TA0001", techniques: ["T1195.002"], source: "stated" },
          { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
        ],
      },
      demo,
      { knowledge: k },
    );
    expect(v.guidanceJa).toBeUndefined();
    expect(v.result).not.toBe("out_of_scope");
  });
});

describe("続報で種類が分からない公表（needsPrevious。TRIAL-I-005）", () => {
  const followUp: Case = {
    title: "システム障害（続報）",
    damageType: "out_of_scope",
    clarity: "unknown",
    suspiciousInstructions: [],
    steps: [],
    needsPrevious: true,
  };
  it("見出しと一枚の先頭が「これは続報で、この文書だけでは種類が分かりません。第一報と合わせて読んでください」", () => {
    const line =
      "これは続報で、この文書だけでは種類が分かりません。第一報と合わせて読んでください。";
    const v = evaluate(followUp, demo, { knowledge: k });
    expect(v.result).toBe("out_of_scope");
    expect(v.needsPrevious).toBe(true);
    expect(v.headlineJa).toBe(line);
    expect(v.guidanceJa?.[0]).toBe(line);
    expect(v.guidanceJa?.join("")).not.toContain("攻撃経路で判定できない");
    expect(buildOnePager(v, demo, k).whatHappensJa[0]).toBe(line);
    // 共通の初動（個人情報の報告の案内）は残す
    expect(v.guidanceJa?.join("")).toContain("個人情報保護委員会への報告");
  });
  it("needsPrevious が無い対象外は従来どおり", () => {
    const { needsPrevious: _n, ...plain } = followUp;
    const v = evaluate(plain, demo, { knowledge: k });
    expect(v.needsPrevious).toBeUndefined();
    expect(v.headlineJa).toBe("この事故は攻撃経路で判定できないため、対象外です");
    expect(v.guidanceJa?.[0]).toBe(
      "この事故は攻撃経路で判定できないため、被害の見込みは出していません。",
    );
  });
});
