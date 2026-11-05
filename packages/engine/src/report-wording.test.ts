/**
 * 報告義務の安心側（C5）：対象外・メールアカウントの経路・件数が未入力のときに、「報告は要らない」と読める文を出さない。
 * D-006、B-002、B-004、TRIAL-009
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { buildOnePager, onePagerExtraLines, reportCautionLines } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

let k: Knowledge;
let demo: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  demo = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
});

const outOfScope = (techniques: string[] = []): Case => ({
  title: "対象外の事故",
  damageType: "out_of_scope",
  clarity: "unknown",
  suspiciousInstructions: [],
  steps: techniques.map((t) => ({ tactic: "TA0001", techniques: [t], source: "stated" as const })),
});

describe("D-006・B-002：対象外の一枚に、報告の可能性と共通の初動を出す", () => {
  it("どの対象外にも、個人情報の報告が必要になることがある、と警察への相談を出す（判定は出さない）", () => {
    const v = evaluate(outOfScope(), demo, { knowledge: k });
    expect(v.result).toBe("out_of_scope");
    const text = buildOnePager(v, demo, k).whatHappensJa;
    expect(text[0]).toBe("この事故は攻撃経路で判定できないため、被害の見込みは出していません。");
    expect(text.join("")).toMatch(
      /個人情報が外部の人に見られた可能性がある場合は、個人情報保護委員会への報告が必要になることがあります/,
    );
    expect(text.join("")).toMatch(/警察のサイバー犯罪相談窓口/);
    expect(text.join("")).not.toMatch(/報告(も|は)?(必要ありません|不要)/);
  });
  it("アカウントの乗っ取りの段階があれば、取引先への連絡・パスワード変更とセッション削除・転送ルールの確認を足す", () => {
    const v = evaluate(outOfScope(["T1078.004", "T1534"]), demo, { knowledge: k });
    const text = buildOnePager(v, demo, k).whatHappensJa.join("\n");
    expect(text).toMatch(/取引先に、不審なメールが届いていないか/);
    expect(text).toMatch(/パスワードを変更し、サインイン中の端末（セッション）を削除/);
    expect(text).toMatch(/転送ルール/);
    // 手法の無い（DDoS など）対象外には足さない
    const ddos = evaluate(outOfScope(["T1498"]), demo, { knowledge: k });
    expect(buildOnePager(ddos, demo, k).whatHappensJa.join("")).not.toMatch(/転送ルール/);
  });
  it("初動は YAML で足せる（コードの変更なし）", () => {
    const more: Knowledge = {
      ...k,
      firstActions: {
        ...k.firstActions,
        byTechnique: [
          ...k.firstActions.byTechnique,
          {
            id: "ddos",
            labelJa: "DDoS",
            techniques: ["T1498"],
            actionsJa: ["回線事業者に連絡してください。"],
          },
        ],
      },
    };
    const v = evaluate(outOfScope(["T1498"]), demo, { knowledge: more });
    expect(v.guidanceJa).toContain("回線事業者に連絡してください。");
  });
});

describe("B-004：メールアカウントに入られる経路で、「報告は不要」と読める文を出さない", () => {
  const becCase: Case = {
    title: "社長のメールが乗っ取られた",
    damageType: "bec",
    clarity: "clear",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1078.004"], source: "stated" },
      { tactic: "TA0005", techniques: ["T1684.001"], source: "stated" },
    ],
  };
  it("個人情報がカルテに無く reportRequired が false でも、メールの内容の確認を求める", () => {
    const profile: CompanyProfile = { ...demo, personalData: [] };
    const v = evaluate(becCase, profile, { knowledge: k });
    expect(v.impact.reportRequired).toBe(false);
    const lines = reportCautionLines(v);
    expect(lines[0]).toMatch(/メールの中身を見られた可能性があり、個人情報が含まれていれば/);
    expect(lines[0]).toMatch(/メールの内容の確認が必要です/);
    expect(buildOnePager(v, profile, k).whatHappensJa).toEqual(expect.arrayContaining(lines));
    expect(onePagerExtraLines(v)).toEqual(lines);
  });
  it("経路が止まるとき、メールアカウントに入られない経路では出さない", () => {
    const frame = profileFromAnswers(
      {
        industry: "wholesale_service",
        site: "office_only",
        hosting: { mail: "onprem", files: "onprem", core: "onprem", web: "provider" },
        remoteAccess: ["vpn"],
        backup: "same_network",
      },
      k.patterns,
      "試験用商事",
      k.sites,
    );
    const ransom: Case = {
      ...becCase,
      damageType: "ransomware",
      steps: [{ tactic: "TA0040", techniques: ["T1486"], source: "stated" }],
    };
    expect(reportCautionLines(evaluate(ransom, frame, { knowledge: k }))).toEqual([]);
  });
});

describe("TRIAL-009：件数が未入力のときは、1,000 人を超えると言い切らない", () => {
  const ransom: Case = {
    title: "t",
    damageType: "ransomware",
    clarity: "partial",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated", entryKind: "vpn" },
      { tactic: "TA0040", techniques: ["T1486"], source: "stated" },
    ],
  };
  it("5 問のカルテ（個人情報の件数が空）は「超えるおそれ（…超えるとみなしています）」", () => {
    const frame = profileFromAnswers(
      {
        industry: "wholesale_service",
        site: "office_only",
        hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
        remoteAccess: ["vpn"],
        backup: "same_network",
      },
      k.patterns,
      "試験用商事",
      k.sites,
    );
    const v = evaluate(ransom, frame, { knowledge: k });
    const reasons = v.impact.reportReasonsJa ?? [];
    expect(reasons.join("")).toMatch(
      /1,000 人を超えるおそれ（件数が未入力のため、超えるとみなしています）/,
    );
    expect(reasons.join("")).not.toMatch(/1,000 人を超える漏えい等/);
  });
  it("件数が分かっているカルテ（デモ精工：3,000 件）は従来どおり", () => {
    const v = evaluate(ransom, demo, { knowledge: k });
    expect((v.impact.reportReasonsJa ?? []).join("")).toMatch(
      /本人の数が 1,000 人を超える漏えい等/,
    );
  });
});

describe("D-011：記事が書く、漏えいした情報の種類ごとの案内", () => {
  const breach = (leakedData?: string[], victim?: string): Case => ({
    title: "t",
    damageType: "data_breach",
    clarity: "clear",
    suspiciousInstructions: [],
    steps: [
      { tactic: "TA0001", techniques: ["T1190"], source: "stated", entryKind: "web" },
      { tactic: "TA0010", techniques: ["T1567"], source: "stated" },
    ],
    ...(leakedData ? { leakedData } : {}),
    ...(victim ? { victim } : {}),
  });
  const webProfile = (): CompanyProfile => {
    const p = profileFromAnswers(
      {
        industry: "wholesale_service",
        site: "office_only",
        hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "onprem" },
        remoteAccess: ["vpn"],
        backup: "same_network",
      },
      k.patterns,
      "試験用商事",
      k.sites,
    );
    return p;
  };
  it("要配慮・決済情報・本人確認書類があれば、種類ごとの文を出す。無ければ出さない", () => {
    const p = webProfile();
    const none = evaluate(breach(), p, { knowledge: k });
    expect(buildOnePager(none, p, k).whatHappensJa.join("")).not.toMatch(
      /記事で漏えいしたとされる情報/,
    );
    const v = evaluate(breach(["sensitive", "payment", "identity"]), p, { knowledge: k });
    const text = buildOnePager(v, p, k).whatHappensJa.join("\n");
    expect(text).toMatch(
      /「要配慮個人情報（病歴など）」が含まれます。御社が同じ種類の情報を預かっている場合：件数にかかわらず/,
    );
    expect(text).toMatch(
      /「決済情報（クレジットカード番号など）」が含まれます。.*カード会社・決済代行会社と警察へ連絡してください/,
    );
    expect(text).toMatch(
      /「本人確認書類（運転免許証・マイナンバーなど）」が含まれます。.*なりすましに悪用されるおそれ/,
    );
    expect(v.leakedData?.map((l) => l.id)).toEqual(["sensitive", "payment", "identity"]);
    // 根拠（個人情報保護委員会、警察庁）が出典に載る
    const src = buildOnePager(v, p, k).sources.join("\n");
    expect(src).toMatch(/個人情報保護委員会/);
    expect(src).toMatch(/警察庁/);
  });
  it("第三者の事故（C4）のときは「預けている情報に、同じ種類が含まれる場合」と書く", () => {
    const p = webProfile();
    const v = evaluate(breach(["payment"], "vendor"), p, { knowledge: k });
    const text = buildOnePager(v, p, k).whatHappensJa.join("\n");
    expect(text).toMatch(
      /委託先・取引先に預けている情報に、同じ種類が含まれる場合：不正に利用されるおそれ/,
    );
    expect(text).toMatch(/確認が必要です/);
  });
  it("決済情報のとき、カード会社・決済代行会社への連絡を期限（時間軸）に足す（要確認と明記）。他の種類では足さない", () => {
    // 経路が中核まで届く（デモ精工の VPN 装置から）ので、期限が出る
    const vpnBreach = (kinds: string[]): Case => ({
      ...breach(kinds),
      steps: [
        { tactic: "TA0001", techniques: ["T1190"], source: "stated", entryKind: "vpn" },
        { tactic: "TA0010", techniques: ["T1567"], source: "stated" },
      ],
    });
    const pay = evaluate(vpnBreach(["payment"]), demo, { knowledge: k });
    expect(pay.paths.some((x) => x.reachedCore)).toBe(true);
    const ev = pay.timeline.find((e) => e.deadlineId === "card-contact");
    expect(ev?.kind).toBe("money");
    expect(ev?.day).toBe(0);
    expect(ev?.detailJa).toMatch(/要確認/);
    const other = evaluate(vpnBreach(["sensitive"]), demo, { knowledge: k });
    expect(other.timeline.some((e) => e.deadlineId === "card-contact")).toBe(false);
    const dl = k.deadlines.deadlines.find((d) => d.id === "card-contact");
    expect(dl?.status).toBe("unverified");
  });
  it("対象外の事故にも、記事が書く情報の種類の案内を出す", () => {
    const v = evaluate({ ...outOfScope(), leakedData: ["identity"] }, demo, { knowledge: k });
    expect(buildOnePager(v, demo, k).whatHappensJa.join("\n")).toMatch(/本人確認書類/);
  });
  it("拡張性：leak-kinds に 1 件足すだけで、その種類の案内が出る", () => {
    const more: Knowledge = {
      ...k,
      leakKinds: [
        ...k.leakKinds,
        {
          id: "biometric",
          labelJa: "生体情報",
          readingHintJa: "テスト",
          noteJa: "変更できないため、慎重に扱ってください。",
          sourceIds: [],
        },
      ],
    };
    const v = evaluate(breach(["biometric"]), webProfile(), { knowledge: more });
    expect(buildOnePager(v, webProfile(), more).whatHappensJa.join("")).toMatch(
      /「生体情報」が含まれます/,
    );
  });
});
