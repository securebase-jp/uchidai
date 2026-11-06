/**
 * 同一生成元の確認（SEC-002、SEC-012）。
 * CORS は「応答を他の生成元に読ませない」だけで、要求の処理そのものは止めない。`text/plain` の単純リクエストは
 * プリフライト無しで届くので、悪意あるページが手元の API を叩いて、Claude の呼び出しや SMTP の送信を誘発できた。
 *
 * ここで止めるもの（/api/* の GET・HEAD・OPTIONS 以外。SSE の GET は別に見る）：
 * - `Sec-Fetch-Site` が `same-origin`・`none`（アドレス欄や curl）以外 → 403
 * - `Origin` があって、手元の生成元（corsOrigin）でない → 403
 * - POST・PUT・PATCH で `content-type` が `application/json` でない → 415
 * 画面（同じ生成元）、Vite のプロキシ、curl、`app.request` のテストは、どれも通る。
 */
import type { MiddlewareHandler } from "hono";

export type SameOriginOptions = {
  /** 許す生成元なら、その生成元を返す（app.ts の corsOrigin と同じ） */
  allowOrigin: (origin: string) => string | null;
  /** `Sec-Fetch-Site` を GET にも求めるパス（SSE のように、開きっぱなしの接続を他サイトから作れるもの） */
  guardedGetPaths?: readonly string[];
};

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** 他サイトのページからの要求か（ブラウザが付ける Sec-Fetch-Site と Origin で見る）。理由を返す。問題なければ undefined */
export function crossSiteReason(
  headers: Headers,
  allowOrigin: SameOriginOptions["allowOrigin"],
): string | undefined {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none")
    return "他のサイトのページからの要求";
  const origin = headers.get("origin");
  if (origin !== null && allowOrigin(origin) === null) return "手元以外の生成元からの要求";
  return undefined;
}

export function isJsonContentType(value: string | null): boolean {
  return value !== null && /^application\/json\s*(;|$)/i.test(value);
}

export function sameOriginGuard(opts: SameOriginOptions): MiddlewareHandler {
  const guardedGet = new Set(opts.guardedGetPaths ?? []);
  return async (c, next) => {
    const method = c.req.method;
    const headers = c.req.raw.headers;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      if (!guardedGet.has(c.req.path)) return next();
      const reason = crossSiteReason(headers, opts.allowOrigin);
      if (reason)
        return c.json({ error: `この操作は手元の画面からだけ使えます（${reason}）` }, 403);
      return next();
    }
    const reason = crossSiteReason(headers, opts.allowOrigin);
    if (reason) return c.json({ error: `この操作は手元の画面からだけ使えます（${reason}）` }, 403);
    if (BODY_METHODS.has(method) && !isJsonContentType(headers.get("content-type")))
      return c.json({ error: "この API は application/json の本文だけ受け付けます" }, 415);
    return next();
  };
}
