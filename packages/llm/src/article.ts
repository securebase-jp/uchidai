/**
 * 記事の取り込み：URL（HTML / PDF）、PDF のバイト列、貼り付けたテキストの 3 通りを
 * 同じ形（Article）にそろえる。取得したテキストは信頼できないデータとして扱う。
 *
 * URL の取得は公開の記事サイト・公的機関の PDF だけが対象。自社ホストの調査には使わない設計に合わせて、
 * - http / https 以外、認証情報つき URL、localhost・内部用の名前、私設・ループバック・リンクローカル・
 *   メタデータ（169.254.169.254）などの IP に向く URL は拒否する（ホスト名は解決した先の IP でも確認する）
 * - リダイレクトは 1 回ごとに同じ検査をして辿る（最大 5 回）
 * - 受信は上限バイト数（既定 20MB）で打ち切り、全体にタイムアウト（既定 30 秒）をかける。同時の取得は 3 件まで（超えた分は待つ）
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchSemaphore } from "./limits.ts";
import { type FetchLike, resolveFetch } from "./proxy.ts";

/** 取得に失敗したときの案内（どの失敗にも付ける。本文を貼れば、取得を介さずに読める） */
export const PASTE_HINT_JA = "記事の本文を貼って読むこともできます。";

/** 記事の取得・取り込みの失敗の種類 */
export type ArticleFetchErrorKind =
  | "not_found" // 404・410
  | "forbidden" // 401・402・403・451（ログインや有料の壁、取得の拒否）
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "http_error" // その他の HTTP エラー
  | "timeout"
  | "network" // 接続できない
  | "dns" // ホスト名が引けない
  | "rejected" // URL の検査で取得しないと決めた（内部ネットワークなど）
  | "too_large"
  | "redirect"
  | "empty" // 本文を取り出せなかった
  | "bad_pdf"
  | "bad_input"; // ページ指定など、入力の誤り

/**
 * 記事を取得できなかった・取り込めなかった。message は利用者にそのまま見せてよい日本語
 * （技術的な詳細は detail と cause に残し、画面には出さない）。サーバはこれを 400 系で返す
 */
export class ArticleFetchError extends Error {
  readonly kind: ArticleFetchErrorKind;
  readonly status: number | undefined;
  readonly detail: string | undefined;
  constructor(
    kind: ArticleFetchErrorKind,
    message: string,
    opts: { status?: number; detail?: string; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ArticleFetchError";
    this.kind = kind;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

/** 取得を断られた応答の本文に、ログインや会員登録を求める語があるか（企業の IR ページの単なる拒否と区別する） */
const LOGIN_WORDS = /ログイン|会員登録|サインイン|無料登録|sign[\s-]?in|log[\s-]?in/i;

/** 自動での取得を断られた（403）ときの、次の手の案内。「ログインの壁」とは決めつけず、本文にログインの語があるときだけそう案内する */
const FORBIDDEN_PDF_HINT_JA = "PDF の版や、本文の貼り付けをお試しください。";

/** HTTP のエラー応答を、利用者向けの案内にする。errorBody は断られた応答の本文の先頭（任意。403 の案内を分けるのに使う） */
export function httpErrorToFetchError(status: number, errorBody?: string): ArticleFetchError {
  const opts = { status, detail: `HTTP ${status}` };
  if (status === 404 || status === 410)
    return new ArticleFetchError(
      "not_found",
      `記事が見つかりませんでした（${status}）。URL を確かめるか、${PASTE_HINT_JA}`,
      opts,
    );
  if (status === 403) {
    const wall = errorBody !== undefined && LOGIN_WORDS.test(errorBody);
    return new ArticleFetchError(
      "forbidden",
      wall
        ? `この記事は、ログインや会員登録が必要なため、取得を断られました（${status}）。${PASTE_HINT_JA}`
        : `サイトが自動での取得を断りました（${status}）。${FORBIDDEN_PDF_HINT_JA}`,
      opts,
    );
  }
  if (status === 401 || status === 402 || status === 451)
    return new ArticleFetchError(
      "forbidden",
      `この記事は、ログインや会員登録が必要、または取得を断られました（${status}）。${PASTE_HINT_JA}`,
      opts,
    );
  if (status === 429)
    return new ArticleFetchError(
      "rate_limited",
      `記事のサイトが、短い間に続けた取得を断りました（${status}）。しばらくしてからやり直すか、${PASTE_HINT_JA}`,
      opts,
    );
  if (status >= 500)
    return new ArticleFetchError(
      "server_error",
      `記事のサイトが応答しませんでした（${status}）。しばらくしてからやり直すか、${PASTE_HINT_JA}`,
      opts,
    );
  return new ArticleFetchError(
    "http_error",
    `記事を取得できませんでした（${status}）。${PASTE_HINT_JA}`,
    opts,
  );
}

export type ArticleInput =
  | { kind: "url"; url: string; pages?: string; caseNumber?: number; mustInclude?: string }
  | {
      kind: "pdf";
      data: Uint8Array;
      pages?: string;
      caseNumber?: number;
      /** caseNumber で探すとき、ページに含まれていなければならない語（章の区別用） */
      mustInclude?: string;
      sourceUrl?: string;
    }
  | { kind: "html"; html: string; sourceUrl?: string }
  | { kind: "text"; text: string; title?: string; sourceUrl?: string };

export type Article = {
  kind: "html" | "pdf" | "text";
  title?: string;
  text: string;
  sourceUrl?: string;
  /** PDF のとき、取り出したページ番号（1 始まり、PDF のページ順） */
  pages?: number[];
  totalPages?: number;
  /** 本文が長すぎて MAX_TEXT_CHARS で切ったとき true */
  truncated?: boolean;
  /** HTML のとき、取り込んだページ数（記事サイトの「次のページ」を辿った数。1 なら分割なし） */
  htmlPages?: number;
  /** HTML のとき、本文が途中で切れていそうな理由（無ければ付かない。画面で「続きが取得できていない可能性」と案内する） */
  incomplete?: IncompleteReason[];
};

/**
 * 本文が途中で切れていそうな理由：members_only 会員向けの案内がある／ends_with_heading 末尾が見出しだけ／read_more 末尾が「続きを読む」／
 * too_short 本文が 200 字に満たない（読み込み後に表示されるページなど。TRIAL-I-002）／consent_only Cookie の同意文・著作権表示だけ
 */
export type IncompleteReason =
  | "members_only"
  | "ends_with_heading"
  | "read_more"
  | "too_short"
  | "consent_only";

/** 本文として「ほとんど取れていない」とみなす文字数（これ未満は too_short） */
export const TOO_SHORT_CHARS = 200;
/** 同意文・著作権表示だけのページと見なすときの上限の文字数（これ未満で、同意の語があり、事故の語が無いとき consent_only） */
const CONSENT_ONLY_MAX_CHARS = 400;
const CONSENT_WORDS = /cookie|クッキー|同意|copyright|©|著作権|all rights reserved|プライバシー/i;
/** 事故の公表らしい語。これがあれば、短くても同意文だけとは見なさない */
const INCIDENT_WORDS = /不正アクセス|ランサム|サイバー攻撃|漏えい|漏洩|感染|被害|インシデント|侵入/;

export type FetchOptions = {
  fetch?: FetchLike;
  /** 取得する最大バイト数（既定 20MB） */
  maxBytes?: number;
  /** タイムアウト（ms、既定 30 秒。リダイレクトと本文の受信を含む全体） */
  timeoutMs?: number;
  /** 辿るリダイレクトの最大回数（既定 5） */
  maxRedirects?: number;
  /** ホスト名を IP アドレスに解決する関数（テストで差し替える）。既定は dns.lookup */
  lookup?: (hostname: string) => Promise<string[]>;
  /** 取得を禁じるホスト（自社のドメインなど。そのホストとサブドメインに一致） */
  blockedHosts?: string[];
};

export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
/** Claude に渡す本文の上限（文字数）。これを超える分は切る（根拠文の照合も切った後の本文で行う） */
export const MAX_TEXT_CHARS = 100_000;
/** PDF のページ数の上限 */
export const MAX_PDF_PAGES = 500;
/** 記事サイトの「次のページ」を辿る上限（1 本の記事を複数ページに分ける媒体向け） */
export const MAX_HTML_PAGES = 5;
const USER_AGENT = "uchidai/0.0 (+https://github.com/securebase-jp/uchidai)";

// ---------------------------------------------------------------------------
// URL の検査（SSRF 対策）
// ---------------------------------------------------------------------------

/** 内部用・ローカル用として扱うホスト名の末尾 */
const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".test",
  ".invalid",
  ".onion",
];

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return undefined;
  return (
    ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0)
  );
}

