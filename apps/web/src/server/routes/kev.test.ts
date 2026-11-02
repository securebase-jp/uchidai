import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { KEV_URL } from "../../shared/kev.ts";
import { app } from "../app.ts";
import { ClientError } from "../errors.ts";
import { ForbiddenKevUrlError, fetchKevCatalog, KevStore, kevRoutes } from "./kev.ts";

// biome-ignore lint/suspicious/noExplicitAny: テストでは応答の形を緩く読む
type Loose = any;
const loose = async (res: Response | Promise<Response>): Promise<Loose> => (await res).json();

const catalog = (catalogVersion = "2026.10.30") => ({
  title: "CISA Catalog of Known Exploited Vulnerabilities",
  catalogVersion,
  dateReleased: "2026-10-30T17:02:45.3665Z",
  count: 2,
  vulnerabilities: [
    {
      cveID: "CVE-2024-55591",
      vendorProject: "Fortinet",
      product: "FortiOS and FortiProxy",
      vulnerabilityName: "Fortinet FortiOS and FortiProxy Authentication Bypass Vulnerability",
      dateAdded: "2025-01-21",
      shortDescription: "…",
      requiredAction: "Apply mitigations per vendor instructions.",
      dueDate: "2025-01-21",
      knownRansomwareCampaignUse: "Known",
      notes: "",
      cwes: ["CWE-288"],
    },
    {
      cveID: "CVE-2024-21762",
      vendorProject: "Fortinet",
      product: "FortiOS",
      vulnerabilityName: "Fortinet FortiOS Out-of-Bound Write Vulnerability",
      dateAdded: "2024-02-16",
      shortDescription: "…",
      requiredAction: "Apply mitigations per vendor instructions.",
      dueDate: "2024-02-16",
      knownRansomwareCampaignUse: "Known",
      notes: "",
    },
  ],
});

/** 偽の fetch：呼ばれた URL と init を記録し、用意した応答を返す */
function fakeFetch(respond: () => Response | Promise<Response>): {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, ...(init ? { init } : {}) });
    return respond();
  };
  return { fetch, calls };
}
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function build(
  opts: { respond?: () => Response | Promise<Response>; now?: () => Date; file?: string } = {},
) {
  const f = fakeFetch(opts.respond ?? (() => jsonResponse(catalog())));
  const api = new Hono();
  api.onError((err, c) => {
    if (err instanceof ClientError) return c.json({ error: err.message }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: "入力の形式が正しくありません" }, 400);
    return c.json({ error: String(err) }, 500);
  });
  const store = new KevStore(opts.file);
  api.route(
    "/api/kev",
    kevRoutes({ store, fetch: f.fetch, ...(opts.now ? { now: opts.now } : {}) }),
  );
  const post = (path: string, body: unknown = {}) =>
    api.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { api, post, calls: f.calls, store };
}

async function demoProfile() {
  const p = await loose(app.request("/api/examples/demo-seiko"));
  return p.profile;
}

