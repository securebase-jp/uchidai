/**
 * 記事の取り込みの安全性：SSRF（内部アドレス・自社ホスト・リダイレクト）、サイズと文字数の上限、文字コード、空入力
 */
import { describe, expect, it } from "vitest";
import {
  assertAllowedUrl,
  decodeHtml,
  detectThinBody,
  downloadBytes,
  extractPdfPages,
  fetchArticle,
  isPrivateIp,
  MAX_TEXT_CHARS,
} from "./article.ts";
import type { FetchLike } from "./proxy.ts";

const publicLookup = async () => ["93.184.216.34"];
const privateLookup = async () => ["93.184.216.34", "10.0.0.5"];

describe("isPrivateIp", () => {
  it("私設・ループバック・リンクローカル・メタデータ・マルチキャスト・IPv4 射影を内部とみなす", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "2001:db8::1",
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
  });
  it("公開アドレスは通す", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "2404:6800::1"])
      expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("assertAllowedUrl", () => {
  const opts = { lookup: publicLookup };
  it("http / https 以外、認証情報つき、ホスト名なしは拒否する", async () => {
    for (const u of [
      "file:///etc/passwd",
      "ftp://example.com/a",
      "gopher://example.com/",
      "javascript:alert(1)",
      "http://user:pw@example.com/",
      "not a url",
    ])
      await expect(assertAllowedUrl(u, opts), u).rejects.toThrow();
  });
  it("localhost・内部用の名前・内部アドレス（10 進や IPv6 の表記を含む）は拒否する", async () => {
    for (const u of [
      "http://localhost/",
      "http://localhost:8787/api",
      "http://intranet/",
      "http://vpn.corp.local/",
      "http://db.internal/",
      "http://127.0.0.1/",
      "http://127.0.0.1:8787/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/",
      "http://192.168.0.1/",
      "http://172.20.0.1/",
      "http://0.0.0.0/",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://0177.0.0.1/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/",
    ])
      await expect(assertAllowedUrl(u, opts), u).rejects.toThrow(/接続しません|ホスト名/);
  });
  it("ホスト名が内部アドレスに解決されるなら拒否する（DNS リバインディング）", async () => {
    await expect(
      assertAllowedUrl("https://example.com/a", { lookup: privateLookup }),
    ).rejects.toThrow(/解決されるホスト/);
    await expect(
      assertAllowedUrl("https://example.com/a", { lookup: async () => [] }),
    ).rejects.toThrow(/解決できません/);
  });
  it("自社のホスト（blockedHosts）とそのサブドメインは拒否する", async () => {
    const o = { ...opts, blockedHosts: ["demo-seiko.example"] };
    await expect(assertAllowedUrl("https://vpn.demo-seiko.example/", o)).rejects.toThrow(/自社/);
    await expect(assertAllowedUrl("https://demo-seiko.example/", o)).rejects.toThrow(/自社/);
    await expect(assertAllowedUrl("https://notdemo-seiko.example/", o)).resolves.toBeInstanceOf(
      URL,
    );
  });
  it("公開サイトは通す", async () => {
    const u = await assertAllowedUrl("https://www.ipa.go.jp/security/reports/sme/x.pdf", opts);
    expect(u.hostname).toBe("www.ipa.go.jp");
    await expect(assertAllowedUrl("https://93.184.216.34/a", opts)).resolves.toBeInstanceOf(URL);
  });
});

/** URL ごとの応答を返す偽の fetch */
function fakeFetch(routes: Record<string, () => Response>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const make = routes[url];
    if (!make) throw new Error(`fetch failed: ${url}`);
    return make();
  }) as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}
const redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } });
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });

