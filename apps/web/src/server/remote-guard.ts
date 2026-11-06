/**
 * 公開 URL（Cloudflare Tunnel など）経由の要求は、一枚の共有リンクを開くのに要る API だけに絞る。
 * ベンダーの回答はメールの返信で受け取り、担当者が手元で入力するので、ベンダー向けの公開 API は無い。
 *
 * 判定（どれかに当たれば「外から」）：
 * - 転送元のヘッダ（cf-connecting-ip、x-forwarded-for、x-real-ip、forwarded）が付いている。
 *   手元のブラウザ → Vite のプロキシ → API の経路にはこれらのヘッダは付かない
 * - 接続元のアドレスがループバック（127.0.0.0/8、::1）でない（SEC-004）。転送ヘッダを足さない中継や、
 *   `API_HOST=0.0.0.0` での直接公開を、手元扱いにしないため。接続元が取れないとき（`app.request` のテスト）は見ない
 *   - Docker はコンテナの中で 0.0.0.0 で待ち受け、ホストからの `-p 127.0.0.1:8787:8787` の接続はブリッジの
 *     私設アドレス（172.17.0.1 など）から来る。Dockerfile が `UCHIDAI_TRUST_PRIVATE_PEER=1` を既定で設定し、
 *     公開アドレスでない接続元は手元扱いにする（公開するのはホスト側の `-p 127.0.0.1:` で絞る）
 * 外から使えるのは：GET /api/health、GET /api/sources。
 * /api/sources は出典の一覧（公開された資料の名前と URL だけ。会社カルテを扱わない読み取り専用）で、共有リンクの一枚から行ける。
 * 送信箱の一覧、判定、読解、AI攻撃者などは手元からだけ。
 * UCHIDAI_ALLOW_REMOTE_API=1 で全面的に許す（自分で認証を前に置く場合）。
 */
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { isBlockedAddress } from "./safe-url.ts";

const FORWARDED_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip", "forwarded"];

export function isForwarded(headers: Headers): boolean {
  return FORWARDED_HEADERS.some((h) => headers.has(h));
}

/** ループバックのアドレスか（127.0.0.0/8、::1、::ffff:127.0.0.0/8） */
export function isLoopback(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (a === "::1") return true;
  const v4 = /^(?:::ffff:)?(\d+)\.\d+\.\d+\.\d+$/.exec(a);
  if (v4) return v4[1] === "127";
  // ::ffff:7f00:1 のような 16 進の射影
  const hex = /^(?:0*:)*ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(a);
  return hex !== null && Number.parseInt(hex[1] ?? "", 16) >> 8 === 127;
}

/** 接続元のアドレス。Node のサーバ以外（app.request のテストなど）では取れないので undefined */
export function peerAddress(c: Context): string | undefined {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === "string" && address ? address : undefined;
  } catch {
    return undefined;
  }
}

export type RemoteGuardOptions = {
  allowAll?: boolean;
  /** 公開アドレスでない接続元（私設・リンクローカルなど）も手元扱いにする（Docker の既定） */
  trustPrivatePeer?: boolean;
};

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): RemoteGuardOptions {
  return {
    allowAll: env.UCHIDAI_ALLOW_REMOTE_API === "1",
    trustPrivatePeer: env.UCHIDAI_TRUST_PRIVATE_PEER === "1",
  };
}

/** 外からの要求か。転送ヘッダ、または接続元のアドレスで決める */
export function isRemote(c: Context, opts: RemoteGuardOptions = {}): boolean {
  if (isForwarded(c.req.raw.headers)) return true;
  const peer = peerAddress(c);
  if (peer === undefined) return false;
  if (isLoopback(peer)) return false;
  if (opts.trustPrivatePeer && isBlockedAddress(peer)) return false;
  return true;
}

/** 外から使ってよい API か */
export function allowedRemotely(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  return method === "GET" && (path === "/api/health" || path === "/api/sources");
}

export function remoteGuard(opts: RemoteGuardOptions = optionsFromEnv()): MiddlewareHandler {
  return async (c, next) => {
    if (opts.allowAll || !isRemote(c, opts)) return next();
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
