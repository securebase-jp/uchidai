import { join } from "node:path";
import {
  buildGraph,
  type CompanyProfile,
  loadKnowledge,
  loadProfile,
  repoRoot,
} from "@uchidai/engine";
import { describe, expect, it } from "vitest";
import {
  buildReconLog,
  profileBannedTerms,
  reconnoiter,
  renderReconTechniques,
  screenCandidate,
  validateCandidates,
} from "./attacker.ts";
import { abstractProfile, leakedTerms, renderAbstracted } from "./attacker-abstract.ts";
import { checkLine, checkLineAgainst } from "./attacker-safety.ts";

const k = loadKnowledge();
const profile: CompanyProfile = loadProfile(join(repoRoot, "examples", "demo-seiko.json"));
const graph = buildGraph(profile, k.roles);

describe("abstractProfile", () => {
  const abstracted = abstractProfile(profile, graph, k.roles, { labels: k.labels });
  const text = renderAbstracted(abstracted);

  it("役割の枠・つながり・属性の要約・対策の有無だけを含む", () => {
    const vr = abstracted.roles.find((r) => r.role === "entry.vendor_remote");
    expect(vr).toBeDefined();
    expect(vr?.attrsJa).toEqual(
      expect.arrayContaining(["常時接続", "共通パスワード", "中核システム（core）に直結"]),
    );
    expect(vr?.connectsTo).toEqual(expect.arrayContaining(["attacker", "core"]));
    expect(vr?.controls.map((c) => `${c.mitigation}=${c.status}`)).toEqual(
      expect.arrayContaining(["M1032=なし", "UD-02=なし", "M1035=なし"]),
    );
    expect(abstracted.roles[0]?.role).toBe("attacker");
    expect(text).toContain("多要素認証（M1032）＝なし");
    expect(text).toContain("未確認");
  });

  it("製品名・バージョン・社名・ホスト名・資産 ID・CVE を含まない", () => {
    expect(leakedTerms(profile, text)).toEqual([]);
    for (const bad of [
      "Fortinet",
      "FortiOS",
      "7.0.14",
      "CVE",
      "デモ精工",
      "demo-seiko",
      "vendor-remote",
      "cloud-mail",
      "campaign2019",
      "vendor@example.com",
    ])
      expect(text).not.toContain(bad);
  });

  it("カルテ由来の禁止語を集める", () => {
    const terms = profileBannedTerms(profile);
    expect(terms).toEqual(
      expect.arrayContaining(["デモ精工株式会社", "Fortinet FortiOS", "7.0.14", "CVE-2024-55591"]),
    );
  });
});

