/**
 * 起動処理（launcher.mjs）が使う、副作用のない部品。単体でテストできるよう別のファイルにしている。
 * ZIP の runtime/ に launcher.mjs と一緒に置かれる（依存は Node の標準だけ）
 */
import net from "node:net";
import { join } from "node:path";
import { parseEnv } from "node:util";

export const DEFAULT_PORT = 8787;
/** 使用中のときに試す、次のポートの数 */
export const PORT_TRIES = 20;
const HOST = "127.0.0.1";

/** 保存先（確認依頼などの .data）。フォルダを差し替えても残るよう、ユーザー領域に置く */
export function defaultDataDir({ platform, env, home }) {
  if (platform === "win32") {
    const base = env.APPDATA || join(home, "AppData", "Roaming");
    return join(base, "uchidai");
  }
  if (platform === "darwin") return join(home, "Library", "Application Support", "uchidai");
  const base = env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(base, "uchidai");
}

/** uchidai.env の中身を読む。メモ帳が付ける BOM を除く。値は返すだけで、表示しない */
export function parseEnvFile(text) {
  return parseEnv(text.replace(/^\uFEFF/, ""));
}

/** プロセスの環境変数が先、ファイルは足りないものだけ補う（Node の --env-file と同じ向き） */
export function mergeEnv(processEnv, fileEnv) {
  const merged = { ...processEnv };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (merged[key] === undefined || merged[key] === "") merged[key] = value;
  }
  return merged;
}

/** 指定のポートが 127.0.0.1 で使えるか */
export function isPortFree(port, host = HOST) {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

/** start から順に tries 個まで試し、最初に空いているポートを返す。無ければ undefined */
export async function findFreePort(start, tries = PORT_TRIES, check = isPortFree) {
  for (let port = start; port < start + tries && port <= 65535; port++) {
    if (await check(port)) return port;
  }
  return undefined;
}

/** ポート番号として正しい文字列か（1〜65535 の整数） */
export function parsePort(value) {
  if (!/^\d{1,5}$/.test(String(value ?? ""))) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/** ブラウザを開くコマンド */
export function openCommand(platform, url) {
  if (platform === "win32") return { command: "cmd.exe", args: ["/d", "/c", "start", '""', url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

/** すでにウチダイが動いているポートか（/api/health が { ok: true } を返す） */
export async function isUchidaiRunning(port, fetchFn = fetch) {
  try {
    const res = await fetchFn(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true && "readAvailable" in body;
  } catch {
    return false;
  }
}
