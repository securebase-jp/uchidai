/**
 * 被害の種類 account_takeover（メールアカウントの乗っ取り・取引先への踏み台。TRIAL-006）。
 * relay-space（取引先を装うフィッシング → 社員のメールの乗っ取り → 取引先へ再送）の要約で、判定・時間軸・期限まで通ること
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { buildOnePager } from "./onepager.ts";
import { buildTimeline } from "./timeline.ts";
import type { Case, CompanyProfile } from "./types.ts";

// 取引先を装ったメールでパスワードを入力させられ、社員のアカウントが乗っ取られ、取引先へ不審なメールが送られた
// （記事の要約。本文は入れない）
const relayCase: Case = {
  title: "取引先を装うメールから社員のアカウントが乗っ取られ、取引先へ不審なメールが送られた",
  damageType: "account_takeover",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1566.002"], source: "stated" },
    { tactic: "TA0003", techniques: ["T1078.004"], source: "inferred" },
    { tactic: "TA0008", techniques: ["T1534"], source: "stated" },
  ],
};

let k: Knowledge;
let frame: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  frame = profileFromAnswers(
    {
      industry: "wholesale_service",
      site: "office_only",
      hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
      remoteAccess: ["rdp"],
      backup: "same_network",
    },
    k.patterns,
    "試験用商事",
    k.sites,
  );
});

type Status = "present" | "absent" | "unknown";
/** 社員のメールアカウントの対策を、指定した状態にしたカルテ */
const withStaff = (s: { mfa?: Status; training?: Status; audit?: Status; notice?: Status }) =>
  applyMeasures(
    frame,
    (
      [
        ["M1032", s.mfa ?? "absent"],
        ["M1017", s.training ?? "absent"],
        ["M1047", s.audit ?? "absent"],
        ["UD-03", s.notice ?? "absent"],
      ] as const
    ).map(([mitigation, status]) => ({
      id: `staff-${mitigation}-${status}`,
      labelJa: mitigation,
      patches: [{ role: "cloud.mail_account.staff", mitigation, status }],
    })),
  );

describe("account_takeover：知識ファイルが足されている", () => {
  it("被害の種類・型紙・社員のメールの役割がある", () => {
    expect(k.damageTypes.find((d) => d.id === "account_takeover")?.day0.kind).toBe("partner");
    expect(k.damageTypes.find((d) => d.id === "account_takeover")?.reachesMoney).toBeFalsy();
    const t = k.templates.find((x) => x.id === "account-takeover");
    expect(t?.stages.map((s) => s.id)).toEqual(["phish", "login", "forward", "send", "partner"]);
    // 手法は ATT&CK の手法の水準まで
    expect(t?.stages.flatMap((s) => Object.values(s.byRole))).toEqual([
      "T1566.002",
      "T1078.004",
      "T1114.003",
      "T1534",
      null,
    ]);
    expect(k.roles.find((r) => r.id === "cloud.mail_account.staff")).toBeDefined();
  });
  it("5 問から作るカルテに、社員のメールアカウントが自動で作られる（メールが社内のときは作らない）", () => {
    expect(frame.assets.some((a) => a.role === "cloud.mail_account.staff")).toBe(true);
    const onprem = profileFromAnswers(
      {
        ...(frame.answers as NonNullable<typeof frame.answers>),
        hosting: { mail: "onprem", files: "onprem", core: "onprem", web: "provider" },
      },
      k.patterns,
      "x",
      k.sites,
    );
    expect(onprem.assets.some((a) => a.role === "cloud.mail_account.staff")).toBe(false);
  });
});

