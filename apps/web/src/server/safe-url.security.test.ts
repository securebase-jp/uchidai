/**
 * セキュリティ診断で確かめた、記事 URL の検査の振る舞い。
 * 外へ出る通信はしない：名前解決と fetch は差し替える。
 * 「通ってしまう」ことを記録する試験も含む（直すときに、ここを反転させる）。
 */
import { assertAllowedUrl, isPrivateIp } from "@uchidai/llm";
import { describe, expect, it } from "vitest";
import { ClientError } from "./errors.ts";
import {
  assertPublicUrl,
  checkPublicUrl,
  guardedFetch,
  isBlockedAddress,
  pinnedLookup,
  pinningFetch,
} from "./safe-url.ts";

const publicLookup = async () => ["93.184.216.34"];

describe("checkPublicUrl：形だけで断れるもの", () => {
  it.each([
    ["file:///etc/hosts"],
    ["data:text/html,hi"],
    ["ftp://example.com/x"],
    ["gopher://example.com/"],
    ["javascript:alert(1)"],
    ["http://user:pw@example.com/"],
    ["http://user@example.com/"],
    ["http://localhost/"],
    ["http://localhost./"],
    ["http://LOCALHOST:8787/"],
    ["http://api.internal/"],
    ["http://box.local/"],
    ["http://intranet/"],
    ["http://127.0.0.1:8787/api/requests"],
    ["http://127.1/"], // URL が 127.0.0.1 に正規化する
    ["http://2130706433/"], // 10 進表記 → 127.0.0.1
    ["http://0x7f000001/"], // 16 進表記 → 127.0.0.1
    ["http://0177.0.0.1/"], // 8 進表記 → 127.0.0.1
    ["http://0.0.0.0/"],
    ["http://0/"],
    ["http://10.1.2.3/"],
    ["http://172.16.0.1/"],
    ["http://192.168.1.1/"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://100.64.0.1/"],
    ["http://[::1]/"],
    ["http://[::]/"],
    ["http://[::ffff:127.0.0.1]/"], // URL が [::ffff:7f00:1] に正規化する
    ["http://[::ffff:7f00:1]/"],
    ["http://[0:0:0:0:0:ffff:7f00:1]/"],
    ["http://[fe80::1]/"],
    ["http://[fc00::1]/"],
    ["http://[fd12::1]/"],
  ])("%s は断る", (url) => {
    expect(checkPublicUrl(url)).toBeDefined();
  });

  it("NAT64（64:ff9b::/96）と IPv4 互換（::/96）に埋めた 127.0.0.1 は、どちらの検査も断る（SEC-008 対応済み）", () => {
    expect(checkPublicUrl("http://[64:ff9b::7f00:1]/")).toBeDefined();
    expect(checkPublicUrl("http://[::7f00:1]/")).toBeDefined();
    expect(isPrivateIp("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateIp("::7f00:1")).toBe(true);
    expect(isBlockedAddress("::7f00:1")).toBe(true);
    // サーバ側の判定は llm 側に寄せたので、同じ答えになる
    for (const ip of [
      "10.0.0.1",
      "169.254.169.254",
      "fe80::1",
      "2001:db8::1",
      "93.184.216.34",
      "2606:4700::1",
    ])
      expect(isBlockedAddress(ip)).toBe(isPrivateIp(ip));
  });
});

describe("assertPublicUrl：名前解決の結果で断る", () => {
  it.each([
    ["127.0.0.1"],
    ["10.0.0.1"],
    ["169.254.169.254"],
    ["::1"],
    ["::ffff:127.0.0.1"],
    ["fe80::1"],
  ])("ホスト名が %s に解決されれば断る", async (addr) => {
    await expect(
      assertPublicUrl("http://evil.example/", async () => [addr]),
    ).rejects.toBeInstanceOf(ClientError);
  });
  it("公開アドレスと内部アドレスの両方に解決されれば断る（1 つでも内部なら止める）", async () => {
    await expect(
      assertPublicUrl("http://evil.example/", async () => ["93.184.216.34", "127.0.0.1"]),
    ).rejects.toBeInstanceOf(ClientError);
  });
  it("名前解決が失敗した・空のときは断る（SEC-005 対応済み。fail-open にしない）", async () => {
    await expect(
      assertPublicUrl("http://flaky.example/", async () => {
        throw new Error("EAI_AGAIN");
      }),
    ).rejects.toBeInstanceOf(ClientError);
    await expect(assertPublicUrl("http://empty.example/", async () => [])).rejects.toBeInstanceOf(
      ClientError,
    );
  });
  it("llm 側の assertAllowedUrl は、解決が失敗・空なら断る", async () => {
    await expect(
      assertAllowedUrl("http://flaky.example/", {
        lookup: async () => {
          throw new Error("EAI_AGAIN");
        },
      }),
    ).rejects.toThrow();
    await expect(
      assertAllowedUrl("http://empty.example/", { lookup: async () => [] }),
    ).rejects.toThrow();
  });
});

describe("guardedFetch：検査で解決した IP を接続に固定する（SEC-005 対応済み）", () => {
  it("取得の名前解決（pinnedLookup）は、検査で解決したアドレスだけを返す。検査していないホストは拒む", async () => {
    const seen: string[] = [];
    const base = async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response("ok");
    };
    let calls = 0;
    const flipping = async () => {
      calls++;
      return calls === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
    };
    const res = await guardedFetch(base, flipping)("http://rebind.example/");
    expect(res.status).toBe(200);
    expect(seen).toEqual(["http://rebind.example/"]);
    expect(calls).toBe(1);
    // 取得側の名前解決は、検査の結果（1 回目の公開 IP）を返し、2 回目の解決（127.0.0.1）は起きない
    const single = await new Promise<unknown[]>((resolve) =>
      pinnedLookup("rebind.example", { all: false }, (...args) => resolve(args)),
    );
    expect(single).toEqual([null, "93.184.216.34", 4]);
    const all = await new Promise<unknown[]>((resolve) =>
      pinnedLookup("REBIND.example.", { all: true }, (...args) => resolve(args)),
    );
    expect(all).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
    const unknown = await new Promise<unknown[]>((resolve) =>
      pinnedLookup("never-checked.example", { all: false }, (...args) => resolve(args)),
    );
    expect((unknown[0] as NodeJS.ErrnoException).code).toBe("ENOTFOUND");
  });
  it("プロキシが無ければ接続先を固定した fetch、プロキシがあれば従来の fetch（固定しない）", () => {
    const saved = {
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy,
      http_proxy: process.env.http_proxy,
    };
    for (const k of Object.keys(saved)) delete process.env[k];
    try {
      expect(pinningFetch().pinned).toBe(true);
      process.env.HTTPS_PROXY = "http://proxy.example:8080";
      expect(pinningFetch().pinned).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("転送先が file:・data: など http(s) 以外なら断る", async () => {
    const base = async () =>
      new Response(null, { status: 302, headers: { location: "file:///etc/hosts" } });
    await expect(guardedFetch(base, publicLookup)("http://news.example/")).rejects.toBeInstanceOf(
      ClientError,
    );
  });
  it("転送先がメタデータのアドレスなら断る", async () => {
    const base = async (input: string | URL | Request) =>
      String(input) === "http://news.example/"
        ? new Response(null, {
            status: 307,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          })
        : new Response("secret");
    await expect(guardedFetch(base, publicLookup)("http://news.example/")).rejects.toBeInstanceOf(
      ClientError,
    );
  });
  it("転送先が内部ホスト名に解決されるなら断る", async () => {
    const lookup = async (host: string) =>
      host === "inner.example" ? ["10.0.0.5"] : ["93.184.216.34"];
    const base = async (input: string | URL | Request) =>
      String(input) === "http://news.example/"
        ? new Response(null, { status: 302, headers: { location: "http://inner.example/" } })
        : new Response("secret");
    await expect(guardedFetch(base, lookup)("http://news.example/")).rejects.toBeInstanceOf(
      ClientError,
    );
  });
});
