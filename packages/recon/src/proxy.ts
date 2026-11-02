/**
 * HTTP(S)_PROXY が設定された環境でも fetch が通るようにする（packages/llm/src/proxy.ts と同じ方針）。
 * ここで作る fetch は safe-fetch.ts の restrictedFetch からだけ呼ばれる。
 */
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

let proxied: FetchLike | undefined;

function proxyConfigured(): boolean {
  const env = process.env;
  return Boolean(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy);
}

/** プロキシが設定されていれば、それを経由する fetch を返す。無ければ undefined */
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
  return explicit ?? proxyFetch() ?? ((input, init) => fetch(input, init));
}
