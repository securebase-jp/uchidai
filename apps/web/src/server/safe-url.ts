/**
 * 記事の URL の安全確認：/api/case/read が取得してよいのは、公開された http(s) の記事だけ。
 * localhost・プライベートアドレス・リンクローカル・file: などへは向けない（SSRF の防止）。
 * リダイレクトも 1 段ごとに同じ確認を通す。
 *
 * 制限：名前解決は取得の直前に一度だけ行う（DNS の付け替えには追随しない）。
 * 外部確認（recon）とは別物で、ここは記事サイト・公的機関の資料の取得にだけ使う。
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
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

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a = 0, b = 0] = p;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10（共有アドレス）
    (a === 169 && b === 254) || // リンクローカル・クラウドのメタデータ
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 192 && b === 0) || // 192.0.0/24、192.0.2/24（文書用）
    (a === 198 && (b === 18 || b === 19)) || // ベンチマーク
    (a === 198 && b === 51) || // 198.51.100/24（文書用）
    (a === 203 && b === 0) || // 203.0.113/24（文書用）
    a >= 224 // マルチキャスト・予約・ブロードキャスト
  );
}

function ipv6Blocked(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  // IPv4 射影（::ffff:a.b.c.d）
  const mapped = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return ipv4Blocked(mapped[1]);
  const mappedHex = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (mappedHex?.[1] && mappedHex[2]) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    return ipv4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const head = v.split(":")[0] ?? "";
  const first = Number.parseInt(head || "0", 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ユニークローカル
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 リンクローカル
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 マルチキャスト
  if (first === 0x2001 && (v.split(":")[1] ?? "") === "db8") return true; // 文書用
  return false;
}

/** IP アドレス（文字列）が公開アドレスでなければ true */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ""));
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) return ipv6Blocked(ip);
  return true;
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
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return "記事の URL は http か https だけ受け付けます";
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

/** 形の確認に加えて名前解決の結果も確かめる。問題があれば ClientError(400) */
export async function assertPublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  const reason = checkPublicUrl(raw);
  if (reason) throw new ClientError(400, reason);
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return u;
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch {
    // 解決できないホストは、取得側が同じ理由で失敗する。ここでは止めない
    return u;
  }
  if (addrs.some(isBlockedAddress))
    throw new ClientError(
      400,
      "この URL は手元のネットワークや社内のアドレスを指しているため、記事として取得できません",
    );
  return u;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 5;

/**
 * リダイレクトを 1 段ずつ自分で追い、各段の URL を assertPublicUrl に通す fetch。
 * llm の fetchArticle に渡す（redirect: "follow" は無視して manual で扱う）
 */
export function guardedFetch(base: FetchLike, lookup: Lookup = defaultLookup): FetchLike {
  return async (input, init) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (let hop = 0; ; hop++) {
      await assertPublicUrl(url, lookup);
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
