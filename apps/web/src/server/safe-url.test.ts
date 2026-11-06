import { describe, expect, it } from "vitest";
import { ClientError } from "./errors.ts";
import { assertPublicUrl, checkPublicUrl, guardedFetch, isBlockedAddress } from "./safe-url.ts";

describe("checkPublicUrl（形だけの判定）", () => {
  it("公開された http(s) の URL は通す", () => {
    expect(checkPublicUrl("https://www.ipa.go.jp/security/reports/sme/x.pdf")).toBeUndefined();
    expect(checkPublicUrl("http://example.com/news/1")).toBeUndefined();
    expect(checkPublicUrl("https://8.8.8.8/")).toBeUndefined();
  });
  it("http(s) 以外のスキームは拒む", () => {
    for (const u of [
      "file:///etc/passwd",
      "ftp://example.com/a",
      "gopher://x.example",
      "javascript:1",
    ])
      expect(checkPublicUrl(u), u).toBeDefined();
  });
  it("localhost・社内名・プライベートアドレスは拒む", () => {
    const bad = [
      "http://localhost:8787/api/requests",
      "http://LOCALHOST/",
      "http://foo.localhost/",
      "http://nas.local/",
      "http://intranet/",
      "http://127.0.0.1/",
      "http://127.1.2.3/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://172.31.255.254/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://user:pass@example.com/",
    ];
    for (const u of bad) expect(checkPublicUrl(u), u).toBeDefined();
  });
  it("壊れた URL は理由を返す", () => {
    expect(checkPublicUrl("not a url")).toContain("形式");
  });
});

describe("isBlockedAddress", () => {
  it("公開アドレスは通し、それ以外は止める", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    expect(isBlockedAddress("10.1.1.1")).toBe(true);
    expect(isBlockedAddress("224.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("2001:db8::1")).toBe(true);
    expect(isBlockedAddress("garbage")).toBe(true);
  });
});

describe("assertPublicUrl（名前解決つき）", () => {
  it("ホスト名がプライベートアドレスに解決されれば 400", async () => {
    const lookup = async () => ["10.0.0.9"];
    await expect(assertPublicUrl("https://evil.example/", lookup)).rejects.toBeInstanceOf(
      ClientError,
    );
  });
  it("公開アドレスなら通し、解決できないときは止める（SEC-005。取得側に委ねない）", async () => {
    await expect(
      assertPublicUrl("https://news.example/", async () => ["93.184.216.34"]),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertPublicUrl("https://none.example/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toBeInstanceOf(ClientError);
  });
});

describe("guardedFetch（リダイレクトも 1 段ずつ確認）", () => {
  const publicLookup = async () => ["93.184.216.34"];
  it("転送先が社内なら途中で止める", async () => {
    const seen: string[] = [];
    const base = async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url === "https://news.example/a")
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8787/" } });
      return new Response("ok");
    };
    const f = guardedFetch(base, publicLookup);
    await expect(f("https://news.example/a")).rejects.toBeInstanceOf(ClientError);
    expect(seen).toEqual(["https://news.example/a"]);
  });
  it("公開先への転送は追い、manual で取得する", async () => {
    const inits: RequestInit[] = [];
    const base = async (input: string | URL | Request, init?: RequestInit) => {
      if (init) inits.push(init);
      const url = String(input);
      if (url.endsWith("/a"))
        return new Response(null, { status: 301, headers: { location: "/b" } });
      return new Response(`got ${url}`);
    };
    const res = await guardedFetch(base, publicLookup)("https://news.example/a", {
      redirect: "follow",
    });
    expect(await res.text()).toBe("got https://news.example/b");
    expect(inits.every((i) => i.redirect === "manual")).toBe(true);
  });
  it("転送が多すぎれば止める", async () => {
    const base = async () =>
      new Response(null, { status: 302, headers: { location: "https://news.example/loop" } });
    await expect(guardedFetch(base, publicLookup)("https://news.example/loop")).rejects.toThrow(
      /多すぎ/,
    );
  });
});
