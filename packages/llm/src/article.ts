/**
 * 記事の取り込み：URL（HTML / PDF）、PDF のバイト列、貼り付けたテキストの 3 通りを
 * 同じ形（Article）にそろえる。取得したテキストは信頼できないデータとして扱う。
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { extractText, getDocumentProxy } from "unpdf";
import { type FetchLike, resolveFetch } from "./proxy.ts";

export type ArticleInput =
  | { kind: "url"; url: string; pages?: string; caseNumber?: number; mustInclude?: string }
  | {
      kind: "pdf";
      data: Uint8Array;
      pages?: string;
      caseNumber?: number;
      /** caseNumber で探すとき、ページに含まれていなければならない語（章の区別用） */
      mustInclude?: string;
      sourceUrl?: string;
    }
  | { kind: "html"; html: string; sourceUrl?: string }
  | { kind: "text"; text: string; title?: string; sourceUrl?: string };

export type Article = {
  kind: "html" | "pdf" | "text";
  title?: string;
  text: string;
  sourceUrl?: string;
  /** PDF のとき、取り出したページ番号（1 始まり、PDF のページ順） */
  pages?: number[];
  totalPages?: number;
};

export type FetchOptions = {
  fetch?: FetchLike;
  /** 取得する最大バイト数（既定 20MB） */
  maxBytes?: number;
  /** タイムアウト（ms、既定 30 秒） */
  timeoutMs?: number;
};

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const USER_AGENT = "uchidai/0.0 (+https://github.com/securebase-jp/uchidai)";

