/**
 * 型紙 account-takeover-service（顧客向けサービスへの不正ログイン・認証情報の詰め込み。TRIAL-I-008、D-009）。
 * 東証プライム上場企業の公表の検証で、会員サイト・EC の事故が社内への侵入（VPN→管理者権限→業務サーバ）の連鎖で書かれていた。
 * 記事の要約（本文は入れない）で、型紙の選択・判定・対策・既存の型紙への影響を確かめる
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate, rankTemplates, selectTemplates } from "./evaluate.ts";
import { profileFromAnswers } from "./graph.ts";
import { type Knowledge, loadKnowledge, loadProfile, repoRoot } from "./knowledge.ts";
import { applyMeasures } from "./measures.ts";
import { buildOnePager, effectiveMeasures, measureCost } from "./onepager.ts";
import { findRule } from "./rules.ts";
import type { Case, CompanyProfile } from "./types.ts";

const SERVICE = "account-takeover-service";

// 外部で漏れた ID・パスワードのリストによるポイントサイトへの不正ログイン（日本郵政の公表の読み方：入口は認証情報、記載）
const listAttack: Case = {
  title: "外部で漏れた ID・パスワードのリストによるポイントサイトへの不正ログイン",
  damageType: "data_breach",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1078"], source: "stated", entryKind: "credential" },
    { tactic: "TA0009", techniques: ["T1213"], source: "inferred" },
    { tactic: "TA0010", techniques: [], source: "inferred" },
  ],
};

// 通販サイトへの不正ログイン（ショップチャンネルの読み方：認証情報の詰め込みと、個人情報の閲覧）
const shopLogin = (entryKind?: string): Case => ({
  title: "通販サイトへの不正ログインで会員の個人情報が閲覧された",
  damageType: "data_breach",
  clarity: "partial",
  suspiciousInstructions: [],
  steps: [
    {
      tactic: "TA0001",
      techniques: ["T1078", "T1110.004", "T1110"],
      source: "stated",
      ...(entryKind ? { entryKind } : {}),
    },
    { tactic: "TA0009", techniques: ["T1005"], source: "stated" },
  ],
});

// 会員管理システムへの不正アクセス。侵入の方法は書かれていない（物語コーポレーションの読み方）
const unknownEntryMembers: Case = {
  title: "会員管理システムへの不正アクセスで会員情報が漏えい",
  damageType: "data_breach",
  clarity: "unknown",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: [], source: "unknown" },
    { tactic: "TA0009", techniques: ["T1213", "T1005"], source: "inferred" },
    { tactic: "TA0010", techniques: ["T1041", "T1048"], source: "stated" },
  ],
};

// ポイントの不正利用まで進んだ事故
const withMisuse: Case = {
  title: "不正ログインで会員のポイントが不正に利用された",
  damageType: "data_breach",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1110.004"], source: "stated", entryKind: "credential" },
    { tactic: "TA0009", techniques: ["T1213"], source: "stated" },
    { tactic: "TA0040", techniques: ["T1657"], source: "stated" },
  ],
};

// VPN の認証情報による侵入（入口の種類は VPN）。顧客向けサービスの型紙に取られない
const vpnCredentialIntrusion: Case = {
  title: "VPN の認証情報で社内に入られ、サーバのファイルが持ち出された",
  damageType: "data_breach",
  clarity: "clear",
  suspiciousInstructions: [],
  steps: [
    { tactic: "TA0001", techniques: ["T1078"], source: "stated", entryKind: "vpn" },
    { tactic: "TA0009", techniques: ["T1005"], source: "stated" },
    { tactic: "TA0010", techniques: ["T1048"], source: "stated" },
  ],
};

let k: Knowledge;
let frame: CompanyProfile;
beforeAll(() => {
  k = loadKnowledge();
  // 公開ホームページ（事業者のサービス）と、リモートデスクトップ、社内の基幹があるカルテ
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
/** 公開ホームページ（会員向けログインを含む）の対策を、指定した状態にしたカルテ */
const withLogin = (s: { mfa?: Status; limit?: Status; notice?: Status; adminMfa?: Status }) =>
  applyMeasures(
    frame,
    (
      [
        ["UD-08", s.mfa],
        ["M1036", s.limit],
        ["UD-09", s.notice],
        ["M1032", s.adminMfa],
      ] as const
    )
      .filter(([, status]) => status !== undefined)
      .map(([mitigation, status]) => ({
        id: `login-${mitigation}`,
        labelJa: mitigation,
        patches: [{ role: "entry.web", mitigation, status: status as Status }],
      })),
  );

