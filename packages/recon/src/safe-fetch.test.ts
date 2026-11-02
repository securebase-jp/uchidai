import { describe, expect, it, vi } from "vitest";
import {
  assertAllowedUrl,
  CRTSH_ORIGIN,
  crtshUrl,
  ForbiddenDestinationError,
  restrictedFetch,
} from "./safe-fetch.ts";

describe("crtshUrl", () => {
  it("crt.sh のサブドメイン検索 URL だけを作る", () => {
    expect(crtshUrl("Example.JP").href).toBe("https://crt.sh/?q=%25.example.jp&output=json");
  });
  it("ドメインとして不正な文字列は拒否する", () => {
    expect(() => crtshUrl("example.jp/../")).toThrow();
    expect(() => crtshUrl("exa mple.jp")).toThrow();
    expect(() => crtshUrl("localhost")).toThrow();
  });
});

describe("assertAllowedUrl", () => {
  it("許可した形の URL は通す", () => {
    expect(assertAllowedUrl("https://crt.sh/?q=%25.example.jp&output=json").origin).toBe(
      CRTSH_ORIGIN,
    );
  });
  it.each([
    ["http://crt.sh/?q=%25.example.jp&output=json", "http"],
    ["https://vpn.example.jp/", "対象ホスト"],
    ["https://crt.sh.example.jp/?q=%25.example.jp&output=json", "似たホスト名"],
    ["https://crt.sh/other?q=%25.example.jp&output=json", "別パス"],
    ["https://crt.sh/?q=example.jp&output=json", "ワイルドカードなし"],
    ["https://crt.sh/?q=%25.example.jp", "output なし"],
    ["https://crt.sh/?q=%25.example.jp&output=json&x=1", "余分なパラメータ"],
    ["https://crt.sh/?q=%25.example.jp&output=json#frag", "フラグメント"],
    ["https://user:pw@crt.sh/?q=%25.example.jp&output=json", "認証情報"],
    ["not a url", "URL でない"],
  ])("%s は拒否する（%s）", (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(ForbiddenDestinationError);
  });
});

describe("restrictedFetch", () => {
  it("検査を通った URL でだけ、GET・リダイレクト不追従で fetch を呼ぶ", async () => {
    const fake = vi.fn(async () => new Response("[]", { status: 200 }));
    const res = await restrictedFetch(crtshUrl("example.jp"), { fetch: fake });
    expect(res.status).toBe(200);
    expect(fake).toHaveBeenCalledTimes(1);
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://crt.sh/?q=%25.example.jp&output=json");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
  });
  it("対象ホストへの URL は fetch を呼ぶ前に拒否する", async () => {
    const fake = vi.fn(async () => new Response("", { status: 200 }));
    await expect(
      restrictedFetch("https://vpn.demo-seiko.example/remote/login", { fetch: fake }),
    ).rejects.toBeInstanceOf(ForbiddenDestinationError);
    await expect(restrictedFetch("https://demo-seiko.example/", { fetch: fake })).rejects.toThrow();
    expect(fake).not.toHaveBeenCalled();
  });
});
