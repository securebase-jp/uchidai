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

/** ログに出す URL：ホスト名だけ残し、ユーザー情報・パス・クエリ・フラグメントを伏せる（SEC-015） */
const URL_LIKE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#'"<>)\]]*)([^\s'"<>)\]]*)/gi;

export function redactUrls(text: string): string {
  return text.replace(URL_LIKE, (_m, scheme: string, authority: string, rest: string) => {
    const host = authority.includes("@")
      ? authority.slice(authority.lastIndexOf("@") + 1)
      : authority;
    return `${scheme}://${host}${rest ? "/[省略]" : ""}`;
  });
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