/** URL からバイト列を取得する（記事サイト・公的機関の PDF 向け。自社ホストの調査には使わない） */
export async function downloadBytes(
  url: string,
  opts: FetchOptions = {},
): Promise<{ data: Uint8Array; contentType: string; finalUrl: string }> {
  const doFetch = resolveFetch(opts.fetch);
  const res = await doFetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf,*/*;q=0.8" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`取得に失敗しました: ${res.status} ${res.statusText} (${url})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (buf.byteLength > max)
    throw new Error(`取得したデータが大きすぎます: ${buf.byteLength} bytes`);
  return {
    data: buf,
    contentType: res.headers.get("content-type") ?? "",
    finalUrl: res.url || url,
  };
}

function isPdf(contentType: string, url: string, data: Uint8Array): boolean {
  if (/application\/pdf/i.test(contentType)) return true;
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  return data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === "%PDF-";
}

/** 本文テキストの整形：行頭行末の空白を落とし、3 行以上の空行を 1 行にする */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** linkedom の DOM のうち使う部分だけ（DOM の型定義に依存しないため） */
type MinimalElement = { textContent: string | null; remove(): void };
type MinimalDocument = {
  querySelectorAll(selector: string): Iterable<MinimalElement>;
  querySelector(selector: string): MinimalElement | null;
  body: MinimalElement | null;
  documentElement: MinimalElement | null;
};

/** HTML から本文を取り出す（Readability。失敗したら body のテキスト） */
export function extractHtml(html: string, sourceUrl?: string): Article {
  const { document } = parseHTML(html) as unknown as { document: MinimalDocument };
  for (const el of Array.from(document.querySelectorAll("script,style,noscript,template")))
    el.remove();
  let title = document.querySelector("title")?.textContent?.trim() ?? "";
  let text = "";
  try {
    const result = new Readability(document as never).parse();
    if (result?.textContent && result.textContent.trim().length > 0) {
      text = result.textContent;
      if (result.title) title = result.title;
    }
  } catch {
    // Readability が扱えない HTML は下の素朴な抽出に落とす
  }
  if (!text) text = document.body?.textContent ?? document.documentElement?.textContent ?? "";
  const article: Article = { kind: "html", text: tidyText(text) };
  if (title) article.title = title;
  if (sourceUrl) article.sourceUrl = sourceUrl;
  return article;
}

/** "27" / "27-29" / "27,29-30" のような指定を 1 始まりのページ番号の配列にする */
export function parsePageRange(spec: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(/[,\s、]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–〜~]\s*(\d+))?$/.exec(part.normalize("NFKC"));
    if (!m?.[1]) throw new Error(`ページ指定を解釈できません: "${part}"`);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from) throw new Error(`ページ指定が不正です: "${part}"`);
    for (let p = from; p <= Math.min(to, totalPages); p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/** PDF の全ページのテキスト（ページごと） */
export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  // pdf.js は渡したバッファを worker へ移譲（detach）するので、呼び出し側が再利用できるよう複製を渡す
  const pdf = await getDocumentProxy(data.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/**
 * 事例集の「N．見出し」で始まるページを探す（IPA 事例集のような、1 事例 1 ページ前後の資料向け）。
 * 一覧ページ（「一覧」を含む）は除く。複数の章が同じ番号を使うときは mustInclude で絞る。見つからなければ空配列。
 */
export function findCasePages(pages: string[], caseNumber: number, mustInclude?: string): number[] {
  const head = new RegExp(`^\\s*${caseNumber}\\s*[.．]\\s*\\S`, "m");
  const need = mustInclude ? mustInclude.normalize("NFKC") : undefined;
  const hits: number[] = [];
  pages.forEach((p, i) => {
    const t = p.normalize("NFKC");
    if (head.test(t) && !/一覧/.test(t) && (need === undefined || t.includes(need)))
      hits.push(i + 1);
  });
  return hits;
}

export async function extractPdf(
  data: Uint8Array,
  opts: { pages?: string; caseNumber?: number; mustInclude?: string; sourceUrl?: string } = {},
): Promise<Article> {
  const all = await extractPdfPages(data);
  let selected: number[];
  if (opts.pages) selected = parsePageRange(opts.pages, all.length);
  else if (opts.caseNumber !== undefined) {
    selected = findCasePages(all, opts.caseNumber, opts.mustInclude);
    if (selected.length === 0)
      throw new Error(`事例 ${opts.caseNumber} の見出しが PDF に見つかりません`);
  } else selected = all.map((_, i) => i + 1);
  const text = selected.map((p) => all[p - 1] ?? "").join("\n\n");
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 4 && !/^\d+$/.test(l));
  const article: Article = {
    kind: "pdf",
    text: tidyText(text),
    pages: selected,
    totalPages: all.length,
  };
  if (firstLine) article.title = firstLine;
  if (opts.sourceUrl) article.sourceUrl = opts.sourceUrl;
  return article;
}

/** 記事を取り込む。URL は HTML か PDF かを内容で判別する */
export async function fetchArticle(input: ArticleInput, opts: FetchOptions = {}): Promise<Article> {
  switch (input.kind) {
    case "text": {
      const a: Article = { kind: "text", text: tidyText(input.text) };
      if (input.title) a.title = input.title;
      if (input.sourceUrl) a.sourceUrl = input.sourceUrl;
      return a;
    }
    case "html":
      return extractHtml(input.html, input.sourceUrl);
    case "pdf": {
      const o: { pages?: string; caseNumber?: number; mustInclude?: string; sourceUrl?: string } =
        {};
      if (input.pages) o.pages = input.pages;
      if (input.caseNumber !== undefined) o.caseNumber = input.caseNumber;
      if (input.mustInclude) o.mustInclude = input.mustInclude;
      if (input.sourceUrl) o.sourceUrl = input.sourceUrl;
      return extractPdf(input.data, o);
    }
    case "url": {
      const { data, contentType, finalUrl } = await downloadBytes(input.url, opts);
      if (isPdf(contentType, finalUrl, data)) {
        const o: { pages?: string; caseNumber?: number; mustInclude?: string; sourceUrl?: string } =
          {
            sourceUrl: input.url,
          };
        if (input.pages) o.pages = input.pages;
        if (input.caseNumber !== undefined) o.caseNumber = input.caseNumber;
        if (input.mustInclude) o.mustInclude = input.mustInclude;
        return extractPdf(data, o);
      }
      const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
      let html: string;
      try {
        html = new TextDecoder(charset).decode(data);
      } catch {
        html = new TextDecoder("utf-8").decode(data);
      }
      const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(html)?.[1];
      if (meta && meta.toLowerCase() !== charset.toLowerCase()) {
        try {
          html = new TextDecoder(meta).decode(data);
        } catch {
          // 宣言された文字コードが使えないときは最初の解釈のまま
        }
      }
      return extractHtml(html, input.url);
    }
  }
}