describe("account_takeover：relay-space の要約が判定まで通る", () => {
  it("対策が未確認の 5 問のカルテは確認中（pending）。止められるとは言わない", () => {
    const v = evaluate(relayCase, frame, { knowledge: k });
    expect(v.templateId).toBe("account-takeover");
    expect(v.result).toBe("pending");
  });
  it("多要素認証も手順もなければ突破され、取引先への影響まで進む", () => {
    const v = evaluate(relayCase, withStaff({}), { knowledge: k });
    expect(v.result).toBe("breached");
    const roles = v.paths[0]?.steps.map((s) => s.role);
    expect(roles).toEqual([
      "cloud.mail_account.staff",
      "cloud.mail_account.staff",
      "cloud.mail_account.staff",
      "impact.partner",
    ]);
    expect(v.paths[0]?.reachedCore).toBe(true);
  });
  it("社員のメールにも多要素認証（staff-mfa）を入れると、ログインで止まる", () => {
    const m = k.measures.find((x) => x.id === "staff-mfa");
    if (!m) throw new Error("staff-mfa");
    const v = evaluate(relayCase, applyMeasures(withStaff({}), [m]), { knowledge: k });
    expect(v.result).toBe("blocked");
    expect(v.paths[0]?.steps.find((s) => s.state === "blocked")?.reasonJa).toMatch(/多要素認証/);
  });
  it("多要素認証の例外が一部にあれば、入れていても突破される", () => {
    const p = withStaff({ mfa: "present" });
    const asset = p.assets.find((a) => a.role === "cloud.mail_account.staff");
    if (!asset) throw new Error("staff");
    asset.attrs.mfaException = true;
    expect(evaluate(relayCase, p, { knowledge: k }).result).toBe("breached");
  });
  it("取引先へ知らせる手順（UD-03）だけなら、被害は抑えられる（mitigated）", () => {
    const m = k.measures.find((x) => x.id === "partner-warning-procedure");
    if (!m) throw new Error("partner-warning-procedure");
    expect(evaluate(relayCase, applyMeasures(withStaff({}), [m]), { knowledge: k }).result).toBe(
      "mitigated",
    );
  });
  it("転送ルールの点検は枝の段階にだけ効く。点検しても、取引先への送信は止まらない", () => {
    const m = k.measures.find((x) => x.id === "mail-forward-audit");
    if (!m) throw new Error("mail-forward-audit");
    const v = evaluate(relayCase, applyMeasures(withStaff({}), [m]), { knowledge: k });
    expect(v.result).toBe("breached");
    // 記事に転送ルールの記載が無いので、枝の段階は経路に入らない
    expect(v.paths[0]?.steps.some((s) => s.stageId === "forward")).toBe(false);
    const withForward: Case = {
      ...relayCase,
      steps: [
        ...relayCase.steps,
        { tactic: "TA0009", techniques: ["T1114.003"], source: "stated" },
      ],
    };
    const v2 = evaluate(withForward, applyMeasures(withStaff({}), [m]), { knowledge: k });
    expect(v2.paths[0]?.steps.find((s) => s.stageId === "forward")?.state).toBe("blocked");
    expect(v2.result).toBe("breached");
  });
  it("デモ精工にはまだ社員のメールアカウントが登録されていないので、入口なし", () => {
    const demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
    expect(evaluate(relayCase, demo, { knowledge: k }).result).toBe("no_entry");
  });
});

describe("account_takeover：時間軸・期限・一枚", () => {
  const v = () => evaluate(relayCase, withStaff({}), { knowledge: k });
  it("最初の出来事は damage-types.yaml の day0、取引先への注意喚起と個人情報の報告が出る", () => {
    const verdict = v();
    const events = buildTimeline(verdict.impact, withStaff({}), verdict, { knowledge: k });
    expect(events[0]?.day).toBe(0);
    expect(events[0]?.labelJa).toBe("乗っ取られたアカウントから取引先へ不審なメールが送られる");
    const ids = events.map((e) => e.deadlineId);
    expect(ids).toContain("partner-warning");
    // 乗っ取られたメールに取引先の連絡先がある → 個人情報の報告（不正アクセス由来）
    expect(verdict.impact.reportRequired).toBe(true);
    expect(ids).toContain("ppc-prompt");
    expect(ids).toContain("ppc-final");
    // 送金の出来事（銀行の組戻し）は出ない
    expect(ids).not.toContain("bank-recall");
    // 送金額の目安も出さない
    expect(verdict.impact.moneyLossJpy).toBeUndefined();
  });
  it("取引先への注意喚起は出典が未確認（要確認）と明記する", () => {
    const d = k.deadlines.deadlines.find((x) => x.id === "partner-warning");
    expect(d?.status).toBe("unverified");
    expect(d?.noteJa).toMatch(/要確認/);
  });
  it("一枚の「何が起きるか」は専門用語・ID なしの文になり、費用は出典のない単価を作らない", () => {
    const op = buildOnePager(v(), withStaff({}), k);
    expect(op.whatHappensJa.join("")).not.toMatch(/T\d{4}|M\d{4}/);
    expect(op.whatHappensJa.length).toBeGreaterThan(0);
    for (const m of op.measures) expect(["quote", "internal", "ipa"]).toContain(m.basis);
    const staffMeasures = op.measures.filter((m) =>
      ["staff-mfa", "mail-forward-audit", "partner-warning-procedure"].includes(m.id),
    );
    expect(staffMeasures.length).toBeGreaterThan(0);
    for (const m of staffMeasures) expect(m.basis).not.toBe("ipa");
  });
});
