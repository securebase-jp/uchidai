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
