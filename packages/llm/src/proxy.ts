/**
 * HTTP(S)_PROXY が設定された環境（社内プロキシ、開発用サンドボックス）でも fetch が通るようにする。
 * Node 標準の fetch はプロキシの環境変数を見ないので、undici の fetch と EnvHttpProxyAgent を使う。
 */
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let proxied: FetchLike | undefined;

function proxyConfigured(): boolean {
  const env = process.env;
  return Boolean(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
}

/**
 * プロキシが設定されていれば、それを経由する fetch を返す。無ければ undefined（標準の fetch を使う）。
 * undici の fetch と標準の fetch は型が少し違うので、ここで標準の形に合わせる
 */
export function proxyFetch(): FetchLike | undefined {
  if (!proxyConfigured()) return undefined;
  if (!proxied) {
    const dispatcher = new EnvHttpProxyAgent();
    proxied = (input, init) =>
      undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
      }) as unknown as Promise<Response>;
  }
  return proxied;
}

/** 使う fetch：明示されたもの → プロキシ経由 → 標準 */
export function resolveFetch(explicit?: FetchLike): FetchLike {
  return explicit ?? proxyFetch() ?? fetch;
}