/** 公開インターネットに向いていない IPv4（私設、ループバック、リンクローカル、CGNAT、文書用、マルチキャスト、予約） */
export function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === undefined) return true;
  const u = n >>> 0;
  const inRange = (cidr: string) => {
    const [base, bitsStr] = cidr.split("/");
    const b = (ipv4ToInt(base ?? "") ?? 0) >>> 0;
    const bits = Number(bitsStr);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (u & mask) === (b & mask);
  };
  return [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ].some(inRange);
}

/** IPv6 を 16 バイトに展開する（末尾が IPv4 の表記にも対応）。形が不正なら undefined */
function parseIpv6(ip: string): number[] | undefined {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tailV4: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const n = ipv4ToInt(tail);
    if (n === undefined) return undefined;
    tailV4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((h) => (h === "" ? Number.NaN : Number.parseInt(h, 16)));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if ([...head, ...rest].some((h) => Number.isNaN(h) || h < 0 || h > 0xffff)) return undefined;
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const hextets = [...head, ...Array(missing).fill(0), ...rest];
  const bytes = hextets.flatMap((h) => [(h >>> 8) & 255, h & 255]);
  if (tailV4.length === 4) bytes.splice(12, 4, ...tailV4);
  return bytes;
}

/** 公開インターネットに向いていない IPv6（未指定、ループバック、ユニークローカル、リンクローカル、マルチキャスト、IPv4 埋め込み） */
export function isPrivateIpv6(ip: string): boolean {
  const b = parseIpv6(ip);
  if (!b) return true;
  const allZeroPrefix = b.slice(0, 15).every((x) => x === 0);
  if (allZeroPrefix && ((b[15] ?? 0) === 0 || (b[15] ?? 0) === 1)) return true; // :: と ::1
  if (((b[0] ?? 0) & 0xfe) === 0xfc) return true; // fc00::/7
  if ((b[0] ?? 0) === 0xfe && ((b[1] ?? 0) & 0xc0) === 0x80) return true; // fe80::/10
  if ((b[0] ?? 0) === 0xff) return true; // ff00::/8
  if ((b[0] ?? 0) === 0x20 && (b[1] ?? 0) === 0x01 && (b[2] ?? 0) === 0x0d && (b[3] ?? 0) === 0xb8)
    return true; // 2001:db8::/32（文書用）
  // ::ffff:a.b.c.d（IPv4 射影）、64:ff9b::/96（NAT64）は埋め込まれた IPv4 で判定
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  const nat64 = b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b;
  // ::a.b.c.d（IPv4 互換。廃止された表記）も埋め込まれた IPv4 で判定する（SEC-008）
  const compat = b.slice(0, 12).every((x) => x === 0);
  if (mapped || nat64 || compat) return isPrivateIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) return isPrivateIpv6(ip);
  return true;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((a) => a.address);
}

