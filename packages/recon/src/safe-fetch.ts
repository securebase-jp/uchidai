/**
 * ネットワークに出る HTTP は、この 1 か所だけ。宛先は証明書の公開ログの検索サービス 2 つの URL に限定する。
 *
 * - crt.sh：`https://crt.sh/?q=%25.<domain>&output=json`
 * - Cert Spotter（crt.sh が空か失敗のときの予備）：
 *   `https://api.certspotter.com/v1/issuances?domain=<domain>&include_subdomains=true&expand=dns_names&expand=issuer`
 *
 * 所有確認したドメインであっても、そのホストへ HTTP/TLS でつなぐ経路をコード上に作らない。
 * fetch を呼ぶ前に URL を検査し、上の 2 形以外（別ホスト、別パス、余分なクエリ、認証情報、
 * フラグメント、http）は拒否する。リダイレクトも追わない（別ホストへ連れて行かれないため）。
 */
import { type FetchLike, resolveFetch } from "./proxy.ts";
import { Hostname, normalizeDomain } from "./types.ts";

export const CRTSH_ORIGIN = "https://crt.sh";
export const CERTSPOTTER_ORIGIN = "https://api.certspotter.com";
const CERTSPOTTER_PATH = "/v1/issuances";
const CRTSH_SEARCH = /^\?q=%25\.([a-z0-9.-]+)&output=json$/;
const CERTSPOTTER_SEARCH =
  /^\?domain=([a-z0-9.-]+)&include_subdomains=true&expand=dns_names&expand=issuer$/;

export class ForbiddenDestinationError extends Error {
  readonly url: string;
  constructor(url: string, reason: string) {
    super(
      `外部確認は crt.sh の JSON 出力と Cert Spotter の発行記録（api.certspotter.com/v1/issuances）以外へ接続しない（${reason}）: ${url}`,
    );
    this.name = "ForbiddenDestinationError";
    this.url = url;
  }
}

/** crt.sh でドメインのサブドメイン一覧を得る URL。ドメインは検証してから埋め込む */
export function crtshUrl(domain: string): URL {
  const normalized = normalizeDomain(domain);
  return new URL(`${CRTSH_ORIGIN}/?q=%25.${normalized}&output=json`);
}

/** Cert Spotter でドメインとサブドメインの発行記録を得る URL。ドメインは検証してから埋め込む */
export function certspotterUrl(domain: string): URL {
  const normalized = normalizeDomain(domain);
  return new URL(
    `${CERTSPOTTER_ORIGIN}${CERTSPOTTER_PATH}?domain=${normalized}&include_subdomains=true&expand=dns_names&expand=issuer`,
  );
}

/** 許可した URL か。違えば ForbiddenDestinationError */
export function assertAllowedUrl(input: string | URL): URL {
  const text = typeof input === "string" ? input : input.href;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ForbiddenDestinationError(text, "URL として解釈できない");
  }
  const isCrtsh = url.origin === CRTSH_ORIGIN;
  if (!isCrtsh && url.origin !== CERTSPOTTER_ORIGIN) {
    throw new ForbiddenDestinationError(text, "許可外のホスト");
  }
  if (url.username || url.password) throw new ForbiddenDestinationError(text, "認証情報つき");
  if (url.pathname !== (isCrtsh ? "/" : CERTSPOTTER_PATH)) {
    throw new ForbiddenDestinationError(text, "許可外のパス");
  }
  if (url.hash) throw new ForbiddenDestinationError(text, "フラグメントつき");
  const m = (isCrtsh ? CRTSH_SEARCH : CERTSPOTTER_SEARCH).exec(url.search);
  if (!m?.[1] || !Hostname.safeParse(m[1]).success) {
    throw new ForbiddenDestinationError(text, "許可外のクエリ");
  }
  return url;
}

/** 応答の本文の大きさの上限（既定 10MB）。content-length と受信量の両方で打ち切る（SEC-009） */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  constructor(max: number) {
    super(`応答が大きすぎる（上限 ${max} バイト）`);
    this.name = "ResponseTooLargeError";
  }
}

/** 本文を上限まで読んで文字列にする。上限を超えたら途中で止めて ResponseTooLargeError */
export async function readLimitedText(res: Response, max = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(max);
  }
  if (!res.body) {
    const text = await res.text();
    if (text.length > max) throw new ResponseTooLargeError(max);
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(max);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(out);
}

export interface RestrictedFetchOptions {
  /** 差し替え用（テストではここに偽の fetch を渡す）。検査を通った URL でしか呼ばれない */
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** 検査を通った URL だけを GET する fetch。本文以外のオプションは受け取らない */
export async function restrictedFetch(
  input: string | URL,
  options: RestrictedFetchOptions = {},
): Promise<Response> {
  const url = assertAllowedUrl(input);
  const base = resolveFetch(options.fetch);
  return base(url, {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json", "user-agent": "uchidai-recon/0.0 (+DNS/CT only)" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
}
