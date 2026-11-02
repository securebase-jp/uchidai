import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractHtml,
  extractPdf,
  fetchArticle,
  findCasePages,
  findNextPageUrl,
  parsePageRange,
  tidyText,
  trimTrailer,
} from "./article.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ipaPdf = join(here, "../../../eval/.cache/sme-jirei.pdf");

describe("tidyText", () => {
  it("行ごとの空白を整え、空行の連続を 1 行にする", () => {
    expect(tidyText("  a \t b \r\n\r\n\r\n\r\nc  ")).toBe("a b\n\nc");
  });
});

describe("parsePageRange", () => {
  it("単独・範囲・列挙を 1 始まりのページ番号にする", () => {
    expect(parsePageRange("27", 55)).toEqual([27]);
    expect(parsePageRange("27-29", 55)).toEqual([27, 28, 29]);
    expect(parsePageRange("27,29-30", 55)).toEqual([27, 29, 30]);
    expect(parsePageRange("２７〜２８", 55)).toEqual([27, 28]);
  });
  it("総ページ数を超える部分は切り捨て、不正な指定は例外", () => {
    expect(parsePageRange("54-60", 55)).toEqual([54, 55]);
    expect(() => parsePageRange("x", 55)).toThrow();
  });
});

describe("findCasePages", () => {
  it("「N．見出し」で始まるページを見つけ、一覧ページは除く", () => {
    const pages = [
      "被害事例の一覧\n１．VPN\n２．クラウド",
      "26\n１．VPN装置の脆弱性",
      "27\n２．クラウド設定ミス",
    ];
    expect(findCasePages(pages, 1)).toEqual([2]);
    expect(findCasePages(pages, 2)).toEqual([3]);
    expect(findCasePages(pages, 9)).toEqual([]);
    expect(findCasePages(pages, 1, "脆弱性")).toEqual([2]);
    expect(findCasePages(pages, 1, "設定ミス")).toEqual([]);
  });
});

describe("extractHtml", () => {
  it("script を除いて本文と題を取り出す", () => {
    const html = `<html><head><title>記事の題</title><script>alert(1)</script></head>
<body><nav>メニュー</nav><article><h1>見出し</h1><p>${"攻撃者にVPN装置の脆弱性を悪用され、業務データが暗号化された。".repeat(10)}</p></article></body></html>`;
    const a = extractHtml(html, "https://example.com/x");
    expect(a.kind).toBe("html");
    expect(a.sourceUrl).toBe("https://example.com/x");
    expect(a.text).toContain("業務データが暗号化された");
    expect(a.text).not.toContain("alert(1)");
    expect(a.title).toBeTruthy();
  });
});

describe("fetchArticle(text)", () => {
  it("貼り付けたテキストをそのまま整える", async () => {
    const a = await fetchArticle({ kind: "text", text: " 本文 \n\n\n\n続き ", title: "題" });
    expect(a).toEqual({ kind: "text", text: "本文\n\n続き", title: "題" });
  });
});

describe.skipIf(!existsSync(ipaPdf))("extractPdf（IPA 事例集がキャッシュにあるときだけ）", () => {
  it("ページ指定と事例番号で同じページを取り出す", async () => {
    const data = new Uint8Array(readFileSync(ipaPdf));
    const byPage = await extractPdf(data, { pages: "27" });
    const byCase = await extractPdf(data, { caseNumber: 1, mustInclude: "想定被害額（" });
    expect(byPage.pages).toEqual([27]);
    expect(byCase.pages).toEqual([27]);
    expect(byPage.text).toContain("VPN装置の脆弱性");
    expect(byPage.totalPages).toBe(55);
  });
});

describe("trimTrailer / extractHtml（本文の後ろの関連記事などを落とす）", () => {
  it("後半にある「関連記事」以降を落とし、前半の PR という語では切らない", () => {
    const body = `${"攻撃者にVPN装置の脆弱性を悪用され、業務データが暗号化された。".repeat(8)}\nPR 担当者も確認した。\n${"バックアップも暗号化された。".repeat(8)}`;
    const text = `${body}\n（Security NEXT - 2025/01/27 ）\n\nPR\n\n関連記事GMOに身代金要求 - ランサム攻撃や情報公開を行うと脅迫\n「銀のさら」にサイバー攻撃、影響など調査`;
    const trimmed = trimTrailer(text);
    expect(trimmed).toContain("PR 担当者も確認した");
    expect(trimmed).toContain("（Security NEXT - 2025/01/27 ）");
    expect(trimmed).not.toContain("GMOに身代金要求");
    expect(trimmed).not.toContain("銀のさら");
  });
  it("extractHtml は関連記事の見出し一覧を本文に含めない", () => {
    const html = `<html><head><title>t</title></head><body><div class="main"><p>${"攻撃者にVPN装置の脆弱性を悪用され、業務データが暗号化された。".repeat(10)}</p><p>（Security NEXT - 2025/01/27 ）</p><p>関連記事<br>別の会社にランサム攻撃<br>さらに別の会社で情報流出</p></div></body></html>`;
    const a = extractHtml(html);
    expect(a.text).toContain("業務データが暗号化された");
    expect(a.text).not.toContain("別の会社にランサム攻撃");
    expect(a.htmlPages).toBe(1);
  });
});

describe("findNextPageUrl（記事の続きのページだけを辿る）", () => {
  const current = "https://www.security-next.com/166531";
  it("現在の URL にページ番号を足したリンクを見つける", () => {
    const html = `<div class="pnavi"><a href="https://www.security-next.com/166531/2"><img src="/x.gif"></a></div><a href="https://www.security-next.com/166999">別の記事</a>`;
    expect(findNextPageUrl(html, current)).toBe("https://www.security-next.com/166531/2");
    expect(findNextPageUrl(html, "https://www.security-next.com/166531/2")).toBeUndefined();
    expect(
      findNextPageUrl(`<a href="/166531/3">3</a>`, "https://www.security-next.com/166531/2"),
    ).toBe("https://www.security-next.com/166531/3");
  });
  it("rel=next もページ番号の形のときだけ辿り、別ホスト・別の記事・ブログの前後の記事は辿らない", () => {
    expect(findNextPageUrl(`<link rel="next" href="/166531?page=2">`, current)).toBe(
      "https://www.security-next.com/166531?page=2",
    );
    expect(
      findNextPageUrl(`<a rel="next" href="https://evil.example/166531/2">`, current),
    ).toBeUndefined();
    expect(
      findNextPageUrl(`<a href="https://www.security-next.com/166532">次の記事</a>`, current),
    ).toBeUndefined();
    expect(
      findNextPageUrl(`<a href="https://www.security-next.com/">トップ</a>`, current),
    ).toBeUndefined();
    // はてなブログの rel=next は別の日の記事を指す
    expect(
      findNextPageUrl(
        `<link rel="next" href="https://piyolog.hatenadiary.jp/entry/2026/08/01/010000">`,
        "https://piyolog.hatenadiary.jp/entry/2026/07/30/075612",
      ),
    ).toBeUndefined();
  });
});