/**
 * 取得してよい URL か検査し、正規化した URL を返す。
 * 公開の http(s) サイトだけを通し、内部ネットワークや自社ホストに向く URL は拒否する
 */
export async function assertAllowedUrl(urlStr: string, opts: FetchOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new ArticleFetchError("rejected", `URL の形式が正しくありません: ${urlStr}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new ArticleFetchError(
      "rejected",
      `取得できるのは http / https の URL だけです: ${url.protocol}`,
    );
  if (url.username || url.password)
    throw new ArticleFetchError("rejected", "認証情報を含む URL は取得しません");
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host) throw new ArticleFetchError("rejected", "URL にホスト名がありません");
  if (
    host === "localhost" ||
    INTERNAL_SUFFIXES.some((s) => host.endsWith(s)) ||
    !host.includes(".")
  )
    if (!isIP(host))
      throw new ArticleFetchError("rejected", `内部用のホスト名には接続しません: ${host}`);
  for (const blocked of opts.blockedHosts ?? []) {
    const b = blocked.toLowerCase().replace(/\.$/, "");
    if (b && (host === b || host.endsWith(`.${b}`)))
      throw new ArticleFetchError(
        "rejected",
        `このホストは取得の対象外です（自社のホストには接続しません）: ${host}`,
      );
  }
  if (isIP(host)) {
    if (isPrivateIp(host))
      throw new ArticleFetchError(
        "rejected",
        `内部ネットワークのアドレスには接続しません: ${host}`,
      );
    return url;
  }
  let addresses: string[];
  try {
    addresses = await (opts.lookup ?? defaultLookup)(host);
  } catch (e) {
    throw new ArticleFetchError(
      "dns",
      `ホスト名を解決できません（${host}）。URL に誤りがないか確かめるか、${PASTE_HINT_JA}`,
      { detail: e instanceof Error ? e.message : String(e), cause: e },
    );
  }
  if (addresses.length === 0)
    throw new ArticleFetchError(
      "dns",
      `ホスト名を解決できません（${host}）。URL に誤りがないか確かめるか、${PASTE_HINT_JA}`,
    );
  const bad = addresses.find((a) => isPrivateIp(a));
  if (bad)
    throw new ArticleFetchError(
      "rejected",
      `内部ネットワークのアドレスに解決されるホストには接続しません: ${host}`,
    );
  return url;
}

// ---------------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------------

/** 本文を上限まで読む。上限を超えたら打ち切って例外 */
/** 応答の本文の先頭 maxBytes だけを文字にする（読めなければ空文字）。断られた応答の中身を見るために使う */
async function peekBodyText(
  res: Response,
  signal: AbortSignal,
  maxBytes = 32_768,
): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // 読めなかった分は無視する
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, maxBytes));
}

async function readBody(res: Response, max: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max)
    throw new ArticleFetchError(
      "too_large",
      `取得したデータが大きすぎます: ${declared} bytes（上限 ${max}）`,
    );
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > max)
      throw new ArticleFetchError(
        "too_large",
        `取得したデータが大きすぎます: ${buf.byteLength} bytes（上限 ${max}）`,
      );
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal.aborted)
      throw new ArticleFetchError(
        "timeout",
        `記事の取得に時間がかかりすぎたため、やめました。${PASTE_HINT_JA}`,
      );
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ArticleFetchError(
        "too_large",
        `取得したデータが大きすぎます: ${total} bytes 以上（上限 ${max}）`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** URL からバイト列を取得する（記事サイト・公的機関の PDF 向け。自社ホストの調査には使わない） */
export async function downloadBytes(
  url: string,
  opts: FetchOptions = {},
): Promise<{ data: Uint8Array; contentType: string; finalUrl: string }> {
  // 同時の取得を抑える（SEC-006）。枠が空くまで待ってから、タイムアウトを数え始める
  return fetchSemaphore.run(() => downloadBytesNow(url, opts));
}

async function downloadBytesNow(
  url: string,
  opts: FetchOptions,
): Promise<{ data: Uint8Array; contentType: string; finalUrl: string }> {
  const doFetch = resolveFetch(opts.fetch);
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? 5;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  let current = await assertAllowedUrl(url, opts);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf,*/*;q=0.8" },
        signal,
        redirect: "manual",
      });
    } catch (e) {
      // サーバ側の検査（リダイレクト先が内部のアドレスなど）で止めた理由は、cause に残して呼び出し側が使えるようにする
      const detail = e instanceof Error ? e.message : String(e);
      if (signal.aborted)
        throw new ArticleFetchError(
          "timeout",
          `記事の取得に時間がかかりすぎたため、やめました（${current.hostname}）。${PASTE_HINT_JA}`,
          { detail, cause: e },
        );
      throw new ArticleFetchError(
        "network",
        `記事の取得に失敗しました（${current.hostname}）。サイトに接続できませんでした。${PASTE_HINT_JA}`,
        { detail, cause: e },
      );
    }
    if (REDIRECT_STATUSES.has(res.status) || res.type === "opaqueredirect") {
      const location = res.headers.get("location");
      if (!location)
        throw new ArticleFetchError("redirect", `リダイレクト先が分かりません: ${res.status}`);
      if (hop >= maxRedirects)
        throw new ArticleFetchError(
          "redirect",
          `リダイレクトが多すぎます（${maxRedirects} 回を超過）。${PASTE_HINT_JA}`,
        );
      await res.body?.cancel().catch(() => undefined);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new ArticleFetchError("redirect", `リダイレクト先の URL が不正です: ${location}`);
      }
      current = await assertAllowedUrl(next.toString(), opts);
      continue;
    }
    if (!res.ok) {
      // 403 は、本文にログインの語があるかで案内を分ける（先頭だけ読む）
      const errorBody = res.status === 403 ? await peekBodyText(res, signal) : undefined;
      await res.body?.cancel().catch(() => undefined);
      throw httpErrorToFetchError(res.status, errorBody);
    }
    const data = await readBody(res, max, signal);
    return {
      data,
      contentType: res.headers.get("content-type") ?? "",
      finalUrl: current.toString(),
    };
  }
}

function isPdf(contentType: string, url: string, data: Uint8Array): boolean {
  if (/application\/pdf/i.test(contentType)) return true;
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  return data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === "%PDF-";
}

// ---------------------------------------------------------------------------
// 文字コード
// ---------------------------------------------------------------------------

function sniffMetaCharset(data: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(data.subarray(0, 4096));
  const m =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ?? /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head);
  return m?.[1];
}

/**
 * HTML のバイト列を文字列にする。ヘッダ → meta → UTF-8 → Shift_JIS → EUC-JP の順に、
 * 不正なバイト列を含まずに読める文字コードを採る（宣言が間違っていても文字化けしにくい）
 */
export function decodeHtml(data: Uint8Array, contentType: string): string {
  const header = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const meta = sniffMetaCharset(data);
  const candidates = [header, meta, "utf-8", "shift_jis", "euc-jp"]
    .filter((c): c is string => Boolean(c))
    .map((c) => c.toLowerCase())
    .filter((c, i, a) => a.indexOf(c) === i);
  for (const cs of candidates) {
    try {
      return new TextDecoder(cs, { fatal: true }).decode(data);
    } catch {
      // この文字コードでは読めない（未対応のラベル、または不正なバイト列）。次の候補へ
    }
  }
  return new TextDecoder("utf-8").decode(data);
}

// ---------------------------------------------------------------------------
// 本文の整形と抽出
// ---------------------------------------------------------------------------

/** 本文テキストの整形：行頭行末の空白を落とし、3 行以上の空行を 1 行にする */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 本文を整え、空なら例外、長すぎれば切る */
function finishText(article: Article): Article {
  const text = tidyText(article.text);
  if (!text)
    throw new ArticleFetchError(
      "empty",
      "記事の本文を取り出せませんでした（本文が空です）。本文のある URL か、本文を貼り付けてください",
    );
  if (text.length > MAX_TEXT_CHARS)
    return { ...article, text: text.slice(0, MAX_TEXT_CHARS), truncated: true };
  return { ...article, text };
}

/** linkedom の DOM のうち使う部分だけ（DOM の型定義に依存しないため） */
type MinimalNode = {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<MinimalNode>;
};
type MinimalElement = MinimalNode & {
  textContent: string | null;
  remove(): void;
  getAttribute(name: string): string | null;
};

/** 改行として扱う要素（段落や見出しが 1 行にくっつかないように） */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "BR",
  "LI",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TR",
  "TD",
  "TH",
  "TABLE",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "BLOCKQUOTE",
  "PRE",
  "DL",
  "DT",
  "DD",
  "FIGCAPTION",
  "HR",
]);

/** DOM の木を、ブロック要素の境で改行しながらテキストにする（textContent は段落の境を落とすため） */
export function nodeToText(node: MinimalNode): string {
  const parts: string[] = [];
  const walk = (n: MinimalNode) => {
    if (n.nodeType === 3) {
      parts.push(n.nodeValue ?? "");
      return;
    }
    if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
    const block = BLOCK_TAGS.has(n.nodeName.toUpperCase());
    if (block) parts.push("\n");
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c) walk(c);
    }
    if (block) parts.push("\n");
  };
  walk(node);
  return parts.join("");
}
type MinimalDocument = {
  querySelectorAll(selector: string): Iterable<MinimalElement>;
  querySelector(selector: string): MinimalElement | null;
  body: MinimalElement | null;
  documentElement: MinimalElement | null;
};

/**
 * 本文の後ろに付く「関連記事」「おすすめ記事」「著作権表示」などの見出しの行。
 * 本文抽出（Readability）が記事本文と一緒に拾ってしまうことがあり、他社の事故の見出しが混ざると読解を惑わせる。
 * 見出し語は行頭の一致（「関連記事GMOに…」のように見出しの直後に続くことがある）、短い語は行全体の一致で見る
 */
const TRAILER_HEAD =
  /^(関連記事|関連リンク|関連する記事|あわせて読みたい|合わせて読みたい|おすすめ(の)?記事|人気(の)?記事|注目(の)?記事|新着記事|ピックアップ|この記事の著者|著者プロフィール|Copyright\s*[©(]|この記事をシェア)/i;
const TRAILER_WORD = /^(PR|\[PR\]|広告|Sponsored|SpecialPR|シェアする|タグ|カテゴリ[ー]?)$/i;

/** 本文とみなす最小の長さ。これより前に見出し語があっても（記事の冒頭の「PR」など）切らない */
const MIN_BODY_CHARS = 120;

/**
 * 本文の末尾に付いた関連記事などの塊を落とす。
 * 本文が MIN_BODY_CHARS 以上あったあと、最初に現れた見出し語の行から後ろを切る
 * （続きのページでは本文が短く、関連記事やピックアップの一覧の方が長いので、位置の割合では決められない）
 */
export function trimTrailer(text: string): string {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const t = line.trim();
    if (offset >= MIN_BODY_CHARS && (TRAILER_HEAD.test(t) || TRAILER_WORD.test(t)))
      return lines.slice(0, i).join("\n");
    offset += line.length + 1;
  }
  return text;
}

/**
 * メニューらしい行の連なり（短い行が 4 行以上続き、句読点がない）を落とす。
 * 記事サイトのヘッダのメニュー（「ニュース」「脆弱性」「コラム」…）が本文の前後に混ざるのを防ぐ
 */
export function dropMenuRuns(text: string): string {
  const lines = text.split("\n");
  const menuLike = (l: string) => {
    const t = l.trim();
    return t.length > 0 && t.length <= 10 && !/[。、.,：:]/.test(t);
  };
  const keep: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length < 4) keep.push(...run); // 4 行未満なら本文の短い行（見出しや金額）とみなして残す
    run = [];
  };
  for (const line of lines) {
    if (menuLike(line)) run.push(line);
    else {
      if (line.trim() === "" && run.length > 0) continue; // メニューの行間の空行
      flush();
      keep.push(line);
    }
  }
  flush();
  return keep.join("\n");
}

// ---------------------------------------------------------------------------
// 媒体の定型文・会員向けの案内・題の整理（TRIAL-013、R-008）、途中で切れた本文の検知（B-012）
// 取得の段階で、本文とタイトルから除く。読解も根拠文の照合も、除いたあとの本文で行うので、
// 根拠文（記事の文と一字一句一致）の約束は変わらない。除くのは「行ぜんたいが定型文」のときだけ
// ---------------------------------------------------------------------------

/** 媒体の定型文の行：サイトの紹介文、ページの境目に入る「（媒体名 - 日付）」の署名 */
const BOILERPLATE_LINE: RegExp[] = [
  /^([A-Za-z0-9 ]{2,30}では[、,])?最新の情報セキュリティに関するニュースを(日刊で)?お届けして(い|お)ます[。.]?$/,
  /^[（(][^（）()\n]{2,30}\s[-－―]\s\d{4}[/／.]\d{1,2}[/／.]\d{1,2}\s*[）)]$/,
];

/** 会員向けの案内の行（続きは会員登録・ログインが要る、など）。短い行だけを見る（本文の「会員サイト」などと区別するため） */
const MEMBER_WALL_LINE: RegExp[] = [
  /この記事は(有料)?(会員|購読者)(限定|のみ)/,
  /(有料)?会員(限定)?(の)?(記事|コンテンツ)です/,
  /(続き|全文)を(読む|ご覧いただく|閲覧する)(には|ためには)/,
  /(会員登録|ログイン|無料登録|ご登録)(を|して|すると|いただくと|することで)[^。]{0,24}(続き|全文|すべて|全て)/,
  /(すべて|全て)の記事が(読み放題|読めます)/,
  /(続き|残り)は(有料)?(会員|登録)/,
  /有料会員(になる|に登録|限定)/,
];
const MEMBER_WALL_MAX_LINE = 80;

/** 末尾が「続きを読む」のような、記事が途中で終わっていることを示す行 */
const READ_MORE_LINE =
  /^(…|\.\.\.|[.。]{3})?\s*(続きを読む|もっと読む|もっと見る|続きはこちら|Read more)\s*[»>＞]?$/i;

/**
 * 本文から媒体の定型文と会員向けの案内の行を除き、会員向けの案内があったかを返す。
 * 行ぜんたいが定型文のときだけ除く（本文の文の途中は触らない）
 */
export function stripBoilerplate(text: string): { text: string; memberWall: boolean } {
  let memberWall = false;
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t && BOILERPLATE_LINE.some((re) => re.test(t))) continue;
    if (t && t.length <= MEMBER_WALL_MAX_LINE && MEMBER_WALL_LINE.some((re) => re.test(t))) {
      memberWall = true;
      continue;
    }
    kept.push(line);
  }
  return { text: tidyText(kept.join("\n")), memberWall };
}

/**
 * 記事の題の末尾の、媒体が付けたページ番号と媒体名を除く：
 * 「…（1ページ目 / 全1ページ）：Security NEXT」「…（2ページ目」→ 「…」
 */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[（(]\s*\d+\s*ページ目[^）)]*[）)]?\s*(?:[：:｜|]\s*[^：:｜|]{1,30})?\s*$/, "")
    .replace(/\s*[（(]\s*全\s*\d+\s*ページ\s*[）)]\s*$/, "")
    .trim();
}

/** 文の終わりの記号（これで終わっていれば、見出しではなく文とみなす） */
const SENTENCE_END = /[。．.！？!?」』）)”"]$/;

/**
 * 本文が途中で切れていそうな理由を返す（無ければ空）。
 * 末尾が文でなく短い行（見出し）で終わっている、末尾が「続きを読む」、会員向けの案内があった、のいずれか。
 * 「可能性」の検知なので、誤って出ても読解の結果は変わらない（画面に案内を出すだけ）
 */
export function detectIncomplete(text: string, memberWall: boolean): IncompleteReason[] {
  const reasons: IncompleteReason[] = [];
  if (memberWall) reasons.push("members_only");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  const before = lines[lines.length - 2] ?? "";
  if (READ_MORE_LINE.test(last)) reasons.push("read_more");
  else if (
    lines.length >= 2 &&
    last.length <= 30 &&
    !SENTENCE_END.test(last) &&
    !/^[（(].*[）)]$/.test(last) &&
    !/^https?:\/\//i.test(last) &&
    SENTENCE_END.test(before)
  )
    reasons.push("ends_with_heading");
  return reasons;
}

/**
 * 本文がほとんど取れていないとき（TRIAL-I-002）の理由を返す（無ければ空）。HTML を取り込んだ結果にだけ使う。
 * 本文が 200 字に満たなければ too_short。400 字に満たず、Cookie・同意・著作権の語があり、事故の公表らしい語が無ければ consent_only
 */
export function detectThinBody(text: string): IncompleteReason[] {
  const reasons: IncompleteReason[] = [];
  const plain = text.replace(/\s+/g, "");
  if (plain.length < TOO_SHORT_CHARS) reasons.push("too_short");
  if (
    plain.length < CONSENT_ONLY_MAX_CHARS &&
    CONSENT_WORDS.test(text) &&
    !INCIDENT_WORDS.test(text)
  )
    reasons.push("consent_only");
  return reasons;
}

/** HTML の取り込み結果に、本文が取れていない印（too_short・consent_only）を足す */
function withThinBody(article: Article): Article {
  const thin = detectThinBody(article.text);
  if (thin.length === 0) return article;
  return { ...article, incomplete: [...(article.incomplete ?? []), ...thin] };
}

function parseDocument(html: string): MinimalDocument {
  const { document } = parseHTML(html) as unknown as { document: MinimalDocument };
  for (const el of Array.from(document.querySelectorAll("script,style,noscript,template")))
    el.remove();
  return document;
}

/** 本文でない部分の目印（Readability が本文を見つけられなかったときの素朴な抽出で落とす要素） */
const CHROME_SELECTOR =
  "nav,header,footer,aside,form,iframe,[role=navigation],[role=banner],[role=contentinfo],[role=complementary]";
const CHROME_CLASS =
  /(^|[-_ ])(nav|navi|menu|sidebar|side|footer|header|banner|ad|ads|advert|pr|related|recommend|pickup|ranking|share|sns|social|comment|breadcrumb|pager|pagination|copyright|search|login|tag|tags)($|[-_ ]|\d)/i;

/** ナビゲーションや広告らしい要素を落とす（class / id の名前で見る。本文らしい要素は残す） */
function removeChrome(document: MinimalDocument): void {
  for (const el of Array.from(document.querySelectorAll(CHROME_SELECTOR))) el.remove();
  for (const el of Array.from(document.querySelectorAll("[class],[id]"))) {
    const name = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
    if (CHROME_CLASS.test(name)) el.remove();
  }
}

/** Readability が本文とみなす最小の文字数（既定の 500 では短い続きのページで本文を見つけられない） */
const READABILITY_CHAR_THRESHOLD = 200;

/** 1 ページ分の HTML から題と本文を取り出す（本文の整形はしない） */
function extractHtmlPage(html: string): { title: string; text: string; memberWall: boolean } {
  const document = parseDocument(html);
  let title = document.querySelector("title")?.textContent?.trim() ?? "";
  let text = "";
  try {
    const result = new Readability(document as never, {
      charThreshold: READABILITY_CHAR_THRESHOLD,
    }).parse();
    if (result?.content && result.textContent && result.textContent.trim().length > 0) {
      // content（本文の HTML）をブロック要素の境で改行しながらテキストにする
      // linkedom は <html> で包まないと body の子要素を持たない
      const { document: page } = parseHTML(
        `<html><body>${result.content}</body></html>`,
      ) as unknown as { document: MinimalDocument };
      const pageBody = page.body ?? page.documentElement;
      text = pageBody ? nodeToText(pageBody) : "";
      if (!text.trim()) text = result.textContent;
      if (result.title) title = result.title;
    }
  } catch {
    // Readability が扱えない HTML は下の素朴な抽出に落とす
  }
  if (!text.trim()) {
    // Readability が本文を見つけられなかった：ナビゲーションや広告らしい要素を落としてから全体を読む
    removeChrome(document);
    const rootNode = document.body ?? document.documentElement;
    text = rootNode ? nodeToText(rootNode) : "";
  }
  // 関連記事などの見出し語で切ってから、メニューらしい行の連なりを落とす（先に落とすと見出し語ごと消えて切れなくなる）
  const stripped = stripBoilerplate(tidyText(text));
  return {
    title: cleanTitle(title),
    text: tidyText(dropMenuRuns(trimTrailer(stripped.text))),
    memberWall: stripped.memberWall,
  };
}

/** HTML から本文を取り出す（Readability。失敗したら body のテキスト）。末尾の関連記事などは落とす */
export function extractHtml(html: string, sourceUrl?: string): Article {
  return extractHtmlPages([html], sourceUrl);
}

/** 複数ページに分かれた記事の HTML をまとめて 1 本の本文にする（題は最初のページから） */
export function extractHtmlPages(htmls: string[], sourceUrl?: string): Article {
  const pages = htmls.map(extractHtmlPage);
  const title = pages.find((p) => p.title)?.title ?? "";
  const article: Article = {
    kind: "html",
    text: pages.map((p) => p.text).join("\n\n"),
    htmlPages: htmls.length,
  };
  if (title) article.title = title.slice(0, 300);
  if (sourceUrl) article.sourceUrl = sourceUrl;
  const finished = finishText(article);
  const incomplete = detectIncomplete(
    finished.text,
    pages.some((p) => p.memberWall),
  );
  return incomplete.length > 0 ? { ...finished, incomplete } : finished;
}

/** 現在の URL から見て「次のページ」になり得る URL（同じ記事の続き）。/166531 → /166531/2、/166531/2 → /166531/3 */
function nextPageCandidates(current: URL): string[] {
  const out = new Set<string>();
  const path = current.pathname.replace(/\/$/, "");
  // 末尾の数字が 2〜MAX_HTML_PAGES のときだけページ番号とみなす（/166531 のような記事 ID と区別する）。
  // /2024/11/2 のような日付のパスの末尾は日であってページ番号ではない（翌日の記事を続きとして辿らない）
  const m = /^(.*)\/(\d+)$/.exec(path);
  const n = m?.[2] !== undefined ? Number(m[2]) : Number.NaN;
  const dateLike = m?.[1] !== undefined && /\/\d{4}\/\d{1,2}$/.test(m[1]);
  const bases =
    m?.[1] !== undefined && !dateLike && n >= 2 && n <= MAX_HTML_PAGES
      ? [`${m[1]}/${n + 1}`]
      : dateLike
        ? []
        : [`${path}/2`];
  for (const b of bases) {
    for (const suffix of ["", "/"]) {
      const u = new URL(current.toString());
      u.pathname = `${b}${suffix}`;
      u.search = "";
      u.hash = "";
      out.add(u.toString());
    }
  }
  const page = current.searchParams.get("page");
  const u = new URL(current.toString());
  u.hash = "";
  u.searchParams.set("page", page && /^\d+$/.test(page) ? String(Number(page) + 1) : "2");
  out.add(u.toString());
  return [...out];
}

/**
 * 記事の「次のページ」へのリンクを探す。見つからなければ undefined。
 * 同じホストで、現在の URL にページ番号を足した形（/2、/3、?page=2）のリンクだけを「続き」とみなす。
 * rel="next" は、ブログでは別の記事を指すことがあるので、それだけでは辿らない（ページ番号の形にも合うときだけ）
 */
export function findNextPageUrl(html: string, currentUrl: string): string | undefined {
  let current: URL;
  try {
    current = new URL(currentUrl);
  } catch {
    return undefined;
  }
  const document = parseDocument(html);
  const candidates = new Set(nextPageCandidates(current));
  const asCandidate = (href: string | null): string | undefined => {
    if (!href) return undefined;
    try {
      const u = new URL(href, current);
      if (u.hostname !== current.hostname) return undefined;
      u.hash = "";
      const s = u.toString();
      return candidates.has(s) ? s : undefined;
    } catch {
      return undefined;
    }
  };
  for (const sel of ['link[rel="next"]', 'a[rel="next"]', "a[href]"]) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const u = asCandidate(el.getAttribute("href"));
      if (u) return u;
    }
  }
  return undefined;
}

/** URL から取得した結果：PDF のバイト列か、記事の HTML（分割されていれば続きのページも） */
export type DownloadedArticle =
  | { kind: "pdf"; data: Uint8Array; finalUrl: string }
  | { kind: "html"; htmls: string[]; finalUrl: string };

/**
 * 記事の URL を取得し、HTML なら「次のページ」を MAX_HTML_PAGES まで辿る。
 * 続きのページも downloadBytes を通すので、URL の検査（SSRF 対策）とサイズ・時間の上限は 1 ページごとに効く
 */
export async function downloadArticle(
  url: string,
  opts: FetchOptions = {},
): Promise<DownloadedArticle> {
  const first = await downloadBytes(url, opts);
  if (isPdf(first.contentType, first.finalUrl, first.data))
    return { kind: "pdf", data: first.data, finalUrl: first.finalUrl };
  const htmls = [decodeHtml(first.data, first.contentType)];
  const seen = new Set([url, first.finalUrl]);
  let current = first.finalUrl;
  for (let page = 1; page < MAX_HTML_PAGES; page++) {
    const html = htmls[htmls.length - 1] ?? "";
    const next = findNextPageUrl(html, current);
    if (!next || seen.has(next)) break;
    seen.add(next);
    let res: Awaited<ReturnType<typeof downloadBytes>>;
    try {
      res = await downloadBytes(next, opts);
    } catch {
      break; // 続きが取れなくても、取れたページまでで読む
    }
    if (isPdf(res.contentType, res.finalUrl, res.data)) break;
    htmls.push(decodeHtml(res.data, res.contentType));
    current = res.finalUrl;
    seen.add(res.finalUrl);
  }
  return { kind: "html", htmls, finalUrl: first.finalUrl };
}

/** "27" / "27-29" / "27,29-30" のような指定を 1 始まりのページ番号の配列にする */
export function parsePageRange(spec: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(/[,\s、]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–〜~]\s*(\d+))?$/.exec(part.normalize("NFKC"));
    if (!m?.[1]) throw new ArticleFetchError("bad_input", `ページ指定を解釈できません: "${part}"`);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from)
      throw new ArticleFetchError("bad_input", `ページ指定が不正です: "${part}"`);
    for (let p = from; p <= Math.min(to, totalPages); p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/** PDF でなかったバイト列の案内。HTML が返っているときは、そう伝える（同意の画面などのことが多い） */
function notPdfMessage(data: Uint8Array): string {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(data.subarray(0, 512))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  if (/^(<!doctype html|<html|<head|<body|<meta|<\?xml)/.test(head))
    return `PDF ではなく HTML が返りました（同意の画面かもしれません）。${PASTE_HINT_JA}`;
  return "PDF として読めません（先頭が %PDF- ではありません）";
}

/** PDF の全ページのテキスト（ページごと）。大きすぎる PDF は読まない */
export async function extractPdfPages(
  data: Uint8Array,
  opts: { maxBytes?: number } = {},
): Promise<string[]> {
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (data.byteLength > max)
    throw new ArticleFetchError(
      "too_large",
      `PDF が大きすぎます: ${data.byteLength} bytes（上限 ${max}）`,
    );
  if (data.byteLength < 5 || String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-")
    throw new ArticleFetchError("bad_pdf", notPdfMessage(data));
  // pdf.js は渡したバッファを worker へ移譲（detach）するので、呼び出し側が再利用できるよう複製を渡す
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(data.slice());
  } catch (e) {
    throw new ArticleFetchError(
      "bad_pdf",
      "PDF を開けませんでした（壊れているか、パスワードで保護されている可能性があります）",
      { detail: e instanceof Error ? e.message : String(e), cause: e },
    );
  }
  if (pdf.numPages > MAX_PDF_PAGES)
    throw new ArticleFetchError(
      "bad_pdf",
      `PDF のページ数が多すぎます: ${pdf.numPages}（上限 ${MAX_PDF_PAGES}）`,
    );
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/**
 * 事例集の「N．見出し」で始まるページを探す（IPA 事例集のような、1 事例 1 ページ前後の資料向け）。
 * 一覧ページ（「一覧」を含む）は除く。複数の章が同じ番号を使うときは mustInclude で絞る。見つからなければ空配列。
 */
export function findCasePages(pages: string[], caseNumber: number, mustInclude?: string): number[] {
  const head = new RegExp(`^\\s*${caseNumber}\\s*[.．]\\s*\\S`, "m");
  const need = mustInclude ? mustInclude.normalize("NFKC") : undefined;
  const hits: number[] = [];
  pages.forEach((p, i) => {
    const t = p.normalize("NFKC");
    if (head.test(t) && !/一覧/.test(t) && (need === undefined || t.includes(need)))
      hits.push(i + 1);
  });
  return hits;
}

type PdfOptions = {
  pages?: string;
  caseNumber?: number;
  mustInclude?: string;
  sourceUrl?: string;
  maxBytes?: number;
};

function pdfOptions(
  input: { pages?: string; caseNumber?: number; mustInclude?: string },
  sourceUrl: string | undefined,
  maxBytes: number | undefined,
): PdfOptions {
  const o: PdfOptions = {};
  if (input.pages) o.pages = input.pages;
  if (input.caseNumber !== undefined) o.caseNumber = input.caseNumber;
  if (input.mustInclude) o.mustInclude = input.mustInclude;
  if (sourceUrl) o.sourceUrl = sourceUrl;
  if (maxBytes !== undefined) o.maxBytes = maxBytes;
  return o;
}

export async function extractPdf(data: Uint8Array, opts: PdfOptions = {}): Promise<Article> {
  const all = await extractPdfPages(
    data,
    opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {},
  );
  let selected: number[];
  if (opts.pages) selected = parsePageRange(opts.pages, all.length);
  else if (opts.caseNumber !== undefined) {
    selected = findCasePages(all, opts.caseNumber, opts.mustInclude);
    if (selected.length === 0)
      throw new ArticleFetchError(
        "bad_input",
        `事例 ${opts.caseNumber} の見出しが PDF に見つかりません`,
      );
  } else selected = all.map((_, i) => i + 1);
  if (selected.length === 0)
    throw new ArticleFetchError("bad_input", "指定したページが PDF にありません");
  const text = selected.map((p) => all[p - 1] ?? "").join("\n\n");
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 4 && !/^\d+$/.test(l));
  const article: Article = {
    kind: "pdf",
    text,
    pages: selected,
    totalPages: all.length,
  };
  if (firstLine) article.title = firstLine.slice(0, 300);
  if (opts.sourceUrl) article.sourceUrl = opts.sourceUrl;
  return finishText(article);
}

/** 記事を取り込む。URL は HTML か PDF かを内容で判別する */
export async function fetchArticle(input: ArticleInput, opts: FetchOptions = {}): Promise<Article> {
  switch (input.kind) {
    case "text": {
      const a: Article = { kind: "text", text: input.text };
      if (input.title) a.title = input.title.slice(0, 300);
      if (input.sourceUrl) a.sourceUrl = input.sourceUrl;
      return finishText(a);
    }
    case "html":
      return withThinBody(extractHtml(input.html, input.sourceUrl));
    case "pdf":
      return extractPdf(input.data, pdfOptions(input, input.sourceUrl, opts.maxBytes));
    case "url": {
      const downloaded = await downloadArticle(input.url, opts);
      if (downloaded.kind === "pdf")
        return extractPdf(downloaded.data, pdfOptions(input, input.url, opts.maxBytes));
      return withThinBody(extractHtmlPages(downloaded.htmls, input.url));
    }
  }
}