describe("account-takeover-service：知識ファイル", () => {
  it("型紙は data_breach の顧客向けサービスの型で、手法は ATT&CK の手法の水準まで", () => {
    const t = k.templates.find((x) => x.id === SERVICE);
    expect(t?.damageType).toBe("data_breach");
    expect(t?.stages.map((s) => s.id)).toEqual([
      "svc-login",
      "svc-browse",
      "svc-misuse",
      "svc-exfil",
      "leak",
    ]);
    expect(t?.stages.flatMap((s) => Object.values(s.byRole))).toEqual([
      "T1110.004",
      "T1213",
      "T1657",
      "T1567",
      null,
    ]);
    // 全段階が顧客向けサービス（公開ホームページ）の上で完結する。社内システムの入口は持たない
    expect(new Set(t?.stages.flatMap((s) => Object.keys(s.byRole)))).toEqual(
      new Set(["entry.web"]),
    );
    // 不正利用・持ち出しは、記事に出たときだけ経路に入れる枝
    expect(t?.stages.filter((s) => s.branch).map((s) => s.id)).toEqual(["svc-misuse", "svc-exfil"]);
    expect(t?.stages.find((s) => s.entry)?.tactics).toContain("TA0006");
    expect(t?.priority).toBe(-1);
    expect(t?.preferEntryKinds).toEqual(["credential", "web"]);
  });

  it("対策ボタン 3 つ。単価の出典が無いものは見積もり待ち、社内作業は外部費用なし", () => {
    const ids = ["web-service-mfa", "web-service-login-limit", "web-service-reuse-notice"];
    expect(k.measures.filter((m) => ids.includes(m.id)).map((m) => m.id)).toEqual(ids);
    const basis = (id: string) => k.costs.measures.find((c) => c.measureId === id)?.basis;
    expect(basis("web-service-mfa")).toBe("quote");
    expect(basis("web-service-login-limit")).toBe("quote");
    expect(basis("web-service-reuse-notice")).toBe("internal");
    // 単価を推測で書かない：IPA の明細にあるのはウェブアプリケーション診断だけで、この 3 つには使わない
    for (const id of ids)
      expect(k.costs.measures.find((c) => c.measureId === id)).not.toHaveProperty("unitPriceId");
    for (const id of ids) {
      const m = k.measures.find((x) => x.id === id);
      if (!m) throw new Error(id);
      const cost = measureCost(m, frame, k);
      expect(cost.costJpy).toBeUndefined();
    }
  });

  it("会員向けの対策は管理画面の多要素認証（M1032）と混ぜない", () => {
    // 同じ役割・同じ手法 T1078 でも、段階で判定が分かれる
    expect(findRule(k.rules, "entry.web", "T1078", "entry")?.id).toBe("web.entry.credentials");
    expect(findRule(k.rules, "entry.web", "T1078")?.id).toBe("web.entry.credentials");
    expect(findRule(k.rules, "entry.web", "T1078", "svc-login")?.id).toBe("web_service.login");
    expect(findRule(k.rules, "entry.web", "T1110.004", "svc-login")?.id).toBe("web_service.login");
    // 段階を指定しない呼び出しでは、段階限定のルールは当たらない
    expect(findRule(k.rules, "entry.web", "T1213")?.id).not.toBe("web_service.browse");
    expect(findRule(k.rules, "entry.web", "T1213", "svc-browse")?.id).toBe("web_service.browse");
  });
});

