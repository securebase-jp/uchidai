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

describe("GET /api/sources", () => {
  it("分類の順に出典を返し、ATT&CK の項目にだけ版を差し込む", async () => {
    const res = await app.request("/api/sources");
    expect(res.status).toBe(200);
    const body = await loose(res);
    expect(body.categories.map((c: { id: string }) => c.id)).toEqual([
      "attack",
      "cases-costs",
      "law-stats",
      "kev",
      "recon",
      "fonts-voice",
    ]);
    const all = body.categories.flatMap((c: { sources: unknown[] }) => c.sources);
    expect(all.length).toBeGreaterThan(10);
    for (const s of all) expect(s.url).toMatch(/^https:\/\//);
    const knowledge = await loose(app.request("/api/knowledge"));
    const attack = body.categories[0].sources;
    expect(attack.map((s: { version: string }) => s.version)).toEqual([
      knowledge.attackVersion,
      knowledge.attackVersion,
    ]);
    const others = body.categories.slice(1).flatMap((c: { sources: unknown[] }) => c.sources);
    expect(others.some((s: { version?: string }) => s.version !== undefined)).toBe(false);
  });
  it("会社カルテも判定結果も含まない", async () => {
    const text = await (await app.request("/api/sources")).text();
    expect(text).not.toContain("demo-seiko");
    expect(text).not.toContain("verdict");
  });
  it("公開 URL（転送ヘッダつき）からも読める", async () => {
    const res = await app.request("/api/sources", {
      headers: { "cf-connecting-ip": "203.0.113.5" },
    });
    expect(res.status).toBe(200);
  });
});

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
    expect(body.patterns.length).toBe(4);
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
  it("GET /api/examples は架空の会社 3 社を会社名・業種・人数つきで返す", async () => {
    const body = await loose(app.request("/api/examples"));
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([
      "demo-bussan",
      "demo-clinic",
      "demo-seiko",
    ]);
    const seiko = body.items.find((i: { id: string }) => i.id === "demo-seiko");
    expect(seiko).toEqual({
      id: "demo-seiko",
      companyName: "デモ精工株式会社",
      patternLabelJa: "製造業（工場あり）",
      employees: 120,
      fictional: true,
    });
    const clinic = body.items.find((i: { id: string }) => i.id === "demo-clinic");
    expect(clinic.patternLabelJa).toBe("医療・福祉");
    expect(clinic.employees).toBe(40);
    // 一覧にはカルテの中身（資産）を入れない
    expect(seiko.assets).toBeUndefined();
  });
  it("3 社 × 事例 1・2・5 の結論が examples/README.md の表どおり", async () => {
    const expected: Record<string, Record<string, string>> = {
      "demo-seiko": { "ipa-case-1": "breached", "ipa-case-2": "blocked", "ipa-case-5": "breached" },
      "demo-bussan": {
        "ipa-case-1": "no_entry",
        "ipa-case-2": "breached",
        "ipa-case-5": "blocked",
      },
      "demo-clinic": {
        "ipa-case-1": "mitigated",
        "ipa-case-2": "no_entry",
        "ipa-case-5": "pending",
      },
    };
    for (const [id, cases] of Object.entries(expected)) {
      const { profile } = await loose(app.request(`/api/examples/${id}`));
      for (const [caseId, result] of Object.entries(cases)) {
        const { case: theCase } = await loose(app.request(`/api/case/recorded/${caseId}`));
        const ev = await loose(json("/api/evaluate", { case: theCase, profile }));
        expect(`${id} × ${caseId}: ${ev.verdict.result}`).toBe(`${id} × ${caseId}: ${result}`);
      }
    }
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
  it("/api/health は読解が使えるか（キーの有無）だけを返し、値は返さない", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await loose(app.request("/api/health"))).toEqual({ ok: true, readAvailable: false });
      process.env.ANTHROPIC_API_KEY = "test-key-not-used";
      const body = await loose(app.request("/api/health"));
      expect(body.readAvailable).toBe(true);
      expect(JSON.stringify(body)).not.toContain("test-key-not-used");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
      else delete process.env.ANTHROPIC_API_KEY;
    }
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
    // 次の一手：入口で効く VPN 装置の更新が先頭。講じた対策は候補から消える
    expect(base.nextMoves.map((n: { measureId: string }) => n.measureId)[0]).toBe("vpn-update");
    expect(base.nextMoves[0].stageJa).toBe("入口から侵入");
    expect(base.nextMoves.length).toBeLessThanOrEqual(3);
    expect(update.nextMoves.map((n: { measureId: string }) => n.measureId)).not.toContain(
      "vpn-update",
    );

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
  it("形式が違えば 400。どの項目で落ちたかを日本語の文に含める", async () => {
    const res = await json("/api/evaluate", { bad: 1 });
    expect(res.status).toBe(400);
    const body = await loose(res);
    expect(body.error).toContain("形式");
    expect(body.error).toContain("項目：");
    expect(body.error).toContain("case");
    // 入れ子の項目は path を点でつなぐ（画面が「構成要素 2 件目の役割」などと案内できる）
    const { theCase, profile } = await demoFixture();
    const broken = structuredClone(profile);
    broken.assets[1].role = "Not A Role";
    const res2 = await json("/api/evaluate", {
      case: theCase,
      profile: broken,
      measureIds: [],
      answers: [],
    });
    expect(res2.status).toBe(400);
    expect((await loose(res2)).error).toContain("項目：profile.assets.1.role");
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
  it("建設業×工事現場は、施工管理（現場）が業務の層に出る。古い回答の値（工場）も受け付ける", async () => {
    const answers = {
      industry: "construction",
      site: "construction_site",
      hosting: { mail: "cloud", files: "onprem", core: "onprem", web: "provider" },
      remoteAccess: ["vpn"],
      backup: "isolated",
    };
    const body = await loose(json("/api/profile/from-answers", { answers }));
    expect(body.profile.pattern).toBe("construction");
    expect(body.profile.businesses.map((b: { name: string }) => b.name)).toEqual([
      "見積・受注",
      "施工管理（現場）",
      "資材・調達",
      "請求・精算",
    ]);
    expect(body.graph.nodes.some((n: { label: string }) => n.label === "施工管理（現場）")).toBe(
      true,
    );
    const old = await loose(
      json("/api/profile/from-answers", {
        answers: { ...answers, industry: "manufacturing", site: "factory" },
      }),
    );
    expect(old.profile.businesses.map((b: { name: string }) => b.name)).toContain("生産ライン");
  });
});
