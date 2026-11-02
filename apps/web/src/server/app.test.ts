import { describe, expect, it } from "vitest";
import { app, corsOrigin } from "./app.ts";

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
  it("緩和策ごとの確認の質問表（controlQuestions）を選択肢と属性つきで返す", async () => {
    const body = await loose(app.request("/api/knowledge"));
    const ids = body.controlQuestions.map((q: { mitigation: string }) => q.mitigation);
    expect(ids).toEqual(expect.arrayContaining(["M1051", "M1053", "M1040", "UD-01"]));
    const backup = body.controlQuestions.find(
      (q: { mitigation: string }) => q.mitigation === "M1053",
    );
    expect(backup.textJa.length).toBeGreaterThan(5);
    const tested = backup.choices.find((c: { id: string }) => c.id === "isolated_tested");
    expect(tested).toMatchObject({
      status: "present",
      attrs: { isolated: true, restoreTested: true },
    });
    expect(backup.choices.at(-1)).toMatchObject({ id: "unknown", status: "unknown" });
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
  it("手元・社内・file: の URL はキーがあっても 400 で止める（Claude も取得も呼ばない）", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    try {
      for (const url of [
        "http://localhost:8787/api/requests",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
      ]) {
        const res = await json("/api/case/read", { input: { kind: "url", url } });
        expect(res.status, url).toBe(400);
        expect((await loose(res)).error).toContain("受け付けません");
      }
      const file = await json("/api/case/read", {
        input: { kind: "url", url: "file:///etc/hosts" },
      });
      expect(file.status).toBe(400);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
  it("本文が長すぎれば 400、JSON でなければ 400", async () => {
    const res = await json("/api/case/read", {
      input: { kind: "text", text: "x".repeat(300_001) },
    });
    expect(res.status).toBe(400);
    const bad = await app.request("/api/case/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(bad.status).toBe(400);
    expect((await loose(bad)).error).toContain("JSON");
  });
});

describe("守り", () => {
  it("大きすぎる本文は 413", async () => {
    const res = await app.request("/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(3 * 1024 * 1024) },
      body: JSON.stringify({ pad: "x".repeat(3 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect((await loose(res)).error).toContain("大きすぎ");
  });
  it("公開 URL 経由（転送ヘッダつき）では送信箱と判定は 403", async () => {
    const h = { "cf-connecting-ip": "203.0.113.9" };
    expect((await app.request("/api/requests", { headers: h })).status).toBe(403);
    expect((await app.request("/api/knowledge", { headers: h })).status).toBe(403);
    expect((await app.request("/api/health", { headers: h })).status).toBe(200);
  });
  it("CORS は手元の origin と PUBLIC_BASE_URL だけに許す", async () => {
    const ok = await app.request("/api/health", { headers: { origin: "http://localhost:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const ng = await app.request("/api/health", { headers: { origin: "https://evil.example" } });
    expect(ng.headers.get("access-control-allow-origin")).toBeNull();
    expect(
      corsOrigin("https://demo.trycloudflare.com", {
        PUBLIC_BASE_URL: "https://demo.trycloudflare.com/",
      }),
    ).toBe("https://demo.trycloudflare.com");
    expect(
      corsOrigin("https://evil.example", { PUBLIC_BASE_URL: "https://demo.trycloudflare.com" }),
    ).toBeNull();
  });
  it("対策 ID と回答の数に上限がある", async () => {
    const { theCase, profile } = await demoFixture();
    const res = await json("/api/evaluate", {
      case: theCase,
      profile,
      measureIds: Array.from({ length: 51 }, (_, i) => `m${i}`),
    });
    expect(res.status).toBe(400);
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