describe("account-takeover-service：型紙の選択", () => {
  it("入口が認証情報（記載）の会員サイトの事故は、この型紙になり、VPN が候補に出ない", () => {
    const [top] = rankTemplates(listAttack, k);
    expect(top?.template.id).toBe(SERVICE);
    const v = evaluate(listAttack, frame, { knowledge: k });
    expect(v.templateId).toBe(SERVICE);
    expect(v.paths.length).toBeGreaterThan(0);
    for (const p of v.paths) {
      expect(p.templateId).toBe(SERVICE);
      expect(p.steps.every((s) => s.role === "entry.web")).toBe(true);
      expect(p.steps.some((s) => ["entry.vpn", "admin", "server", "core"].includes(s.role))).toBe(
        false,
      );
    }
  });

  it("認証情報の詰め込みの記事で入口の種類が記載なら、同数のときもこの型紙を先にする（記載が無ければ従来どおり）", () => {
    expect(rankTemplates(shopLogin("credential"), k)[0]?.template.id).toBe(SERVICE);
    expect(rankTemplates(shopLogin("web"), k)[0]?.template.id).toBe(SERVICE);
    // 入口の種類が分からないときは、当てはまりが同数の型紙の順を変えない（社内への侵入の型紙が先のまま）
    expect(rankTemplates(shopLogin(), k)[0]?.template.id).toBe("data-breach-intrusion");
  });

  it("VPN の認証情報による侵入は、この型紙に取られない", () => {
    expect(rankTemplates(vpnCredentialIntrusion, k)[0]?.template.id).toBe("data-breach-intrusion");
    const v = evaluate(vpnCredentialIntrusion, frame, { knowledge: k });
    expect(v.paths.some((p) => p.templateId === SERVICE)).toBe(false);
  });

  it("侵入の方法が書かれていない会員管理システムの事故は、この型紙になる", () => {
    const sel = selectTemplates(unknownEntryMembers, k);
    expect(sel.map((m) => m.template.id)).toEqual([SERVICE]);
    const v = evaluate(unknownEntryMembers, frame, { knowledge: k });
    expect(v.paths.every((p) => p.steps.every((s) => s.role === "entry.web"))).toBe(true);
  });

  it("ポイントの不正利用まで進んだ事故は、不正利用の段階が経路に入る。出てこない事故では入らない", () => {
    const withIt = evaluate(withMisuse, frame, { knowledge: k });
    expect(withIt.paths[0]?.steps.map((s) => s.stageId)).toEqual([
      "svc-login",
      "svc-browse",
      "svc-misuse",
      "leak",
    ]);
    const without = evaluate(listAttack, frame, { knowledge: k });
    expect(without.paths[0]?.steps.map((s) => s.stageId)).not.toContain("svc-misuse");
  });

  it("既存の型紙（SaaS の共有設定の誤り、ファイル置き場）の選ばれ方を変えない", () => {
    const saas: Case = {
      title: "SaaS の共有設定の誤りで閲覧された",
      damageType: "data_breach",
      clarity: "clear",
      suspiciousInstructions: [],
      steps: [{ tactic: "TA0009", techniques: ["T1213.002"], source: "stated" }],
    };
    expect(rankTemplates(saas, k)[0]?.template.id).toBe("data-breach-saas");
    const storage: Case = {
      title: "ストレージの公開設定の誤り",
      damageType: "data_breach",
      clarity: "clear",
      suspiciousInstructions: [],
      steps: [{ tactic: "TA0009", techniques: ["T1530"], source: "stated" }],
    };
    expect(rankTemplates(storage, k)[0]?.template.id).toBe("data_breach");
    // 他の被害の種類の型紙は、この型紙の影響を受けない
    const account: Case = {
      title: "メールアカウントの乗っ取り",
      damageType: "account_takeover",
      clarity: "clear",
      suspiciousInstructions: [],
      steps: [{ tactic: "TA0001", techniques: ["T1566.002"], source: "stated" }],
    };
    expect(rankTemplates(account, k).map((m) => m.template.id)).toEqual(["account-takeover"]);
  });
});

