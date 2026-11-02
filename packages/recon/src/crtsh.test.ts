import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "./cache.ts";
import { CrtShSource, CtUnavailableError, normalizeRow, toIsoUtc } from "./crtsh.ts";

const rows = [
  {
    id: 1,
    issuer_name: "C=US, O=Let's Encrypt, CN=R11",
    common_name: "www.example.jp",
    name_value: "example.jp\nwww.example.jp\nWWW.EXAMPLE.JP",
    not_before: "2026-01-01T00:00:00",
    not_after: "2026-03-31T23:59:59",
  },
  {
    id: 2,
    issuer_name: "C=US, O=Other CA",
    common_name: "unrelated.example.com",
    name_value: "unrelated.example.com",
    not_before: "2026-01-01T00:00:00",
    not_after: "2026-03-31T23:59:59",
  },
];

describe("crt.sh の行の正規化", () => {
  it("タイムゾーンなしの日時は UTC に揃える", () => {
    expect(toIsoUtc("2026-01-01T00:00:00")).toBe("2026-01-01T00:00:00Z");
    expect(toIsoUtc("2026-01-01 00:00:00")).toBe("2026-01-01T00:00:00Z");
    expect(toIsoUtc("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
  });
  it("名前を小文字にして重複を除き、対象ドメイン外の名前は捨てる", () => {
    const cert = normalizeRow(rows[0] as never, "example.jp");
    expect(cert?.names).toEqual(["example.jp", "www.example.jp"]);
    expect(normalizeRow(rows[1] as never, "example.jp")).toBeUndefined();
  });
});

describe("CrtShSource", () => {
  it("restrictedFetch 経由で取得し、結果をキャッシュして 2 回目は fetch しない", async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }));
    const cache = new MemoryCache();
    const source = new CrtShSource({ fetch: fake, cache });
    const first = await source.listCertificates("example.jp");
    expect(first).toHaveLength(1);
    expect(first[0]?.names).toEqual(["example.jp", "www.example.jp"]);
    const second = await source.listCertificates("Example.JP");
    expect(second).toEqual(first);
    expect(fake).toHaveBeenCalledTimes(1);
    const [url] = fake.mock.calls[0] as unknown as [URL];
    expect(url.href).toBe("https://crt.sh/?q=%25.example.jp&output=json");
  });
  it("HTTP エラーや壊れた JSON は CtUnavailableError", async () => {
    const bad = new CrtShSource({
      fetch: async () => new Response("busy", { status: 503 }),
      cache: new MemoryCache(),
    });
    await expect(bad.listCertificates("example.jp")).rejects.toBeInstanceOf(CtUnavailableError);
    const broken = new CrtShSource({
      fetch: async () => new Response("<html>", { status: 200 }),
      cache: new MemoryCache(),
    });
    await expect(broken.listCertificates("example.jp")).rejects.toBeInstanceOf(CtUnavailableError);
  });
  it("空の応答は 0 件", async () => {
    const source = new CrtShSource({
      fetch: async () => new Response("", { status: 200 }),
      cache: new MemoryCache(),
    });
    expect(await source.listCertificates("example.jp")).toEqual([]);
  });
});
