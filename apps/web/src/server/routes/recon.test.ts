import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CtLogSource, type DnsResolver, type MxRecord, VERIFY_PREFIX } from "@uchidai/recon";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FIXTURE_DOMAIN } from "../../shared/recon.ts";
import { app } from "../app.ts";
import { ClientError } from "../errors.ts";
import { ReconStore, reconRoutes } from "./recon.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();

/** 偽の DNS。呼ばれた名前を記録する（所有確認なしで呼ばれないことを確かめる） */
class FakeDns implements DnsResolver {
  readonly calls: string[] = [];
  txt: Record<string, string[]> = {};
  async resolveTxt(name: string): Promise<string[]> {
    this.calls.push(`TXT ${name}`);
    return this.txt[name] ?? [];
  }
  async resolveMx(name: string): Promise<MxRecord[]> {
    this.calls.push(`MX ${name}`);
    return [];
  }
  async resolve4(name: string): Promise<string[]> {
    this.calls.push(`A ${name}`);
    return [];
  }
  async resolve6(name: string): Promise<string[]> {
    this.calls.push(`AAAA ${name}`);
    return [];
  }
  async resolveCname(name: string): Promise<string[]> {
    this.calls.push(`CNAME ${name}`);
    return [];
  }
}
class FakeCt implements CtLogSource {
  readonly calls: string[] = [];
  fail = false;
  async listCertificates(domain: string) {
    this.calls.push(domain);
    if (this.fail) throw new Error("crt.sh がタイムアウト");
    return [];
  }
}

function build(opts: { now?: () => Date; store?: ReconStore } = {}) {
  const dns = new FakeDns();
  const ct = new FakeCt();
  const api = new Hono();
  api.onError((err, c) => {
    if (err instanceof ClientError) return c.json({ error: err.message }, err.status);
    if (err instanceof z.ZodError)
      return c.json({ error: "入力の形式が正しくありません（ドメイン）" }, 400);
    return c.json({ error: String(err) }, 500);
  });
  api.route(
    "/api/recon",
    reconRoutes({
      store: opts.store ?? new ReconStore(),
      live: () => ({ resolver: dns, ct }),
      ...opts,
    }),
  );
  const post = (path: string, body: unknown) =>
    api.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { api, dns, ct, post };
}

describe("POST /api/recon/token", () => {
  it("トークンを発行し、TXT レコードの名前と値、手順を返す。同じドメインには同じトークンを返す", async () => {
    const { post } = build();
    const first = await loose(post("/api/recon/token", { domain: "Example.JP." }));
    expect(first.domain).toBe("example.jp");
    expect(first.fixture).toBe(false);
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(first.record).toEqual({
      name: "example.jp",
      type: "TXT",
      value: `${VERIFY_PREFIX}${first.token}`,
    });
    expect(first.instructionsJa.join("\n")).toContain("サーバには接続しません");
    const again = await loose(post("/api/recon/token", { domain: "example.jp" }));
    expect(again.token).toBe(first.token);
    const renewed = await loose(post("/api/recon/token", { domain: "example.jp", renew: true }));
    expect(renewed.token).not.toBe(first.token);
  });
  it("不正なドメインは 400 と日本語の理由", async () => {
    const { post } = build();
    for (const domain of ["203.0.113.10", "foo.localhost", "a", "日本語.jp", "x".repeat(300)]) {
      const res = await post("/api/recon/token", { domain });
      expect(res.status, domain).toBe(400);
      expect((await loose(res)).error).toMatch(/ドメイン/);
    }
  });
});

describe("POST /api/recon/verify", () => {
  it("トークン未発行なら 400。TXT が無ければ ok: false と理由。TXT があれば ok と有効期限", async () => {
    const { post, dns } = build({ now: () => new Date("2026-11-03T00:00:00Z") });
    expect((await post("/api/recon/verify", { domain: "example.jp" })).status).toBe(400);
    const { token } = await loose(post("/api/recon/token", { domain: "example.jp" }));
    const missing = await loose(post("/api/recon/verify", { domain: "example.jp" }));
    expect(missing.ok).toBe(false);
    expect(missing.reasonJa).toContain("見つからない");
    dns.txt["example.jp"] = [`${VERIFY_PREFIX}${token}`, "v=spf1 -all"];
    const ok = await loose(post("/api/recon/verify", { domain: "example.jp" }));
    expect(ok).toEqual({
      ok: true,
      domain: "example.jp",
      fixture: false,
      verifiedAt: "2026-11-03T00:00:00.000Z",
      expiresAt: "2026-11-04T00:00:00.000Z",
    });
    const status = await loose(build().api.request("/api/recon/status?domain=example.jp"));
    expect(status.verified).toBeNull();
  });
});

