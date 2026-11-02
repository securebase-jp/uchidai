/** ハッシュによる画面の切り替え：#/ #/questions #/profile #/staff #/exec #/onepager #/answer/:token */
import { useEffect, useMemo, useState } from "react";

export type Route = "home" | "questions" | "profile" | "staff" | "exec" | "onepager" | "answer";

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "").split("?")[0];
  if (h?.startsWith("answer/")) return "answer";
  if (h === "questions" || h === "profile" || h === "staff" || h === "exec" || h === "onepager")
    return h;
  return "home";
}

export function useRoute(): [Route, (r: Route) => void] {
  // ハッシュ全体を状態に持つ（#/answer/A → #/answer/B のように route が同じでも再描画する）
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const route = useMemo(() => parse(hash), [hash]);
  return [route, (r) => (location.hash = r === "home" ? "/" : `/${r}`)];
}

/** #/answer/:token のトークン（回答ページ用） */
export function answerToken(): string | undefined {
  return /^#\/answer\/([A-Za-z0-9_-]+)/.exec(location.hash)?.[1];
}
