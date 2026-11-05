/**
 * API のエラー応答。利用者に見せる文言だけを返し、スタック・内部パス・環境変数・キーの断片は出さない。
 */

/** 入力の問題（400 系）。message はそのまま画面に出してよい日本語 */
export class ClientError extends Error {
  readonly status: 400 | 403 | 404 | 413 | 422 | 429 | 503;
  constructor(status: ClientError["status"], message: string) {
    super(message);
    this.name = "ClientError";
    this.status = status;
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
