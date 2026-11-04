/**
 * 公開 URL（Cloudflare Tunnel など、PUBLIC_BASE_URL）経由の要求は、ベンダーの回答に要る API だけに絞る。
 *
 * 判定：転送元のヘッダ（cf-connecting-ip、x-forwarded-for、x-real-ip、forwarded）が付いていれば「外から」とみなす。
 * 手元のブラウザ → Vite のプロキシ → API の経路にはこれらのヘッダは付かない。
 * 外から使えるのは：GET /api/health、GET /api/sources、GET /api/requests/:token、POST /api/requests/:token/answer。
 * /api/sources は出典の一覧（公開された資料の名前と URL だけ。会社カルテを扱わない読み取り専用）で、共有リンクの一枚から行ける。
 * 送信箱の一覧（トークンを含む）、判定、読解、AI攻撃者などは手元からだけ。
 * UCHIDAI_ALLOW_REMOTE_API=1 で全面的に許す（自分で認証を前に置く場合）。
 */
import type { MiddlewareHandler } from "hono";
import { TOKEN_PATTERN } from "./store/requests.ts";

const FORWARDED_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip", "forwarded"];

export function isForwarded(headers: Headers): boolean {
  return FORWARDED_HEADERS.some((h) => headers.has(h));
}

/** 外から使ってよい API か */
export function allowedRemotely(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  if (method === "GET" && (path === "/api/health" || path === "/api/sources")) return true;
  const m = /^\/api\/requests\/([^/]+)(\/answer)?$/.exec(path);
  if (!m?.[1] || !TOKEN_PATTERN.test(m[1])) return false;
  if (m[2]) return method === "POST";
  return method === "GET";
}

export function remoteGuard(
  opts: { allowAll?: boolean } = { allowAll: process.env.UCHIDAI_ALLOW_REMOTE_API === "1" },
): MiddlewareHandler {
  return async (c, next) => {
    if (opts.allowAll || !isForwarded(c.req.raw.headers)) return next();
    if (allowedRemotely(c.req.method, c.req.path)) return next();
    return c.json(
      {
        error: "この操作は手元のサーバからだけ使えます（公開 URL からは回答ページだけ開けます）",
      },
      403,
    );
  };
}