describe("GET /api/kev/status", () => {
  it("未取得なら available: false。対応表の確認日と製品数は返す", async () => {
    const { api } = build();
    const body = await loose(api.request("/api/kev/status"));
    expect(body.available).toBe(false);
    expect(body.stale).toBe(true);
    expect(body.sourceUrl).toBe(KEV_URL);
    expect(body.table.products).toBeGreaterThan(10);
    expect(body.table.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("POST /api/kev/refresh", () => {
  it("CISA の URL だけに GET し（リダイレクトは追わない）、.data のファイルに保存する。24 時間以内は取り直さない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uchidai-kev-"));
    const file = join(dir, "kev.json");
    let t = Date.parse("2026-11-03T00:00:00Z");
    const { post, api, calls } = build({ file, now: () => new Date(t) });
    const first = await loose(post("/api/kev/refresh"));
    expect(first).toMatchObject({ ok: true, fetched: true });
    expect(first.status).toMatchObject({
      available: true,
      catalogVersion: "2026.10.30",
      count: 2,
      stale: false,
      fetchedAt: "2026-11-03T00:00:00.000Z",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(KEV_URL);
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).catalog.catalogVersion).toBe("2026.10.30");

    // 1 時間後：キャッシュが新しいので取得しない
    t += 60 * 60 * 1000;
    const second = await loose(post("/api/kev/refresh"));
    expect(second).toMatchObject({ ok: true, fetched: false });
    expect(calls).toHaveLength(1);
    // force なら取り直す
    expect((await loose(post("/api/kev/refresh", { force: true }))).fetched).toBe(true);
    expect(calls).toHaveLength(2);
    // 25 時間後：古いので取り直す
    t += 25 * 60 * 60 * 1000;
    expect((await loose(api.request("/api/kev/status"))).stale).toBe(true);
    expect((await loose(post("/api/kev/refresh"))).fetched).toBe(true);
    expect(calls).toHaveLength(3);

    // 別のプロセスがファイルから読み直せる
    const reopened = new KevStore(file);
    expect(reopened.get()?.catalog.count).toBe(2);
  });
  it("取得に失敗したらキャッシュを使い「取得できなかった」を返す。キャッシュも無ければ突き合わせはできない", async () => {
    let fail = false;
    const { post, api } = build({
      respond: () => {
        if (fail) throw new Error("ECONNRESET");
        return jsonResponse(catalog("2026.10.01"));
      },
      now: () => new Date("2026-11-03T00:00:00Z"),
    });
    // キャッシュ無しで失敗
    fail = true;
    const none = await loose(post("/api/kev/refresh"));
    expect(none.ok).toBe(false);
    expect(none.errorJa).toContain("キャッシュも無い");
    expect(none.status.available).toBe(false);
    expect(none.status.lastErrorJa).toContain("取得できませんでした");
    // 成功してキャッシュができる
    fail = false;
    expect((await loose(post("/api/kev/refresh"))).ok).toBe(true);
    // 再び失敗：キャッシュで続ける
    fail = true;
    const cached = await loose(post("/api/kev/refresh", { force: true }));
    expect(cached.ok).toBe(false);
    expect(cached.errorJa).toContain("キャッシュ（カタログ版 2026.10.01）で続けます");
    expect(cached.status.available).toBe(true);
    expect((await loose(api.request("/api/kev/status"))).catalogVersion).toBe("2026.10.01");
  });
  it("CISA の応答が JSON として壊れている・形が違うときは失敗にする（キャッシュは汚さない）", async () => {
    const { post } = build({
      respond: () => new Response("<html>maintenance</html>", { status: 200 }),
    });
    const r = await loose(post("/api/kev/refresh"));
    expect(r.ok).toBe(false);
    expect(r.status.available).toBe(false);
    const { post: post2 } = build({
      respond: () => jsonResponse({ title: "x", vulnerabilities: "no" }),
    });
    expect((await loose(post2("/api/kev/refresh"))).ok).toBe(false);
    const { post: post3 } = build({ respond: () => jsonResponse({}, 503) });
    const r3 = await loose(post3("/api/kev/refresh"));
    expect(r3.ok).toBe(false);
    expect(r3.errorJa).toContain("503");
  });
  it("fetchKevCatalog は KEV_URL 以外を拒否する", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(catalog()));
    await expect(
      fetchKevCatalog("https://www.cisa.gov/sites/default/files/feeds/other.json", { fetch }),
    ).rejects.toBeInstanceOf(ForbiddenKevUrlError);
    await expect(fetchKevCatalog("https://example.com/kev.json", { fetch })).rejects.toBeInstanceOf(
      ForbiddenKevUrlError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/kev/match", () => {
  it("カタログ未取得なら 404 と「取り込む」の案内", async () => {
    const { post } = build();
    const res = await post("/api/kev/match", { profile: await demoProfile(), assetId: "vpn" });
    expect(res.status).toBe(404);
    expect((await loose(res)).error).toContain("取り込む");
  });
  it("デモ精工の VPN（FortiOS 7.0.14）は CVE-2024-55591 に該当し、反映後のカルテは公開情報の根拠になる", async () => {
    const { post } = build({ now: () => new Date("2026-11-03T01:00:00Z") });
    await post("/api/kev/refresh");
    const body = await loose(
      post("/api/kev/match", { profile: await demoProfile(), assetId: "vpn" }),
    );
    expect(body.match.product.id).toBe("fortinet-fortios");
    expect(body.match.versionStatus).toBe("affected");
    expect(body.match.matched.map((m: { cve: string }) => m.cve)).toEqual([
      "CVE-2024-55591",
      "CVE-2025-24472",
    ]);
    expect(body.match.matched[0].entry.knownRansomwareCampaignUse).toBe("Known");
    const vpn = body.applied.profile.assets.find((a: { id: string }) => a.id === "vpn");
    expect(vpn.attrs).toMatchObject({
      knownExploited: true,
      authBypass: true,
      kevCves: "CVE-2024-55591,CVE-2025-24472",
      kevCatalogVersion: "2026.10.30",
      kevCheckedAt: "2026-11-03T01:00:00.000Z",
    });
    expect(vpn.attrEvidence.knownExploited).toBe("external");
    expect(body.applied.contradictions).toEqual([]);
    expect(body.status.available).toBe(true);
  });
  it("画面で入力中の版（7.0.17）を渡すと「該当しない」になり、カルテの版も 7.0.17 に書き、ベンダー回答との矛盾を返す", async () => {
    const { post } = build();
    await post("/api/kev/refresh");
    const body = await loose(
      post("/api/kev/match", { profile: await demoProfile(), assetId: "vpn", version: "7.0.17" }),
    );
    expect(body.match.versionStatus).toBe("not_affected");
    expect(body.match.version).toBe("7.0.17");
    const vpn = body.applied.profile.assets.find((a: { id: string }) => a.id === "vpn");
    expect(vpn.version).toBe("7.0.17");
    expect(vpn.attrs.knownExploited).toBe(false);
    expect(vpn.attrEvidence.knownExploited).toBe("external");
    expect(body.applied.contradictions).toHaveLength(1);
    expect(body.applied.contradictions[0].registered).toBe("ベンダー回答：該当");
  });
  it("版が空なら未確認で、カルテは変えない（版は消す）", async () => {
    const { post } = build();
    await post("/api/kev/refresh");
    const body = await loose(
      post("/api/kev/match", { profile: await demoProfile(), assetId: "vpn", version: "" }),
    );
    expect(body.match.versionStatus).toBe("unknown");
    const vpn = body.applied.profile.assets.find((a: { id: string }) => a.id === "vpn");
    expect(vpn.version).toBeUndefined();
    expect(vpn.attrs.knownExploited).toBe(true);
    expect(vpn.attrEvidence.knownExploited).toBe("vendor");
    expect(body.applied.changed).toEqual([]);
  });
  it("カルテに無い資産は 404", async () => {
    const { post } = build();
    await post("/api/kev/refresh");
    const res = await post("/api/kev/match", { profile: await demoProfile(), assetId: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("公開 URL 経由（remote-guard）", () => {
  it("転送ヘッダつきの要求は /api/kev/* をすべて拒否する", async () => {
    const h = { "cf-connecting-ip": "203.0.113.5", "content-type": "application/json" };
    expect((await app.request("/api/kev/status", { headers: h })).status).toBe(403);
    expect(
      (await app.request("/api/kev/refresh", { method: "POST", headers: h, body: "{}" })).status,
    ).toBe(403);
    expect(
      (await app.request("/api/kev/match", { method: "POST", headers: h, body: "{}" })).status,
    ).toBe(403);
    // 手元（転送ヘッダなし）からは通る
    expect((await app.request("/api/kev/status")).status).toBe(200);
  });
});
