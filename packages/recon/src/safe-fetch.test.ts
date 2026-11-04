import { describe, expect, it, vi } from "vitest";
import {
  assertAllowedUrl,
  CERTSPOTTER_ORIGIN,
  CRTSH_ORIGIN,
  certspotterUrl,
  crtshUrl,
  ForbiddenDestinationError,
  restrictedFetch,
} from "./safe-fetch.ts";
import { InvalidDomainError, isLookupSafeName, normalizeDomain } from "./types.ts";

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

describe("certspotterUrl", () => {
  it("Cert Spotter の発行記録検索 URL だけを作る", () => {
    expect(certspotterUrl("Example.JP").href).toBe(
      "https://api.certspotter.com/v1/issuances?domain=example.jp&include_subdomains=true&expand=dns_names&expand=issuer",
    );
  });
  it("ドメインとして不正な文字列は拒否する", () => {
    expect(() => certspotterUrl("example.jp&after=1")).toThrow();
    expect(() => certspotterUrl("exa mple.jp")).toThrow();
    expect(() => certspotterUrl("localhost")).toThrow();
  });
});

describe("assertAllowedUrl", () => {
  it("許可した 2 形の URL は通す", () => {
    expect(assertAllowedUrl("https://crt.sh/?q=%25.example.jp&output=json").origin).toBe(
      CRTSH_ORIGIN,
    );
    expect(assertAllowedUrl(certspotterUrl("example.jp")).origin).toBe(CERTSPOTTER_ORIGIN);
  });
  const CS = "https://api.certspotter.com/v1/issuances";
  const CS_Q = "domain=example.jp&include_subdomains=true&expand=dns_names&expand=issuer";
  it.each([
    [`http://api.certspotter.com/v1/issuances?${CS_Q}`, "http"],
    [`https://api.certspotter.com.example.jp/v1/issuances?${CS_Q}`, "似たホスト名"],
    [`https://certspotter.com/v1/issuances?${CS_Q}`, "別ホスト"],
    [`https://api.certspotter.com/v1/issuances/firehose?${CS_Q}`, "別パス"],
    [`https://api.certspotter.com/v1/other?${CS_Q}`, "別パス"],
    [`https://api.certspotter.com/?${CS_Q}`, "ルートのパス"],
    [`${CS}?${CS_Q}&after=12345`, "after の付加"],
    [`${CS}?${CS_Q}&match_wildcards=true`, "余分なパラメータ"],
    [
      `${CS}?domain=example.jp&include_subdomains=false&expand=dns_names&expand=issuer`,
      "include_subdomains=false の改変",
    ],
    [`${CS}?domain=example.jp&expand=dns_names&expand=issuer`, "include_subdomains なし"],
    [
      `${CS}?include_subdomains=true&domain=example.jp&expand=dns_names&expand=issuer`,
      "順序の入れ替え",
    ],
    [`${CS}?domain=example.jp&include_subdomains=true&expand=dns_names`, "expand の欠落"],
    [
      `${CS}?domain=example.jp&include_subdomains=true&expand=dns_names&expand=issuer&expand=cert_der`,
      "expand の付加",
    ],
    [
      `${CS}?domain=EXAMPLE.jp&include_subdomains=true&expand=dns_names&expand=issuer`,
      "大文字のドメイン",
    ],
    [
      `${CS}?domain=exa_mple.jp&include_subdomains=true&expand=dns_names&expand=issuer`,
      "ホスト名として不正",
    ],
    [
      `${CS}?domain=*.example.jp&include_subdomains=true&expand=dns_names&expand=issuer`,
      "ワイルドカード",
    ],
    [`${CS}?domain=&include_subdomains=true&expand=dns_names&expand=issuer`, "ドメイン空"],
    [`${CS}?${CS_Q}#frag`, "フラグメント"],
    [`https://user:pw@api.certspotter.com/v1/issuances?${CS_Q}`, "認証情報"],
    [`https://key@api.certspotter.com/v1/issuances?${CS_Q}`, "ユーザ名だけ"],
    [`https://api.certspotter.com:8443/v1/issuances?${CS_Q}`, "別ポート"],
    ["https://api.certspotter.com/v1/issuances", "クエリなし"],
  ])("%s は拒否する（%s）", (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(ForbiddenDestinationError);
  });
  it("crt.sh の形を Cert Spotter のホストへ持ち込むのも、その逆も拒否する", () => {
    expect(() =>
      assertAllowedUrl("https://api.certspotter.com/?q=%25.example.jp&output=json"),
    ).toThrow(ForbiddenDestinationError);
    expect(() => assertAllowedUrl(`https://crt.sh/v1/issuances?${CS_Q}`)).toThrow(
      ForbiddenDestinationError,
    );
    expect(() => assertAllowedUrl(`https://crt.sh/?${CS_Q}`)).toThrow(ForbiddenDestinationError);
  });
  it("拒否の文言は 2 つの宛先を言う", () => {
    expect(() => assertAllowedUrl("https://vpn.example.jp/")).toThrow(/crt\.sh.*Cert Spotter/);
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
  it("Cert Spotter の URL も GET・リダイレクト不追従で、検査を通ったときだけ fetch を呼ぶ", async () => {
    const fake = vi.fn(async () => new Response("[]", { status: 200 }));
    await restrictedFetch(certspotterUrl("example.jp"), { fetch: fake });
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.hostname).toBe("api.certspotter.com");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.headers).not.toHaveProperty("authorization");
    await expect(
      restrictedFetch(`${certspotterUrl("example.jp").href}&after=1`, { fetch: fake }),
    ).rejects.toBeInstanceOf(ForbiddenDestinationError);
    expect(fake).toHaveBeenCalledTimes(1);
  });
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

describe("ドメインの正規化（normalizeDomain）", () => {
  it("IP アドレス、localhost、逆引きの名前空間、国際化ドメイン名の生文字は拒否し、理由は日本語", () => {
    for (const bad of [
      "203.0.113.10",
      "localhost",
      "foo.localhost",
      "printer.local",
      "1.0.113.203.in-addr.arpa",
      "例.jp",
      "a..jp",
      "-a.jp",
      "a\n.jp",
    ]) {
      expect(() => normalizeDomain(bad), bad).toThrow(InvalidDomainError);
      expect(() => normalizeDomain(bad), bad).toThrow(/ドメイン名として扱えない/);
    }
    expect(normalizeDomain(" Example.JP. ")).toBe("example.jp");
    expect(normalizeDomain("xn--r8jz45g.jp")).toBe("xn--r8jz45g.jp");
  });
  it("isLookupSafeName はワイルドカードと不正な名前を通さない", () => {
    expect(isLookupSafeName("*.example.jp")).toBe(false);
    expect(isLookupSafeName("evil.com\u0000.example.jp")).toBe(false);
    expect(isLookupSafeName(".example.jp")).toBe(false);
    expect(isLookupSafeName("vpn.example.jp")).toBe(true);
  });
});
