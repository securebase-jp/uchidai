/**
 * 記事の取り込みの「小さな課題」の固定：
 * - 取得の失敗は ArticleFetchError（利用者向けの日本語。本文を貼る案内つき）になる（TRIAL-012）
 * - 媒体の定型文・ページの署名・題の末尾を取得の段階で除く。根拠文の照合は除いたあとの本文で行うので壊れない（TRIAL-013、R-008）
 * - 本文が途中で切れていそうなときを検知する（TRIAL-B-012）
 */
import { describe, expect, it } from "vitest";
import {
  ArticleFetchError,
  type ArticleFetchErrorKind,
  cleanTitle,
  detectIncomplete,
  downloadBytes,
  extractHtml,
  extractHtmlPages,
  fetchArticle,
  httpErrorToFetchError,
  PASTE_HINT_JA,
  stripBoilerplate,
} from "./article.ts";
import type { FetchLike } from "./proxy.ts";
import { normalizeText } from "./verify.ts";

const publicLookup = async () => ["93.184.216.34"];

function statusFetch(status: number): FetchLike {
  return async () => new Response("x", { status });
}

async function kindOf(
  p: Promise<unknown>,
): Promise<{ kind: ArticleFetchErrorKind; message: string }> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ArticleFetchError);
    const err = e as ArticleFetchError;
    return { kind: err.kind, message: err.message };
  }
  throw new Error("失敗するはずの取得が成功した");
}

