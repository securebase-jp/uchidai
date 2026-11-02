import { describe, expect, it } from "vitest";
import { app } from "./app.ts";

const json = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();

async function demoFixture() {
  const c = await loose(app.request("/api/case/recorded/ipa-case-1"));
  const p = await loose(app.request("/api/examples/demo-seiko"));
  return { theCase: c.case, profile: p.profile };
}

describe("GET /api/knowledge", () => {
  it("ラベル・対策・5問・パターン・ATT&CK のバージョンを返す", async () => {
    const res = await app.request("/api/knowledge");
    expect(res.status).toBe(200);
    const body = await loose(res);
    expect(body.attackVersion).toMatch(/^\d+\.\d+$/);
    expect(body.measures.length).toBeGreaterThan(3);
    expect(body.questions.map((q: { id: string }) => q.id)).toEqual([
      "industry",
      "site",
      "hosting",
      "remoteAccess",
      "backup",
    ]);
    const hosting = body.questions.find((q: { id: string }) => q.id === "hosting");
    expect(hosting.rows.map((r: { key: string }) => r.key)).toEqual([
      "mail",
      "files",
      "core",
      "web",
    ]);
    expect(hosting.options[0]).toEqual({ value: "onprem", labelJa: "社内のサーバ" });
    expect(body.patterns.length).toBe(3);
  });
});

describe("記録済みの事例と架空企業", () => {
  it("記録の一覧と中身を Case として返す", async () => {
    const list = await loose(app.request("/api/case/recorded"));
    expect(list.items.map((i: { caseId: string }) => i.caseId)).toContain("ipa-case-1");
    const one = await loose(app.request("/api/case/recorded/ipa-case-1"));
    expect(one.case.damageType).toBe("ransomware");
    expect(one.case.steps.length).toBeGreaterThan(2);
  });
  it("存在しない ID は 404、不正な ID は 400", async () => {
    expect((await app.request("/api/case/recorded/nope")).status).toBe(404);
    expect((await app.request("/api/examples/..%2Fpackage")).status).toBe(400);
  });
  it("demo-seiko は架空の会社としてカルテとグラフを返す", async () => {
    const body = await loose(app.request("/api/examples/demo-seiko"));
    expect(body.profile.fictional).toBe(true);
    expect(body.graph.nodes.some((n: { id: string }) => n.id === "attacker")).toBe(true);
  });
});

describe("POST /api/case/read", () => {
  it("キーが無ければ 503 と日本語の理由", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await json("/api/case/read", { input: { kind: "text", text: "x".repeat(50) } });
      expect(res.status).toBe(503);
      expect((await loose(res)).error).toContain("ANTHROPIC_API_KEY");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("POST /api/evaluate", () => {
  it("デモ用カルテ × 事例1は突破され、対策で結論が変わる", async () => {
    const { theCase, profile } = await demoFixture();
    const base = await loose(json("/api/evaluate", { case: theCase, profile }));
    expect(base.verdict.result).toBe("breached");
    const states = base.verdict.paths[0].steps.map((s: { nodeId: string; state: string }) => [
      s.nodeId,
      s.state,
    ]);
    expect(states).toEqual([
      ["vpn", "breached"],
      ["admin", "unknown"],
      ["server", "breached"],
      ["backup", "breached"],
      ["core", "breached"],
    ]);

    const mfa = await loose(
      json("/api/evaluate", { case: theCase, profile, measureIds: ["vpn-mfa"] }),
    );
    expect(mfa.verdict.result).toBe("breached");
    expect(
      mfa.verdict.paths[0].steps[0].ineffective.map((i: { mitigation: string }) => i.mitigation),
    ).toContain("M1032");

    const update = await loose(
      json("/api/evaluate", { case: theCase, profile, measureIds: ["vpn-update"] }),
    );
    expect(update.verdict.result).toBe("blocked");
    expect(update.measures.map((m: { id: string }) => m.id)).toEqual(["vpn-update"]);

    const backup = await loose(
      json("/api/evaluate", { case: theCase, profile, measureIds: ["backup-isolated"] }),
    );
    expect(backup.verdict.result).toBe("mitigated");
    expect(backup.verdict.impact.downtimeDays).toBe(2);
  });
  it("ベンダー回答で未確認が確定する", async () => {
    const { theCase, profile } = await demoFixture();
    const res = await json("/api/evaluate", {
      case: theCase,
      profile,
      answers: [
        {
          assetId: "admin",
          mitigation: "M1026",
          status: "absent",
          evidence: "vendor",
          answeredBy: "保守ベンダー",
        },
        {
          assetId: "admin",
          mitigation: "M1040",
          status: "absent",
          evidence: "vendor",
          answeredBy: "保守ベンダー",
        },
      ],
    });
    const body = await loose(res);
    expect(body.verdict.paths[0].steps[1].state).toBe("breached");
    expect(body.verdict.paths[0].steps[1].evidence).toBe("vendor");
  });
  it("形式が違えば 400", async () => {
    const res = await json("/api/evaluate", { bad: 1 });
    expect(res.status).toBe(400);
    expect((await loose(res)).error).toContain("形式");
  });
});

describe("POST /api/profile/from-answers", () => {
  it("業種で構成が変わる", async () => {
    const answers = {
      industry: "healthcare",
      site: "clinic",
      hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
      remoteAccess: ["vpn", "vendor_remote"],
      backup: "same_network",
    };
    const body = await loose(json("/api/profile/from-answers", { answers }));
    expect(body.profile.pattern).toBe("healthcare");
    expect(body.graph.nodes.map((n: { id: string }) => n.id)).toContain("vendor-remote");
    expect(body.profile.businesses[0].recoveryDays).toBe(14);
  });
});
