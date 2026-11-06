/**
 * セキュリティ診断（docs/security-review-2026-11-06.md）で確かめた、記事 URL の検査の振る舞い。
 * 外へ出る通信はしない：名前解決と fetch は差し替える。
 * 「通ってしまう」ことを記録する試験も含む（直すときに、ここを反転させる）。
 */
import { assertAllowedUrl, isPrivateIp } from "@uchidai/llm";
import { describe, expect, it } from "vitest";
import { ClientError } from "./errors.ts";
import { assertPublicUrl, checkPublicUrl, guardedFetch, isBlockedAddress } from "./safe-url.ts";

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

  it("NAT64（64:ff9b::/96）に埋め込んだ 127.0.0.1 は、サーバ側の検査では通る（llm 側の検査で止まる）", () => {
    // SEC-006：safe-url.ts は NAT64 を見ない。article.ts の isPrivateIpv6 は見る。二重の検査の片方だけが止める
    expect(checkPublicUrl("http://[64:ff9b::7f00:1]/")).toBeUndefined();
    expect(isPrivateIp("64:ff9b::7f00:1")).toBe(true);
  });

  it("IPv4 互換アドレス（::7f00:1。廃止された表記）は、どちらの検査も通す", () => {
    // SEC-006：OS はこの形をループバックとして扱わないのが普通だが、記録しておく
    expect(checkPublicUrl("http://[::7f00:1]/")).toBeUndefined();
    expect(isPrivateIp("::7f00:1")).toBe(false);
    expect(isBlockedAddress("::7f00:1")).toBe(false);
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
  it("名前解決が失敗したときは通す（fail-open。取得側が自分で解決する）", async () => {
    // SEC-005：検査の解決と取得の解決は別。検査が失敗した・空だったときに取得側の解決が内部に向くと止められない
    await expect(
      assertPublicUrl("http://flaky.example/", async () => {
        throw new Error("EAI_AGAIN");
      }),
    ).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("http://empty.example/", async () => [])).resolves.toBeInstanceOf(
      URL,
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

describe("guardedFetch：解決した IP を取得に固定しない（DNS の付け替えの窓）", () => {
  it("検査で解決した結果は取得側に渡されず、取得側はホスト名のまま受け取る", async () => {
    // SEC-005：検査（lookup）と取得（fetch 内部の名前解決）が別々に名前を引く。
    // TTL の短いレコードを 1 回目は公開 IP、2 回目は 127.0.0.1 に向ければ、検査を通ったあとの取得が内部に向く
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
    // 取得はホスト名で行われる（IP に固定されていない）。検査は 1 回しか引かれない
    expect(seen).toEqual(["http://rebind.example/"]);
    expect(calls).toBe(1);
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
