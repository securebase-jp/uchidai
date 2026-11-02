/**
 * 経営への影響・時間軸・社長向けの一枚：デモ用カルテで 3 事例の数値を固定する
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { computeImpact, formatJpy } from "./impact.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { buildOnePager, OnePager } from "./onepager.ts";
import { buildTimeline } from "./timeline.ts";
import type { Case, CompanyProfile, TimelineEvent } from "./types.ts";

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
const byDeadline = (t: TimelineEvent[], id: string) => t.find((e) => e.deadlineId === id);

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

describe("事例1（業務停止）の経営への影響", () => {
  it("生産管理まで到達し、停止 10 日、3 日目から取引先の納期に影響、売上影響の目安 1 億円", () => {
    const v = evaluate(case1, demo, { knowledge });
    expect(v.impact.downtimeDays).toBe(10);
    expect(v.impact.revenueImpactJpy).toBe(100_000_000);
    expect(v.impact.partnerImpactDay).toBe(3);
    const order = v.impact.stopped.find((s) => s.businessId === "biz-order");
    expect(order).toMatchObject({
      days: 10,
      manualDays: 2,
      partnerDay: 3,
      affectsJa: "取引先の納期",
    });
    // 設計（ファイルサーバ）には到達していないので止まらない。経理（復旧 0 日）も止まらない
    expect(v.impact.stopped.map((s) => s.businessId)).toEqual(["biz-order"]);
    expect(v.impact.moneyLossJpy).toBeUndefined();
  });

  it("取引先担当者の連絡先 3,000 件に到達するので、報告義務（不正アクセス由来・1,000 人超）", () => {
    const v = evaluate(case1, demo, { knowledge });
    expect(v.impact.reportRequired).toBe(true);
    expect(v.impact.personalDataReached.map((p) => p.assetId)).toEqual(["core"]);
    expect(v.impact.reportReasonsJa?.join("")).toContain("不正の目的");
    expect(v.impact.reportReasonsJa?.join("")).toContain("1,000 人");
    expect(v.impact.reportReasonsJa?.join("")).not.toContain("要配慮");
  });

  it("時間軸：Day0 暗号化、業務停止、3 日目から取引先、速報・確報・本人通知、保険、警察、復旧", () => {
    const v = evaluate(case1, demo, { knowledge });
    const t = v.timeline;
    expect(t.length).toBeGreaterThan(0);
    expect(t.map((e) => e.day)).toEqual([...t.map((e) => e.day)].sort((a, b) => a - b));
    expect(t[0]).toMatchObject({ day: 0, kind: "business_stop" });
    expect(t.find((e) => e.kind === "business_stop" && e.businessId === "biz-order")?.day).toBe(0);
    expect(
      t.find((e) => e.kind === "partner" && !e.deadlineId && e.businessId === "biz-order"),
    ).toMatchObject({
      day: 3,
      labelJa: "3 日目から取引先の納期に影響",
    });
    expect(t.find((e) => e.kind === "recovery" && e.businessId === "biz-order")?.day).toBe(10);

    const prompt = byDeadline(t, "ppc-prompt");
    expect(prompt).toMatchObject({ day: 5, kind: "legal", assetId: "core" });
    expect(prompt?.labelJa).toContain("3〜5 日以内");
    expect(prompt?.sourceJa).toContain("個人情報保護委員会");
    const final = byDeadline(t, "ppc-final");
    expect(final?.day).toBe(60);
    expect(final?.detailJa).toContain("60 日以内");
    expect(byDeadline(t, "ppc-notify")).toMatchObject({ day: 5, kind: "legal" });
    expect(byDeadline(t, "insurance")).toMatchObject({ day: 30, kind: "insurance" });
    expect(byDeadline(t, "police")).toMatchObject({ day: 1, kind: "police" });
    // 取引先への契約上の通知は、取引先に影響が出る前日（手作業の最終日）
    expect(byDeadline(t, "partner-notice")).toMatchObject({ day: 2, businessId: "biz-order" });
    expect(byDeadline(t, "partner-notice")?.detailJa).toContain("要確認");
    // なりすまし送金の出来事は出ない
    expect(byDeadline(t, "bank-recall")).toBeUndefined();
    // すべての出来事に出典または紐づけがある
    for (const e of t) expect(e.sourceJa ?? e.businessId ?? e.deadlineId).toBeTruthy();
  });

  it("「VPN 装置の更新」で止まると、影響も時間軸も消える", () => {
    const v = evaluate(case1, applyMeasures(demo, [measure("vpn-update")]), { knowledge });
    expect(v.result).toBe("blocked");
    expect(v.timeline).toEqual([]);
    expect(v.impact.stopped).toEqual([]);
    expect(v.impact.downtimeDays).toBe(0);
    expect(v.impact.revenueImpactJpy).toBeUndefined();
    expect(v.impact.reportRequired).toBe(false);
    expect(v.impact.partnerImpactDay).toBeUndefined();
  });

  it("「切り離したバックアップ」で停止は 2 日になり、取引先への影響は出ない", () => {
    const v = evaluate(case1, applyMeasures(demo, [measure("backup-isolated")]), { knowledge });
    expect(v.result).toBe("mitigated");
    expect(v.impact.downtimeDays).toBe(2);
    expect(v.impact.revenueImpactJpy).toBe(20_000_000);
    expect(v.impact.partnerImpactDay).toBeUndefined();
    expect(v.timeline.some((e) => e.kind === "partner")).toBe(false);
    expect(byDeadline(v.timeline, "partner-notice")).toBeUndefined();
    expect(v.timeline.find((e) => e.kind === "recovery")?.day).toBe(2);
    // 個人情報には到達したままなので、報告の期限は残る
    expect(byDeadline(v.timeline, "ppc-prompt")).toBeDefined();
  });

  it("computeImpact は Verdict でも経路の配列でも同じ結果を返す", () => {
    const v = evaluate(case1, demo, { knowledge });
    expect(computeImpact(v, demo, { knowledge })).toEqual(
      computeImpact(v.paths, demo, { damageType: "ransomware", knowledge }),
    );
    expect(computeImpact(v, demo, { knowledge })).toEqual(v.impact);
  });
});

describe("事例5（なりすまし送金）の経営への影響", () => {
  it("送金額の目安 500 万円、業務は止まらない、組戻しの依頼が Day0 に出る", () => {
    const v = evaluate(case5, demo, { knowledge });
    expect(v.result).toBe("breached");
    expect(v.impact.moneyLossJpy).toBe(5_000_000);
    expect(v.impact.stopped).toEqual([]);
    expect(v.impact.downtimeDays).toBe(0);
    expect(v.impact.revenueImpactJpy).toBeUndefined();
    expect(v.impact.reportRequired).toBe(false);
    const t = v.timeline;
    expect(t[0]).toMatchObject({ day: 0, kind: "money" });
    expect(t[0]?.detailJa).toContain("約 500 万円");
    expect(byDeadline(t, "bank-recall")).toMatchObject({ day: 0, kind: "money" });
    expect(byDeadline(t, "bank-recall")?.sourceJa).toContain("警視庁");
    expect(byDeadline(t, "police")?.day).toBe(1);
    expect(t.some((e) => e.kind === "business_stop")).toBe(false);
    expect(byDeadline(t, "insurance")).toMatchObject({ day: 30 });
  });
  it("「送金時の折り返し確認ルール」で止まると、送金額も時間軸も消える", () => {
    const v = evaluate(case5, applyMeasures(demo, [measure("transfer-callback")]), { knowledge });
    expect(v.impact.moneyLossJpy).toBeUndefined();
    expect(v.timeline).toEqual([]);
  });
});

describe("事例2（情報漏えい）の経営への影響", () => {
  it("止まるので時間軸は空、報告義務なし", () => {
    const v = evaluate(case2, demo, { knowledge });
    expect(v.result).toBe("blocked");
    expect(v.timeline).toEqual([]);
    expect(v.impact.reportRequired).toBe(false);
    expect(v.impact.personalDataReached).toEqual([]);
  });
  it("公開リンクの禁止と棚卸しを外すと、取引先リスト 400 件（1,000 人以下）でも不正アクセス由来で報告対象", () => {
    const weak: CompanyProfile = structuredClone(demo);
    const storage = weak.assets.find((a) => a.id === "cloud-storage");
    if (!storage) throw new Error("cloud-storage");
    storage.controls = storage.controls.map((c) => ({ ...c, status: "absent" as const }));
    storage.attrs = { publicLinksDisabled: false };
    const v = evaluate(case2, weak, { knowledge });
    expect(v.result).toBe("breached");
    expect(v.impact.reportRequired).toBe(true);
    expect(v.impact.reportReasonsJa?.join("")).toContain("不正の目的");
    expect(v.impact.reportReasonsJa?.join("")).not.toContain("1,000 人");
    expect(v.timeline[0]).toMatchObject({ day: 0, kind: "legal" });
    expect(byDeadline(v.timeline, "ppc-final")).toMatchObject({
      day: 60,
      assetId: "cloud-storage",
    });
    expect(byDeadline(v.timeline, "ppc-notify")).toBeDefined();
    expect(v.impact.stopped).toEqual([]);
  });
});

describe("業種による違い：医療・福祉", () => {
  it("電子カルテの病歴（要配慮個人情報）に到達すると、件数にかかわらず報告対象と時間軸に出る", () => {
    const p = profileFromAnswers(
      {
        industry: "healthcare",
        site: "clinic",
        hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
        remoteAccess: ["vpn"],
        backup: "same_network",
      },
      knowledge.patterns,
      "デモ診療所",
    );
    p.personalData = [
      {
        assetId: "core",
        descriptionJa: "患者の病歴",
        count: 800,
        over1000: false,
        sensitive: true,
      },
    ];
    const v = evaluate(case1, p, { knowledge });
    expect(v.paths.some((x) => x.reachedCore)).toBe(true);
    expect(v.impact.reportRequired).toBe(true);
    expect(v.impact.reportReasonsJa?.join("")).toContain("要配慮個人情報");
    expect(v.impact.reportReasonsJa?.join("")).toContain("件数にかかわらず");
    const prompt = byDeadline(v.timeline, "ppc-prompt");
    expect(prompt?.detailJa).toContain("要配慮個人情報");
    expect(prompt?.detailJa).toContain("患者の病歴 800 件");
    // 受付・診療・検査・会計の 4 業務が止まり、手作業 1 日なので 2 日目から患者に影響
    expect(v.impact.stopped.length).toBe(4);
    expect(v.impact.partnerImpactDay).toBe(2);
    expect(v.impact.downtimeDays).toBe(14);
  });
});

describe("社長向けの一枚", () => {
  it("事例1：結論、専門用語なしの文、止まる業務、期限、効く対策と費用、出典、架空の注記", () => {
    const v = evaluate(case1, demo, { knowledge });
    const one = buildOnePager(v, demo, knowledge, { caseTitle: case1.title });
    expect(OnePager.safeParse(one).success).toBe(true);
    expect(one.result).toBe("breached");
    expect(one.headlineJa).toBe(v.headlineJa);
    expect(one.fictional).toBe(true);
    expect(one.notesJa.join("")).toContain("架空の会社");
    // 手法 ID・緩和策 ID を含まない
    for (const line of one.whatHappensJa)
      expect(line).not.toMatch(/\b(T\d{4}|M\d{4}|TA\d{4}|UD-\d{2})\b/);
    expect(one.whatHappensJa.join("")).toContain("VPN装置");
    expect(one.whatHappensJa.join("")).toContain("復旧まで最長 10 日");
    expect(one.whatHappensJa.join("")).toContain("3 日目から取引先の納期に影響");
    expect(one.stopped).toEqual([
      { name: "受注・生産管理", days: 10, manualDays: 2, partnerDay: 3, affectsJa: "取引先の納期" },
    ]);
    expect(one.revenueImpactJpy).toBe(100_000_000);
    expect(one.revenueImpactJa).toContain("約 1 億円");
    expect(one.deadlines.map((d) => d.kind)).toEqual(
      expect.arrayContaining(["legal", "insurance", "police", "partner"]),
    );
    expect(one.deadlines.every((d) => d.sourceJa)).toBe(true);

    const ids = one.measures.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining(["vpn-update", "backup-isolated", "edr", "admin-separate"]),
    );
    // 効かない対策（VPN の多要素認証）と経路の外の対策は載せない
    expect(ids).not.toContain("vpn-mfa");
    expect(ids).not.toContain("exec-mfa");
    expect(ids).not.toContain("transfer-callback");
    const edr = one.measures.find((m) => m.id === "edr");
    expect(edr).toMatchObject({ basis: "ipa", costJpy: 13_200 * 120, requestToJa: "保守ベンダー" });
    expect(edr?.costJa).toContain("13,200 円 × 120 台");
    expect(edr?.costSourceJa).toContain("PDF 45 ページ");
    expect(one.measures.find((m) => m.id === "vpn-update")).toMatchObject({
      basis: "quote",
      costJa: "ベンダーの見積もり待ち",
    });
    expect(one.sources.join("\n")).toContain("IPA");
    expect(one.sources.join("\n")).toContain(`ATT&CK Enterprise v${v.attackVersion}`);
    expect(one.sources.join("\n")).toContain("個人情報保護委員会");
  });
  it("事例5：送金額の目安と、社内ルールの対策（外部費用なし）", () => {
    const v = evaluate(case5, demo, { knowledge });
    const one = buildOnePager(v, demo, knowledge);
    expect(one.moneyLossJa).toContain("約 500 万円");
    expect(one.stopped).toEqual([]);
    const ids = one.measures.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["exec-mfa", "transfer-callback"]));
    expect(ids).not.toContain("vpn-update");
    expect(one.measures.find((m) => m.id === "transfer-callback")?.basis).toBe("internal");
  });
  it("止められる結論では、止まる段階と理由を文にし、対策の一覧は空", () => {
    const v = evaluate(case2, demo, { knowledge });
    const one = buildOnePager(v, demo, knowledge);
    expect(one.result).toBe("blocked");
    expect(one.whatHappensJa[0]).toContain("止まります");
    expect(one.measures).toEqual([]);
    expect(one.deadlines).toEqual([]);
  });
});

describe("buildTimeline と formatJpy", () => {
  it("結論が blocked / no_entry / out_of_scope なら空", () => {
    const v = evaluate(case1, demo, { knowledge });
    for (const result of ["blocked", "no_entry", "out_of_scope"] as const)
      expect(buildTimeline(v.impact, demo, { result, paths: v.paths }, { knowledge })).toEqual([]);
  });
  it("金額の表示", () => {
    expect(formatJpy(100_000_000)).toBe("約 1 億円");
    expect(formatJpy(5_000_000)).toBe("約 500 万円");
    expect(formatJpy(1_584_000)).toBe("約 158.4 万円");
    expect(formatJpy(20_000_000)).toBe("約 2000 万円");
    expect(formatJpy(13_200)).toBe("約 1.3 万円");
    expect(formatJpy(5_280)).toBe("5,280 円");
  });
});
