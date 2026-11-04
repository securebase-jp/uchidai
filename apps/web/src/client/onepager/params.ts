/**
 * 共有リンクの読み書き。2 つの形がある：
 * - 内容を載せた形（主）：#/onepager?d=<base64url(deflate(JSON))>。一枚の内容そのものが URL に入る（lib/onepager-share.ts）。
 *   カルテが無いスマホでも開ける
 * - ID で指す形（架空の会社の記録向け）：#/onepager?profile=demo-seiko&case=ipa-case-1&measures=vpn-update,edr。
 *   カルテは examples/ か、このブラウザの localStorage に無いと再現できない
 */
import { useEffect, useState } from "react";

export type OnePagerParams = {
  /** 内容を載せた共有リンクの本体（base64url）。あるときは他の指定より優先する */
  d?: string;
  profile?: string;
  case?: string;
  /** undefined は「画面の状態に従う」、[] は「対策なし」 */
  measures?: string[];
  rewrite: boolean;
  /** ボタンを押さなくても作る（録画・テスト用）。generate=1 */
  generate?: boolean;
};

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseOnePagerHash(hash: string = location.hash): OnePagerParams {
  const q = hash.slice(hash.indexOf("?") + 1 || hash.length);
  const p = new URLSearchParams(q);
  const out: OnePagerParams = { rewrite: p.get("rewrite") !== "0" };
  if (p.get("generate") === "1") out.generate = true;
  // d= は形が崩れていても渡す（開く側が「壊れています」と理由を出す。黙ってカルテの一枚に落とさない）
  const d = p.get("d");
  if (d) out.d = d;
  const profile = p.get("profile");
  if (profile && SAFE_ID.test(profile)) out.profile = profile;
  const c = p.get("case");
  if (c && SAFE_ID.test(c)) out.case = c;
  const m = p.get("measures");
  if (m !== null)
    out.measures = m
      .split(",")
      .map((s) => s.trim())
      .filter((s) => SAFE_ID.test(s));
  return out;
}

export function buildOnePagerHash(params: {
  profile?: string | undefined;
  case?: string | undefined;
  measures?: string[] | undefined;
}): string {
  const p = new URLSearchParams();
  if (params.profile) p.set("profile", params.profile);
  if (params.case) p.set("case", params.case);
  if (params.measures) p.set("measures", params.measures.join(","));
  const q = p.toString();
  return q ? `#/onepager?${q}` : "#/onepager";
}

/** いまのハッシュの、rewrite だけを付け替えたハッシュ。Claude（既定）は rewrite を書かず、テンプレートは rewrite=0 */
export function withRewrite(hash: string, rewrite: boolean): string {
  const i = hash.indexOf("?");
  const path = i < 0 ? hash : hash.slice(0, i);
  const p = new URLSearchParams(i < 0 ? "" : hash.slice(i + 1));
  if (rewrite) p.delete("rewrite");
  else p.set("rewrite", "0");
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

export function useOnePagerParams(): OnePagerParams {
  const [params, setParams] = useState<OnePagerParams>(() => parseOnePagerHash());
  useEffect(() => {
    const on = () => setParams(parseOnePagerHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return params;
}
