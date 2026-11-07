/**
 * 型紙 service-account-takeover（連携用アカウント・API キーの乗っ取り。D-009 の残り半分）と、
 * 当てはまりが同数の型紙が並ぶときの入口候補（TRIAL-I-004・I-008）。
 * 記事の要約（本文は入れない）で、型紙の選択・判定・対策・既存の型紙への影響を確かめる
 */
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate, rankTemplates, selectTemplates } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { findRule } from "./rules.ts";
import type { Case, CompanyProfile } from "./types.ts";

const SA = "service-account-takeover";

// 流出した API キーでクラウドのデータを取得された事故（入口の種類は記載）
const keyLeak: Case = {
  title: "流出した API キーでクラウド上の顧客情報が取得された",
  damageType: "data_breach",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    {
      tactic: "TA0001",
      techniques: ["T1552.001", "T1078.004"],
      source: "stated",
      entryKind: "service-account",
    },
    { tactic: "TA0009", techniques: ["T1213"], source: "stated" },
    { tactic: "TA0010", techniques: ["T1537"], source: "inferred" },
  ],
};

// 正規アカウントの悪用（T1078.004）と書かれた会員サイトの事故（入口の種類は認証情報）。これまでどおり顧客向けサービスの型紙
const memberLogin: Case = {
  title: "不正ログインで会員情報が閲覧された",
  damageType: "data_breach",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1078.004"], source: "stated", entryKind: "credential" },
    { tactic: "TA0009", techniques: ["T1213"], source: "stated" },
  ],
};

// 入口が書かれず、手法が持ち出しだけの事故（ir-san-hd の読み方）
const exfilOnly: Case = {
  title: "不正アクセスで個人情報が漏えいした可能性",
  damageType: "data_breach",
  clarity: "unknown",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: [], source: "unknown" },
    { tactic: "TA0010", techniques: ["T1041", "T1048"], source: "inferred" },
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
      remoteAccess: ["vpn", "rdp"],
      backup: "same_network",
    },
    k.patterns,
    "試験用商事",
    k.sites,
  );
});

/** クラウドサービス（cloud.saas）の資産を足したカルテ。対策の状態は指定したものだけ */
const withSaas = (s: { keys?: "present" | "absent" | "unknown"; scope?: "present" | "absent" }) => {
  const profile: CompanyProfile = {
    ...frame,
    assets: [
      ...frame.assets,
      {
        id: "saas-crm",
        kind: "system",
        role: "cloud.saas",
        label: "顧客管理クラウド",
        side: "external",
        controls: [],
        attrs: {},
        attrEvidence: {},
      },
    ],
  };
  return applyMeasures(
    profile,
    (
      [
        ["UD-11", s.keys],
        ["UD-10", s.scope],
      ] as const
    )
      .filter(([, status]) => status !== undefined)
      .map(([mitigation, status]) => ({
        id: `sa-${mitigation}`,
        labelJa: mitigation,
        patches: [{ role: "cloud.saas", mitigation, status: status as "present" }],
      })),
  );
};

describe("service-account-takeover：知識ファイル", () => {
  it("型紙は data_breach で、手法は ATT&CK の手法の水準まで。鍵の窃取と正規アカウントの悪用を分けない", () => {
    const t = k.templates.find((x) => x.id === SA);
    expect(t?.damageType).toBe("data_breach");
    expect(t?.stages.map((s) => s.id)).toEqual(["sa-login", "sa-access", "sa-exfil", "leak"]);
    expect(t?.stages.flatMap((s) => Object.values(s.byRole))).toEqual([
      "T1078.004",
      "T1213",
      "T1537",
      null,
    ]);
    expect(t?.stages.find((s) => s.branch)?.id).toBe("sa-exfil");
    expect(t?.priority).toBe(-1);
    expect(t?.preferEntryKinds).toEqual(["service-account"]);
    // 親の T1078 は顧客向けサービスの型紙と取り合わないよう、受け入れない
    expect(t?.stages.flatMap((s) => s.accepts)).not.toContain("T1078");
  });

  it("入口の種類 service-account は cloud.saas の資産を入口にする", () => {
    const kind = k.entryKinds.find((e) => e.id === "service-account");
    expect(kind?.roles).toEqual(["cloud.saas"]);
    expect(kind?.pinsAsset).toBe(true);
  });

  it("鍵の対策は、共有設定の対策（M1022・M1047）や多要素認証（M1032）と混ぜない", () => {
    expect(findRule(k.rules, "cloud.saas", "T1078.004", "sa-login")?.id).toBe(
      "service_account.login",
    );
    expect(findRule(k.rules, "cloud.saas", "T1213", "sa-access")?.id).toBe(
      "service_account.access",
    );
    expect(findRule(k.rules, "cloud.saas", "T1213")?.id).toBe("data_breach_saas.entry");
    expect(findRule(k.rules, "cloud.saas", "T1213", "sa-access")?.id).toBe(
      "service_account.access",
    );
    const login = k.rules.find((r) => r.id === "service_account.login");
    expect(login?.mitigations).toEqual(["UD-11"]);
    expect(login?.ineffective?.map((i) => i.mitigation)).toEqual(["M1032"]);
  });
});

