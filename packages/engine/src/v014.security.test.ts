/**
 * v0.1.4 前のセキュリティ診断（docs/security-review-v0.1.4-2026-11-07.md）で足した試験（判定の知識まわり）。
 * - 確かめて問題なかったことは it で固定する
 * - 見つけた問題（DL-001）は直したので it で固定する
 * Claude は呼ばない。入力はすべて架空（デモのカルテ）
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { buildOnePager } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

let k: Knowledge;
let seiko: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  seiko = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

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

describe("DL-001（低）取引先への通知の期限が、一枚では「契約で定められた期限」の 0 日目として出る", () => {
  it("時間軸の詳細にも「要確認」がある（一枚の期限は、詳細ではなく見出しで示す）", () => {
    const v = evaluate(breach, seiko, { knowledge: k });
    const e = v.timeline.find((x) => x.deadlineId === "partner-notice-breach");
    expect(e?.day).toBe(0);
    expect(e?.detailJa).toContain("要確認");
    const op = buildOnePager(v, seiko, k, { caseTitle: breach.title });
    const d = op.deadlines.find((x) => x.deadlineId === "partner-notice-breach");
    expect(d?.day).toBe(0);
    expect(d?.labelJa).toContain("取引先への通知（契約で定められた期限）");
  });
  it("DL-001：一枚の期限の見出しに「要確認」が出て、出典は会社カルテではなく契約書（要確認）になる", () => {
    const v = evaluate(breach, seiko, { knowledge: k });
    const op = buildOnePager(v, seiko, k, { caseTitle: breach.title });
    const d = op.deadlines.find((x) => x.deadlineId === "partner-notice-breach");
    expect(d?.labelJa).toBe("取引先への通知（契約で定められた期限）（要確認）");
    expect(d?.sourceJa).toBe("契約書（要確認）");
  });
  it("DL-001：確定している期限（警察、送金の組み戻し）の見出しと出典は変わらない", () => {
    const v = evaluate(breach, seiko, { knowledge: k });
    const op = buildOnePager(v, seiko, k, { caseTitle: breach.title });
    const police = op.deadlines.find((x) => x.deadlineId === "police");
    expect(police?.labelJa).toMatch(/（目安）$/);
    expect(police?.labelJa).not.toContain("要確認");
    expect(police?.sourceJa).not.toContain("契約書");
  });
});

describe("確かめて問題なかったこと（Issue #7・#8）", () => {
  it("サービスアカウント乗っ取りの判定ルールに、「止められる」（blocked）になる結果は無い", () => {
    const rules = k.rules.filter((r) => r.id.startsWith("service_account."));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) for (const o of r.outcomes) expect(o.state).not.toBe("blocked");
  });
  it("取引先・提供元の停止の判定ルールは、対策の有無によらず breached だけ（御社の対策で防げたとは言わない）", () => {
    const rules = k.rules.filter((r) => r.id.startsWith("partner_outage."));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.mitigations).toEqual([]);
      expect(r.outcomes.map((o) => o.state)).toEqual(["breached"]);
    }
  });
  it("入口なしの言い換え（noEntry）は取引先・提供元の停止だけで、他の被害の型には無い", () => {
    for (const d of k.damageTypes) if (d.id !== "partner_outage") expect(d.noEntry).toBeUndefined();
  });
  it("PO-001（情報）現状：記事の分類が取引先・提供元の停止なら、カルテに依存が無いと「御社は侵入されていません」と言い切る", () => {
    // 被害の型（damageType）は Claude が記事から読む値で、記事の本文で左右される。判定そのものはプログラムだが、
    // 見出しは「記事がそう分類した」ではなく、御社の事実として書かれる。デフォルトのカルテ（pending に倒す）では出ない
    const outage: Case = {
      title: "x",
      damageType: "partner_outage",
      clarity: "clear",
      suspiciousInstructions: [],
      steps: [
        { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
        { tactic: "TA0040", techniques: [], source: "stated" },
      ],
    };
    const v = evaluate(outage, seiko, { knowledge: k });
    expect(v.result).toBe("no_entry");
    expect(v.headlineJa).toContain("御社は侵入されていません");
  });
  it("取引先・提供元の停止は、個人情報の報告・通知の期限を出さない（reportsPersonalData: false）。他の型は従来どおり出す", () => {
    const flags = Object.fromEntries(k.damageTypes.map((d) => [d.id, d.reportsPersonalData]));
    expect(flags.partner_outage).toBe(false);
    for (const [id, f] of Object.entries(flags)) if (id !== "partner_outage") expect(f).toBe(true);
  });
});
