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
  resolveFetch,
} from "@uchidai/llm";
import type { z } from "zod";
import type { ReadRequest } from "../shared/api.ts";
import { ClientError } from "./errors.ts";
import { assertPublicUrl, guardedFetch, type Lookup } from "./safe-url.ts";

type ReadInput = z.infer<typeof ReadRequest>["input"];

/** 取得の失敗を、利用者に見せてよい 400 系のエラーにする。それ以外の例外はそのまま返す */
export function toClientError(e: unknown): unknown {
  if (!(e instanceof ArticleFetchError)) return e;
  // 転送先の検査（内部のアドレスなど）で止めたときは、その理由をそのまま見せる
  if (e.cause instanceof ClientError) return e.cause;
  return new ClientError(400, e.message);
}

export async function loadArticle(
  input: ReadInput,
  opts: { fetch?: FetchLike; lookup?: Lookup } = {},
): Promise<Article> {
  try {
    if (input.kind === "url") {
      await assertPublicUrl(input.url, opts.lookup);
      return await fetchArticle(
        { kind: "url", url: input.url, ...(input.pages ? { pages: input.pages } : {}) },
        {
          fetch: guardedFetch(opts.fetch ?? resolveFetch(), opts.lookup),
          ...(opts.lookup ? { lookup: opts.lookup } : {}),
        },
      );
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
