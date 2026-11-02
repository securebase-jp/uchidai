/** ハッシュによる画面の切り替え：#/ #/questions #/staff #/exec #/answer/:token */
import { useEffect, useState } from "react";

export type Route = "home" | "questions" | "staff" | "exec" | "answer";

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "").split("?")[0];
  if (h?.startsWith("answer/")) return "answer";
  if (h === "questions" || h === "staff" || h === "exec") return h;
  return "home";
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return [route, (r) => (location.hash = r === "home" ? "/" : `/${r}`)];
}

/** #/answer/:token のトークン（回答ページ用） */
export function answerToken(): string | undefined {
  return /^#\/answer\/([A-Za-z0-9_-]+)/.exec(location.hash)?.[1];
}