describe("POST /api/recon/run（安全の固定）", () => {
  it("所有確認なしの実行は 403 で、DNS にも CT にも一切問い合わせない", async () => {
    const { post, dns, ct } = build();
    await post("/api/recon/token", { domain: "example.jp" });
    const res = await post("/api/recon/run", { domain: "example.jp" });
    expect(res.status).toBe(403);
    expect((await loose(res)).error).toContain("所有確認");
    expect(dns.calls).toEqual([]);
    expect(ct.calls).toEqual([]);
    // 未発行のドメインも同じ
    expect((await post("/api/recon/run", { domain: "other.example.jp" })).status).toBe(403);
    expect(dns.calls).toEqual([]);
  });
  it("所有確認が 24 時間を超えていたら 403（再確認を求める）", async () => {
    let clock = new Date("2026-11-03T00:00:00Z");
    const { post, dns, ct } = build({ now: () => clock });
    const { token } = await loose(post("/api/recon/token", { domain: "example.jp" }));
    dns.txt["example.jp"] = [`${VERIFY_PREFIX}${token}`];
    expect((await loose(post("/api/recon/verify", { domain: "example.jp" }))).ok).toBe(true);
    clock = new Date("2026-11-04T00:00:01Z");
    dns.calls.length = 0;
    const res = await post("/api/recon/run", { domain: "example.jp" });
    expect(res.status).toBe(403);
    expect(dns.calls).toEqual([]);
    expect(ct.calls).toEqual([]);
  });
  it("所有確認を通したドメインだけ実行し、結果と初期値・資産のヒントを返す。CT の失敗は注記つきで部分的に返す", async () => {
    const { post, dns, ct } = build({ now: () => new Date("2026-11-03T00:00:00Z") });
    const { token } = await loose(post("/api/recon/token", { domain: "example.jp" }));
    dns.txt["example.jp"] = [`${VERIFY_PREFIX}${token}`, "v=spf1 include:_spf.google.com ~all"];
    await post("/api/recon/verify", { domain: "example.jp" });
    ct.fail = true;
    const res = await post("/api/recon/run", { domain: "example.jp" });
    expect(res.status).toBe(200);
    const body = await loose(res);
    expect(body.fixture).toBe(false);
    expect(body.result.domain).toBe("example.jp");
    expect(body.result.sources.ct).toBe("unavailable");
    expect(body.ctUnavailableJa).toContain("CT ログは今回取得できませんでした");
    expect(body.result.mail.spf.present).toBe(true);
    expect(body.answersHints.inferred).not.toContain("hosting.mail");
    expect(body.assetHints.map((h: { role: string }) => h.role)).toContain("cloud.mail");
    expect(body.applied).toBeUndefined();
    expect(ct.calls).toEqual(["example.jp"]);
    // 問い合わせ先は所有確認したドメインとその配下だけ
    for (const call of dns.calls) expect(call).toMatch(/[ .]example\.jp$/);
    const status = await loose((await build()).api.request("/api/recon/status?domain=example.jp"));
    expect(status.domain).toBe("example.jp");
  });
});

describe("fixture モード（架空のドメイン）", () => {
  it("demo-seiko.example は記録を再生し fixture: true。実際の参照先には触れない", async () => {
    const { post, dns, ct } = build();
    const token = await loose(post("/api/recon/token", { domain: FIXTURE_DOMAIN }));
    expect(token.fixture).toBe(true);
    expect(token.instructionsJa.join("")).toContain("架空のドメイン");
    const verify = await loose(post("/api/recon/verify", { domain: FIXTURE_DOMAIN }));
    expect(verify.ok).toBe(true);
    expect(verify.fixture).toBe(true);
    const run = await loose(post("/api/recon/run", { domain: FIXTURE_DOMAIN }));
    expect(run.fixture).toBe(true);
    expect(run.result.sources).toEqual({ dns: "fixture", ct: "fixture" });
    expect(
      run.result.remoteAccessCandidates.map((c: { hostname: string }) => c.hostname),
    ).toContain("vpn.demo-seiko.example");
    expect(run.answersHints.answers.remoteAccess).toEqual(["vpn"]);
    expect(run.answersHints.answers.hosting).toEqual({ mail: "cloud", web: "provider" });
    expect(dns.calls).toEqual([]);
    expect(ct.calls).toEqual([]);
  });
  it("カルテを渡すと、矛盾（旧キャンペーンサイト）と反映後のカルテ（根拠 external、domainVerified）を返す", async () => {
    const { post } = build();
    await post("/api/recon/token", { domain: FIXTURE_DOMAIN });
    await post("/api/recon/verify", { domain: FIXTURE_DOMAIN });
    const { profile } = await loose(app.request("/api/examples/demo-seiko"));
    const run = await loose(post("/api/recon/run", { domain: FIXTURE_DOMAIN, profile }));
    const { applied } = run;
    expect(applied.contradictions.map((c: { assetId: string }) => c.assetId)).toContain(
      "campaign-site",
    );
    expect(applied.contradictions[0].messageJa).toContain("可能性");
    expect(applied.profile.domain).toBe(FIXTURE_DOMAIN);
    expect(applied.profile.domainVerified).toBe(true);
    const mail = applied.profile.assets.find((a: { role: string }) => a.role === "cloud.mail");
    expect(mail.attrs.spf).toBe(true);
    expect(mail.attrs.dmarc).toBe(false);
    expect(mail.attrEvidence.dmarc).toBe("external");
    expect(applied.answers.merged.remoteAccess).toContain("vpn");
    // 反映後のカルテは engine の判定に通る（矛盾の材料は attrs と attrEvidence で伝わる）
    const { case: theCase } = await loose(app.request("/api/case/recorded/ipa-case-1"));
    const ev = await app.request("/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ case: theCase, profile: applied.profile }),
    });
    expect(ev.status).toBe(200);
    // 後から渡したカルテにも、直前の結果で反映できる
    const again = await loose(post("/api/recon/apply", { domain: FIXTURE_DOMAIN, profile }));
    expect(again.contradictions.length).toBe(applied.contradictions.length);
    expect((await post("/api/recon/apply", { domain: "example.jp", profile })).status).toBe(404);
  });
});

