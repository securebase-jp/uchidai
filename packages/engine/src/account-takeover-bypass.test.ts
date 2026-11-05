/**
 * メールアカウントの乗っ取りで、多要素認証を通り抜ける手口（セッションの窃取と利用、多要素認証の傍受、認証の改変）を
 * ログインの段階として受け入れる（TRIAL-B-009）。この手口では多要素認証があっても止まらない
 */
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { effectiveMeasures } from "./onepager.ts";
import type { Case, CompanyProfile } from "./types.ts";

const caseWith = (login: Case["steps"][number]): Case => ({
  title: "取引先を装うメールから社員のアカウントが乗っ取られ、取引先へ不審なメールが送られた",
  damageType: "account_takeover",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1566.002"], source: "stated" },
    login,
    { tactic: "TA0008", techniques: ["T1534"], source: "stated" },
  ],
});
const sessionTheft = caseWith({ tactic: "TA0006", techniques: ["T1539"], source: "stated" });
const cookieUse = caseWith({ tactic: "TA0008", techniques: ["T1550.004"], source: "stated" });
const mfaInterception = caseWith({ tactic: "TA0006", techniques: ["T1111"], source: "stated" });
const mfaModify = caseWith({ tactic: "TA0003", techniques: ["T1556.006"], source: "stated" });
const password = caseWith({ tactic: "TA0001", techniques: ["T1078.004"], source: "stated" });

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
const withStaff = (s: { mfa?: Status; conditions?: Status }) =>
  applyMeasures(
    frame,
    (
      [
        ["M1032", s.mfa ?? "absent"],
        ["M1036", s.conditions ?? "absent"],
        ["M1017", "absent"],
        ["M1047", "absent"],
        ["UD-03", "absent"],
      ] as const
    ).map(([mitigation, status]) => ({
      id: `staff-${mitigation}-${status}`,
      labelJa: mitigation,
      patches: [{ role: "cloud.mail_account.staff", mitigation, status }],
    })),
  );
const loginStep = (v: ReturnType<typeof evaluate>) =>
  v.paths[0]?.steps.find((s) => s.stageId === "login");

describe("乗っ取りの型紙：多要素認証を通り抜ける手口", () => {
  it("手法は ATT&CK にあり、ラベルがあり、ログインの段階が受け入れる", () => {
    const login = k.templates
      .find((t) => t.id === "account-takeover")
      ?.stages.find((s) => s.id === "login");
    for (const id of ["T1539", "T1550.004", "T1111", "T1556.006"]) {
      expect(login?.accepts, id).toContain(id);
      expect(
        k.attack.techniques.some((t) => t.id === id && !t.revoked && !t.deprecated),
        id,
      ).toBe(true);
      expect(k.labels.techniques[id], id).toBeDefined();
    }
  });

  it.each([
    ["T1539", sessionTheft],
    ["T1550.004", cookieUse],
    ["T1111", mfaInterception],
    ["T1556.006", mfaModify],
  ])("%s の事案はログインの段階に対応づき、専用のルールで判定される", (id, c) => {
    const v = evaluate(c, withStaff({}), { knowledge: k });
    expect(v.templateId).toBe("account-takeover");
    const step = loginStep(v);
    expect(step?.technique).toBe(id);
    expect(step?.source).toBe("stated");
    expect(step?.ruleId).toBe("account_takeover.login_bypass");
    expect(v.result).toBe("breached");
  });

  it("多要素認証が全員に強制されていても止まらない（パスワードの事案は止まる）", () => {
    const profile = withStaff({ mfa: "present" });
    expect(evaluate(password, profile, { knowledge: k }).result).toBe("blocked");
    const v = evaluate(sessionTheft, profile, { knowledge: k });
    expect(v.result).toBe("breached");
    expect(loginStep(v)?.state).toBe("breached");
    expect(loginStep(v)?.ineffective.map((i) => i.mitigation)).toContain("M1032");
  });

  it("接続元・端末の条件づけがあれば被害を抑える。未確認なら確認中", () => {
    const set = evaluate(sessionTheft, withStaff({ conditions: "present" }), { knowledge: k });
    expect(loginStep(set)?.state).toBe("recoverable");
    expect(set.result).toBe("mitigated");
    const unknown = evaluate(sessionTheft, withStaff({ conditions: "unknown" }), { knowledge: k });
    expect(loginStep(unknown)?.state).toBe("unknown");
  });

  it("対策ボタン：この手口では条件づけが並び、多要素認証は並ばない（パスワードの事案はその逆）", () => {
    const ids = (c: Case) => {
      const p = withStaff({});
      return effectiveMeasures(evaluate(c, p, { knowledge: k }), k.measures, p).map(
        (e) => e.measure.id,
      );
    };
    const bypass = ids(sessionTheft);
    expect(bypass).toContain("session-conditions");
    expect(bypass).not.toContain("staff-mfa");
    const pw = ids(password);
    expect(pw).toContain("staff-mfa");
    expect(pw).not.toContain("session-conditions");
    expect(k.costs.measures.find((c) => c.measureId === "session-conditions")?.basis).toBe("quote");
  });
});