describe("account-takeover-service：判定", () => {
  const first = (p: CompanyProfile) => evaluate(listAttack, p, { knowledge: k }).paths[0]?.steps[0];

  it("会員向けのログインの対策が何も登録されていなければ、止まるとは言わない（未確認）", () => {
    const s = first(frame);
    expect(s?.ruleId).toBe("web_service.login");
    expect(s?.state).toBe("unknown");
    expect(evaluate(listAttack, frame, { knowledge: k }).result).not.toBe("safe");
  });

  it("追加認証があれば止まり、試行の制限は復旧できる、使い回しの注意喚起は人次第", () => {
    expect(first(withLogin({ mfa: "present" }))?.state).toBe("blocked");
    expect(first(withLogin({ mfa: "absent", limit: "present" }))?.state).toBe("recoverable");
    expect(first(withLogin({ mfa: "absent", limit: "absent", notice: "present" }))?.state).toBe(
      "human",
    );
  });

  it("どの対策も無い（absent）と、パスワードだけで入られる", () => {
    const s = first(withLogin({ mfa: "absent", limit: "absent", notice: "absent" }));
    expect(s?.state).toBe("breached");
    expect(s?.reasonJa).toContain("ID・パスワードだけ");
  });

  it("ホームページの管理画面の多要素認証（M1032）では、会員向けのログインは止まらない", () => {
    const s = first(withLogin({ adminMfa: "present", mfa: "absent", limit: "absent" }));
    expect(s?.state).toBe("breached");
    expect(s?.ineffective.map((i) => i.mitigation)).toContain("M1032");
  });

  it("ログインされた後の閲覧・不正利用は、会社側で止められない", () => {
    const v = evaluate(withMisuse, withLogin({ mfa: "absent", limit: "absent" }), {
      knowledge: k,
    });
    const steps = v.paths[0]?.steps ?? [];
    expect(steps.find((s) => s.stageId === "svc-browse")?.state).toBe("breached");
    expect(steps.find((s) => s.stageId === "svc-misuse")?.state).toBe("breached");
  });

  it("追加認証を入れる対策ボタンで、段階が止まる", () => {
    const m = k.measures.find((x) => x.id === "web-service-mfa");
    if (!m) throw new Error("web-service-mfa");
    const after = applyMeasures(frame, [m]);
    expect(first(after)?.state).toBe("blocked");
  });
});

describe("account-takeover-service：一枚と対策ボタン", () => {
  it("一枚は顧客向けサービスの連鎖で書かれ、VPN や管理者権限の連鎖は出ない", () => {
    const v = evaluate(listAttack, frame, { knowledge: k });
    const sheet = buildOnePager(v, frame, k, { caseTitle: listAttack.title });
    const text = sheet.whatHappensJa.join("\n");
    expect(text).toContain("会員");
    expect(text).not.toMatch(/VPN|管理者アカウント|業務サーバ区画/);
  });

  it("効く対策は会員向けの 3 つだけ（ホームページの管理画面の対策は出ない）", () => {
    const v = evaluate(listAttack, frame, { knowledge: k });
    expect(effectiveMeasures(v, k.measures, frame).map((e) => e.measure.id)).toEqual([
      "web-service-mfa",
      "web-service-login-limit",
      "web-service-reuse-notice",
    ]);
  });
});

describe("account-takeover-service：デモ企業", () => {
  it("廃止済みのキャンペーンサイトしか無いデモ精工は入口なし。社内への侵入の連鎖で書かない", () => {
    const seiko = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
    const v = evaluate(listAttack, seiko, { knowledge: k });
    expect(v.result).toBe("no_entry");
    expect(v.paths).toEqual([]);
  });

  it("公開ホームページのあるデモ企業では、会員向けのログインとして判定する", () => {
    const bussan = loadProfile(join(repoRoot, "examples", "demo-bussan.json"));
    const v = evaluate(listAttack, bussan, { knowledge: k });
    expect(v.paths[0]?.steps[0]?.role).toBe("entry.web");
    // 管理画面の多要素認証（M1032 present）は、会員向けのログインを止めない
    expect(v.paths[0]?.steps[0]?.state).not.toBe("blocked");
  });
});
