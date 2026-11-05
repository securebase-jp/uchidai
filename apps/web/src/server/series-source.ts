/**
 * 同じ事故の複数の公表（第一報と続報など）を 1 件として読むための取り込み（TRIAL-I-005 の (b)）。
 * - 各 URL を既存どおり取得・本文抽出する（HTML・PDF とも。loadArticle をそのまま使う）
 * - 公表日が全部取れたときは日付順、取れないものがあるときは指定順に並べる
 * - 各報に「第N報」「日付」の見出しを付けて連結する。連結した本文は 1 件の記事として、既存の仕組み
 *   （信頼できないデータとして指示文と分けて渡す、zod 検証、根拠文の照合）に通す
 * - 根拠文（quote）がどの報から来たかを、連結前の本文との照合で決める（Claude の申告は使わない）
 */

import type { Case } from "@uchidai/engine";
import { type Article, normalizeText } from "@uchidai/llm";
import type { SeriesFailure, SeriesPartInfo } from "../shared/api.ts";
import { loadArticle } from "./article-source.ts";
import { ClientError, publicMessage } from "./errors.ts";

/** 連結した本文の上限（文字）。Claude に 1 回で読ませる大きさに収める */
export const MAX_SERIES_CHARS = 150_000;

export type SeriesPart = SeriesPartInfo;

