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
import { loadArticle } from "./article-source.ts";
import { ClientError, publicMessage } from "./errors.ts";

/** 連結した本文の上限（文字）。Claude に 1 回で読ませる大きさに収める */
export const MAX_SERIES_CHARS = 150_000;

export type SeriesPart = {
  /** 並べたあとの番号（1 始まり）。「第N報」のN。公表元の呼び名（第3報など）とは別で、この画面での順番 */
  number: number;
  label: string;
  /** 公表日（YYYY-MM-DD）。本文の先頭・題・URL から取れたときだけ */
  date?: string;
  url: string;
  title?: string;
  kind: Article["kind"];
  chars: number;
  /** 本文が途中で切れていそうな理由（HTML のとき）。画面の「続きが取得できていない可能性」の案内に使う */
  incomplete?: string[];
  truncated?: boolean;
};
export type SeriesFailure = { url: string; message: string };

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

/**
 * 公表日を、本文の先頭 1,000 字 → 題 → URL の順に探す。年が書かれた日付だけを採る
 * （「10月1日」のように年が無いものは、事故の日付のことが多いので採らない）
 */
export function detectPublishedDate(article: {
  text: string;
  title?: string;
  sourceUrl?: string;
}): string | undefined {
  const norm = (s: string) => s.normalize("NFKC");
  for (const src of [norm(article.text.slice(0, 1000)), norm(article.title ?? "")]) {
    const w = /令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(src);
    const a = /(20\d\d)\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/.exec(src);
    // 先に現れるほうを採る
    const hit = [
      w && {
        at: w.index,
        iso: isoOrUndefined(2018 + (w[1] === "元" ? 1 : Number(w[1])), Number(w[2]), Number(w[3])),
      },
      a && { at: a.index, iso: isoOrUndefined(Number(a[1]), Number(a[2]), Number(a[3])) },
    ]
      .filter(
        (x): x is { at: number; iso: string | undefined } => Boolean(x) && x?.iso !== undefined,
      )
      .sort((x, y) => x.at - y.at)[0];
    if (hit?.iso) return hit.iso;
  }
  const u = /\/(20\d\d)[-/]?(\d\d)[-/]?(\d\d)(?:\/|$|[^\d])/.exec(article.sourceUrl ?? "");
  return u ? isoOrUndefined(Number(u[1]), Number(u[2]), Number(u[3])) : undefined;
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
