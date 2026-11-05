/**
 * 記事の取得の失敗は、500 ではなく 400 系の日本語の案内になる（TRIAL-012）。
 * 取得は差し替えた fetch で行うので、ネットワークにも Claude にも出ない。
 */
import { describe, expect, it } from "vitest";
import { isThinReading, loadArticle } from "./article-source.ts";
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
    [403, /自動での取得を断りました/],
    [500, /応答しませんでした（500）/],
  ])("HTTP %i は 400 と、本文を貼る案内", async (status, re) => {
    const fetch = async () => new Response("x", { status, statusText: "Not Found" });
    const err = await failure(loadArticle(url("https://news.example/a"), { fetch, lookup }));
    expect(err.status).toBe(400);
    expect(err.message).toMatch(re);
    expect(err.message).toMatch(/本文を貼って読むこともできます|本文の貼り付けをお試しください/);
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
    const page = `<html><head><title>VPN 経由でランサム被害 - 製造業（1ページ目 / 全1ページ）：Security NEXT</title></head><body><div class="main"><p>Security NEXTでは、最新の情報セキュリティに関するニュースを日刊でお届けしています。</p><p>産業機械を設計する会社は、VPN機器の脆弱性を突かれてランサムウェアに感染したことを明らかにした。サーバのデータが暗号化された。同社は警察に相談し、外部の専門家とともに被害の範囲と侵入の経路を調べている。調査の結果は、分かり次第あらためて公表するとしている。顧客への影響はいまのところ確認されていないという。同社は、サーバの隔離と全従業員のパスワードの変更を済ませ、取引先には個別に事情を説明している。再発を防ぐため、VPN機器の入れ替えと多要素認証の導入も進める方針だ。</p><p>（Security NEXT - 2025/02/18 ）</p></div></body></html>`;
    const fetch = async () =>
      new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const a = await loadArticle(url("https://news.example/a"), { fetch, lookup });
    expect(a.title).toBe("VPN 経由でランサム被害 - 製造業");
    expect(a.text).not.toMatch(/最新の情報セキュリティ|Security NEXT/);
    expect(a.incomplete).toBeUndefined();
  });
});

describe("本文がほとんど取れなかったページは 422 の案内（TRIAL-I-002）", () => {
  const page = (body: string) => async () =>
    new Response(`<html><head><title>お知らせ</title></head><body>${body}</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  it("著作権表示の 1 行だけ（日本郵政の HTML 版の形）", async () => {
    const err = await failure(
      loadArticle(url("https://news.example/a"), {
        fetch: page("<p>Copyright (C) EXAMPLE HOLDINGS Co., Ltd. All Rights Reserved.</p>"),
        lookup,
      }),
    );
    expect(err.status).toBe(422);
    expect(err.message).toContain("本文がほとんど取れませんでした（");
    expect(err.message).toContain("PDF の版があればその URL、または本文を貼ってください");
  });
  it("Cookie の同意文だけ（山一電機の HTML 版の形）", async () => {
    const err = await failure(
      loadArticle(url("https://news.example/a"), {
        fetch: page(
          "<p>当ウェブサイトでは、お客様により良いサービスを提供するため、クッキーを利用しています。</p><p>クッキーの使用に同意いただける場合は「同意」ボタンをクリックし、</p><p>クッキーに関する情報や設定については「詳細を見る」ボタンをクリックしてください。</p>",
        ),
        lookup,
      }),
    );
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/本文がほとんど取れませんでした（\d+ 字）/);
  });
  it("貼り付け（text）の短い文は対象外：そのまま通す", async () => {
    const a = await loadArticle({
      kind: "text",
      text: "当社サーバへの不正アクセスを確認しました。",
    });
    expect(a.text).toContain("不正アクセス");
  });
  it("保険：読解が「段階なし・対象外」で 300 字未満なら、本文が取れていなかったとみなす", () => {
    expect(isThinReading({ steps: [], damageType: "out_of_scope" }, 64)).toBe(true);
    expect(isThinReading({ steps: [], damageType: "out_of_scope" }, 300)).toBe(false);
    expect(isThinReading({ steps: [{}], damageType: "out_of_scope" }, 64)).toBe(false);
    expect(isThinReading({ steps: [], damageType: "ransomware" }, 64)).toBe(false);
  });
});
