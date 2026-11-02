/** ハッシュによる画面の切り替え：#/ #/questions #/staff #/exec */
import { useEffect, useState } from "react";

export type Route = "home" | "questions" | "staff" | "exec";

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "").split("?")[0];
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
