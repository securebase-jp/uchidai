/**
 * 経営への影響・時間軸・社長向けの一枚：デモ用カルテで 3 事例の数値を固定する
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { computeImpact, formatJpy, hasRecoverableStep } from "./impact.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { buildOnePager, effectiveMeasures, OnePager, stripIds } from "./onepager.ts";
import { buildTimeline } from "./timeline.ts";
import type { AttackPath, Case, CompanyProfile, TimelineEvent, Verdict } from "./types.ts";

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

describe("被害の種類ごとに「業務が止まるか」を決める（stopsOperations。TRIAL-D-001）", () => {
  // VPN 装置の脆弱性から入り、データを持ち出す（情報漏えい）。ランサムウェアと同じ入口・同じ到達資産
  const breachViaVpn: Case = {
    title: "VPN の脆弱性から侵入され、顧客情報が持ち出された",
    damageType: "data_breach",
    clarity: "partial",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated", quote: "VPN装置の脆弱性" },
      { tactic: "TA0010", techniques: ["T1041"], source: "stated", quote: "情報が外部に送信" },
    ],
  };

  it("情報漏えいは、経路が生産管理に届いても止まる業務・復旧日数・売上影響が空になり、報告義務は残る", () => {
    const v = evaluate(breachViaVpn, demo, { knowledge });
    expect(v.result).toBe("breached");
    expect(v.impact.stopped).toEqual([]);
    expect(v.impact.downtimeDays).toBe(0);
    expect(v.impact.revenueImpactJpy).toBeUndefined();
    expect(v.impact.partnerImpactDay).toBeUndefined();
    expect(v.impact.personalDataReached.length).toBeGreaterThan(0);
    expect(v.impact.reportRequired).toBe(true);
    const t = v.timeline;
    expect(t[0]).toMatchObject({ day: 0, kind: "legal" });
    expect(t.some((e) => e.kind === "business_stop" || e.kind === "recovery")).toBe(false);
    expect(byDeadline(t, "ppc-final")?.day).toBe(60);
    expect(byDeadline(t, "ppc-notify")).toBeDefined();
    expect(byDeadline(t, "police")?.day).toBe(1);
  });
  it("同じ入口でも、ランサムウェアなら従来どおり止まる（受注・生産管理、10 日、1 億円）", () => {
    const v = evaluate(case1, demo, { knowledge });
    expect(v.impact.stopped.map((s) => s.businessId)).toEqual(["biz-order"]);
    expect(v.impact.downtimeDays).toBe(10);
    expect(v.impact.revenueImpactJpy).toBe(100_000_000);
  });
  it("一枚は、止まる業務が空のとき止まる業務の文を書かず、報告義務の文は書く", () => {
    const v = evaluate(breachViaVpn, demo, { knowledge });
    const op = buildOnePager(v, demo, knowledge);
    expect(op.stopped).toEqual([]);
    expect(op.revenueImpactJa).toBeUndefined();
    expect(op.whatHappensJa.join("")).not.toContain("止まり、復旧まで");
    expect(op.whatHappensJa.join("")).toContain("個人情報保護委員会への報告");
  });
  it("定義の無い種類・種類が分からないときは、従来どおり止まる", () => {
    const paths = evaluate(case1, demo, { knowledge }).paths;
    // 種類を渡さず、型紙も引けない経路（templateId なし）
    const bare = paths.map(({ templateId: _t, ...p }) => p);
    expect(computeImpact(bare, demo, { knowledge }).stopped.length).toBeGreaterThan(0);
    // 知識ファイルに無い種類
    expect(
      computeImpact(paths, demo, { knowledge, damageType: "new_kind_of_attack" }).stopped.length,
    ).toBeGreaterThan(0);
  });
  it("stopsOperations を宣言すれば、新しい種類も同じ扱いになる（コードは変えない）", () => {
    const paths = evaluate(case1, demo, { knowledge }).paths;
    const extended: Knowledge = {
      ...knowledge,
      damageTypes: [
        ...knowledge.damageTypes,
        { ...knowledge.damageTypes[0]!, id: "quiet_theft", stopsOperations: false },
        { ...knowledge.damageTypes[0]!, id: "loud_outage" },
      ],
    };
    expect(
      computeImpact(paths, demo, { knowledge: extended, damageType: "quiet_theft" }).stopped,
    ).toEqual([]);
    expect(
      computeImpact(paths, demo, { knowledge: extended, damageType: "loud_outage" }).stopped.length,
    ).toBeGreaterThan(0);
  });
  it("知識ファイルの宣言：ransomware だけが止まる。省略時は止まる", () => {
    const flag = (id: string) => knowledge.damageTypes.find((d) => d.id === id)?.stopsOperations;
    expect(flag("ransomware")).toBe(true);
    expect(flag("data_breach")).toBe(false);
    expect(flag("account_takeover")).toBe(false);
    expect(flag("bec")).toBe(false);
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
    // 「何が起きるか」は型紙の言葉で書く（「突破」ではなく「暗号化される」）
    expect(one.whatHappensJa[0]).toContain("バックアップ（クラウド同期）が暗号化される");
    expect(one.whatHappensJa.join("")).not.toContain("突破");
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
    expect(formatJpy(20_000_000)).toBe("約 2,000 万円");
    expect(formatJpy(150_000_000)).toBe("約 1.5 億円");
    expect(formatJpy(99_999_999)).toBe("約 1 億円");
    expect(formatJpy(9_999)).toBe("9,999 円");
    expect(formatJpy(0)).toBe("0 円");
    expect(formatJpy(13_200)).toBe("約 1.3 万円");
    expect(formatJpy(5_280)).toBe("5,280 円");
  });
});

describe("経営の層の境界", () => {
  it("復旧できる経路と復旧できない経路が混在すれば、停止日数は通常の復旧日数で見る", () => {
    const v = evaluate(case1, applyMeasures(demo, [measure("backup-isolated")]), { knowledge });
    const recoverable = v.paths.filter((p) => p.reachedCore);
    expect(recoverable.length).toBeGreaterThan(0);
    const hard: AttackPath = {
      ...(recoverable[0] as AttackPath),
      id: "ransomware:other",
      steps: (recoverable[0] as AttackPath).steps.map((s) =>
        s.state === "recoverable" ? { ...s, state: "breached" as const } : s,
      ),
    };
    expect(hasRecoverableStep(recoverable)).toBe(true);
    expect(hasRecoverableStep([...recoverable, hard])).toBe(false);
    expect(hasRecoverableStep([])).toBe(false);
    const mixed = computeImpact([...recoverable, hard], demo, {
      damageType: "ransomware",
      knowledge,
    });
    expect(mixed.downtimeDays).toBe(10);
    expect(mixed.partnerImpactDay).toBe(3);
  });

  it("手作業で回せる日数が復旧日数以上なら取引先への影響は出ず、復旧 0 日の業務は止まらない", () => {
    const p: CompanyProfile = structuredClone(demo);
    const order = p.businesses.find((b) => b.id === "biz-order");
    if (!order) throw new Error("biz-order");
    order.manualDays = 10;
    const v = evaluate(case1, p, { knowledge });
    expect(v.impact.stopped[0]?.partnerDay).toBeUndefined();
    expect(v.impact.partnerImpactDay).toBeUndefined();
    expect(v.timeline.some((e) => e.kind === "partner")).toBe(false);
    const one = buildOnePager(v, p, knowledge);
    expect(one.partnerImpactJa).toContain("取引先への影響は見込みません");
  });

  it("1 日の売上と個人情報が未登録なら、売上影響と報告義務は出ない", () => {
    const p: CompanyProfile = structuredClone(demo);
    delete p.dailyRevenue;
    p.personalData = [];
    const v = evaluate(case1, p, { knowledge });
    expect(v.impact.downtimeDays).toBe(10);
    expect(v.impact.revenueImpactJpy).toBeUndefined();
    expect(v.impact.reportRequired).toBe(false);
    expect(v.timeline.some((e) => e.kind === "legal")).toBe(false);
    const one = buildOnePager(v, p, knowledge);
    expect(one.revenueImpactJa).toBeUndefined();
    expect(one.sources.join("\n")).not.toContain("個人情報保護委員会");
  });

  it("保険に加入しているが通知期限が未登録なら、発覚当日に「要確認」として置く", () => {
    const p: CompanyProfile = structuredClone(demo);
    p.cyberInsurance = { enrolled: true };
    const v = evaluate(case1, p, { knowledge });
    const ins = byDeadline(v.timeline, "insurance");
    expect(ins).toMatchObject({ day: 0, kind: "insurance" });
    expect(ins?.labelJa).toContain("カルテ未登録");
    expect(ins?.detailJa).toContain("要確認");
    p.cyberInsurance = { enrolled: false };
    expect(byDeadline(evaluate(case1, p, { knowledge }).timeline, "insurance")).toBeUndefined();
  });

  it("本人への通知は法令に日数の定めがないので「◯ 日以内」とは書かず、目安と書く", () => {
    const v = evaluate(case1, demo, { knowledge });
    const notify = byDeadline(v.timeline, "ppc-notify");
    expect(notify?.labelJa).not.toMatch(/\d+ 日以内/);
    expect(notify?.labelJa).toContain("目安");
    expect(byDeadline(v.timeline, "ppc-prompt")?.labelJa).toContain("3〜5 日以内");
    expect(byDeadline(v.timeline, "ppc-final")?.labelJa).toContain("60 日以内");
  });

  it("確認中（pending）でも影響は到達した前提で計算し、一枚に確認中の段階を書く", () => {
    // サーバへ広がる段階（M1030・M1035）を未確認にすると、材料のある段階が未確認だけになり pending
    const p: CompanyProfile = structuredClone(demo);
    for (const a of p.assets) {
      if (a.id === "server" || a.id === "backup" || a.id === "vpn") {
        a.controls = a.controls.map((c) => ({
          ...c,
          status: "unknown" as const,
          evidence: "none" as const,
        }));
        a.attrs = {};
        a.attrEvidence = {};
      }
    }
    const v = evaluate(case1, p, { knowledge });
    expect(v.result).toBe("pending");
    expect(v.impact.downtimeDays).toBe(10);
    const one = buildOnePager(v, p, knowledge);
    expect(one.whatHappensJa.join("")).toContain("確認中");
  });
});

describe("社長向けの一枚の文と対策", () => {
  it("一枚のどの文にも手法 ID・緩和策 ID が出ない（判定ルールの理由文に混じっていても取り除く）", () => {
    expect(stripIds("承認ボタンを押すだけの方式は、大量の承認要求（T1621）に弱い")).toBe(
      "承認ボタンを押すだけの方式は、大量の承認要求に弱い",
    );
    expect(stripIds("多要素認証（M1032、UD-01）がない。T1078.004 で入る")).toBe(
      "多要素認証がない。 で入る",
    );
    expect(stripIds("CVE-2024-55591 に該当")).toBe("CVE-2024-55591 に該当");
    for (const c of [case1, case2, case5]) {
      const v = evaluate(c, demo, { knowledge });
      const one = buildOnePager(v, demo, knowledge);
      const texts = [
        one.headlineJa,
        ...one.whatHappensJa,
        one.partnerImpactJa ?? "",
        ...one.deadlines.map((d) => d.labelJa),
        ...one.measures.flatMap((m) => [m.labelJa, m.stageJa ?? "", m.costJa]),
        ...one.notesJa,
      ];
      for (const t of texts)
        expect(t).not.toMatch(/\b(T\d{4}(\.\d{3})?|M\d{4}|TA\d{4}|UD-\d{2})\b/);
    }
  });

  it("止まる段階の理由に ID が混じった経路でも、一枚の文からは消える", () => {
    const v = evaluate(case2, demo, { knowledge });
    const path = v.paths.find((p) => p.steps.some((s) => s.state === "blocked"));
    if (!path) throw new Error("blocked path");
    const tainted: Verdict = {
      ...v,
      paths: v.paths.map((p) =>
        p.id === path.id
          ? {
              ...p,
              steps: p.steps.map((s) =>
                s.state === "blocked" ? { ...s, reasonJa: `${s.reasonJa}（M1022、T1530）` } : s,
              ),
            }
          : p,
      ),
    };
    const one = buildOnePager(tainted, demo, knowledge);
    expect(one.whatHappensJa[0]).toContain("理由：");
    expect(one.whatHappensJa[0]).not.toMatch(/M1022|T1530/);
  });

  it("対策は攻撃を早い段階で止めるものが先に並び、費用と依頼先がつく", () => {
    const v = evaluate(case1, demo, { knowledge });
    const one = buildOnePager(v, demo, knowledge);
    const ids = one.measures.map((m) => m.id);
    expect(ids[0]).toBe("vpn-update");
    expect(ids.indexOf("vpn-update")).toBeLessThan(ids.indexOf("edr"));
    expect(ids.indexOf("edr")).toBeLessThan(ids.indexOf("backup-isolated"));
    for (const m of one.measures) {
      expect(m.costJa.length).toBeGreaterThan(0);
      expect(m.requestToJa).toBeTruthy();
    }
  });

  it("既に講じてある対策（切り離したバックアップ済み）は勧めない。AI が見つけた経路だけに効く対策も載せない", () => {
    const applied = applyMeasures(demo, [measure("backup-isolated")]);
    const v = evaluate(case1, applied, { knowledge });
    expect(v.result).toBe("mitigated");
    const ids = buildOnePager(v, applied, knowledge).measures.map((m) => m.id);
    expect(ids).not.toContain("backup-isolated");
    expect(ids).toContain("vpn-update");
    // profile を渡さなければ従来どおり（経路で効く対策をすべて）
    expect(effectiveMeasures(v, knowledge.measures).map((x) => x.measure.id)).toContain(
      "backup-isolated",
    );
    const aiOnly: Verdict = { ...v, paths: v.paths.map((p) => ({ ...p, source: "ai" as const })) };
    expect(effectiveMeasures(aiOnly, knowledge.measures)).toEqual([]);
  });

  it("出典は実際に使った期限の分だけ載せる（業務停止の一枚に警視庁の BEC 資料は載らない）", () => {
    const one1 = buildOnePager(evaluate(case1, demo, { knowledge }), demo, knowledge);
    expect(one1.sources.join("\n")).toContain("警察庁");
    expect(one1.sources.join("\n")).not.toContain("警視庁");
    const one5 = buildOnePager(evaluate(case5, demo, { knowledge }), demo, knowledge);
    expect(one5.sources.join("\n")).toContain("警視庁");
    expect(one5.sources.join("\n")).not.toContain("個人情報保護委員会");
    expect(one5.deadlines.every((d) => d.deadlineId)).toBe(true);
  });

  it("日数と売上影響の文には「目安」と書き、外部統計からの推計はしないと注記する", () => {
    const one = buildOnePager(evaluate(case1, demo, { knowledge }), demo, knowledge);
    expect(one.whatHappensJa.join("")).toContain("目安");
    expect(one.revenueImpactJa).toContain("目安");
    expect(one.notesJa.join("")).toContain("外部統計からの損害額の推計ではありません");
  });
});

describe("時間軸の重複（同じ見出しの出来事は 1 つにまとめる）", () => {
  it("5 問から作った製造業のカルテで、同じ日の「取引先の納期に影響」が重複しない", () => {
    const k = loadKnowledge();
    const p = profileFromAnswers(
      {
        industry: "manufacturing",
        site: "factory",
        hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
        remoteAccess: ["vpn", "vendor_remote"],
        backup: "cloud_sync",
      },
      k.patterns,
    );
    const v = evaluate(
      {
        title: "t",
        damageType: "ransomware",
        clarity: "partial",
        suspiciousInstructions: [],
        steps: [
          { tactic: "TA0001", techniques: ["T1190"], source: "stated" },
          { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
        ],
      },
      p,
      { knowledge: k },
    );
    const keys = v.timeline.map((e) => `${e.kind}|${e.day}|${e.labelJa}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(v.timeline.filter((e) => e.kind === "partner" && e.day === 3)).toHaveLength(2);
  });
});