describe("downloadBytes", () => {
  it("リダイレクトを 1 回ずつ検査して辿り、最終 URL を返す", async () => {
    const fetch = fakeFetch({
      "http://example.com/a": () => redirect("https://example.com/b", 301),
      "https://example.com/b": () => redirect("/c"),
      "https://example.com/c": () => html("<p>ok</p>"),
    });
    const r = await downloadBytes("http://example.com/a", { fetch, lookup: publicLookup });
    expect(r.finalUrl).toBe("https://example.com/c");
    expect(new TextDecoder().decode(r.data)).toBe("<p>ok</p>");
    expect(fetch.calls).toHaveLength(3);
  });
  it("内部アドレスへのリダイレクトは辿らない", async () => {
    for (const to of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8787/api/knowledge",
      "http://[::1]/",
      "file:///etc/passwd",
    ]) {
      const fetch = fakeFetch({ "https://example.com/a": () => redirect(to) });
      await expect(
        downloadBytes("https://example.com/a", { fetch, lookup: publicLookup }),
        to,
      ).rejects.toThrow();
      expect(fetch.calls).toEqual(["https://example.com/a"]);
    }
  });
  it("リダイレクトが多すぎれば止める", async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++)
      routes[`https://example.com/${i}`] = () => redirect(`https://example.com/${i + 1}`);
    const fetch = fakeFetch(routes);
    await expect(
      downloadBytes("https://example.com/0", { fetch, lookup: publicLookup, maxRedirects: 3 }),
    ).rejects.toThrow(/リダイレクトが多すぎます/);
    expect(fetch.calls).toHaveLength(4);
  });
  it("content-length が上限を超えていれば本文を読まずに止め、宣言が無くても受信量で打ち切る", async () => {
    const big = fakeFetch({
      "https://example.com/big": () => html("x", { "content-length": "99999999" }),
    });
    await expect(
      downloadBytes("https://example.com/big", {
        fetch: big,
        lookup: publicLookup,
        maxBytes: 1000,
      }),
    ).rejects.toThrow(/大きすぎます/);
    const stream = fakeFetch({
      "https://example.com/stream": () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(512));
            },
          }),
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    });
    await expect(
      downloadBytes("https://example.com/stream", {
        fetch: stream,
        lookup: publicLookup,
        maxBytes: 2000,
      }),
    ).rejects.toThrow(/大きすぎます/);
  });
  it("失敗の理由は日本語で返す", async () => {
    const fetch = fakeFetch({});
    await expect(
      downloadBytes("https://example.com/none", { fetch, lookup: publicLookup }),
    ).rejects.toThrow(/取得に失敗しました（example.com）/);
    const notFound = fakeFetch({
      "https://example.com/404": () => new Response("x", { status: 404, statusText: "Not Found" }),
    });
    await expect(
      downloadBytes("https://example.com/404", { fetch: notFound, lookup: publicLookup }),
    ).rejects.toThrow(/404/);
  });
});

describe("decodeHtml（文字コード）", () => {
  // 「日本語」の Shift_JIS と EUC-JP のバイト列
  const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
  const eucjp = new Uint8Array([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]);
  it("ヘッダに文字コードが無くても Shift_JIS / EUC-JP を読める", () => {
    expect(decodeHtml(sjis, "text/html")).toBe("日本語");
    expect(decodeHtml(eucjp, "text/html")).toBe("日本語");
  });
  it("ヘッダの宣言が間違っていても、不正なバイト列にならない文字コードに落ちる", () => {
    expect(decodeHtml(sjis, "text/html; charset=utf-8")).toBe("日本語");
  });
  it("meta の宣言を使う", () => {
    const head = new TextEncoder().encode('<meta charset="shift_jis"><p>');
    const data = new Uint8Array([...head, ...sjis]);
    expect(decodeHtml(data, "text/html")).toContain("日本語");
  });
});

describe("fetchArticle の入力の上限", () => {
  it("空の本文は例外にする", async () => {
    await expect(fetchArticle({ kind: "text", text: "  \n\n " })).rejects.toThrow(/空/);
    await expect(
      fetchArticle({ kind: "html", html: "<html><body></body></html>" }),
    ).rejects.toThrow(/空/);
  });
  it("長すぎる本文は上限で切り、truncated を付ける", async () => {
    const a = await fetchArticle({ kind: "text", text: "あ".repeat(MAX_TEXT_CHARS + 500) });
    expect(a.text.length).toBe(MAX_TEXT_CHARS);
    expect(a.truncated).toBe(true);
    const b = await fetchArticle({ kind: "text", text: "短い本文" });
    expect(b.truncated).toBeUndefined();
  });
  it("PDF でないバイト列や大きすぎる PDF は読まない", async () => {
    await expect(extractPdfPages(new TextEncoder().encode("hello"))).rejects.toThrow(/PDF/);
    await expect(
      extractPdfPages(new TextEncoder().encode("%PDF-1.4 ....."), { maxBytes: 4 }),
    ).rejects.toThrow(/大きすぎます/);
  });
  it("PDF の代わりに HTML が返ったときは、そう案内する（TRIAL-I-013）", async () => {
    const html = new TextEncoder().encode(
      "<!DOCTYPE html><html><body>同意してください</body></html>",
    );
    await expect(extractPdfPages(html)).rejects.toThrow(
      /PDF ではなく HTML が返りました（同意の画面かもしれません）/,
    );
    await expect(extractPdfPages(new TextEncoder().encode("hello"))).rejects.toThrow(
      /先頭が %PDF- ではありません/,
    );
  });
  it("URL 入力はホストの検査を通ってから取得する", async () => {
    const fetch = fakeFetch({});
    await expect(
      fetchArticle({ kind: "url", url: "http://127.0.0.1:8787/api/knowledge" }, { fetch }),
    ).rejects.toThrow(/接続しません/);
    expect(fetch.calls).toEqual([]);
  });
});