describe("service-account-takeover：型紙の選択", () => {
  it("入口の種類が連携用アカウント・API キーの事故は、この型紙になる", () => {
    expect(rankTemplates(keyLeak, k)[0]?.template.id).toBe(SA);
  });

  it("会員サイトへの不正ログインや、共有設定の誤りは、これまでの型紙のまま", () => {
    expect(rankTemplates(memberLogin, k)[0]?.template.id).toBe("account-takeover-service");
    const saasMisconfig: Case = {
      title: "クラウドの共有設定の誤りで従業員情報が閲覧できる状態だった",
      damageType: "data_breach",
      clarity: "clear",
      suspiciousInstructions: [],
      steps: [{ tactic: "TA0009", techniques: ["T1213"], source: "stated" }],
    };
    expect(rankTemplates(saasMisconfig, k)[0]?.template.id).toBe("data-breach-saas");
  });
});

describe("service-account-takeover：判定", () => {
  it("カルテにクラウドサービスの資産が無ければ、登録の不足として答え、VPN などを入口にしない", () => {
    const v = evaluate(keyLeak, frame, { knowledge: k });
    expect(v.templateId).toBe(SA);
    expect(v.paths).toEqual([]);
    expect(v.result).not.toBe("blocked");
  });

  it("鍵の管理も権限の絞り込みも無ければ「大丈夫ではない」。経路はクラウドサービスの上だけ", () => {
    const v = evaluate(keyLeak, withSaas({ keys: "absent", scope: "absent" }), { knowledge: k });
    expect(v.templateId).toBe(SA);
    expect(v.result).toBe("breached");
    for (const p of v.paths) {
      expect(p.steps.every((s) => s.role === "cloud.saas")).toBe(true);
    }
  });

  it("鍵の管理と権限の絞り込みがあれば、侵入は防げないが被害は抑えられる。多要素認証では止まらない", () => {
    const v = evaluate(keyLeak, withSaas({ keys: "present", scope: "present" }), { knowledge: k });
    expect(v.result).toBe("mitigated");
    expect(v.result).not.toBe("blocked");
  });

  it("未確認の項目が残れば確認中", () => {
    const v = evaluate(keyLeak, withSaas({ keys: "unknown", scope: "present" }), { knowledge: k });
    expect(v.result).toBe("pending");
  });
});

describe("当てはまりが同数の型紙が並ぶときの入口候補", () => {
  it("手法が持ち出しだけの事故は、入口のある型紙が複数並ぶ", () => {
    expect(selectTemplates(exfilOnly, k).length).toBeGreaterThan(1);
  });

  it("型紙ごとに入口が違えば、VPN・RDP などを仮に置かず、入口は分かっていないと答える", () => {
    const v = evaluate(exfilOnly, frame, { knowledge: k });
    const roles = new Set(selectTemplates(exfilOnly, k).map((m) => m.template.id));
    expect(roles.size).toBeGreaterThan(1);
    expect(v.paths.some((p) => p.steps[0]?.role === "entry.vpn" && roles.size > 1)).toBe(false);
    expect(v.paths.some((p) => p.steps[0]?.role === "entry.rdp" && roles.size > 1)).toBe(false);
    expect(v.result).toBe("pending");
    expect(v.headlineJa).toBe("入口はまだ分かっていません");
  });
});