describe("公開 URL 経由（remote-guard）", () => {
  it("転送ヘッダが付いた要求は /api/recon/* をすべて拒否する", async () => {
    const h = { "cf-connecting-ip": "203.0.113.5", "content-type": "application/json" };
    const body = JSON.stringify({ domain: FIXTURE_DOMAIN });
    for (const path of ["/api/recon/token", "/api/recon/verify", "/api/recon/run"]) {
      const res = await app.request(path, { method: "POST", headers: h, body });
      expect(res.status, path).toBe(403);
    }
    const status = await app.request(`/api/recon/status?domain=${FIXTURE_DOMAIN}`, {
      headers: h,
    });
    expect(status.status).toBe(403);
  });
});

describe("サーバに会社カルテを残さない", () => {
  it("/run に渡したカルテは応答にだけ使い、サーバが記憶するのは外部確認の結果だけ", async () => {
    const store = new ReconStore();
    const { post } = build({ store });
    await post("/api/recon/token", { domain: FIXTURE_DOMAIN });
    await post("/api/recon/verify", { domain: FIXTURE_DOMAIN });
    const { profile } = await loose(app.request("/api/examples/demo-seiko"));
    const run = await loose(post("/api/recon/run", { domain: FIXTURE_DOMAIN, profile }));
    expect(run.applied.profile.companyName).toBe(profile.companyName);
    const last = store.getLastRun(FIXTURE_DOMAIN);
    expect(last).toBeDefined();
    expect(last && "applied" in last).toBe(false);
    const remembered = JSON.stringify(last);
    expect(remembered).not.toContain(profile.companyName);
    for (const key of ['"assets"', '"businesses"', '"personalData"', '"companyName"'])
      expect(remembered).not.toContain(key);
    for (const a of profile.assets) expect(remembered).not.toContain(a.label);
  });
});

describe("ReconStore のファイル保存", () => {
  it("別のプロセスが同じファイルに書いたドメインを消さず、壊れたファイルは空として読む", () => {
    const dir = mkdtempSync(join(tmpdir(), "uchidai-recon-"));
    const file = join(dir, "recon-tokens.json");
    const a = new ReconStore(file);
    const b = new ReconStore(file);
    a.setToken({
      domain: "a.example.jp",
      token: "a".repeat(32),
      createdAt: "2026-11-03T00:00:00Z",
    });
    b.setToken({
      domain: "b.example.jp",
      token: "b".repeat(32),
      createdAt: "2026-11-03T00:00:00Z",
    });
    a.setToken({
      domain: "a.example.jp",
      token: "c".repeat(32),
      createdAt: "2026-11-03T01:00:00Z",
    });
    const reloaded = new ReconStore(file);
    expect(reloaded.getToken("a.example.jp")?.token).toBe("c".repeat(32));
    expect(reloaded.getToken("b.example.jp")?.token).toBe("b".repeat(32));
    expect(JSON.parse(readFileSync(file, "utf8")).tokens).toHaveLength(2);
    const broken = join(dir, "broken.json");
    const w = new ReconStore(broken);
    w.setToken({
      domain: "x.example.jp",
      token: "d".repeat(32),
      createdAt: "2026-11-03T00:00:00Z",
    });
    expect(new ReconStore(broken).getToken("x.example.jp")).toBeDefined();
  });
});