describe("安全検査", () => {
  it("手法の水準の文章は通る", () => {
    expect(
      checkLine("保守ツールのログインがパスワードだけなので外部リモートサービスで入れる").ok,
    ).toBe(true);
    expect(checkLine("T1133 外部リモートサービス → core").ok).toBe(true);
  });
  it("コマンド・CVE・製品名・URL・IP・コードの記号を含む行は破棄する", () => {
    for (const bad of [
      "mimikatz で認証情報を取る",
      "CVE-2024-55591 を悪用する",
      "FortiGate の管理画面に入る",
      "http://example.com/login にアクセス",
      "192.168.1.10 へ接続",
      "powershell -enc で実行",
      "`net user` を実行",
      "vpn.demo-seiko.example に接続",
    ])
      expect(checkLine(bad).ok, bad).toBe(false);
  });
  it("カルテ由来の語も破棄する", () => {
    expect(checkLineAgainst("デモ精工株式会社の生産管理に入る", ["デモ精工株式会社"]).ok).toBe(
      false,
    );
  });
  it("screenCandidate は禁止語を含む候補を候補ごと破棄し、長すぎる理由はスキーマで破棄する", () => {
    const bad = screenCandidate({
      titleJa: "保守接続から",
      steps: [
        { role: "entry.vendor_remote", technique: "T1133", reasonJa: "CVE-2024-1 を使う" },
        { role: "core", technique: "T1486", reasonJa: "到達" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.discarded.stage).toBe("safety");
    const long = screenCandidate({
      titleJa: "保守接続から",
      steps: [
        { role: "entry.vendor_remote", technique: "T1133", reasonJa: "あ".repeat(121) },
        { role: "core", technique: "T1486", reasonJa: "到達" },
      ],
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.discarded.stage).toBe("schema");
    const good = screenCandidate({
      titleJa: "保守接続から",
      steps: [
        { role: "entry.vendor_remote", technique: "T1133", reasonJa: "常時接続で共通パスワード" },
        { role: "core", technique: "T1486", reasonJa: "直結しているので到達" },
      ],
    });
    expect(good.ok).toBe(true);
  });
});

describe("validateCandidates と buildReconLog", () => {
  const candidates = [
    {
      titleJa: "保守接続から中核へ",
      steps: [
        { role: "entry.vendor_remote", technique: "T1133", reasonJa: "常時接続で共通パスワード" },
        { role: "core", technique: "T1486", reasonJa: "直結しているので到達" },
      ],
    },
    {
      titleJa: "存在しない役割",
      steps: [
        { role: "entry.iot", technique: "T1133", reasonJa: "x" },
        { role: "core", technique: "T1486", reasonJa: "y" },
      ],
    },
    {
      titleJa: "つながっていない",
      steps: [
        { role: "pc", technique: "T1566", reasonJa: "x" },
        { role: "core", technique: "T1486", reasonJa: "y" },
      ],
    },
  ];
  it("仕込んだ経路は通り、役割やつながりの無い経路は破棄される", () => {
    const v = validateCandidates(candidates, graph, profile, k);
    expect(v.paths.length).toBe(1);
    expect(v.paths[0]?.source).toBe("ai");
    expect(v.paths[0]?.reachedCore).toBe(true);
    expect(v.paths[0]?.steps.map((s) => s.state)).toEqual(["breached", "breached"]);
    expect(v.discarded.length).toBe(2);
    expect(v.discarded[0]?.reasons[0]).toContain("構成グラフにない");
    expect(v.discarded[1]?.reasons[0]).toContain("つながりがない");
  });
  it("ログは短い行で、採用と破棄の件数を含む", () => {
    const validated = validateCandidates(candidates, graph, profile, k);
    const log = buildReconLog({
      abstracted: abstractProfile(profile, graph, k.roles),
      attackVersion: k.attack.version,
      candidates,
      validated,
      screened: [],
      recorded: true,
      techniqueLabel: (id) => k.labels.techniques[id],
    });
    expect(log[0]).toContain("実際の出力の記録");
    expect(log.some((l) => l.includes("T1133 外部リモートサービス"))).toBe(true);
    expect(log[log.length - 1]).toContain("採用 1 本");
    expect(log[log.length - 1]).toContain("破棄 2 本");
    for (const l of log) expect(l.length).toBeLessThan(200);
  });
});

describe("reconnoiter（偽のクライアント）", () => {
  it("手法一覧は関連する戦術だけで、応答を安全検査・スキーマ検証して返す", async () => {
    const list = renderReconTechniques(k.attack, k.labels);
    expect(list).toContain("T1133");
    expect(list).toContain("T1199");
    expect(list).not.toContain("TA0043");
    let captured: unknown;
    const fake = {
      messages: {
        create: async (req: unknown) => {
          captured = req;
          return {
            model: "fake-model",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  paths: [
                    {
                      titleJa: "保守接続から",
                      steps: [
                        { role: "entry.vendor_remote", technique: "T1133", reasonJa: "常時接続" },
                        { role: "core", technique: "T1486", reasonJa: "直結" },
                      ],
                    },
                    {
                      titleJa: "危険な候補",
                      steps: [
                        { role: "pc", technique: "T1566", reasonJa: "mimikatz を使う" },
                        { role: "core", technique: "T1486", reasonJa: "到達" },
                      ],
                    },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    };
    const abstracted = abstractProfile(profile, graph, k.roles, { labels: k.labels });
    const r = await reconnoiter(abstracted, {
      // biome-ignore lint/suspicious/noExplicitAny: 偽のクライアント
      client: fake as any,
      attack: k.attack,
      labels: k.labels,
      templates: k.templates,
      extraBannedTerms: profileBannedTerms(profile),
    });
    expect(r.candidates.length).toBe(1);
    expect(r.discarded.length).toBe(1);
    expect(r.discarded[0]?.stage).toBe("safety");
    expect(r.model).toBe("fake-model");
    const req = captured as { messages: { content: string }[]; tools?: unknown };
    expect(req.tools).toBeUndefined();
    expect(req.messages[0]?.content).toContain("<profile>");
    expect(req.messages[0]?.content).not.toContain("Fortinet");
  });
});