describe("取得の失敗（TRIAL-012）", () => {
  const cases: [number, ArticleFetchErrorKind, RegExp][] = [
    [404, "not_found", /見つかりませんでした（404）/],
    [410, "not_found", /見つかりませんでした（410）/],
    [401, "forbidden", /ログインや会員登録/],
    [402, "forbidden", /ログインや会員登録/],
    [403, "forbidden", /ログインや会員登録/],
    [429, "rate_limited", /断りました（429）/],
    [500, "server_error", /応答しませんでした（500）/],
    [503, "server_error", /応答しませんでした（503）/],
    [418, "http_error", /取得できませんでした（418）/],
  ];
  it.each(cases)(
    "HTTP %i は %s の案内になる（英語の statusText や URL を出さず、本文を貼る案内を付ける）",
    async (status, kind, re) => {
      const got = await kindOf(
        downloadBytes("https://news.example/a", {
          fetch: statusFetch(status),
          lookup: publicLookup,
        }),
      );
      expect(got.kind).toBe(kind);
      expect(got.message).toMatch(re);
      expect(got.message).toContain(PASTE_HINT_JA);
      expect(got.message).not.toMatch(/Not Found|Forbidden|news\.example/);
    },
  );

  it("接続できないとき・時間切れのときも案内する", async () => {
    const refused: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const net = await kindOf(
      downloadBytes("https://news.example/a", { fetch: refused, lookup: publicLookup }),
    );
    expect(net.kind).toBe("network");
    expect(net.message).toContain("接続できませんでした");
    expect(net.message).toContain(PASTE_HINT_JA);
    expect(net.message).not.toMatch(/fetch failed/); // 英語の詳細は画面に出さない

    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const slow = await kindOf(
      downloadBytes("https://news.example/a", { fetch: hang, lookup: publicLookup, timeoutMs: 20 }),
    );
    expect(slow.kind).toBe("timeout");
    expect(slow.message).toContain("時間がかかりすぎた");
    expect(slow.message).toContain(PASTE_HINT_JA);
  });

  it("ホスト名が引けないときは、内部用のホスト名とは別の案内にする", async () => {
    const none = await kindOf(
      downloadBytes("https://no-such-host.example/a", {
        fetch: statusFetch(200),
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    expect(none.kind).toBe("dns");
    expect(none.message).toContain("ホスト名を解決できません");
    expect(none.message).not.toContain("内部用");
    expect(none.message).not.toContain("ENOTFOUND");
  });

  it("サーバの検査（guardedFetch）が投げた例外は cause に残る", async () => {
    const guard = new Error("この URL は手元のネットワークを指しているため取得できません");
    const f: FetchLike = async () => {
      throw guard;
    };
    try {
      await downloadBytes("https://news.example/a", { fetch: f, lookup: publicLookup });
      throw new Error("成功してはいけない");
    } catch (e) {
      expect((e as ArticleFetchError).cause).toBe(guard);
    }
  });

  it("本文が空のときと、読めない PDF も ArticleFetchError", async () => {
    expect((await kindOf(fetchArticle({ kind: "text", text: "  " }))).kind).toBe("empty");
    expect(
      (await kindOf(fetchArticle({ kind: "html", html: "<html><body></body></html>" }))).kind,
    ).toBe("empty");
    expect(
      (await kindOf(fetchArticle({ kind: "pdf", data: new TextEncoder().encode("hello") }))).kind,
    ).toBe("bad_pdf");
  });

  it("httpErrorToFetchError は status を持つ", () => {
    expect(httpErrorToFetchError(404).status).toBe(404);
  });
});

// Security NEXT の記事の形（題・紹介文・本文・ページの境目の署名）
const security = (extra = "") =>
  `<html><head><title>【セキュリティ ニュース】複数サーバがランサム被害、診療に影響なし - 京都府内の病院（1ページ目 / 全1ページ）：Security NEXT</title></head><body><div class="main"><p>Security NEXTでは、最新の情報セキュリティに関するニュースを日刊でお届けしています。</p><p>京都府内の病院は、ランサムウェアによる攻撃を受け、複数のサーバのデータが暗号化されたことを明らかにした。診療への影響はないという。</p><p>同院によれば、VPN機器の脆弱性を突かれて侵入されたとみられる。外部の専門家とともに被害の範囲を調べている。</p><p>（Security NEXT - 2025/06/23 ）</p>${extra}</div></body></html>`;

describe("媒体の定型文の除去（TRIAL-013、R-008）", () => {
  it("題の末尾の「（N ページ目 / 全 M ページ）：媒体名」を除く", () => {
    for (const [from, to] of [
      [
        "【セキュリティ ニュース】複数サーバがランサム被害 - 京都府内の病院（1ページ目 / 全1ページ）：Security NEXT",
        "【セキュリティ ニュース】複数サーバがランサム被害 - 京都府内の病院",
      ],
      [
        "【セキュリティ ニュース】複数サーバがランサム被害 - 京都府内の病院（1ページ目 ",
        "【セキュリティ ニュース】複数サーバがランサム被害 - 京都府内の病院",
      ],
      ["VPN 装置の脆弱性を突かれる（2ページ目 / 全3ページ）", "VPN 装置の脆弱性を突かれる"],
      ["VPN 装置の脆弱性を突かれる(3ページ目)：ITニュース", "VPN 装置の脆弱性を突かれる"],
      ["VPN 装置の脆弱性を突かれる", "VPN 装置の脆弱性を突かれる"], // 付いていなければそのまま
      ["会員向けの1ページ目の使い方を解説", "会員向けの1ページ目の使い方を解説"], // 題の途中は触らない
    ] as const)
      expect(cleanTitle(from), from).toBe(to);
  });

  it("extractHtml の題と本文から、媒体の紹介文と署名の行が消える", () => {
    const a = extractHtml(security());
    expect(a.title).toBe(
      "【セキュリティ ニュース】複数サーバがランサム被害、診療に影響なし - 京都府内の病院",
    );
    expect(a.text).not.toContain("最新の情報セキュリティ");
    expect(a.text).not.toContain("Security NEXT");
    expect(a.text).toContain("京都府内の病院は、ランサムウェアによる攻撃を受け");
    expect(a.incomplete).toBeUndefined(); // 普通の記事は「切れている」と言わない
  });

  it("複数ページでも、ページの境目の署名は除く", () => {
    const p1 = security();
    const p2 = `<html><head><title>x（2ページ目 / 全2ページ）：Security NEXT</title></head><body><div class="main"><p>同院では、再発防止のためネットワーク機器の設定を見直し、監視体制を強化するとしている。患者への影響は確認されていない。</p><p>（Security NEXT - 2025/06/23 ）</p></div></body></html>`;
    const a = extractHtmlPages([p1, p2]);
    expect(a.htmlPages).toBe(2);
    expect(a.text).not.toMatch(/Security NEXT/);
    expect(a.text).toContain("監視体制を強化する");
  });

  it("行ぜんたいが定型文のときだけ除く（本文の文の途中は触らない）", () => {
    const body =
      "同社は「最新の情報セキュリティに関するニュースを日刊でお届け」する媒体の取材に答えた。";
    expect(stripBoilerplate(body).text).toBe(body);
    const mixed = `${body}\n（Security NEXT - 2025/06/23 ）\n次の段落。`;
    expect(stripBoilerplate(mixed).text).toBe(`${body}\n次の段落。`);
    // 括弧つきの、署名に似た本文の行は残す（日付が無い、媒体名の形でない）
    const kept = "（2025年6月23日 午前の発表）\n（サーバー 2025/06/23 の記録）";
    expect(stripBoilerplate(kept).text).toBe(kept);
  });

  it("根拠文の一致を壊さない：除いたあとの本文に、Claude が引く文が一字一句残っている", () => {
    const a = extractHtml(security());
    // Claude が読む本文は a.text。そこから引いた根拠文は、同じ本文との照合（verify と同じ正規化）で必ず見つかる
    const quote = "VPN機器の脆弱性を突かれて侵入されたとみられる。";
    expect(normalizeText(a.text)).toContain(normalizeText(quote));
    // 除く前の本文にあった記事の文は、一つも欠けない
    const original = [
      "京都府内の病院は、ランサムウェアによる攻撃を受け、複数のサーバのデータが暗号化されたことを明らかにした。診療への影響はないという。",
      "同院によれば、VPN機器の脆弱性を突かれて侵入されたとみられる。外部の専門家とともに被害の範囲を調べている。",
    ];
    for (const s of original) expect(a.text).toContain(s);
    // 定型文が根拠文にならない（紹介文・署名は照合の対象にも出てこない）
    expect(normalizeText(a.text)).not.toContain(normalizeText("日刊でお届けしています"));
  });
});

describe("本文が途中で切れていそうなとき（TRIAL-B-012）", () => {
  const body =
    "同社は、メールアカウントが不正に使われ、取引先に偽の請求書が送られたことを明らかにした。";

  it("会員向けの案内の行があれば members_only", () => {
    for (const wall of [
      "この記事は会員限定です",
      "続きを読むには会員登録が必要です",
      "ログインすると続きをお読みいただけます",
      "すべての記事が読み放題",
      "この記事は有料会員のみご覧いただけます",
    ]) {
      const s = stripBoilerplate(`${body}\n${wall}`);
      expect(s.memberWall, wall).toBe(true);
      expect(s.text, wall).not.toContain(wall); // 案内の行は本文から除く
      expect(detectIncomplete(s.text, s.memberWall)).toContain("members_only");
    }
  });

  it("本文中の「会員」「ログイン」は会員向けの案内とみなさない", () => {
    const text = `${body}\n同社は会員サイトへの不正ログインがあったとして、会員登録している顧客へ通知した。パスワードの変更を求めている。`;
    expect(stripBoilerplate(text).memberWall).toBe(false);
  });

  it("末尾が文でなく短い見出しなら ends_with_heading、文で終わっていれば何も言わない", () => {
    expect(detectIncomplete(`${body}\n\n被害の経緯`, false)).toEqual(["ends_with_heading"]);
    expect(detectIncomplete(`${body}\n\n被害の経緯について`, false)).toEqual(["ends_with_heading"]);
    expect(detectIncomplete(body, false)).toEqual([]);
    expect(detectIncomplete(`${body}\n\n再発防止に努めるとしている。`, false)).toEqual([]);
    // 署名や URL、括弧書きは見出しとみなさない
    expect(detectIncomplete(`${body}\n\n（2025年6月23日 発表）`, false)).toEqual([]);
    expect(detectIncomplete(`${body}\n\nhttps://example.com/news/1`, false)).toEqual([]);
    // 1 行だけの本文は判定しない
    expect(detectIncomplete("被害の経緯", false)).toEqual([]);
  });

  it("末尾が「続きを読む」なら read_more", () => {
    expect(detectIncomplete(`${body}\n\n続きを読む`, false)).toEqual(["read_more"]);
    expect(detectIncomplete(`${body}\n\n… 続きを読む »`, false)).toEqual(["read_more"]);
  });

  it("extractHtml が incomplete を付ける（会員向けの案内つき・末尾が見出し）", () => {
    const wall = extractHtml(security("<p>この記事は会員限定です。</p>"));
    expect(wall.incomplete).toContain("members_only");
    expect(wall.text).not.toContain("会員限定");
    const cut = extractHtml(
      `<html><head><title>t</title></head><body><div class="main"><p>${body}</p><p>${body}</p><h2>被害の経緯</h2></div></body></html>`,
    );
    expect(cut.incomplete).toEqual(["ends_with_heading"]);
  });

  it("貼り付けた本文には付けない（利用者が自分で渡したものなので）", async () => {
    const a = await fetchArticle({ kind: "text", text: `${body}\n\n被害の経緯` });
    expect(a.incomplete).toBeUndefined();
  });
});
