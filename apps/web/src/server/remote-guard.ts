/**
 * 公開 URL（Cloudflare Tunnel など）経由の要求は、一枚の共有リンクを開くのに要る API だけに絞る。
 * ベンダーの回答はメールの返信で受け取り、担当者が手元で入力するので、ベンダー向けの公開 API は無い。
 *
 * 判定：転送元のヘッダ（cf-connecting-ip、x-forwarded-for、x-real-ip、forwarded）が付いていれば「外から」とみなす。
 * 手元のブラウザ → Vite のプロキシ → API の経路にはこれらのヘッダは付かない。
 * 外から使えるのは：GET /api/health、GET /api/sources。
 * /api/sources は出典の一覧（公開された資料の名前と URL だけ。会社カルテを扱わない読み取り専用）で、共有リンクの一枚から行ける。
 * 送信箱の一覧、判定、読解、AI攻撃者などは手元からだけ。
 * UCHIDAI_ALLOW_REMOTE_API=1 で全面的に許す（自分で認証を前に置く場合）。
 */
import type { MiddlewareHandler } from "hono";

const FORWARDED_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip", "forwarded"];

export function isForwarded(headers: Headers): boolean {
  return FORWARDED_HEADERS.some((h) => headers.has(h));
}

/** 外から使ってよい API か */
export function allowedRemotely(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  return method === "GET" && (path === "/api/health" || path === "/api/sources");
}

export function remoteGuard(
  opts: { allowAll?: boolean } = { allowAll: process.env.UCHIDAI_ALLOW_REMOTE_API === "1" },
): MiddlewareHandler {
  return async (c, next) => {
    if (opts.allowAll || !isForwarded(c.req.raw.headers)) return next();
    if (allowedRemotely(c.req.method, c.req.path)) return next();
    return c.json(
      {
        error:
          "この操作は手元のサーバからだけ使えます（公開 URL から使えるのは出典の一覧だけです）",
      },
      403,
    );
  };
}
