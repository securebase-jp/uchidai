/**
 * 型紙 partner-outage（取引先・提供元の停止。Issue #8、TRIAL-S-004）と、情報漏えいの取引先への通知（partner-notice-breach）。
 * 記事の要約（本文は入れない）で、型紙の選択・判定・止まる業務・期限・既存の型紙への影響を確かめる
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate, rankTemplates, selectTemplates } from "./evaluate.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { buildOnePager } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

// 配送を委託した先のランサムウェア被害で、自社のネットストアが止まった（無印良品の読み方：自社は侵入されていない）
const outage: Case = {
  title: "委託先のランサムウェア被害の影響で、ネットストアが停止した",
  damageType: "partner_outage",
  victim: "vendor",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    { tactic: "TA0040", techniques: [], source: "stated" },
  ],
};

let k: Knowledge;
let bussan: CompanyProfile;
let seiko: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  bussan = loadProfile(join(repoRoot, "examples", "demo-bussan.json"));
  seiko = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

describe("型紙の選択", () => {
  it("取引先・提供元の停止の記事では partner-outage が選ばれる", () => {
    expect(selectTemplates(outage, k).map((m) => m.template.id)).toEqual(["partner-outage"]);
    expect(rankTemplates(outage, k)[0]?.stageMatches).toBeGreaterThan(0);
  });
  it("他の被害の型の記事では選ばれない", () => {
    for (const damageType of ["ransomware", "data_breach", "bec", "account_takeover"]) {
      const ids = rankTemplates({ ...outage, damageType }, k).map((m) => m.template.id);
      expect(ids).not.toContain("partner-outage");
    }
  });
});

describe("判定", () => {
  it("提供元に任せた中核システムに頼る業務が止まり、取引先への影響日と時間軸が出る", () => {
    const v = evaluate(outage, bussan, { knowledge: k });
    expect(v.result).toBe("breached");
    expect(v.paths.some((p) => p.templateId === "partner-outage" && p.reachedCore)).toBe(true);
    expect(v.impact.stopped.length).toBeGreaterThan(0);
    expect(v.impact.downtimeDays).toBeGreaterThan(0);
    expect(v.timeline[0]?.day).toBe(0);
    expect(v.timeline.some((e) => e.kind === "business_stop")).toBe(true);
    // 御社が侵入されたとは書かない：第三者の事故の見出しになる
    expect(v.thirdParty?.id).toBe("vendor");
    expect(v.headlineJa).toContain("委託先・取引先で起きた事故");
  });
  it("止まる業務が外部の提供元に頼っていないカルテ（自社で持つ）では、入口なしになり、止まる業務は出ない", () => {
    const v = evaluate(outage, seiko, { knowledge: k });
    expect(v.result).toBe("no_entry");
    expect(v.impact.stopped).toEqual([]);
    expect(v.timeline).toEqual([]);
  });
  it("入口なしの見出しは「攻撃の入口」と言わず、侵入されていないことと止まる業務が無いことを書く", () => {
    const v = evaluate(outage, seiko, { knowledge: k });
    expect(v.headlineJa).not.toMatch(/入口/);
    expect(v.headlineJa).toContain("侵入されていません");
    expect(v.noEntry?.shortJa).toBe("止まる業務なし");
    expect(v.noEntry?.timelineJa).not.toMatch(/入口/);
    const op = buildOnePager(v, seiko, k, { caseTitle: outage.title });
    expect(op.headlineJa).toBe(v.headlineJa);
    expect(op.resultWordJa).toBe("止まる業務なし");
    expect(op.whatHappensJa.join("")).not.toMatch(/入口/);
    expect(op.whatHappensJa.join("")).toContain("取引先・提供元の停止");
  });
  it("他の被害の型の入口なしは、従来の見出しのまま（言い換えは取引先・提供元の停止だけ）", () => {
    const rw: Case = {
      ...outage,
      damageType: "account_takeover",
      steps: [{ tactic: "TA0001", techniques: ["T1078"], source: "stated" }],
    };
    const v = evaluate(rw, seiko, { knowledge: k });
    if (v.result === "no_entry") {
      expect(v.headlineJa).not.toContain("侵入されていません");
      expect(v.noEntry).toBeUndefined();
    }
    for (const d of k.damageTypes) if (d.id !== "partner_outage") expect(d.noEntry).toBeUndefined();
  });
  it("情報が外に出る事故ではないので、個人情報の報告・本人通知の期限は出ない", () => {
    const v = evaluate(outage, bussan, { knowledge: k });
    expect(v.impact.reportRequired).toBe(false);
    expect(v.timeline.some((e) => e.kind === "legal")).toBe(false);
  });
  it("攻撃者から届く経路は作らない（入口は取引先・提供元）", () => {
    const v = evaluate(outage, bussan, { knowledge: k });
    for (const p of v.paths) expect(p.steps[0]?.stageId).toBe("partner-down");
  });
});

describe("情報漏えいの取引先への通知", () => {
  const breach: Case = {
    title: "不正アクセスで情報が漏えい",
    damageType: "data_breach",
    clarity: "clear",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
      { tactic: "TA0009", techniques: ["T1005"], source: "stated" },
    ],
  };
  it("止まる業務が無くても、契約で定められた期限として時間軸に出る（日数は断定しない）", () => {
    const v = evaluate(breach, seiko, { knowledge: k });
    if (v.result === "blocked" || v.result === "no_entry") return;
    const e = v.timeline.find((x) => x.deadlineId === "partner-notice-breach");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("partner");
    expect(e?.labelJa).toContain("契約で定められた期限");
    expect(e?.detailJa).toContain("要確認");
  });
  it("ランサムウェアには出ない（従来の partner-notice のまま）", () => {
    const rw: Case = {
      ...breach,
      damageType: "ransomware",
      steps: [{ tactic: "TA0001", techniques: ["T1190"], source: "stated" }],
    };
    const v = evaluate(rw, seiko, { knowledge: k });
    expect(v.timeline.some((x) => x.deadlineId === "partner-notice-breach")).toBe(false);
  });
});
