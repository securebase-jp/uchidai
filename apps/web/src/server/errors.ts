/**
 * API のエラー応答。利用者に見せる文言だけを返し、スタック・内部パス・環境変数・キーの断片は出さない。
 */

import type { FetchFailReason } from "../shared/api.ts";

/** 入力の問題（400 系）。message はそのまま画面に出してよい日本語 */
export class ClientError extends Error {
  readonly status: 400 | 403 | 404 | 413 | 422 | 429 | 503;
  /** 記事を取得できなかった理由（画面が案内を出し分ける） */
  readonly reason: FetchFailReason | undefined;
  constructor(status: ClientError["status"], message: string, reason?: FetchFailReason) {
    super(message);
    this.name = "ClientError";
    this.status = status;
    this.reason = reason;
  }
}

const MAX_MESSAGE = 300;
/** Anthropic のキーの形（万一メッセージに混じっても出さない） */
const KEY_LIKE = /sk-ant-[A-Za-z0-9_-]{8,}/g;
/** 絶対パス（/Users/..、/home/..、C:\..）。内部の配置を外に出さない。URL の中のパス（://x/a）は対象外 */
const ABS_PATH = /(?<![:\w/])(?:[A-Za-z]:\\|\/)(?:[\w.-]+[\\/]){1,}[\w.-]*/g;
/** 環境変数らしき語 */
const ENV_LIKE = /\b(?:ANTHROPIC_API_KEY|SMTP_URL|MAIL_FROM)\s*[=:]\s*\S+/g;

/**
 * 利用者に返してよいメッセージに整える。
 * Error 以外、空、長すぎるもの、パスやキーを含むものは一般的な文言に落とす
 */
export function publicMessage(err: unknown, fallback = "サーバ側でエラーが起きました"): string {
  if (!(err instanceof Error) || !err.message) return fallback;
  let m = err.message
    .replace(KEY_LIKE, "[キー]")
    .replace(ENV_LIKE, "[環境変数]")
    .replace(ABS_PATH, "[パス]")
    .replace(/\s+/g, " ")
    .trim();
  if (!m) return fallback;
  if (m.length > MAX_MESSAGE) m = `${m.slice(0, MAX_MESSAGE - 1)}…`;
  return m;
}

/** zod の検証エラーを 400 の応答の形にする（項目名だけを出す。入力の値やスタックは出さない） */
export function zodErrorBody(err: { issues: { path: PropertyKey[]; message: string }[] }): {
  error: string;
  details: { path: PropertyKey[]; message: string }[];
} {
  const details = err.issues.slice(0, 20).map((i) => ({ path: i.path, message: i.message }));
  // 画面が原因を案内できるよう、どの項目で落ちたか（zod の path）を日本語の文に含める
  const where = [...new Set(err.issues.map((i) => i.path.map(String).join(".") || "(全体)"))];
  const shown = where.slice(0, 3).join("、") + (where.length > 3 ? " ほか" : "");
  return { error: `入力の形式が正しくありません（項目：${shown}）`, details };
}

/**
 * ログに出す URL：ホスト名だけ残し、ユーザー情報・パス・クエリ・フラグメントを伏せる（SEC-015、LG-001）。
 * 3 つの形を、それぞれ 1 回の走査で伏せる（どの形も開始位置からの走査に上限があり、長い入力でも長さに比例する。LG-002）
 *   1. スキームつき（https://…。IPv6 の [..] のホストも）
 *   2. スキームなしの // で始まるもの（//cdn.example/x）
 *   3. スキームなしの www. で始まるもの（www.example.com/x）
 * パスの ) や引用符で止めず、空白と <> まで伏せる。URL のあとにつく句読点・閉じ括弧・引用符だけは残す
 */
const IPV6_HOST = String.raw`\[[^\]\s/]{0,64}\](?::\d{1,5})?`;
const URL_SCHEME_LIKE = new RegExp(
  String.raw`\b([a-z][a-z0-9+.-]{0,30}):\/\/(${IPV6_HOST}|[^\s/?#'"<>)]*)([^\s<>]*)`,
  "gi",
);
const URL_SLASH_LIKE = new RegExp(
  String.raw`(?<![\w:/.@-])\/\/(?:[^\s/?#@<>'"]{0,100}@)?(${IPV6_HOST}|[\w-]{1,63}(?:\.[\w-]{1,63}){1,10}(?::\d{1,5})?)([^\s<>]*)`,
  "gi",
);
const URL_WWW_LIKE =
  /(?<![\w:/.@-])(www\.[\w-]{1,63}(?:\.[\w-]{1,63}){0,10}(?::\d{1,5})?)([/?#][^\s<>]*)/gi;
/** URL のあとにつく文の記号。ここは伏せずに残す（URL の一部とは見なさない） */
const AFTER_URL = new Set([..."()]}'\".,;:!?、。」』）"]);

/** ホストのあとに続く部分を「/[省略]」にする。末尾の記号だけは残す */
function redactRest(rest: string): string {
  let end = rest.length;
  while (end > 0 && AFTER_URL.has(rest[end - 1] as string)) end--;
  return (end > 0 ? "/[省略]" : "") + rest.slice(end);
}

function hostOf(authority: string): string {
  return authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
}

export function redactUrls(text: string): string {
  return text
    .replace(
      URL_SCHEME_LIKE,
      (_m, scheme: string, authority: string, rest: string) =>
        `${scheme}://${hostOf(authority)}${redactRest(rest)}`,
    )
    .replace(
      URL_SLASH_LIKE,
      (_m, authority: string, rest: string) => `//${authority}${redactRest(rest)}`,
    )
    .replace(URL_WWW_LIKE, (_m, host: string, rest: string) => `${host}${redactRest(rest)}`);
}

function errorText(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return typeof err === "string" ? err : String(err);
  const own = err.stack ?? `${err.name}: ${err.message}`;
  if (depth >= 3 || err.cause === undefined) return own;
  return `${own}\nCaused by: ${errorText(err.cause, depth + 1)}`;
}

/**
 * 500 などの例外を標準エラーに出す。既定は例外をそのまま出す（原因の調査に記事の URL が要るため）。
 * UCHIDAI_LOG_REDACT_URLS=1 のときは、文にして URL のパスとクエリを伏せてから出す
 */
export function logError(label: string, err: unknown): void {
  if (process.env.UCHIDAI_LOG_REDACT_URLS === "1") console.error(label, redactUrls(errorText(err)));
  else console.error(label, err);
}
