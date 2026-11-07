/**
 * /api/case/read の記事の取り込み。URL・本文・PDF を同じ形（Article）にする。
 * 取得の失敗（404、ログイン・有料の壁、タイムアウト、接続できない、読めない PDF など）は、
 * 500 ではなく 400 系の ClientError にして、日本語の案内（本文を貼って読むこともできます）を返す（TRIAL-012）。
 */
import {
  type Article,
  ArticleFetchError,
  type FetchLike,
  fetchArticle,
  isUnreadableThinBody,
} from "@uchidai/llm";
import type { z } from "zod";
import type { FetchFailReason, ReadRequest } from "../shared/api.ts";
import { ClientError } from "./errors.ts";
import { assertPublicUrl, guardedFetch, type Lookup, pinningFetch } from "./safe-url.ts";

type ReadInput = Exclude<z.infer<typeof ReadRequest>["input"], { kind: "urls" }>;

/** 取得の失敗を、利用者に見せてよい 400 系のエラーにする。それ以外の例外はそのまま返す */
export function toClientError(e: unknown): unknown {
  if (!(e instanceof ArticleFetchError)) return e;
  // 転送先の検査（内部のアドレスなど）で止めたときは、その理由をそのまま見せる
  if (e.cause instanceof ClientError) return e.cause;
  return new ClientError(400, e.message, failReasonOf(e.kind));
}

/** 取得の失敗の種類を、画面が案内を出し分ける理由にする */
export function failReasonOf(kind: ArticleFetchError["kind"]): FetchFailReason {
  switch (kind) {
    case "forbidden":
      return "forbidden";
    case "not_found":
      return "not_found";
    case "empty":
      return "empty";
    case "bad_pdf":
      return "bad_pdf";
    default:
      return "other";
  }
}

/** 読解が「対象外・段階なし」だったとき、本文がこれより短ければ、本文が取れていないとみなす文字数 */
export const THIN_BODY_CHARS = 300;

/**
 * 本文がほとんど取れなかったときの案内（TRIAL-I-002）。取得は成功しても、同意の画面や読み込み後に表示されるページは、
 * 数十〜百数十字しか取れない。そのまま読むと「対象外」の一枚になるので、読む前に止めて、取り直す方法を案内する
 */
export function thinBodyError(chars: number): ClientError {
  return new ClientError(
    422,
    `本文がほとんど取れませんでした（${chars} 字）。ページが読み込み後に表示される作りか、同意の画面かもしれません。PDF の版があればその URL、または本文を貼ってください`,
    "thin",
  );
}

/** 保険：読解が「段階なし・対象外」で、本文が短い（THIN_BODY_CHARS 未満）なら、本文が取れていなかったとみなす */
export function isThinReading(
  read: { steps: readonly unknown[]; damageType: string },
  textChars: number,
): boolean {
  return (
    read.steps.length === 0 && read.damageType === "out_of_scope" && textChars < THIN_BODY_CHARS
  );
}

/**
 * 本文が取れていない HTML か（同意文・著作権表示だけ、または 200 字未満で事故の語が無い／80 字未満）。
 * 200 字未満でも事故の公表らしい語がある 80 字以上は読む（#2）。URL・HTML の入力だけが対象で、貼り付けの短い文は対象外
 */
function isThinHtml(article: Article): boolean {
  return (
    article.kind === "html" &&
    (article.incomplete?.includes("too_short") === true ||
      article.incomplete?.includes("consent_only") === true) &&
    isUnreadableThinBody(article.text)
  );
}

export async function loadArticle(
  input: ReadInput,
  opts: { fetch?: FetchLike; lookup?: Lookup } = {},
): Promise<Article> {
  try {
    if (input.kind === "url") {
      await assertPublicUrl(input.url, opts.lookup);
      const article = await fetchArticle(
        { kind: "url", url: input.url, ...(input.pages ? { pages: input.pages } : {}) },
        {
          // 検査で解決したアドレスに接続を固定する fetch（プロキシがあるときは固定しない。SEC-005）
          fetch: guardedFetch(opts.fetch ?? pinningFetch().fetch, opts.lookup),
          ...(opts.lookup ? { lookup: opts.lookup } : {}),
        },
      );
      if (isThinHtml(article)) throw thinBodyError(article.text.replace(/\s+/g, "").length);
      return article;
    }
    if (input.kind === "text")
      return await fetchArticle({
        kind: "text",
        text: input.text,
        ...(input.title ? { title: input.title } : {}),
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      });
    return await fetchArticle({
      kind: "pdf",
      data: new Uint8Array(Buffer.from(input.dataBase64, "base64")),
      ...(input.pages ? { pages: input.pages } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    });
  } catch (e) {
    throw toClientError(e);
  }
}
