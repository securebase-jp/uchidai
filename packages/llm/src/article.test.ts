import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractHtml,
  extractPdf,
  fetchArticle,
  findCasePages,
  parsePageRange,
  tidyText,
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
