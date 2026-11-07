/**
 * 記事の URL の安全確認：/api/case/read が取得してよいのは、公開された http(s) の記事だけ。
 * localhost・プライベートアドレス・リンクローカル・file: などへは向けない（SSRF の防止）。
 * リダイレクトも 1 段ごとに同じ確認を通す。
 *
 * - アドレスの判定は @uchidai/llm の isPrivateIp に寄せる（二重の検査が食い違わないように。SEC-008）
 * - 名前解決に失敗した・空だったホストは拒む（fail-open にしない。SEC-005）
 * - 検査で解決した IP に接続を固定する（SEC-005）：プロキシが無いときは undici の Agent の connect.lookup で、
 *   検査の結果の IP だけを返す。TLS の SNI と Host はホスト名のまま。プロキシ（HTTPS_PROXY）があるときは
 *   プロキシ側が名前を引くので固定できず、従来どおり「解決して内部なら拒否」だけになる
 * 外部確認（recon）とは別物で、ここは記事サイト・公的機関の資料の取得にだけ使う。
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateIp, lookupFetch, proxyFetch } from "@uchidai/llm";
import { isHttpProtocol } from "../shared/api.ts";
import { ClientError } from "./errors.ts";

export type Lookup = (hostname: string) => Promise<string[]>;

const defaultLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((a) => a.address);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".lan",
  ".intranet",
];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "broadcasthost",
]);

/** IP アドレス（文字列）が公開アドレスでなければ true（判定は llm 側の isPrivateIp と同じ） */
export function isBlockedAddress(ip: string): boolean {
  return isPrivateIp(ip.replace(/^\[|\]$/g, ""));
}

/**
 * URL の形だけで判定できる問題を返す（問題なければ undefined）。名前解決はしない。
 * 画面に出す日本語の理由を返す
 */
export function checkPublicUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "URL の形式が正しくありません";
  }
  if (!isHttpProtocol(u.protocol)) return "記事の URL は http か https だけ受け付けます";
  if (u.username || u.password) return "ユーザー名やパスワードを含む URL は受け付けません";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return "URL にホスト名がありません";
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)))
    return "手元のネットワークや社内のアドレスは記事の URL として受け付けません";
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) && isBlockedAddress(bare))
    return "手元のネットワークや社内のアドレスは記事の URL として受け付けません";
  if (!isIP(bare) && !host.includes("."))
    return "手元のネットワークや社内のアドレスは記事の URL として受け付けません";
  return undefined;
}

export type ResolvedPublicUrl = { url: URL; addresses: string[] };

/**
 * 形の確認に加えて名前解決の結果も確かめ、解決したアドレスを返す。
 * 問題があれば ClientError(400)。解決できない・空のときも拒む（取得側に判断を委ねない）
 */
export async function resolvePublicUrl(
  raw: string,
  lookup: Lookup = defaultLookup,
): Promise<ResolvedPublicUrl> {
  const reason = checkPublicUrl(raw);
  if (reason) throw new ClientError(400, reason);
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return { url: u, addresses: [host] };
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new ClientError(
      400,
      "記事の URL のホスト名を解決できませんでした。URL を確かめるか、本文を貼ってください",
    );
  }
  if (addrs.length === 0)
    throw new ClientError(
      400,
      "記事の URL のホスト名を解決できませんでした。URL を確かめるか、本文を貼ってください",
    );
  if (addrs.some(isBlockedAddress))
    throw new ClientError(
      400,
      "この URL は手元のネットワークや社内のアドレスを指しているため、記事として取得できません",
    );
  return { url: u, addresses: addrs };
}

/** 形の確認に加えて名前解決の結果も確かめる。問題があれば ClientError(400) */
export async function assertPublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  return (await resolvePublicUrl(raw, lookup)).url;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 5;

// ---------------------------------------------------------------------------
// 接続先の固定：検査で解決したアドレスだけを、取得時の名前解決として返す
// ---------------------------------------------------------------------------

/** 検査を通ったホスト名 → アドレス。guardedFetch が取得の直前に入れ、pinnedLookup が読む */
const pinned = new Map<string, string[]>();

export function pinAddresses(hostname: string, addresses: string[]): void {
  pinned.set(hostname.toLowerCase().replace(/\.$/, ""), addresses);
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * undici の connect.lookup に渡す関数。検査を通ったアドレスだけを返し、検査していないホストは拒む
 * （取得の途中で名前を引き直すことが無いので、DNS の付け替えの窓が閉じる）
 */
export function pinnedLookup(
  hostname: string,
  options: { all?: boolean } | number | undefined,
  callback: LookupCallback,
): void {
  const addrs = pinned.get(hostname.toLowerCase().replace(/\.$/, ""));
  const first = addrs?.[0];
  if (!first) {
    const err: NodeJS.ErrnoException = new Error(`検査を通っていないホスト: ${hostname}`);
    err.code = "ENOTFOUND";
    callback(err, "", undefined);
    return;
  }
  const family = (a: string) => (isIP(a) === 6 ? 6 : 4);
  if (typeof options === "object" && options?.all) {
    callback(
      null,
      addrs.map((address) => ({ address, family: family(address) })),
    );
    return;
  }
  callback(null, first, family(first));
}

let pinnedFetch: FetchLike | undefined;
/** 取得に使う fetch と、接続先を固定できるか。プロキシがあるときは固定できない（プロキシ側が名前を引く） */
export function pinningFetch(): { fetch: FetchLike; pinned: boolean } {
  const viaProxy = proxyFetch();
  if (viaProxy) return { fetch: viaProxy, pinned: false };
  pinnedFetch ??= lookupFetch(pinnedLookup as Parameters<typeof lookupFetch>[0]);
  return { fetch: pinnedFetch, pinned: true };
}

/**
 * リダイレクトを 1 段ずつ自分で追い、各段の URL を resolvePublicUrl に通す fetch。
 * 各段で解決したアドレスを pinAddresses で固定してから base を呼ぶ（base が pinningFetch の fetch なら接続先が固定される）。
 * llm の fetchArticle に渡す（redirect: "follow" は無視して manual で扱う）
 */
export function guardedFetch(base: FetchLike, lookup: Lookup = defaultLookup): FetchLike {
  return async (input, init) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (let hop = 0; ; hop++) {
      const { url: checked, addresses } = await resolvePublicUrl(url, lookup);
      pinAddresses(checked.hostname.replace(/^\[|\]$/g, ""), addresses);
      const res = await base(url, { ...init, redirect: "manual" });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) {
        if (res.status >= 300 && res.status < 400)
          throw new ClientError(400, "記事の URL の転送先が分かりませんでした");
        return res;
      }
      if (hop >= MAX_REDIRECTS)
        throw new ClientError(400, "記事の URL の転送（リダイレクト）が多すぎます");
      url = new URL(location, url).href;
    }
  };
}