describe("fetchArticle(url) は記事の続きのページを辿る", () => {
  const page = (body: string, next?: string) =>
    html(
      `<html><head><title>記事</title></head><body><div><p>${body.repeat(6)}</p>${next ? `<div class="pnavi"><a href="${next}">次</a></div>` : ""}</div></body></html>`,
    );
  it("/2 のリンクを同じホストでだけ辿り、本文をつなげる（上限あり）", async () => {
    const fetch = fakeFetch({
      "https://example.com/100": () =>
        page("1ページ目の本文。VPN装置の脆弱性を悪用された。", "https://example.com/100/2"),
      "https://example.com/100/2": () =>
        page("2ページ目の本文。多要素認証を導入した。", "https://example.com/100/3"),
      "https://example.com/100/3": () =>
        page("3ページ目の本文。再発防止策を進める。", "https://evil.example/100/4"),
    });
    const a = await fetchArticle(
      { kind: "url", url: "https://example.com/100" },
      { fetch, lookup: publicLookup },
    );
    expect(a.htmlPages).toBe(3);
    expect(a.text).toContain("1ページ目の本文");
    expect(a.text).toContain("2ページ目の本文");
    expect(a.text).toContain("3ページ目の本文");
    expect(fetch.calls).toEqual([
      "https://example.com/100",
      "https://example.com/100/2",
      "https://example.com/100/3",
    ]);
  });
  it("続きの取得に失敗しても、取れたページまでで読む", async () => {
    const fetch = fakeFetch({
      "https://example.com/200": () => page("本文。業務データが暗号化された。", "/200/2"),
    });
    const a = await fetchArticle(
      { kind: "url", url: "https://example.com/200" },
      { fetch, lookup: publicLookup },
    );
    expect(a.htmlPages).toBe(1);
    expect(a.text).toContain("業務データが暗号化された");
  });
});

describe("本文がほとんど取れていない HTML（TRIAL-I-002）", () => {
  const fetchOf = (body: string) =>
    fakeFetch({ "https://example.com/n": () => html(`<html><body>${body}</body></html>`) });
  it("著作権表示の 1 行だけなら too_short と consent_only", async () => {
    const a = await fetchArticle(
      { kind: "url", url: "https://example.com/n" },
      {
        fetch: fetchOf("<p>Copyright (C) EXAMPLE HOLDINGS Co., Ltd. All Rights Reserved.</p>"),
        lookup: publicLookup,
      },
    );
    expect(a.incomplete).toContain("too_short");
    expect(a.incomplete).toContain("consent_only");
  });
  it("200〜400 字の同意文だけなら consent_only（too_short ではない）", () => {
    const text = `クッキーの使用に同意いただける場合は「同意」ボタンをクリックしてください。${"サイトの利用にあたっては、クッキーに関する設定をご確認ください。".repeat(6)}`;
    expect(detectThinBody(text)).toEqual(["consent_only"]);
  });
  it("事故の公表らしい語がある短い本文は consent_only にしない", () => {
    expect(detectThinBody("当社サーバへの不正アクセスについて。クッキーの同意はこちら。")).toEqual([
      "too_short",
    ]);
  });
  it("十分な長さの本文には何も付かない", async () => {
    const a = await fetchArticle(
      { kind: "url", url: "https://example.com/n" },
      {
        fetch: fetchOf(
          `<div><p>${"当社のサーバにVPN装置の脆弱性を突いた不正アクセスがありました。".repeat(8)}</p></div>`,
        ),
        lookup: publicLookup,
      },
    );
    expect(a.incomplete).toBeUndefined();
  });
});