export type { SeriesFailure };
export type LoadedSeries = {
  parts: (SeriesPart & { text: string })[];
  failures: SeriesFailure[];
  /** 並べ方：date = 公表日の順、given = 指定された順 */
  order: "date" | "given";
  /** 連結した本文（見出し付き） */
  text: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
function isoOrUndefined(y: number, m: number, d: number): string | undefined {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100
    ? `${y}-${pad(m)}-${pad(d)}`
    : undefined;
}

/** 本文の先頭の何文字までを、公表日が書かれる見出しの位置とみなすか。それより後ろの日付は、事故の日などが多いので採らない */
const HEADER_CHARS = 200;

/** 日付のあとに続くと、公表日ではなく出来事の日（事故が起きた日、判明した日、調査の日付）を指す言い方 */
const EVENT_DATE_TAIL = "(?!\\s*(?:に|で|頃|ごろ|以降|以来|から|まで|時点|付|現在))";

/**
 * 公表日を、URL → 本文の先頭（見出しの位置）→ 題の順に探す。年が書かれた日付だけを採る。
 * IR の URL（/20251003-0104.html、/pdf/20251003.pdf）の日付は公表日のことが多い。本文の日付は、
 * 「2025年9月29日に発生した…」のような出来事の日を公表日と取り違えると続報の順が逆になるので、
 * 先頭だけを見て、出来事の日を指す言い方が続く日付は採らない。取れなければ、並べ方は指定順になる
 */
export function detectPublishedDate(article: {
  text: string;
  title?: string;
  sourceUrl?: string;
}): string | undefined {
  const norm = (s: string) => s.normalize("NFKC");
  const inText = (src: string): string | undefined => {
    const w = new RegExp(
      `令和\\s*(\\d{1,2}|元)\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日${EVENT_DATE_TAIL}`,
    ).exec(src);
    const a = new RegExp(
      `(20\\d\\d)\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日${EVENT_DATE_TAIL}|(20\\d\\d)[/.-](\\d{1,2})[/.-](\\d{1,2})(?!\\d)`,
    ).exec(src);
    // 先に現れるほうを採る
    const hits = [
      w && {
        at: w.index,
        iso: isoOrUndefined(2018 + (w[1] === "元" ? 1 : Number(w[1])), Number(w[2]), Number(w[3])),
      },
      a && {
        at: a.index,
        iso: isoOrUndefined(Number(a[1] ?? a[4]), Number(a[2] ?? a[5]), Number(a[3] ?? a[6])),
      },
    ].filter(
      (x): x is { at: number; iso: string | undefined } => Boolean(x) && x?.iso !== undefined,
    );
    return hits.sort((x, y) => x.at - y.at)[0]?.iso;
  };
  const u = /\/(20\d\d)[-/]?(\d\d)[-/]?(\d\d)(?:\/|$|[^\d])/.exec(article.sourceUrl ?? "");
  if (u) {
    const iso = isoOrUndefined(Number(u[1]), Number(u[2]), Number(u[3]));
    if (iso) return iso;
  }
  const fromHeader = inText(norm(article.text.slice(0, HEADER_CHARS)));
  if (fromHeader) return fromHeader;
  return inText(norm(article.title ?? ""));
}

/** 取得に失敗した公表があるとき（onError: "fail"）。どの URL がなぜ失敗したかを、画面が一覧にできるよう failures に持つ */
export class SeriesFetchError extends ClientError {
  readonly failures: SeriesFailure[];
  constructor(message: string, failures: SeriesFailure[]) {
    super(400, message);
    this.name = "SeriesFetchError";
    this.failures = failures;
  }
}

export type SeriesDeps = { loadArticle?: typeof loadArticle };

/** 失敗の理由を、利用者に見せてよい文にする（ClientError はそのまま、それ以外は一般的な文） */
function failureMessage(e: unknown): string {
  return e instanceof ClientError ? e.message : publicMessage(e, "取得できませんでした");
}

export async function loadSeries(
  urls: string[],
  onError: "fail" | "skip",
  deps: SeriesDeps = {},
): Promise<LoadedSeries> {
  const load = deps.loadArticle ?? loadArticle;
  // 同じ URL を二度渡されても一度だけ読む
  const unique = [...new Set(urls)];
  const results = await Promise.all(
    unique.map(async (url) => {
      try {
        return { url, article: await load({ kind: "url", url }) } as const;
      } catch (e) {
        return { url, error: failureMessage(e) } as const;
      }
    }),
  );
  const failures: SeriesFailure[] = results.flatMap((r) =>
    "error" in r ? [{ url: r.url, message: r.error }] : [],
  );
  if (failures.length > 0 && (onError === "fail" || failures.length === unique.length)) {
    const head =
      failures.length === unique.length
        ? "どの公表も取得できませんでした"
        : `${failures.length} 件の公表を取得できませんでした`;
    throw new SeriesFetchError(
      `${head}。${failures.map((f) => `${f.url}：${f.message}`).join(" ／ ")}`,
      failures,
    );
  }
  const ok = results.flatMap((r) =>
    "article" in r
      ? [{ url: r.url, article: r.article, date: detectPublishedDate(r.article) }]
      : [],
  );
  const allDated = ok.every((x) => x.date !== undefined);
  const ordered = allDated
    ? ok
        .map((x, i) => ({ x, i }))
        .sort((a, b) => (a.x.date as string).localeCompare(b.x.date as string) || a.i - b.i)
        .map(({ x }) => x)
    : ok;
  const parts = ordered.map((x, i) => {
    const title = x.article.title?.replace(/\s+/g, " ").trim();
    return {
      number: i + 1,
      label: `第${i + 1}報`,
      ...(x.date ? { date: x.date } : {}),
      url: x.url,
      ...(title ? { title } : {}),
      kind: x.article.kind,
      chars: x.article.text.length,
      ...(x.article.incomplete ? { incomplete: x.article.incomplete as string[] } : {}),
      ...(x.article.truncated ? { truncated: true } : {}),
      text: x.article.text,
    };
  });
  const text = parts
    .map(
      (p) =>
        `【${p.label}${p.date ? `｜${p.date}` : ""}${p.title ? `｜${p.title.slice(0, 120)}` : ""}】\n${p.text}`,
    )
    .join("\n\n");
  if (text.length > MAX_SERIES_CHARS)
    throw new ClientError(
      422,
      `公表を合わせると長すぎます（${text.length} 字。上限 ${MAX_SERIES_CHARS} 字）。件数を減らしてください`,
    );
  return { parts, failures, order: allDated ? "date" : "given", text };
}

/**
 * 各段階の根拠文（quote）が、どの報の本文に実在するか（報の番号の列）。
 * 連結前の各報の本文と、検証と同じ規則（空白・全角半角の揺れを吸収）で照合する。どの報にも無ければ null
 */
export function quoteSources(
  theCase: Pick<Case, "steps">,
  parts: readonly { number: number; text: string }[],
): (number[] | null)[] {
  const normalized = parts.map((p) => ({ number: p.number, text: normalizeText(p.text) }));
  return theCase.steps.map((s) => {
    if (!s.quote) return null;
    const q = normalizeText(s.quote);
    const hits = normalized.filter((p) => p.text.includes(q)).map((p) => p.number);
    return hits.length > 0 ? hits : null;
  });
}
