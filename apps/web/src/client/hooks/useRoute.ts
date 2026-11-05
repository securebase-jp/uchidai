/** ハッシュによる画面の切り替え：#/ #/domain #/questions #/profile #/staff #/exec #/onepager #/sources */
import { useEffect, useMemo, useState } from "react";

export type Route =
  | "home"
  | "domain"
  | "questions"
  | "profile"
  | "staff"
  | "exec"
  | "onepager"
  | "sources";

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "").split("?")[0];
  if (
    h === "domain" ||
    h === "questions" ||
    h === "profile" ||
    h === "staff" ||
    h === "exec" ||
    h === "onepager" ||
    h === "sources"
  )
    return h;
  return "home";
}

export function useRoute(): [Route, (r: Route) => void] {
  // ハッシュ全体を状態に持つ（共有リンクの一枚は #/onepager?d=… のように route が同じでも中身が変わる）
  const [hash, setHash] = useState(() => (typeof location === "undefined" ? "" : location.hash));
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const route = useMemo(() => parse(hash), [hash]);
  return [route, (r) => (location.hash = r === "home" ? "/" : `/${r}`)];
}
