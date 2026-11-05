/**
 * 記事の取得の失敗は、500 ではなく 400 系の日本語の案内になる（TRIAL-012）。
 * 取得は差し替えた fetch で行うので、ネットワークにも Claude にも出ない。
 */
import { describe, expect, it } from "vitest";
import { loadArticle } from "./article-source.ts";
import { ClientError } from "./errors.ts";

const lookup = async () => ["93.184.216.34"];
const url = (u: string) => ({ kind: "url", url: u }) as const;

async function failure(p: Promise<unknown>): Promise<ClientError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ClientError);
    return e as ClientError;
  }
  throw new Error("失敗するはずの取得が成功した");
}

describe("loadArticle（取得の失敗は 400 系の案内）", () => {
  it.each([
    [404, /見つかりませんでした（404）/],
    [403, /ログインや会員登録/],
    [500, /応答しませんでした（500）/],
  ])("HTTP %i は 400 と、本文を貼る案内", async (status, re) => {
    const fetch = async () => new Response("x", { status, statusText: "Not Found" });
    const err = await failure(loadArticle(url("https://news.example/a"), { fetch, lookup }));
    expect(err.status).toBe(400);
    expect(err.message).toMatch(re);
    expect(err.message).toContain("記事の本文を貼って読むこともできます");
    expect(err.message).not.toMatch(/Not Found|news\.example/); // 英語の statusText や URL は出さない
  });

  it("接続できない・時間切れ・ホスト名が引けない、も 400", async () => {
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    const net = await failure(loadArticle(url("https://news.example/a"), { fetch: down, lookup }));
    expect(net.status).toBe(400);
    expect(net.message).toContain("接続できませんでした");

    const noHost = await failure(
      loadArticle(url("https://news.example/a"), {
        fetch: async () => new Response("x"),
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    // 名前解決に失敗したホストは、取得側が「ホスト名を解決できません」と案内する
    expect(noHost.status).toBe(400);
    expect(noHost.message).toContain("ホスト名を解決できません");
  });

  it("転送先が内部のアドレスなら、その理由をそのまま 400 で返す（取得の失敗に丸めない）", async () => {
    const fetch = async () =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
    const err = await failure(loadArticle(url("https://news.example/a"), { fetch, lookup }));
    expect(err.status).toBe(400);
    expect(err.message).toContain("受け付けません");
  });

  it("本文が取り出せない HTML と、読めない PDF も 400", async () => {
    const empty = async () =>
      new Response("<html><body></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const e1 = await failure(loadArticle(url("https://news.example/a"), { fetch: empty, lookup }));
    expect(e1.message).toContain("本文を取り出せませんでした");
    const bad = await failure(
      loadArticle({ kind: "pdf", dataBase64: Buffer.from("hello").toString("base64") }),
    );
    expect(bad.status).toBe(400);
    expect(bad.message).toContain("PDF");
  });

  it("取得に成功した記事は、題と本文の定型文を除いて返す", async () => {
    const page = `<html><head><title>VPN 経由でランサム被害 - 製造業（1ページ目 / 全1ページ）：Security NEXT</title></head><body><div class="main"><p>Security NEXTでは、最新の情報セキュリティに関するニュースを日刊でお届けしています。</p><p>産業機械を設計する会社は、VPN機器の脆弱性を突かれてランサムウェアに感染したことを明らかにした。サーバのデータが暗号化された。</p><p>（Security NEXT - 2025/02/18 ）</p></div></body></html>`;
    const fetch = async () =>
      new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const a = await loadArticle(url("https://news.example/a"), { fetch, lookup });
    expect(a.title).toBe("VPN 経由でランサム被害 - 製造業");
    expect(a.text).not.toMatch(/最新の情報セキュリティ|Security NEXT/);
    expect(a.incomplete).toBeUndefined();
  });
});
