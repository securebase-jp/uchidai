/**
 * 共有リンクの読み書き：#/onepager?profile=demo-seiko&case=ipa-case-1&measures=vpn-update,edr
 * URL だけで一枚を再現できる（カルテは examples/ か、このブラウザの localStorage）。
 */
import { useEffect, useState } from "react";

export type OnePagerParams = {
  profile?: string;
  case?: string;
  /** undefined は「画面の状態に従う」、[] は「対策なし」 */
  measures?: string[];
  rewrite: boolean;
};

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseOnePagerHash(hash: string = location.hash): OnePagerParams {
  const q = hash.split("?")[1] ?? "";
  const p = new URLSearchParams(q);
  const out: OnePagerParams = { rewrite: p.get("rewrite") !== "0" };
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

export function useOnePagerParams(): OnePagerParams {
  const [params, setParams] = useState<OnePagerParams>(() => parseOnePagerHash());
  useEffect(() => {
    const on = () => setParams(parseOnePagerHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return params;
}
