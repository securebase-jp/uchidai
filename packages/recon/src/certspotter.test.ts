import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "./cache.ts";
import { CERTSPOTTER_PAGE_SIZE, CertSpotterSource, normalizeIssuance } from "./certspotter.ts";
import { CtUnavailableError } from "./crtsh.ts";

const rows = [
  {
    id: "100",
    tbs_sha256: "aa",
    cert_sha256: "bb",
    dns_names: ["example.jp", "WWW.example.jp", "www.example.jp"],
    issuer: { friendly_name: "Let's Encrypt", name: "C=US, O=Let's Encrypt, CN=R11" },
    not_before: "2026-01-01T00:00:00Z",
    not_after: "2026-03-31T23:59:59Z",
    revoked: false,
  },
  {
    id: "101",
    dns_names: ["unrelated.example.com"],
    issuer: { friendly_name: "Other CA" },
    not_before: "2026-01-01T00:00:00Z",
    not_after: "2026-03-31T23:59:59Z",
    revoked: false,
  },
  {
    id: "102",
    dns_names: ["old.example.jp"],
    issuer: { friendly_name: "Let's Encrypt" },
    not_before: "2026-01-01T00:00:00Z",
    not_after: "2026-03-31T23:59:59Z",
    revoked: true,
  },
  {
    id: "103",
    dns_names: ["*.example.jp", "vpn.example.jp"],
    issuer: { name: "C=US, O=Let's Encrypt, CN=R12" },
    not_before: "2026-02-01T00:00:00Z",
    not_after: "2026-05-01T00:00:00Z",
    revoked: null,
  },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Cert Spotter の記録の正規化", () => {
  it("名前を小文字にして重複を除き、対象ドメイン外の名前は捨てる", () => {
    const cert = normalizeIssuance(rows[0] as never, "example.jp");
    expect(cert).toEqual({
      id: "100",
      issuer: "Let's Encrypt",
      names: ["example.jp", "www.example.jp"],
      notBefore: "2026-01-01T00:00:00Z",
      notAfter: "2026-03-31T23:59:59Z",
    });
    expect(normalizeIssuance(rows[1] as never, "example.jp")).toBeUndefined();
  });
  it("失効済みは除く。失効の状態が不明（null）なものは残す", () => {
    expect(normalizeIssuance(rows[2] as never, "example.jp")).toBeUndefined();
    const cert = normalizeIssuance(rows[3] as never, "example.jp");
    expect(cert?.names).toEqual(["*.example.jp", "vpn.example.jp"]);
    expect(cert?.issuer).toBe("C=US, O=Let's Encrypt, CN=R12");
  });
  it("日時はタイムゾーンなしでも ISO 8601 の UTC に揃える", () => {
    const cert = normalizeIssuance(
      {
        dns_names: ["example.jp"],
        not_before: "2026-01-01 00:00:00",
        not_after: "2026-02-01T00:00:00Z",
      },
      "example.jp",
    );
    expect(cert?.notBefore).toBe("2026-01-01T00:00:00Z");
  });
});

describe("CertSpotterSource", () => {
  it("restrictedFetch 経由で取得し、結果をキャッシュして 2 回目は fetch しない", async () => {
    const fake = vi.fn(async () => json(rows));
    const cache = new MemoryCache();
    const source = new CertSpotterSource({ fetch: fake, cache });
    const first = await source.listCertificates("example.jp");
    expect(first.map((c) => c.id)).toEqual(["100", "103"]);
    expect(source.lastRun("example.jp")).toEqual({ provider: "certspotter", notesJa: [] });
    const second = await source.listCertificates("Example.JP");
    expect(second).toEqual(first);
    expect(fake).toHaveBeenCalledTimes(1);
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe(
      "https://api.certspotter.com/v1/issuances?domain=example.jp&include_subdomains=true&expand=dns_names&expand=issuer",
    );
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(await cache.get("certspotter:example.jp")).toBeDefined();
  });
  it("HTTP エラー、壊れた JSON、形が違う応答は CtUnavailableError", async () => {
    for (const response of [
      () => new Response("busy", { status: 503 }),
      () => new Response("<html>", { status: 200 }),
      () => new Response("", { status: 200 }),
      () => json({ code: "bad_query", message: "x" }),
      () => json([{ id: "1", not_before: "2026-01-01T00:00:00Z" }]),
    ]) {
      const source = new CertSpotterSource({
        fetch: async () => response(),
        cache: new MemoryCache(),
      });
      await expect(source.listCertificates("example.jp")).rejects.toBeInstanceOf(
        CtUnavailableError,
      );
    }
  });
  it("接続できない・時間切れも CtUnavailableError", async () => {
    const source = new CertSpotterSource({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      cache: new MemoryCache(),
    });
    await expect(source.listCertificates("example.jp")).rejects.toBeInstanceOf(CtUnavailableError);
  });
  it("429 は CtUnavailableError。理由に「しばらくして再実行」を含める", async () => {
    const fake = vi.fn(async () => json({ code: "rate_limited", message: "slow down" }, 429));
    const source = new CertSpotterSource({ fetch: fake, cache: new MemoryCache() });
    const error = await source.listCertificates("example.jp").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CtUnavailableError);
    expect((error as Error).message).toContain("しばらくして再実行");
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("空の配列は 0 件。キャッシュせず、次回はもう一度取得する", async () => {
    const fake = vi.fn(async () => json([]));
    const cache = new MemoryCache();
    const source = new CertSpotterSource({ fetch: fake, cache });
    expect(await source.listCertificates("example.jp")).toEqual([]);
    expect(await cache.get("certspotter:example.jp")).toBeUndefined();
    expect(await source.listCertificates("example.jp")).toEqual([]);
    expect(fake).toHaveBeenCalledTimes(2);
  });
  it("1 ページ分（100 件）が返ったら「一部のみ」と注記し、続きは取得しない。キャッシュしても注記は残る", async () => {
    const page = Array.from({ length: CERTSPOTTER_PAGE_SIZE }, (_, i) => ({
      id: String(i + 1),
      dns_names: [`h${i}.example.jp`],
      issuer: { friendly_name: "Let's Encrypt" },
      not_before: "2026-01-01T00:00:00Z",
      not_after: "2026-03-31T23:59:59Z",
      revoked: false,
    }));
    const fake = vi.fn(async () => {
      const res = json(page);
      res.headers.set("link", '<https://api.certspotter.com/v1/issuances?after=100>; rel="next"');
      return res;
    });
    const cache = new MemoryCache();
    const source = new CertSpotterSource({ fetch: fake, cache });
    expect(await source.listCertificates("example.jp")).toHaveLength(CERTSPOTTER_PAGE_SIZE);
    expect(source.lastRun("example.jp")?.notesJa.join("")).toContain("一部のみ");
    const again = new CertSpotterSource({ fetch: fake, cache });
    await again.listCertificates("example.jp");
    expect(again.lastRun("example.jp")?.notesJa.join("")).toContain("一部のみ");
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
