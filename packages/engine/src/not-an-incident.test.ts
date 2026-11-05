/**
 * 事故の報告ではなく、脆弱性への対応（予防的な停止、修正の適用、影響なしの知らせ）のお知らせ（Case.notAnIncident。TRIAL-P-002）。
 * 「事故」「被害」「警察に相談」とは言わず、御社が同じ製品を使っていないかの確認とカルテへの製品・版の登録を案内する
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate, NOT_AN_INCIDENT_HEADLINE, NOT_AN_INCIDENT_LINES } from "./evaluate.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { buildOnePager } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

let k: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

const notice: Case = {
  title: "PHP の脆弱性への対応のお知らせ（被害は確認されていない）",
  damageType: "out_of_scope",
  clarity: "unknown",
  suspiciousInstructions: [],
  steps: [],
  notAnIncident: true,
};

describe("事故の報告ではないお知らせ（notAnIncident）", () => {
  it("見出しは「事故の報告ではなく、脆弱性への対応のお知らせ」。結論は out_of_scope のまま、被害は出さない", () => {
    const v = evaluate(notice, demo, { knowledge: k });
    expect(v.result).toBe("out_of_scope");
    expect(v.headlineJa).toBe(NOT_AN_INCIDENT_HEADLINE);
    expect(v.notAnIncident).toBe(true);
    expect(v.paths).toEqual([]);
    expect(v.guidanceJa).toEqual(NOT_AN_INCIDENT_LINES);
  });
  it("「事故」「個人情報が見られた」「警察」とは書かず、同じ製品の確認と KEV の突き合わせを案内する", () => {
    const v = evaluate(notice, demo, { knowledge: k });
    const text = (v.guidanceJa ?? []).join("\n");
    expect(text).not.toMatch(/警察|個人情報保護委員会|この事故/);
    expect(text).toMatch(/使っていないか/);
    expect(text).toMatch(/KEV/);
  });
  it("一枚も同じ文。対策も金額も出さない", () => {
    const v = evaluate(notice, demo, { knowledge: k });
    const op = buildOnePager(v, demo, k, { caseTitle: notice.title });
    expect(op.result).toBe("out_of_scope");
    expect(op.headlineJa).toBe(NOT_AN_INCIDENT_HEADLINE);
    expect(op.whatHappensJa).toEqual(NOT_AN_INCIDENT_LINES);
    expect(op.measures).toEqual([]);
  });
  it("notAnIncident でない対象外は、従来の文のまま（警察・個人情報の案内を出す）", () => {
    const v = evaluate({ ...notice, notAnIncident: undefined }, demo, { knowledge: k });
    expect(v.notAnIncident).toBeUndefined();
    expect((v.guidanceJa ?? []).join("\n")).toMatch(/警察/);
    expect(v.headlineJa).not.toBe(NOT_AN_INCIDENT_HEADLINE);
  });
  it("対象外でない記事（種類が読めている）には効かない", () => {
    const v = evaluate(
      {
        title: "VPN から侵入されたランサムウェア",
        damageType: "ransomware",
        clarity: "partial",
        suspiciousInstructions: [],
        steps: [{ tactic: "TA0001", techniques: ["T1190"], source: "stated", entryKind: "vpn" }],
        notAnIncident: true,
      },
      demo,
      { knowledge: k },
    );
    expect(v.result).not.toBe("out_of_scope");
    expect(v.notAnIncident).toBeUndefined();
  });
});
