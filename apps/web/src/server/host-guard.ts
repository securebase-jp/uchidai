/**
 * Host ヘッダの確認（SEC-003）。手元のサーバに、攻撃者のドメインを 127.0.0.1 に向けた DNS の付け替えで
 * 同一生成元として届く要求（Host が attacker.example:8787 になる）を断る。
 *
 * 通すもの：localhost、127.0.0.1、[::1]（ポートは任意）、環境変数 UCHIDAI_ALLOWED_HOSTS（カンマ区切り。ポート付きも可）。
 * Host が無い要求（HTTP/1.0、app.request のテスト）は通す。公開 URL（転送ヘッダつき、または接続元がループバックでない）
 * は remote-guard が見るので、ここでは見ない（isRemote のとき飛ばす）。
 * Vite のプロキシは changeOrigin で Host を 127.0.0.1:<API_PORT> に書き換える。ポータブル ZIP は http://127.0.0.1:<port>/ を開く。
 * Docker はコンテナの中で Host: localhost:8787 や 127.0.0.1:8787 で届く
 */
import type { MiddlewareHandler } from "hono";
import { isRemote, optionsFromEnv, type RemoteGuardOptions } from "./remote-guard.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Host の値からホスト名の部分を取り出す（[::1]:8787 → [::1]、localhost:5173 → localhost） */
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const i = h.indexOf(":");
  return i < 0 ? h : h.slice(0, i);
}

export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.UCHIDAI_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** 手元の名前か（追加の許可リストは、ポート付きの完全一致か、ホスト名だけの一致） */
export function isAllowedHost(host: string, extra: ReadonlySet<string>): boolean {
  const h = host.trim().toLowerCase();
  const name = hostnameOf(h);
  if (LOCAL_HOSTS.has(name)) return true;
  return extra.has(h) || extra.has(name);
}

export type HostGuardOptions = {
  allowed?: ReadonlySet<string>;
  remote?: RemoteGuardOptions;
};

export function hostGuard(opts: HostGuardOptions = {}): MiddlewareHandler {
  const extra = opts.allowed ?? allowedHostsFromEnv();
  // 「外から」の判定は remote-guard と同じ設定で行う（Docker の UCHIDAI_TRUST_PRIVATE_PEER=1 を含む）
  const remote = opts.remote ?? optionsFromEnv();
  return async (c, next) => {
    const host = c.req.raw.headers.get("host");
    if (host === null || host === "") return next();
    if (isRemote(c, remote)) return next();
    if (isAllowedHost(host, extra)) return next();
    return c.json(
      {
        error:
          "この名前では手元のサーバに接続できません。http://localhost または http://127.0.0.1 で開いてください（別の名前を使うときは UCHIDAI_ALLOWED_HOSTS に足します）",
      },
      421,
    );
  };
}
